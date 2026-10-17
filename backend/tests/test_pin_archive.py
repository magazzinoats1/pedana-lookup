"""Backend tests for Magazzinieri (PIN) + Archivio features."""
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ['EXPO_PUBLIC_BACKEND_URL'].rstrip('/')
OFFICE_PW = "antolini2024"
HDR = {"User-Agent": "pytest-backend-test"}


def _url(p):
    return f"{BASE_URL}{p}"


@pytest.fixture(scope="module")
def office_token():
    r = requests.post(_url("/api/auth/login"), json={"password": OFFICE_PW}, headers=HDR, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def office_hdr(office_token):
    return {**HDR, "Authorization": f"Bearer {office_token}"}


@pytest.fixture(scope="module")
def tag():
    return f"TESTPIN_{uuid.uuid4().hex[:6]}"


@pytest.fixture(scope="module")
def worker(office_hdr, tag):
    """Create one worker, clean up at end."""
    nome = f"{tag}_W"
    r = requests.post(_url("/api/magazzinieri"), json={"nome": nome, "pin": "1234"}, headers=office_hdr, timeout=15)
    assert r.status_code == 200, r.text
    w = r.json()
    yield w
    requests.delete(_url(f"/api/magazzinieri/{w['id']}"), headers=office_hdr, timeout=15)


# ── Magazzinieri CRUD ────────────────────────────────────────────────────────
class TestMagazzinieriCRUD:
    def test_create_dup_name_400(self, office_hdr, worker):
        r = requests.post(_url("/api/magazzinieri"), json={"nome": worker["nome"], "pin": "9999"}, headers=office_hdr, timeout=15)
        assert r.status_code == 400

    def test_create_bad_pin_422(self, office_hdr, tag):
        r = requests.post(_url("/api/magazzinieri"), json={"nome": f"{tag}_bad", "pin": "12"}, headers=office_hdr, timeout=15)
        assert r.status_code == 422

    def test_list_requires_auth(self):
        r = requests.get(_url("/api/magazzinieri"), headers=HDR, timeout=15)
        assert r.status_code == 401

    def test_list_office(self, office_hdr, worker):
        r = requests.get(_url("/api/magazzinieri"), headers=office_hdr, timeout=15)
        assert r.status_code == 200
        ids = [w["id"] for w in r.json()]
        assert worker["id"] in ids

    def test_nomi_public_no_pin_hash(self, worker):
        r = requests.get(_url("/api/magazzinieri/nomi"), headers=HDR, timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert any(w["id"] == worker["id"] for w in items)
        for w in items:
            assert "pin_hash" not in w
            assert set(w.keys()) <= {"id", "nome"}


# ── Login flow ───────────────────────────────────────────────────────────────
class TestMagLogin:
    def test_no_token_pedane_401(self):
        r = requests.get(_url("/api/pedane"), headers=HDR, timeout=15)
        assert r.status_code == 401

    def test_wrong_pin_401_with_remaining(self, office_hdr, tag):
        # dedicated worker to not pollute main one
        r = requests.post(_url("/api/magazzinieri"), json={"nome": f"{tag}_lock", "pin": "1111"}, headers=office_hdr, timeout=15)
        wid = r.json()["id"]
        try:
            for i in range(1, 5):
                rr = requests.post(_url("/api/auth/magazzino/login"), json={"id": wid, "pin": "0000"}, headers=HDR, timeout=15)
                assert rr.status_code == 401
                assert "tentativ" in rr.json()["detail"].lower()
            # 5th wrong attempt → 429 lock
            rr = requests.post(_url("/api/auth/magazzino/login"), json={"id": wid, "pin": "0000"}, headers=HDR, timeout=15)
            assert rr.status_code == 429
            # now locked: another attempt even with correct PIN → 429
            rr = requests.post(_url("/api/auth/magazzino/login"), json={"id": wid, "pin": "1111"}, headers=HDR, timeout=15)
            assert rr.status_code == 429
        finally:
            requests.delete(_url(f"/api/magazzinieri/{wid}"), headers=office_hdr, timeout=15)

    def test_correct_pin(self, worker):
        r = requests.post(_url("/api/auth/magazzino/login"), json={"id": worker["id"], "pin": "1234"}, headers=HDR, timeout=15)
        assert r.status_code == 200
        j = r.json()
        assert j["nome"] == worker["nome"]
        assert j["token"]

    def test_me_endpoint(self, worker):
        r = requests.post(_url("/api/auth/magazzino/login"), json={"id": worker["id"], "pin": "1234"}, headers=HDR, timeout=15)
        tok = r.json()["token"]
        rr = requests.get(_url("/api/auth/magazzino/me"), headers={**HDR, "Authorization": f"Bearer {tok}"}, timeout=15)
        assert rr.status_code == 200
        assert rr.json()["nome"] == worker["nome"]

    def test_role_separation(self, office_hdr, worker):
        # worker token on office endpoint → 403
        tok = requests.post(_url("/api/auth/magazzino/login"), json={"id": worker["id"], "pin": "1234"}, headers=HDR, timeout=15).json()["token"]
        r = requests.get(_url("/api/pedane"), headers={**HDR, "Authorization": f"Bearer {tok}"}, timeout=15)
        assert r.status_code == 403
        # office token on PATCH stato → 403 (use dummy id, auth check first)
        r = requests.patch(_url("/api/pedane/does-not-exist/stato"), json={"stato": "completo"}, headers=office_hdr, timeout=15)
        assert r.status_code == 403


# ── Change PIN invalidates sessions ──────────────────────────────────────────
class TestChangePinInvalidates:
    def test_change_pin_kills_session(self, office_hdr, tag):
        # new worker
        wid = requests.post(_url("/api/magazzinieri"), json={"nome": f"{tag}_chg", "pin": "2222"}, headers=office_hdr, timeout=15).json()["id"]
        try:
            tok = requests.post(_url("/api/auth/magazzino/login"), json={"id": wid, "pin": "2222"}, headers=HDR, timeout=15).json()["token"]
            # verify active
            r = requests.get(_url("/api/auth/magazzino/me"), headers={**HDR, "Authorization": f"Bearer {tok}"}, timeout=15)
            assert r.status_code == 200
            # change pin
            r = requests.put(_url(f"/api/magazzinieri/{wid}/pin"), json={"pin": "3333"}, headers=office_hdr, timeout=15)
            assert r.status_code == 200
            # old token should be dead
            r = requests.get(_url("/api/auth/magazzino/me"), headers={**HDR, "Authorization": f"Bearer {tok}"}, timeout=15)
            assert r.status_code == 401
            # new pin works
            r = requests.post(_url("/api/auth/magazzino/login"), json={"id": wid, "pin": "3333"}, headers=HDR, timeout=15)
            assert r.status_code == 200
        finally:
            requests.delete(_url(f"/api/magazzinieri/{wid}"), headers=office_hdr, timeout=15)

    def test_delete_kills_session(self, office_hdr, tag):
        wid = requests.post(_url("/api/magazzinieri"), json={"nome": f"{tag}_del", "pin": "4444"}, headers=office_hdr, timeout=15).json()["id"]
        tok = requests.post(_url("/api/auth/magazzino/login"), json={"id": wid, "pin": "4444"}, headers=HDR, timeout=15).json()["token"]
        r = requests.delete(_url(f"/api/magazzinieri/{wid}"), headers=office_hdr, timeout=15)
        assert r.status_code == 200
        r = requests.get(_url("/api/auth/magazzino/me"), headers={**HDR, "Authorization": f"Bearer {tok}"}, timeout=15)
        assert r.status_code == 401


# ── Operatore tracking via session ───────────────────────────────────────────
class TestOperatoreFromSession:
    def test_stato_records_worker_nome(self, office_hdr, worker, tag):
        # create a TEST order
        numero = f"{tag}_O1"
        r = requests.post(_url("/api/pedane"), json={
            "form": {"numeroOrdine": numero, "agenzia": "TEST", "mittente": "TEST", "dataConsegna": "2025-01-01", "note": ""},
            "pedane": [{"codice": f"{tag}-A", "destinazione": "Dest"}],
        }, headers=office_hdr, timeout=15)
        assert r.status_code == 200
        pid = r.json()[0]["id"]
        try:
            tok = requests.post(_url("/api/auth/magazzino/login"), json={"id": worker["id"], "pin": "1234"}, headers=HDR, timeout=15).json()["token"]
            whdr = {**HDR, "Authorization": f"Bearer {tok}"}
            # body operatore should be ignored - use session nome
            r = requests.patch(_url(f"/api/pedane/{pid}/stato"), json={"stato": "completo", "operatore": "HACKER"}, headers=whdr, timeout=15)
            assert r.status_code == 200
            j = r.json()
            assert j["statoArrivo"] == "completo"
            assert j["arrivoCompletoDa"] == worker["nome"]
            # scarica with worker
            r = requests.post(_url("/api/ordini/scarica"), json={"numeroOrdine": numero}, headers=whdr, timeout=15)
            assert r.status_code == 200
        finally:
            requests.delete(_url(f"/api/pedane/{pid}"), headers=office_hdr, timeout=15)


# ── Archivio ─────────────────────────────────────────────────────────────────
class TestArchivio:
    def test_archive_flow(self, office_hdr, worker, tag):
        """Create TEST order with dataConsegna 60d ago, mark completo, esegui -> archived; restore."""
        old_date = (datetime.now(timezone.utc) - timedelta(days=60)).date().isoformat()
        recent_date = (datetime.now(timezone.utc) - timedelta(days=5)).date().isoformat()
        numero_old = f"{tag}_OLD"
        numero_recent = f"{tag}_NEW"
        numero_partial = f"{tag}_PRT"

        # Create 3 orders
        def mk(num, data, codici):
            r = requests.post(_url("/api/pedane"), json={
                "form": {"numeroOrdine": num, "agenzia": "TEST", "mittente": "TEST", "dataConsegna": data, "note": ""},
                "pedane": [{"codice": c, "destinazione": "D"} for c in codici],
            }, headers=office_hdr, timeout=15)
            assert r.status_code == 200
            return [p["id"] for p in r.json()]

        old_ids = mk(numero_old, old_date, [f"{tag}-OLD-1", f"{tag}-OLD-2"])
        recent_ids = mk(numero_recent, recent_date, [f"{tag}-NEW-1"])
        partial_ids = mk(numero_partial, old_date, [f"{tag}-PRT-1", f"{tag}-PRT-2"])

        try:
            tok = requests.post(_url("/api/auth/magazzino/login"), json={"id": worker["id"], "pin": "1234"}, headers=HDR, timeout=15).json()["token"]
            whdr = {**HDR, "Authorization": f"Bearer {tok}"}

            # Mark OLD completo (all), RECENT completo (all), PARTIAL only one
            for pid in old_ids + recent_ids + [partial_ids[0]]:
                r = requests.patch(_url(f"/api/pedane/{pid}/stato"), json={"stato": "completo"}, headers=whdr, timeout=15)
                assert r.status_code == 200

            # Run archive
            r = requests.post(_url("/api/archivio/esegui"), headers=office_hdr, timeout=15)
            assert r.status_code == 200
            assert r.json()["archiviati"] >= 1

            # OLD disappears from active lists
            r = requests.get(_url("/api/pedane"), headers=office_hdr, timeout=15)
            codici_active = [p["codice"] for p in r.json()]
            assert f"{tag}-OLD-1" not in codici_active
            assert f"{tag}-OLD-2" not in codici_active
            # Recent still active
            assert f"{tag}-NEW-1" in codici_active
            # Partial (old date, not all completo) still active
            assert f"{tag}-PRT-1" in codici_active
            assert f"{tag}-PRT-2" in codici_active

            # /pedane/tutte: no archived
            r = requests.get(_url("/api/pedane/tutte"), headers=HDR, timeout=15)
            tutte_cod = [p["codice"] for p in r.json()]
            assert f"{tag}-OLD-1" not in tutte_cod

            # /pedane/cerca does not return archived
            r = requests.get(_url(f"/api/pedane/cerca?q={tag}-OLD-1"), headers=HDR, timeout=15)
            assert r.status_code == 200
            assert all(p["codice"] != f"{tag}-OLD-1" for p in r.json())

            # /archivio shows OLD
            r = requests.get(_url(f"/api/archivio?q={tag}_OLD"), headers=office_hdr, timeout=15)
            assert r.status_code == 200
            j = r.json()
            assert j["total"] >= 2
            codici_arc = [p["codice"] for p in j["items"]]
            assert f"{tag}-OLD-1" in codici_arc and f"{tag}-OLD-2" in codici_arc

            # pagination: skip/limit
            r = requests.get(_url(f"/api/archivio?q={tag}_OLD&skip=0&limit=1"), headers=office_hdr, timeout=15)
            assert r.status_code == 200
            assert len(r.json()["items"]) == 1

            # Restore
            r = requests.post(_url("/api/archivio/ripristina"), json={"numeroOrdine": numero_old}, headers=office_hdr, timeout=15)
            assert r.status_code == 200
            assert r.json()["ripristinate"] >= 2

            # Running esegui again should NOT re-archive restored
            r = requests.post(_url("/api/archivio/esegui"), headers=office_hdr, timeout=15)
            assert r.status_code == 200
            # Verify back in active lists
            r = requests.get(_url("/api/pedane"), headers=office_hdr, timeout=15)
            codici_active = [p["codice"] for p in r.json()]
            assert f"{tag}-OLD-1" in codici_active

        finally:
            for pid in old_ids + recent_ids + partial_ids:
                requests.delete(_url(f"/api/pedane/{pid}"), headers=office_hdr, timeout=15)
