from fastapi import FastAPI, APIRouter, Depends, Header, HTTPException, UploadFile, File
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
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

import bcrypt
from pydantic import BaseModel, Field

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
    mittente: str
    dataConsegna: str
    note: str = ""
    codice: str
    destinazione: str
    numeroColli: str = ""
    createdAt: str = Field(default_factory=now_iso)
    ultimaRettifica: Optional[str] = None
    statoArrivo: Literal["attesa", "parziale", "completo"] = "attesa"
    arrivoParzialeAt: Optional[str] = None
    arrivoCompletoAt: Optional[str] = None
    noteParziale: str = ""


class OrdineForm(BaseModel):
    numeroOrdine: str
    agenzia: str = ""
    mittente: str
    dataConsegna: str
    note: str = ""


class PedanaIn(BaseModel):
    codice: str
    destinazione: str
    numeroColli: str = ""
    mittente: str = ""


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


class LoginReq(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class ChangePwReq(BaseModel):
    vecchia: str = Field(min_length=1, max_length=256)
    nuova: str = Field(min_length=4, max_length=256)


class CoopReq(BaseModel):
    cooperativa: str = ""


# ── Auth ──────────────────────────────────────────────────────────────────────
async def require_ufficio(authorization: Optional[str] = Header(default=None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Accesso ufficio richiesto")
    raw = authorization[7:].strip()
    session = await db.sessions.find_one({"token_hash": token_digest(raw)})
    if not session or session["expires_at"].replace(tzinfo=timezone.utc) <= now():
        raise HTTPException(status_code=401, detail="Sessione scaduta")
    return session


@api.post("/auth/login")
async def login(body: LoginReq):
    office = await db.settings.find_one({"_id": "ufficio"})
    if not office or not check_password(body.password, office["password_hash"]):
        raise HTTPException(status_code=401, detail="Password errata")
    raw = secrets.token_urlsafe(32)
    await db.sessions.insert_one({
        "token_hash": token_digest(raw),
        "created_at": now(),
        "expires_at": now() + timedelta(seconds=SESSION_TTL),
    })
    return {"token": raw}


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
def rx(q: str):
    return {"$regex": re.escape(q), "$options": "i"}


@api.get("/pedane", response_model=List[Pedana])
async def list_pedane(q: str = "", _=Depends(require_ufficio)):
    query = {}
    q = q.strip()
    if q:
        query = {"$or": [{f: rx(q)} for f in ["numeroOrdine", "codice", "agenzia", "mittente", "destinazione"]]}
    docs = await db.pedane.find(query).sort("createdAt", -1).to_list(1000)
    return [Pedana.from_mongo(d) for d in docs]


@api.get("/pedane/cerca", response_model=List[Pedana])
async def cerca(q: str = ""):
    q = q.strip()
    if not q:
        return []
    exact = {"$regex": f"^{re.escape(q)}$", "$options": "i"}
    docs = await db.pedane.find({"$or": [{"codice": exact}, {"numeroOrdine": exact}]}).sort("codice", 1).to_list(100)
    if not docs:
        docs = await db.pedane.find({"$or": [{"codice": rx(q)}, {"numeroOrdine": rx(q)}]}).sort("codice", 1).to_list(30)
    return [Pedana.from_mongo(d) for d in docs]


@api.get("/pedane/{pid}", response_model=Pedana)
async def get_pedana(pid: str):
    doc = await db.pedane.find_one({"id": pid})
    if not doc:
        raise HTTPException(status_code=404, detail="Pedana non trovata")
    return Pedana.from_mongo(doc)


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
            numeroOrdine=f.numeroOrdine.strip(), agenzia=f.agenzia.strip(),
            mittente=(p.mittente.strip() or f.mittente.strip()), dataConsegna=f.dataConsegna,
            note=f.note.strip(), codice=p.codice.strip(), destinazione=p.destinazione.strip(),
            numeroColli=p.numeroColli.strip(),
        )
        await db.pedane.insert_one(item.to_mongo())
        created.append(item)
    return created


@api.put("/pedane/{pid}", response_model=Pedana)
async def update_pedana(pid: str, body: UpdateReq, _=Depends(require_ufficio)):
    f, p = body.form, body.pedana
    patch = {
        "numeroOrdine": f.numeroOrdine.strip(), "agenzia": f.agenzia.strip(),
        "mittente": (p.mittente.strip() or f.mittente.strip()), "dataConsegna": f.dataConsegna,
        "note": f.note.strip(), "codice": p.codice.strip(), "destinazione": p.destinazione.strip(),
        "numeroColli": p.numeroColli.strip(), "ultimaRettifica": now_iso(),
    }
    res = await db.pedane.find_one_and_update({"id": pid}, {"$set": patch}, return_document=True)
    if not res:
        raise HTTPException(status_code=404, detail="Pedana non trovata")
    return Pedana.from_mongo(res)


@api.patch("/pedane/{pid}/stato", response_model=Pedana)
async def update_stato(pid: str, body: StatoReq):
    doc = await db.pedane.find_one({"id": pid})
    if not doc:
        raise HTTPException(status_code=404, detail="Pedana non trovata")
    if body.stato == "completo":
        patch = {"statoArrivo": "completo", "arrivoCompletoAt": now_iso()}
    elif body.stato == "parziale":
        patch = {"statoArrivo": "parziale", "arrivoParzialeAt": now_iso(), "noteParziale": body.noteParziale.strip()}
    else:
        patch = {"statoArrivo": "attesa", "arrivoParzialeAt": None, "arrivoCompletoAt": None, "noteParziale": ""}
    res = await db.pedane.find_one_and_update({"id": pid}, {"$set": patch}, return_document=True)
    return Pedana.from_mongo(res)


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
  "mittente": "fornitore/luogo di carico principale (se più di uno, il primo)",
  "dataConsegna": "data di scarico/consegna in formato YYYY-MM-DD",
  "note": "istruzioni importanti brevi (temperatura, avvisi), max 200 caratteri",
  "pedane": [
    {"codice": "codice posizione completo (es. 2619-019320-10000)", "destinazione": "nome destinatario + città (luogo di scarico)", "numeroColli": "numero colli come intero senza decimali", "mittente": "fornitore di questa posizione"}
  ]
}
Includi OGNI riga/posizione presente nel documento. Se un dato manca usa stringa vuota."""


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
    pedane = []
    for p in parsed.get("pedane", []) or []:
        colli = str(p.get("numeroColli", "") or "").replace(",00", "").replace(".00", "").strip()
        pedane.append({
            "codice": str(p.get("codice", "") or "").strip(),
            "destinazione": str(p.get("destinazione", "") or "").strip(),
            "numeroColli": colli,
            "mittente": str(p.get("mittente", "") or "").strip(),
        })
    return {
        "numeroOrdine": str(parsed.get("numeroOrdine", "") or "").strip(),
        "agenzia": str(parsed.get("agenzia", "") or "").strip(),
        "mittente": str(parsed.get("mittente", "") or "").strip(),
        "dataConsegna": str(parsed.get("dataConsegna", "") or "").strip(),
        "note": str(parsed.get("note", "") or "").strip(),
        "pedane": pedane,
    }


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


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
