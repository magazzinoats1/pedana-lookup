"""Backend tests for PATCH /api/posizioni/stato (merged pedane same codice)."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://pedana-lookup.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"
OFFICE_PWD = "antolini2024"


@pytest.fixture(scope="module")
def office_token():
    r = requests.post(f"{API}/auth/login", json={"password": OFFICE_PWD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def worker(office_token):
    nome = f"TEST_W_{uuid.uuid4().hex[:6]}"
    pin = "1234"
    r = requests.post(f"{API}/magazzinieri", json={"nome": nome, "pin": pin},
                      headers={"Authorization": f"Bearer {office_token}"}, timeout=15)
    assert r.status_code == 200, r.text
    wid = r.json()["id"]
    lg = requests.post(f"{API}/auth/magazzino/login", json={"id": wid, "pin": pin}, timeout=15)
    assert lg.status_code == 200, lg.text
    yield {"id": wid, "nome": nome, "token": lg.json()["token"]}
    requests.delete(f"{API}/magazzinieri/{wid}", headers={"Authorization": f"Bearer {office_token}"}, timeout=15)


@pytest.fixture(scope="module")
def test_order(office_token):
    """Create a TEST order: 2 pedane with same codice X, 1 pedana other codice Y, + 1 pedana same codice X but different order."""
    numero = f"TEST{uuid.uuid4().hex[:6].upper()}"
    numero_other = f"TEST{uuid.uuid4().hex[:6].upper()}"
    codice_shared = f"TEST-{uuid.uuid4().hex[:6].upper()}"
    codice_other = f"TEST-{uuid.uuid4().hex[:6].upper()}"
    data = "2099-01-15"
    headers = {"Authorization": f"Bearer {office_token}"}
    body1 = {
        "form": {"numeroOrdine": numero, "agenzia": "TEST_AGE", "trasportatore": "TEST_TR",
                 "mittente": "TEST_MITT", "dataConsegna": data, "note": "TEST"},
        "pedane": [
            {"codice": codice_shared, "destinazione": "TEST Dest", "numeroColli": "84", "numeroPedane": "1",
             "mittente": "", "merce": "Merce A"},
            {"codice": codice_shared, "destinazione": "TEST Dest", "numeroColli": "84", "numeroPedane": "1",
             "mittente": "", "merce": "Merce B"},
            {"codice": codice_other, "destinazione": "TEST Dest", "numeroColli": "20", "numeroPedane": "1",
             "mittente": "", "merce": "Merce C"},
        ],
    }
    r = requests.post(f"{API}/pedane", json=body1, headers=headers, timeout=15)
    assert r.status_code == 200, r.text
    created = r.json()
    assert len(created) == 3

    # Second order with the SAME codice_shared (must NOT be touched by posizioni/stato)
    body2 = {
        "form": {"numeroOrdine": numero_other, "agenzia": "TEST_AGE", "trasportatore": "TEST_TR",
                 "mittente": "TEST_MITT", "dataConsegna": data, "note": ""},
        "pedane": [
            {"codice": codice_shared, "destinazione": "TEST Dest", "numeroColli": "5", "numeroPedane": "1",
             "mittente": "", "merce": "Merce D"}
        ],
    }
    r2 = requests.post(f"{API}/pedane", json=body2, headers=headers, timeout=15)
    assert r2.status_code == 200, r2.text
    other_created = r2.json()

    ids = [p["id"] for p in created] + [p["id"] for p in other_created]
    yield {
        "numero": numero,
        "numero_other": numero_other,
        "codice_shared": codice_shared,
        "codice_other": codice_other,
        "pedane": created,
        "other": other_created,
        "all_ids": ids,
    }
    # Cleanup
    for pid in ids:
        requests.delete(f"{API}/pedane/{pid}", headers=headers, timeout=15)


class TestPosizioneStato:
    def test_no_token_401(self, test_order):
        r = requests.patch(f"{API}/posizioni/stato", json={
            "numeroOrdine": test_order["numero"], "codice": test_order["codice_shared"],
            "stato": "completo", "noteParziale": ""}, timeout=15)
        assert r.status_code == 401

    def test_office_token_forbidden_403(self, office_token, test_order):
        r = requests.patch(f"{API}/posizioni/stato", json={
            "numeroOrdine": test_order["numero"], "codice": test_order["codice_shared"],
            "stato": "completo", "noteParziale": ""},
            headers={"Authorization": f"Bearer {office_token}"}, timeout=15)
        assert r.status_code == 403

    def test_unknown_position_404(self, worker):
        r = requests.patch(f"{API}/posizioni/stato", json={
            "numeroOrdine": "TESTNOPE999", "codice": "TEST-XXXXXX",
            "stato": "completo", "noteParziale": ""},
            headers={"Authorization": f"Bearer {worker['token']}"}, timeout=15)
        assert r.status_code == 404

    def test_mark_completo_updates_both_pedane_case_insensitive(self, worker, test_order):
        # Use lowercase codice to verify case-insensitive match
        payload = {"numeroOrdine": test_order["numero"],
                   "codice": test_order["codice_shared"].lower(),
                   "stato": "completo", "noteParziale": ""}
        r = requests.patch(f"{API}/posizioni/stato", json=payload,
                           headers={"Authorization": f"Bearer {worker['token']}"}, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) == 2, f"Expected 2 pedane updated, got {len(data)}"
        for p in data:
            assert p["statoArrivo"] == "completo"
            assert p["arrivoCompletoDa"] == worker["nome"]
            assert p["arrivoCompletoAt"] is not None

        # Verify third pedana (other codice, same order) was NOT touched
        other = next(x for x in test_order["pedane"] if x["codice"] == test_order["codice_other"])
        g = requests.get(f"{API}/pedane/{other['id']}", timeout=15).json()
        assert g["statoArrivo"] == "attesa", "codice_other must not change"

        # Verify same codice in DIFFERENT order was NOT touched
        other_order = test_order["other"][0]
        g2 = requests.get(f"{API}/pedane/{other_order['id']}", timeout=15).json()
        assert g2["statoArrivo"] == "attesa", "different numeroOrdine must not change"

    def test_annulla_resets_both(self, worker, test_order):
        payload = {"numeroOrdine": test_order["numero"],
                   "codice": test_order["codice_shared"],
                   "stato": "attesa", "noteParziale": ""}
        r = requests.patch(f"{API}/posizioni/stato", json=payload,
                           headers={"Authorization": f"Bearer {worker['token']}"}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 2
        for p in data:
            assert p["statoArrivo"] == "attesa"
            assert p["arrivoCompletoAt"] is None
            assert p["arrivoCompletoDa"] == ""

    def test_parziale_with_note(self, worker, test_order):
        payload = {"numeroOrdine": test_order["numero"],
                   "codice": test_order["codice_shared"],
                   "stato": "parziale", "noteParziale": "TEST partial note"}
        r = requests.patch(f"{API}/posizioni/stato", json=payload,
                           headers={"Authorization": f"Bearer {worker['token']}"}, timeout=15)
        assert r.status_code == 200
        for p in r.json():
            assert p["statoArrivo"] == "parziale"
            assert p["noteParziale"] == "TEST partial note"
            assert p["arrivoParzialeDa"] == worker["nome"]
