from fastapi import FastAPI, APIRouter, Depends, Header, HTTPException, UploadFile, File, Query
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import re
import json
import uuid
import hashlib
import secrets
import logging
import tempfile
import asyncio
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

import bcrypt
from pydantic import BaseModel, Field, field_validator

from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContentWithMimeType, TextDelta, StreamDone

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

DEFAULT_PASSWORD = os.environ['UFFICIO_DEFAULT_PASSWORD']
EMERGENT_LLM_KEY = os.environ['EMERGENT_LLM_KEY']
SESSION_TTL = 60 * 60 * 24 * 7

app = FastAPI()
api = APIRouter(prefix="/api")
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


def now() -> datetime:
    return datetime.now(timezone.utc)


def now_iso() -> str:
    return now().isoformat()


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def check_password(pw: str, stored: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), stored.encode())
    except ValueError:
        return False


# ── Models ────────────────────────────────────────────────────────────────────
class BaseDocument(BaseModel):
    @classmethod
    def from_mongo(cls, doc: dict):
        return cls(**{k: v for k, v in doc.items() if k != "_id"})

    def to_mongo(self) -> dict:
        return self.model_dump()


class Pedana(BaseDocument):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    numeroOrdine: str
    agenzia: str = ""
    trasportatore: str = ""
    mittente: str
    dataConsegna: str
    note: str = ""
    codice: str
    destinazione: str
    numeroColli: str = ""
    numeroPedane: str = ""
    merce: str = ""
    dataArrivo: str = ""
    oraArrivo: str = ""
    createdAt: str = Field(default_factory=now_iso)
    ultimaRettifica: Optional[str] = None
    statoArrivo: Literal["attesa", "parziale", "completo"] = "attesa"
    arrivoParzialeAt: Optional[str] = None
    arrivoCompletoAt: Optional[str] = None
    noteParziale: str = ""
    arrivoParzialeDa: str = ""
    arrivoCompletoDa: str = ""
    archiviato: bool = False
    archiviatoAt: Optional[str] = None
    ripristinato: bool = False


class OrdineForm(BaseModel):
    numeroOrdine: str
    agenzia: str = ""
    trasportatore: str = ""
    mittente: str = ""
    dataConsegna: str
    note: str = ""


class PedanaIn(BaseModel):
    codice: str
    destinazione: str
    numeroColli: str = ""
    numeroPedane: str = ""
    mittente: str = ""
    merce: str = ""
    dataArrivo: str = Field(default="", pattern=r"^(\d{4}-\d{2}-\d{2})?$")
    oraArrivo: str = Field(default="", pattern=r"^(([01]?\d|2[0-3]):[0-5]\d)?$")

    @field_validator("dataArrivo", "oraArrivo", mode="before")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("dataArrivo")
    @classmethod
    def _data_valida(cls, v: str):
        if v:
            datetime.strptime(v, "%Y-%m-%d")
        return v


class CreateReq(BaseModel):
    form: OrdineForm
    pedane: List[PedanaIn]


class UpdateReq(BaseModel):
    form: OrdineForm
    pedana: PedanaIn


class DupReq(BaseModel):
    numeroOrdine: str = ""
    codici: List[str] = []
    excludeId: Optional[str] = None


class StatoReq(BaseModel):
    stato: Literal["attesa", "parziale", "completo"]
    noteParziale: str = ""


class ScaricaOrdineReq(BaseModel):
    numeroOrdine: str = Field(min_length=1)


class RipristinaReq(BaseModel):
    numeroOrdine: str = Field(min_length=1)


PIN_PATTERN = r"^\d{4,6}$"


class MagazziniereIn(BaseModel):
    nome: str = Field(min_length=2, max_length=60)
    pin: str = Field(pattern=PIN_PATTERN)


class PinReq(BaseModel):
    pin: str = Field(pattern=PIN_PATTERN)


class MagLoginReq(BaseModel):
    id: str = Field(min_length=1)
    pin: str = Field(min_length=1, max_length=12)


MAX_PIN_FAILS = 5
PIN_LOCK_MINUTES = 5
ARCHIVE_DAYS = 30


class LoginReq(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class ChangePwReq(BaseModel):
    vecchia: str = Field(min_length=1, max_length=256)
    nuova: str = Field(min_length=4, max_length=256)


class CoopReq(BaseModel):
    cooperativa: str = ""


# ── Auth ──────────────────────────────────────────────────────────────────────
async def _session(authorization: Optional[str], msg: str):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail=msg)
    raw = authorization[7:].strip()
    session = await db.sessions.find_one({"token_hash": token_digest(raw)})
    if not session or session["expires_at"].replace(tzinfo=timezone.utc) <= now():
        raise HTTPException(status_code=401, detail="Sessione scaduta")
    return session


async def require_ufficio(authorization: Optional[str] = Header(default=None)):
    session = await _session(authorization, "Accesso ufficio richiesto")
    if session.get("role", "ufficio") != "ufficio":
        raise HTTPException(status_code=403, detail="Accesso ufficio richiesto")
    return session


async def require_magazziniere(authorization: Optional[str] = Header(default=None)):
    session = await _session(authorization, "Accedi con nome e PIN")
    if session.get("role") != "magazzino":
        raise HTTPException(status_code=403, detail="Accedi con nome e PIN")
    worker = await db.magazzinieri.find_one({"id": session.get("magazziniere_id")})
    if not worker:
        await db.sessions.delete_one({"_id": session["_id"]})
        raise HTTPException(status_code=401, detail="Magazziniere non più attivo")
    return worker


@api.post("/auth/login")
async def login(body: LoginReq):
    office = await db.settings.find_one({"_id": "ufficio"})
    if not office or not check_password(body.password, office["password_hash"]):
        raise HTTPException(status_code=401, detail="Password errata")
    raw = secrets.token_urlsafe(32)
    await db.sessions.insert_one({
        "token_hash": token_digest(raw),
        "role": "ufficio",
        "created_at": now(),
        "expires_at": now() + timedelta(seconds=SESSION_TTL),
    })
    return {"token": raw}


# ── Magazzinieri (PIN) ────────────────────────────────────────────────────────
def worker_out(w: dict) -> dict:
    return {"id": w["id"], "nome": w["nome"], "createdAt": w.get("createdAt")}


@api.get("/magazzinieri/nomi")
async def nomi_magazzinieri():
    docs = await db.magazzinieri.find({}, {"_id": 0, "id": 1, "nome": 1}).sort("nome", 1).to_list(500)
    return docs


@api.get("/magazzinieri")
async def list_magazzinieri(_=Depends(require_ufficio)):
    docs = await db.magazzinieri.find({}).sort("nome", 1).to_list(500)
    return [worker_out(d) for d in docs]


@api.post("/magazzinieri")
async def create_magazziniere(body: MagazziniereIn, _=Depends(require_ufficio)):
    nome = body.nome.strip()
    if await db.magazzinieri.find_one({"nome": {"$regex": f"^{re.escape(nome)}$", "$options": "i"}}):
        raise HTTPException(status_code=400, detail="Esiste già un magazziniere con questo nome")
    doc = {"id": str(uuid.uuid4()), "nome": nome, "pin_hash": hash_password(body.pin),
           "failed": 0, "locked_until": None, "createdAt": now_iso()}
    await db.magazzinieri.insert_one(doc)
    return worker_out(doc)


@api.put("/magazzinieri/{wid}/pin")
async def change_pin(wid: str, body: PinReq, _=Depends(require_ufficio)):
    res = await db.magazzinieri.update_one({"id": wid}, {"$set": {"pin_hash": hash_password(body.pin), "failed": 0, "locked_until": None}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Magazziniere non trovato")
    await db.sessions.delete_many({"role": "magazzino", "magazziniere_id": wid})
    return {"ok": True}


@api.delete("/magazzinieri/{wid}")
async def delete_magazziniere(wid: str, _=Depends(require_ufficio)):
    res = await db.magazzinieri.delete_one({"id": wid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Magazziniere non trovato")
    await db.sessions.delete_many({"role": "magazzino", "magazziniere_id": wid})
    return {"ok": True}


@api.post("/auth/magazzino/login")
async def login_magazzino(body: MagLoginReq):
    w = await db.magazzinieri.find_one({"id": body.id})
    if not w:
        raise HTTPException(status_code=401, detail="Nome o PIN errato")
    locked = w.get("locked_until")
    if locked and locked.replace(tzinfo=timezone.utc) > now():
        mins = max(1, int((locked.replace(tzinfo=timezone.utc) - now()).total_seconds() // 60) + 1)
        raise HTTPException(status_code=429, detail=f"Troppi tentativi: riprova tra {mins} min")
    if not check_password(body.pin, w["pin_hash"]):
        failed = w.get("failed", 0) + 1
        upd = {"failed": failed}
        if failed >= MAX_PIN_FAILS:
            upd = {"failed": 0, "locked_until": now() + timedelta(minutes=PIN_LOCK_MINUTES)}
        await db.magazzinieri.update_one({"id": w["id"]}, {"$set": upd})
        if failed >= MAX_PIN_FAILS:
            raise HTTPException(status_code=429, detail=f"Troppi tentativi: riprova tra {PIN_LOCK_MINUTES} min")
        raise HTTPException(status_code=401, detail=f"PIN errato ({MAX_PIN_FAILS - failed} tentativi rimasti)")
    await db.magazzinieri.update_one({"id": w["id"]}, {"$set": {"failed": 0, "locked_until": None}})
    raw = secrets.token_urlsafe(32)
    await db.sessions.insert_one({
        "token_hash": token_digest(raw), "role": "magazzino", "magazziniere_id": w["id"],
        "created_at": now(), "expires_at": now() + timedelta(seconds=SESSION_TTL),
    })
    return {"token": raw, "nome": w["nome"]}


@api.get("/auth/magazzino/me")
async def me_magazzino(w=Depends(require_magazziniere)):
    return {"id": w["id"], "nome": w["nome"]}


@api.post("/auth/magazzino/logout")
async def logout_magazzino(authorization: Optional[str] = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        await db.sessions.delete_one({"token_hash": token_digest(authorization[7:].strip()), "role": "magazzino"})
    return {"ok": True}


@api.get("/auth/me")
async def me(_=Depends(require_ufficio)):
    return {"ok": True, "ruolo": "ufficio"}


@api.post("/auth/logout")
async def logout(session=Depends(require_ufficio)):
    await db.sessions.delete_one({"_id": session["_id"]})
    return {"ok": True}


@api.post("/auth/change-password")
async def change_password(body: ChangePwReq, session=Depends(require_ufficio)):
    office = await db.settings.find_one({"_id": "ufficio"})
    if not check_password(body.vecchia, office["password_hash"]):
        raise HTTPException(status_code=400, detail="Password attuale errata")
    await db.settings.update_one({"_id": "ufficio"}, {"$set": {"password_hash": hash_password(body.nuova)}})
    await db.sessions.delete_many({"_id": {"$ne": session["_id"]}})
    return {"ok": True}


# ── Settings ──────────────────────────────────────────────────────────────────
@api.get("/settings")
async def get_settings():
    doc = await db.settings.find_one({"_id": "app"})
    return {"cooperativa": (doc or {}).get("cooperativa", "")}


@api.put("/settings/cooperativa")
async def set_coop(body: CoopReq, _=Depends(require_ufficio)):
    await db.settings.update_one({"_id": "app"}, {"$set": {"cooperativa": body.cooperativa.strip()}}, upsert=True)
    return {"cooperativa": body.cooperativa.strip()}


# ── Pedane ────────────────────────────────────────────────────────────────────
ACTIVE = {"archiviato": {"$ne": True}}


def rx(q: str):
    return {"$regex": re.escape(q), "$options": "i"}


@api.get("/pedane", response_model=List[Pedana])
async def list_pedane(q: str = "", _=Depends(require_ufficio)):
    query = {}
    q = q.strip()
    if q:
        query = {"$or": [{f: rx(q)} for f in ["numeroOrdine", "codice", "agenzia", "trasportatore", "mittente", "destinazione", "merce"]]}
    docs = await db.pedane.find({**query, **ACTIVE}).sort("createdAt", -1).to_list(1000)
    return [Pedana.from_mongo(d) for d in docs]


@api.get("/pedane/cerca", response_model=List[Pedana])
async def cerca(q: str = ""):
    q = q.strip()
    if not q:
        return []
    exact = {"$regex": f"^{re.escape(q)}$", "$options": "i"}
    docs = await db.pedane.find({"$or": [{"codice": exact}, {"numeroOrdine": exact}], **ACTIVE}).sort("codice", 1).to_list(100)
    if not docs:
        docs = await db.pedane.find({"$or": [{"codice": rx(q)}, {"numeroOrdine": rx(q)}], **ACTIVE}).sort("codice", 1).to_list(30)
    return [Pedana.from_mongo(d) for d in docs]


@api.get("/pedane/tutte", response_model=List[Pedana])
async def tutte():
    docs = await db.pedane.find(ACTIVE).sort([("dataConsegna", -1), ("createdAt", -1)]).to_list(1000)
    return [Pedana.from_mongo(d) for d in docs]


@api.get("/pedane/{pid}", response_model=Pedana)
async def get_pedana(pid: str):
    doc = await db.pedane.find_one({"id": pid})
    if not doc:
        raise HTTPException(status_code=404, detail="Pedana non trovata")
    return Pedana.from_mongo(doc)


@api.get("/riepilogo", response_model=List[Pedana])
async def riepilogo(data: str = Query(..., pattern=r"^\d{4}-\d{2}-\d{2}$"), _=Depends(require_ufficio)):
    docs = await db.pedane.find({"$or": [{"dataArrivo": data}, {"dataArrivo": {"$in": ["", None]}, "dataConsegna": data}]}).sort([("numeroOrdine", 1), ("codice", 1)]).to_list(2000)
    return [Pedana.from_mongo(d) for d in docs]


@api.post("/pedane/duplicati")
async def duplicati(body: DupReq, _=Depends(require_ufficio)):
    codice_matches = []
    for c in {c.strip() for c in body.codici if c.strip()}:
        q = {"codice": {"$regex": f"^{re.escape(c)}$", "$options": "i"}}
        if body.excludeId:
            q["id"] = {"$ne": body.excludeId}
        doc = await db.pedane.find_one(q)
        if doc:
            codice_matches.append({"codice": c, "match": Pedana.from_mongo(doc).model_dump()})
    numero_matches = []
    if body.numeroOrdine.strip():
        q = {"numeroOrdine": {"$regex": f"^{re.escape(body.numeroOrdine.strip())}$", "$options": "i"}}
        if body.excludeId:
            q["id"] = {"$ne": body.excludeId}
        docs = await db.pedane.find(q).to_list(200)
        numero_matches = [Pedana.from_mongo(d).model_dump() for d in docs]
    return {"codiceMatches": codice_matches, "numeroMatches": numero_matches}


@api.post("/pedane", response_model=List[Pedana])
async def create_pedane(body: CreateReq, _=Depends(require_ufficio)):
    f = body.form
    rows = [p for p in body.pedane if p.codice.strip()]
    if not rows:
        raise HTTPException(status_code=400, detail="Almeno una pedana è obbligatoria")
    created = []
    for p in rows:
        item = Pedana(
            numeroOrdine=f.numeroOrdine.strip(), agenzia=f.agenzia.strip(), trasportatore=f.trasportatore.strip(),
            mittente=(p.mittente.strip() or f.mittente.strip()), dataConsegna=f.dataConsegna,
            note=f.note.strip(), codice=p.codice.strip(), destinazione=p.destinazione.strip(),
            numeroColli=p.numeroColli.strip(), numeroPedane=p.numeroPedane.strip(), merce=p.merce.strip(),
            dataArrivo=p.dataArrivo.strip(), oraArrivo=p.oraArrivo.strip(),
        )
        await db.pedane.insert_one(item.to_mongo())
        created.append(item)
    return created


@api.put("/pedane/{pid}", response_model=Pedana)
async def update_pedana(pid: str, body: UpdateReq, _=Depends(require_ufficio)):
    f, p = body.form, body.pedana
    patch = {
        "numeroOrdine": f.numeroOrdine.strip(), "agenzia": f.agenzia.strip(), "trasportatore": f.trasportatore.strip(),
        "mittente": (p.mittente.strip() or f.mittente.strip()), "dataConsegna": f.dataConsegna,
        "note": f.note.strip(), "codice": p.codice.strip(), "destinazione": p.destinazione.strip(),
        "numeroColli": p.numeroColli.strip(), "numeroPedane": p.numeroPedane.strip(), "merce": p.merce.strip(),
        "dataArrivo": p.dataArrivo.strip(), "oraArrivo": p.oraArrivo.strip(), "ultimaRettifica": now_iso(),
    }
    res = await db.pedane.find_one_and_update({"id": pid}, {"$set": patch}, return_document=True)
    if not res:
        raise HTTPException(status_code=404, detail="Pedana non trovata")
    return Pedana.from_mongo(res)


@api.patch("/pedane/{pid}/stato", response_model=Pedana)
async def update_stato(pid: str, body: StatoReq, w=Depends(require_magazziniere)):
    doc = await db.pedane.find_one({"id": pid})
    if not doc:
        raise HTTPException(status_code=404, detail="Pedana non trovata")
    res = await db.pedane.find_one_and_update({"id": pid}, {"$set": stato_patch(body, w["nome"])}, return_document=True)
    return Pedana.from_mongo(res)


def stato_patch(body: StatoReq, operatore: str) -> dict:
    if body.stato == "completo":
        return {"statoArrivo": "completo", "arrivoCompletoAt": now_iso(), "arrivoCompletoDa": operatore}
    if body.stato == "parziale":
        return {"statoArrivo": "parziale", "arrivoParzialeAt": now_iso(), "noteParziale": body.noteParziale.strip(), "arrivoParzialeDa": operatore}
    return {"statoArrivo": "attesa", "arrivoParzialeAt": None, "arrivoCompletoAt": None, "noteParziale": "",
            "arrivoParzialeDa": "", "arrivoCompletoDa": ""}


class PosizioneStatoReq(StatoReq):
    numeroOrdine: str = Field(min_length=1)
    codice: str = Field(min_length=1)


@api.patch("/posizioni/stato", response_model=List[Pedana])
async def update_stato_posizione(body: PosizioneStatoReq, w=Depends(require_magazziniere)):
    q = {"numeroOrdine": body.numeroOrdine.strip(),
         "codice": {"$regex": f"^{re.escape(body.codice.strip())}$", "$options": "i"}}
    res = await db.pedane.update_many(q, {"$set": stato_patch(body, w["nome"])})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Posizione non trovata")
    docs = await db.pedane.find(q).to_list(100)
    return [Pedana.from_mongo(d) for d in docs]


@api.post("/ordini/scarica")
async def scarica_ordine(body: ScaricaOrdineReq, w=Depends(require_magazziniere)):
    operatore = w["nome"]
    res = await db.pedane.update_many(
        {"numeroOrdine": body.numeroOrdine.strip(), "statoArrivo": {"$ne": "completo"}},
        {"$set": {"statoArrivo": "completo", "arrivoCompletoAt": now_iso(), "arrivoCompletoDa": operatore}},
    )
    return {"aggiornate": res.modified_count}


# ── Archivio ──────────────────────────────────────────────────────────────────
async def auto_archivia() -> int:
    cutoff = (now() - timedelta(days=ARCHIVE_DAYS)).date().isoformat()
    groups = db.pedane.aggregate([
        {"$match": {"archiviato": {"$ne": True}, "ripristinato": {"$ne": True}}},
        {"$group": {
            "_id": "$numeroOrdine",
            "n": {"$sum": 1},
            "done": {"$sum": {"$cond": [{"$eq": ["$statoArrivo", "completo"]}, 1, 0]}},
            "maxData": {"$max": "$dataConsegna"},
        }},
    ])
    numeri = [g["_id"] async for g in groups if g["n"] == g["done"] and g["maxData"] and g["maxData"] < cutoff]
    if not numeri:
        return 0
    await db.pedane.update_many({"numeroOrdine": {"$in": numeri}, "archiviato": {"$ne": True}},
                                {"$set": {"archiviato": True, "archiviatoAt": now_iso()}})
    logger.info("Archiviati %d ordini", len(numeri))
    return len(numeri)


async def archive_loop():
    while True:
        try:
            await auto_archivia()
        except Exception:
            logger.exception("Archiviazione automatica fallita")
        await asyncio.sleep(3600)


@api.get("/archivio")
async def archivio(q: str = "", skip: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500), _=Depends(require_ufficio)):
    query = {"archiviato": True}
    q = q.strip()
    if q:
        query["$or"] = [{f: rx(q)} for f in ["numeroOrdine", "codice", "agenzia", "trasportatore", "mittente", "destinazione", "merce"]]
    total = await db.pedane.count_documents(query)
    docs = await db.pedane.find(query).sort([("dataConsegna", -1), ("numeroOrdine", 1), ("codice", 1)]).skip(skip).limit(limit).to_list(limit)
    return {"total": total, "items": [Pedana.from_mongo(d).model_dump() for d in docs]}


@api.post("/archivio/esegui")
async def archivio_esegui(_=Depends(require_ufficio)):
    return {"archiviati": await auto_archivia()}


@api.post("/archivio/ripristina")
async def archivio_ripristina(body: RipristinaReq, _=Depends(require_ufficio)):
    res = await db.pedane.update_many({"numeroOrdine": body.numeroOrdine.strip(), "archiviato": True},
                                      {"$set": {"archiviato": False, "archiviatoAt": None, "ripristinato": True}})
    return {"ripristinate": res.modified_count}


@api.delete("/pedane/{pid}")
async def delete_pedana(pid: str, _=Depends(require_ufficio)):
    res = await db.pedane.delete_one({"id": pid})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Pedana non trovata")
    return {"ok": True}


# ── Import PDF (Gemini) ───────────────────────────────────────────────────────
PDF_PROMPT = """Sei un assistente per la logistica. Leggi questo ordine di trasporto (PDF) ed estrai i dati.
Rispondi SOLO con JSON valido, senza testo extra, con questa struttura esatta:
{
  "numeroOrdine": "numero dell'ordine di trasporto (es. 25023467)",
  "agenzia": "azienda che ha emesso/commissionato l'ordine (es. KÖLLA GmbH & Co. KG)",
  "trasportatore": "trasportatore a cui è indirizzato l'ordine, scritto IN ALTO A SINISTRA come destinatario (es. Antolini s.r.l.)",
  "dataConsegna": "data di consegna al CLIENTE finale (sezione Luogo di scarico, Data di scarico) in formato YYYY-MM-DD",
  "note": "istruzioni importanti brevi (temperatura, avvisi), max 200 caratteri",
  "pedane": [
    {"codice": "codice posizione CORTO stampato SOTTO il codice lungo, nel formato NNNN-NNNNNN (es. 2619-019320, 2619-019318, 2619-019321). NON usare il codice lungo sopra (es. 2619-019320-10000 o A2619-023221-10000)", "destinazione": "nome destinatario + città (luogo di scarico)", "numeroColli": "numero colli (valore K0/KO) come intero senza decimali", "numeroPedane": "numero di pedane della colonna Pedane (es. 1,00 EUR = 1; 2,00 EUR = 2; 0,00 = 0), stampato sopra il codice posizione corto, come intero senza decimali", "mittente": "nome stampato A DESTRA della riga, in cima alla colonna tipologia merce (es. ORCHIDEA, BERTOLI FRUIT, MORANDO GRAZIANO). Scrivilo in maiuscole come nel documento, senza descrizione merce", "dataCarico": "Data di carico della riga nella sezione Luogo di carico (partenza dal fornitore), formato YYYY-MM-DD", "merce": "tipo di merce breve (es. Uva rossa senza semi, Uva bianca senza semi, Radicchio Trevisano, Radicchio Castelfranco)"}
  ]
}
Includi OGNI riga presente nella sezione Luogo di carico (non ripetere le righe della sezione Luogo di scarico). Se un dato manca usa stringa vuota.
ATTENZIONE: la dataConsegna è SOLO la data della sezione "Luogo di scarico" (consegna al cliente), MAI la data di carico o la data di arrivo al magazzino Antolini.
La destinazione è SOLO il destinatario della sezione "Luogo di scarico", MAI il luogo di carico/fornitore e MAI Antolini. Il mittente è SOLO il fornitore (nome in maiuscolo sulla riga)."""


def giorno_dopo(iso: str) -> str:
    try:
        return (datetime.strptime(iso, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")
    except ValueError:
        return ""


NOISE = ("Operiamo", "PHG:", "Sitz ", "Geschäftsführer", "KÖLLA GmbH & Co. KG", "Bank:", "Kontonummer",
         "IBAN:", "BIC:", "HOTLINE:", "Logistik-IT", "Pagina ")
RX_DATE = re.compile(r"^(\d{2})\.(\d{2})\.(\d{4})$")
RX_TIME = re.compile(r"^\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}$")
RX_LONG = re.compile(r"^A?\d{4}-\d{6}-\d+$")
RX_SHORT = re.compile(r"^\d{4}-\d{6}$")
MERCE_SKIP = re.compile(r"\d|rinfusa|^cl\.|collo|cartone|epal|polistirolo|lux|extra", re.I)


def iso(d: str) -> str:
    m = RX_DATE.match(d)
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else ""


def num(s: str) -> str:
    return re.sub(r"[.,]0+$", "", re.sub(r"\s*(KO|EUR)\s*$", "", s.strip()))


def merce_breve(desc: str) -> str:
    parts = [p.strip() for p in desc.split(",")]
    if "IT" not in parts:
        return parts[0] if parts else ""
    i = parts.index("IT")
    out = parts[:i]
    if i + 1 < len(parts) and parts[i + 1] and not MERCE_SKIP.search(parts[i + 1]):
        out.append(parts[i + 1])
    return " ".join(out)


def luogo(line: str) -> tuple:
    """'Name - Street - D 81371 München' -> (name, city)."""
    parts = [p.strip() for p in line.split(" - ")]
    city = re.sub(r"\[.*?\]|\(.*?\)", "", parts[-1])
    city = re.sub(r"^[A-Z]{1,2}[\s-]*\d{4,5}\s*", "", city.strip()).strip()
    return parts[0], city


def parse_rows(lines: list) -> list:
    """Each row is anchored on the long position code; returns rows with the context above/below it."""
    rows, place = [], ""
    for i, ln in enumerate(lines):
        if " - " in ln and not RX_TIME.match(ln) and not ln.startswith("Temperatura"):
            place = ln
        if not RX_LONG.match(ln):
            continue
        before = lines[max(0, i - 3):i]
        data = next((iso(x) for x in before if RX_DATE.match(x)), "")
        j, colli, ped, desc, short = i + 1, "", "", [], ""
        while j < len(lines) and not RX_LONG.match(lines[j]):
            x = lines[j]
            if x.endswith("KO") and not colli:
                colli = num(x)
            elif x.endswith("EUR") and not ped:
                ped = num(x)
            elif RX_SHORT.match(x):
                short = x
                break
            elif ped and re.search(r"[A-Za-z]", x):
                desc.append(x)
            j += 1
        rows.append({"long": ln, "short": short, "data": data, "place": place, "colli": colli, "pedane": ped,
                     "mittente": re.sub(r"\s+S\.?R\.?L?\.?$", "", lines[i - 1].strip()).strip(),
                     "merce": merce_breve(" ".join(desc))})
    return rows


def parse_ordine_pdf(path: str) -> Optional[dict]:
    """Deterministic parser for KÖLLA transport orders (fixed layout). None if the layout is not recognised."""
    import pymupdf
    with pymupdf.open(path) as doc:
        raw = "\n".join(p.get_text() for p in doc)
    lines = [ln.strip() for ln in raw.splitlines()]
    lines = [ln for ln in lines if ln and not ln.startswith(NOISE)]
    m = re.search(r"Ordine di trasporto\s*-\s*(\d+)", raw)
    cut = next((i for i, ln in enumerate(lines) if ln.startswith("Luogo di scarico")), None)
    if not m or cut is None:
        return None
    carico, scarico = parse_rows(lines[:cut]), parse_rows(lines[cut:])
    if not carico:
        return None
    dest = {}
    for r in scarico:
        dest.setdefault(r["long"], r)
    consegne = sorted({r["data"] for r in scarico if r["data"]})
    head = next((i for i, ln in enumerate(lines) if ln.startswith("Ordine di trasporto")), 0)
    trasp = next((ln for ln in reversed(lines[:head]) if not ln.endswith(":")), "")
    ag = re.search(r"^(.+?)\s*\|", raw, re.M)
    note = [ln for ln in lines[:cut] if ln.startswith("Temperatura di trasporto")][:1]
    start = next((i for i, ln in enumerate(lines) if ln.startswith("Targa")), -1)
    end = next((i for i, ln in enumerate(lines) if ln.startswith("Luogo di carico")), -1)
    if 0 <= start < end:
        note = [ln for ln in lines[start + 1:end] if not ln.endswith(":")] + note
    pedane = []
    for r in carico:
        d = dest.get(r["long"])
        nome, citta = luogo(d["place"]) if d and d["place"] else ("", "")
        pedane.append({
            "codice": r["short"] or re.sub(r"^A", "", r["long"]).rsplit("-", 1)[0],
            "destinazione": f"{nome} - {citta}" if citta else nome,
            "numeroColli": r["colli"], "numeroPedane": r["pedane"],
            "mittente": r["mittente"], "merce": r["merce"],
            # Goods leave the supplier on the loading date and reach the Antolini warehouse the next day
            "dataArrivo": giorno_dopo(r["data"]), "oraArrivo": "",
        })
    return {
        "numeroOrdine": m.group(1), "agenzia": ag.group(1).strip() if ag else "",
        "trasportatore": trasp, "mittente": "",
        "dataConsegna": consegne[0] if consegne else "",
        "note": " · ".join(note)[:200], "pedane": pedane,
    }


def extract_json(text: str) -> dict:
    t = text.strip()
    t = re.sub(r"^```(?:json)?", "", t).strip()
    t = re.sub(r"```$", "", t).strip()
    start, end = t.find("{"), t.rfind("}")
    return json.loads(t[start:end + 1])


@api.post("/import-pdf")
async def import_pdf(file: UploadFile = File(...), _=Depends(require_ufficio)):
    data = await file.read()
    if not data[:5] == b"%PDF-":
        raise HTTPException(status_code=400, detail="Il file non è un PDF valido")
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(data)
        path = tmp.name
    try:
        fixed = parse_ordine_pdf(path)
    except Exception:
        logger.exception("Deterministic PDF parse failed, falling back to AI")
        fixed = None
    if fixed:
        os.unlink(path)
        return fixed
    try:
        chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"pdf-{uuid.uuid4()}",
                       system_message="Estrai dati strutturati da documenti logistici. Rispondi solo in JSON.") \
            .with_model("gemini", "gemini-3-flash-preview")
        out = ""
        async for ev in chat.stream_message(UserMessage(
                text=PDF_PROMPT,
                file_contents=[FileContentWithMimeType(file_path=path, mime_type="application/pdf")])):
            if isinstance(ev, TextDelta):
                out += ev.content
            elif isinstance(ev, StreamDone):
                break
        parsed = extract_json(out)
    except Exception as e:
        logger.exception("PDF import failed")
        raise HTTPException(status_code=502, detail=f"Lettura PDF non riuscita: {str(e)[:120]}")
    finally:
        os.unlink(path)
    # One pedana per PDF row (rows may share the same position)
    pedane = []
    for p in parsed.get("pedane", []) or []:
        pedane.append({
            "codice": str(p.get("codice", "") or "").strip(),
            "destinazione": str(p.get("destinazione", "") or "").strip(),
            "numeroColli": re.sub(r"[.,]0+$", "", str(p.get("numeroColli") if p.get("numeroColli") is not None else "").strip()),
            "numeroPedane": re.sub(r"[.,]0+$", "", str(p.get("numeroPedane") if p.get("numeroPedane") is not None else "").replace("EUR", "").strip()),
            "mittente": str(p.get("mittente", "") or "").strip(),
            "merce": str(p.get("merce", "") or "").strip(),
            # Goods leave the supplier on the loading date and reach the Antolini warehouse the next day
            "dataArrivo": giorno_dopo(str(p.get("dataCarico", "") or "").strip()[:10]),
            "oraArrivo": "",
        })
    return {
        "numeroOrdine": str(parsed.get("numeroOrdine", "") or "").strip(),
        "agenzia": str(parsed.get("agenzia", "") or "").strip(),
        "trasportatore": str(parsed.get("trasportatore", "") or "").strip(),
        "mittente": str(parsed.get("mittente", "") or "").strip(),
        "dataConsegna": str(parsed.get("dataConsegna", "") or "").strip(),
        "note": str(parsed.get("note", "") or "").strip(),
        "pedane": pedane,
    }


LABEL_PROMPT = """Questa è la foto di un cartello/etichetta di una pedana in un magazzino logistico.
I cartelli sono diversi tra loro e il codice è spesso SCRITTO A MANO (anche in un campo qualsiasi, es. "Prodotto - varietà").
Leggi con attenzione la scrittura a mano: una "q" o "g" in mezzo a cifre è un 9, "l" o "|" è un 1, "O" è uno 0, "S" può essere 5, "Z" può essere 2; punti, virgole o spazi tra i gruppi di cifre sono un trattino.
Ignora numeri di telefono, fax, partita IVA, CAP e indirizzi prestampati.
Individua i codici utili per trovare la pedana:
- codici posizione nel formato NNNN-NNNNNN (es. 2619-019320) oppure lunghi come 2619-019320-10000 o A2619-023221-10000
- numeri ordine di trasporto di 8 cifre (es. 25023467)
Rispondi SOLO con JSON: {"codici": ["..."], "ordini": ["..."], "testo": "testo letto, max 300 caratteri"}
Se non trovi nulla usa liste vuote."""

MAX_IMG = 8 * 1024 * 1024


@api.post("/scan-etichetta")
async def scan_etichetta(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > MAX_IMG:
        raise HTTPException(status_code=413, detail="Foto troppo grande")
    mime = file.content_type if (file.content_type or "").startswith("image/") else "image/jpeg"
    suffix = ".png" if mime == "image/png" else ".jpg"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(data)
        path = tmp.name
    try:
        chat = LlmChat(api_key=EMERGENT_LLM_KEY, session_id=f"label-{uuid.uuid4()}",
                       system_message="Leggi etichette logistiche. Rispondi solo in JSON.") \
            .with_model("gemini", "gemini-3-flash-preview")
        out = ""
        async for ev in chat.stream_message(UserMessage(
                text=LABEL_PROMPT, file_contents=[FileContentWithMimeType(file_path=path, mime_type=mime)])):
            if isinstance(ev, TextDelta):
                out += ev.content
            elif isinstance(ev, StreamDone):
                break
        parsed = extract_json(out)
    except Exception as e:
        logger.exception("Label scan failed")
        raise HTTPException(status_code=502, detail=f"Lettura etichetta non riuscita: {str(e)[:120]}")
    finally:
        os.unlink(path)
    candidati: List[str] = []
    for c in (parsed.get("codici") or []):
        c = str(c).strip().upper().replace(" ", "")
        m = re.search(r"(\d{4}-\d{6})", c)
        for v in ([m.group(1)] if m else []) + [c]:
            if v and v not in candidati:
                candidati.append(v)
    for o in (parsed.get("ordini") or []):
        o = re.sub(r"\D", "", str(o))
        if len(o) >= 6 and o not in candidati:
            candidati.append(o)
    # Prefer candidates that exist in the database
    trovati = []
    for c in candidati:
        exact = {"$regex": f"^{re.escape(c)}$", "$options": "i"}
        n = await db.pedane.count_documents({"$or": [{"codice": exact}, {"numeroOrdine": exact}], **ACTIVE})
        trovati.append({"codice": c, "pedane": n})
    trovati.sort(key=lambda x: -x["pedane"])
    return {"candidati": trovati, "testo": str(parsed.get("testo", ""))[:300]}


@api.get("/")
async def root():
    return {"message": "Gestione Logistica API"}


app.include_router(api)
app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup():
    await db.settings.update_one(
        {"_id": "ufficio"},
        {"$setOnInsert": {"password_hash": hash_password(DEFAULT_PASSWORD), "created_at": now()}},
        upsert=True,
    )
    await db.sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.pedane.create_index("id", unique=True)
    await db.pedane.create_index("codice")
    await db.pedane.create_index("numeroOrdine")
    await db.pedane.create_index("archiviato")
    await db.magazzinieri.create_index("id", unique=True)
    asyncio.create_task(archive_loop())


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
