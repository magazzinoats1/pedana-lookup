"""Backend tests for the Nome Magazziniere feature (iteration 7).

Covers:
  * PATCH /api/pedane/{id}/stato validation of body.operatore
    - missing -> 422 (pydantic min_length=1 on required field)
    - blank '  ' -> 400 'Inserisci il nome del magazziniere'
    - stato=completo -> arrivoCompletoDa=operatore (arrivoCompletoAt set)
    - stato=parziale -> arrivoParzialeDa=operatore (arrivoParzialeAt set)
    - stato=attesa -> arrivoCompletoDa / arrivoParzialeDa cleared to ""
  * POST /api/ordini/scarica
    - requires operatore (missing -> 422, blank -> 400)
    - sets arrivoCompletoDa on flipped pedane
  * GET /api/pedane/tutte returns arrivoCompletoDa / arrivoParzialeDa fields.

All data is TEST_ prefixed and cleaned up by the module fixture.
"""
import os
import time
from datetime import date

import pytest
import requests


# ── Config ─────────────────────────────────────────────────────────────────
BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    from pathlib import Path
    for ln in Path("/app/frontend/.env").read_text().splitlines():
        if ln.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = ln.split("=", 1)[1].strip().strip('"').rstrip("/")

DEFAULT_PW = os.environ.get("UFFICIO_DEFAULT_PASSWORD", "antolini2024")


# ── Fixtures ───────────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def auth(s):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"password": DEFAULT_PW}, timeout=15)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    return {"Authorization": f"Bearer {r.json()['token']}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def seeded(s, auth):
    """Seed TEST order with 3 pedane for stato operations + 1 for scarica."""
    stamp = str(int(time.time()))[-5:]
    num_stato = f"TEST_OP_{stamp}S"
    num_scar = f"TEST_OP_{stamp}X"
    body_stato = {
        "form": {"numeroOrdine": num_stato, "agenzia": "TEST_AG", "mittente": "TEST_MIT",
                 "dataConsegna": date.today().isoformat(), "note": ""},
        "pedane": [
            {"codice": f"TEST-OP-{stamp}-A", "destinazione": "TEST_DEST_A",
             "numeroColli": "1", "mittente": "", "merce": "TESTMERCE"},
            {"codice": f"TEST-OP-{stamp}-B", "destinazione": "TEST_DEST_B",
             "numeroColli": "1", "mittente": "", "merce": "TESTMERCE"},
            {"codice": f"TEST-OP-{stamp}-C", "destinazione": "TEST_DEST_C",
             "numeroColli": "1", "mittente": "", "merce": "TESTMERCE"},
        ],
    }
    r = s.post(f"{BASE_URL}/api/pedane", json=body_stato, headers=auth, timeout=15)
    assert r.status_code == 200, r.text
    stato_ids = [p["id"] for p in r.json()]

    body_scar = {
        "form": {"numeroOrdine": num_scar, "agenzia": "TEST_AG", "mittente": "TEST_MIT",
                 "dataConsegna": date.today().isoformat(), "note": ""},
        "pedane": [
            {"codice": f"TEST-OPX-{stamp}-A", "destinazione": "TEST_DX_A",
             "numeroColli": "1", "mittente": "", "merce": "TESTMERCE"},
            {"codice": f"TEST-OPX-{stamp}-B", "destinazione": "TEST_DX_B",
             "numeroColli": "1", "mittente": "", "merce": "TESTMERCE"},
        ],
    }
    r2 = s.post(f"{BASE_URL}/api/pedane", json=body_scar, headers=auth, timeout=15)
    assert r2.status_code == 200, r2.text
    scar_ids = [p["id"] for p in r2.json()]

    yield {"stato_ids": stato_ids, "scar_ids": scar_ids,
           "num_stato": num_stato, "num_scar": num_scar}

    for pid in stato_ids + scar_ids:
        try:
            s.delete(f"{BASE_URL}/api/pedane/{pid}", headers=auth, timeout=10)
        except Exception:
            pass


# ── PATCH /pedane/{id}/stato : operatore validation ─────────────────────────
def test_stato_missing_operatore_returns_422(s, seeded):
    pid = seeded["stato_ids"][0]
    r = s.patch(f"{BASE_URL}/api/pedane/{pid}/stato",
                json={"stato": "completo"}, timeout=15)
    assert r.status_code == 422, f"expected 422, got {r.status_code} {r.text}"


def test_stato_blank_operatore_returns_400(s, seeded):
    pid = seeded["stato_ids"][0]
    r = s.patch(f"{BASE_URL}/api/pedane/{pid}/stato",
                json={"stato": "completo", "operatore": "  "}, timeout=15)
    assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"
    assert "Inserisci il nome del magazziniere" in r.text


# ── stato=completo sets arrivoCompletoDa ──────────────────────────────────
def test_stato_completo_records_operatore(s, seeded):
    pid = seeded["stato_ids"][0]
    r = s.patch(f"{BASE_URL}/api/pedane/{pid}/stato",
                json={"stato": "completo", "operatore": "  Mario Rossi  "}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["statoArrivo"] == "completo"
    assert body["arrivoCompletoDa"] == "Mario Rossi", f"got {body['arrivoCompletoDa']!r}"
    assert body["arrivoCompletoAt"]
    # GET verifies persistence
    r2 = s.get(f"{BASE_URL}/api/pedane/{pid}", timeout=15)
    assert r2.status_code == 200
    assert r2.json()["arrivoCompletoDa"] == "Mario Rossi"


# ── stato=parziale sets arrivoParzialeDa ──────────────────────────────────
def test_stato_parziale_records_operatore(s, seeded):
    pid = seeded["stato_ids"][1]
    r = s.patch(f"{BASE_URL}/api/pedane/{pid}/stato",
                json={"stato": "parziale", "operatore": "Luca Bianchi",
                      "noteParziale": "mancano 2 colli"}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["statoArrivo"] == "parziale"
    assert body["arrivoParzialeDa"] == "Luca Bianchi"
    assert body["arrivoParzialeAt"]
    assert body["noteParziale"] == "mancano 2 colli"


# ── stato=attesa clears both arrivo*Da ────────────────────────────────────
def test_stato_attesa_clears_operatore(s, seeded):
    pid = seeded["stato_ids"][2]
    # First mark completo
    r0 = s.patch(f"{BASE_URL}/api/pedane/{pid}/stato",
                 json={"stato": "completo", "operatore": "Someone"}, timeout=15)
    assert r0.status_code == 200
    assert r0.json()["arrivoCompletoDa"] == "Someone"
    # Then reset
    r = s.patch(f"{BASE_URL}/api/pedane/{pid}/stato",
                json={"stato": "attesa", "operatore": "AnyName"}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["statoArrivo"] == "attesa"
    assert body["arrivoCompletoDa"] == ""
    assert body["arrivoParzialeDa"] == ""
    assert body["arrivoCompletoAt"] is None
    assert body["arrivoParzialeAt"] is None


# ── POST /ordini/scarica : operatore validation ───────────────────────────
def test_scarica_missing_operatore_returns_422(s, seeded):
    r = s.post(f"{BASE_URL}/api/ordini/scarica",
               json={"numeroOrdine": seeded["num_scar"]}, timeout=15)
    assert r.status_code == 422, f"expected 422, got {r.status_code} {r.text}"


def test_scarica_blank_operatore_returns_400(s, seeded):
    r = s.post(f"{BASE_URL}/api/ordini/scarica",
               json={"numeroOrdine": seeded["num_scar"], "operatore": "   "},
               timeout=15)
    assert r.status_code == 400
    assert "Inserisci il nome del magazziniere" in r.text


# ── scarica sets arrivoCompletoDa on all flipped pedane ───────────────────
def test_scarica_records_operatore_on_pedane(s, seeded):
    r = s.post(f"{BASE_URL}/api/ordini/scarica",
               json={"numeroOrdine": seeded["num_scar"], "operatore": "Giulia Verdi"},
               timeout=15)
    assert r.status_code == 200, r.text
    assert r.json()["aggiornate"] == 2
    # Verify via /pedane/tutte
    r2 = s.get(f"{BASE_URL}/api/pedane/tutte", timeout=15)
    assert r2.status_code == 200
    rows = [p for p in r2.json() if p["numeroOrdine"] == seeded["num_scar"]]
    assert len(rows) == 2
    for p in rows:
        assert p["statoArrivo"] == "completo"
        assert p["arrivoCompletoDa"] == "Giulia Verdi", f"got {p['arrivoCompletoDa']!r}"
        assert p["arrivoCompletoAt"]


# ── GET /pedane/tutte exposes arrivoCompletoDa / arrivoParzialeDa fields ──
def test_tutte_exposes_da_fields(s, seeded):
    r = s.get(f"{BASE_URL}/api/pedane/tutte", timeout=15)
    assert r.status_code == 200
    items = r.json()
    assert items, "expected at least some records"
    sample = items[0]
    assert "arrivoCompletoDa" in sample
    assert "arrivoParzialeDa" in sample
