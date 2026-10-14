"""Backend tests for POST /api/ordini/scarica (public endpoint) and
seed-data helpers used to validate the Oggi/Domani date filter chips.

All test data is prefixed with TEST_ and cleaned up via a session fixture.
"""
import os
import time
from datetime import date, timedelta

import pytest
import requests


BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    from pathlib import Path
    fe = Path("/app/frontend/.env").read_text().splitlines()
    for ln in fe:
        if ln.startswith("EXPO_PUBLIC_BACKEND_URL="):
            BASE_URL = ln.split("=", 1)[1].strip().strip('"').rstrip("/")

DEFAULT_PW = os.environ.get("UFFICIO_DEFAULT_PASSWORD", "antolini2024")


def _iso(offset: int) -> str:
    return (date.today() + timedelta(days=offset)).isoformat()


# ── Session fixtures ────────────────────────────────────────────────────────
@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def token(s):
    r = s.post(f"{BASE_URL}/api/auth/login", json={"password": DEFAULT_PW}, timeout=15)
    assert r.status_code == 200, f"login failed {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def created_ids(s, auth):
    """Seed 3 orders: today (2 pedane), tomorrow (1), yesterday (1).
    Yields list of pedana ids to clean up afterwards."""
    created = []
    stamp = str(int(time.time()))[-5:]

    def mk(num, data, pedane):
        body = {
            "form": {"numeroOrdine": num, "agenzia": "TEST_AG", "mittente": "TEST_MIT",
                     "dataConsegna": data, "note": ""},
            "pedane": pedane,
        }
        r = s.post(f"{BASE_URL}/api/pedane", json=body, headers=auth, timeout=15)
        assert r.status_code == 200, f"create failed {r.status_code} {r.text}"
        data_js = r.json()
        for p in data_js:
            created.append(p["id"])
        return [p["id"] for p in data_js]

    # Order #1: today, 2 pedane
    today_num = f"TEST_{stamp}T"
    today_ids = mk(today_num, _iso(0), [
        {"codice": f"TEST-T-{stamp}-A", "destinazione": "DEST_T_A", "numeroColli": "3", "mittente": "", "merce": "TESTMERCE"},
        {"codice": f"TEST-T-{stamp}-B", "destinazione": "DEST_T_B", "numeroColli": "2", "mittente": "", "merce": "TESTMERCE"},
    ])
    # Order #2: tomorrow, 1 pedana
    tomorrow_num = f"TEST_{stamp}D"
    tomorrow_ids = mk(tomorrow_num, _iso(1), [
        {"codice": f"TEST-D-{stamp}-A", "destinazione": "DEST_D_A", "numeroColli": "1", "mittente": "", "merce": "TESTMERCE"},
    ])
    # Order #3: yesterday, 1 pedana (should NOT appear under Oggi/Domani)
    past_num = f"TEST_{stamp}P"
    past_ids = mk(past_num, _iso(-1), [
        {"codice": f"TEST-P-{stamp}-A", "destinazione": "DEST_P_A", "numeroColli": "1", "mittente": "", "merce": "TESTMERCE"},
    ])

    yield {
        "today_num": today_num, "today_ids": today_ids,
        "tomorrow_num": tomorrow_num, "tomorrow_ids": tomorrow_ids,
        "past_num": past_num, "past_ids": past_ids,
        "all": created,
    }

    # Cleanup
    for pid in created:
        try:
            s.delete(f"{BASE_URL}/api/pedane/{pid}", headers=auth, timeout=10)
        except Exception:
            pass


# ── Tests ──────────────────────────────────────────────────────────────────
# health
def test_health_root(s):
    r = s.get(f"{BASE_URL}/api/", timeout=10)
    assert r.status_code == 200
    assert "message" in r.json()


# date filter prerequisites: /pedane/tutte returns iso dataConsegna fields
def test_tutte_returns_dataconsegna(s, created_ids):
    r = s.get(f"{BASE_URL}/api/pedane/tutte", timeout=15)
    assert r.status_code == 200
    items = r.json()
    today, tomorrow = _iso(0), _iso(1)
    todays = [p for p in items if p["dataConsegna"] == today and p["numeroOrdine"] == created_ids["today_num"]]
    tomorrows = [p for p in items if p["dataConsegna"] == tomorrow and p["numeroOrdine"] == created_ids["tomorrow_num"]]
    assert len(todays) == 2, f"expected 2 today pedane for {created_ids['today_num']}, got {len(todays)}"
    assert len(tomorrows) == 1


# scarica: happy path marks all non-completo pedane completo
def test_scarica_marks_all_pedane_completo(s, created_ids):
    r = s.post(f"{BASE_URL}/api/ordini/scarica",
               json={"numeroOrdine": created_ids["today_num"]}, timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert "aggiornate" in body
    assert body["aggiornate"] == 2, f"expected 2 pedane updated, got {body}"

    # verify persistence + arrivoCompletoAt populated
    r2 = s.get(f"{BASE_URL}/api/pedane/tutte", timeout=15)
    assert r2.status_code == 200
    rows = [p for p in r2.json() if p["numeroOrdine"] == created_ids["today_num"]]
    assert len(rows) == 2
    for p in rows:
        assert p["statoArrivo"] == "completo"
        assert p["arrivoCompletoAt"], f"arrivoCompletoAt should be set, got {p['arrivoCompletoAt']}"


# scarica: already-completo pedane are untouched (idempotent, arrivoCompletoAt unchanged)
def test_scarica_idempotent_leaves_completo_alone(s, created_ids):
    # Snapshot arrivoCompletoAt
    r0 = s.get(f"{BASE_URL}/api/pedane/tutte", timeout=15)
    before = {p["id"]: p["arrivoCompletoAt"]
              for p in r0.json() if p["numeroOrdine"] == created_ids["today_num"]}
    assert all(v for v in before.values()), "setup: all today pedane should already be completo from previous test"

    time.sleep(1.1)  # ensure clock diff would be observable
    r = s.post(f"{BASE_URL}/api/ordini/scarica",
               json={"numeroOrdine": created_ids["today_num"]}, timeout=15)
    assert r.status_code == 200
    assert r.json()["aggiornate"] == 0, "no pedane should be updated on second call"

    r2 = s.get(f"{BASE_URL}/api/pedane/tutte", timeout=15)
    after = {p["id"]: p["arrivoCompletoAt"]
             for p in r2.json() if p["numeroOrdine"] == created_ids["today_num"]}
    assert before == after, "arrivoCompletoAt timestamps must NOT change on idempotent call"


# scarica: unknown order returns aggiornate: 0
def test_scarica_unknown_order(s):
    r = s.post(f"{BASE_URL}/api/ordini/scarica",
               json={"numeroOrdine": "TEST_DOES_NOT_EXIST_XYZ"}, timeout=15)
    assert r.status_code == 200
    assert r.json() == {"aggiornate": 0}


# scarica: validation - empty numeroOrdine should 422
def test_scarica_empty_number_rejected(s):
    r = s.post(f"{BASE_URL}/api/ordini/scarica", json={"numeroOrdine": ""}, timeout=15)
    assert r.status_code == 422


# scarica: partial order - only non-completo pedane get flipped
def test_scarica_partial_order(s, created_ids, auth):
    # Mark the single tomorrow pedana to completo manually (public /pedane/{id}/stato)
    pid = created_ids["tomorrow_ids"][0]
    r0 = s.patch(f"{BASE_URL}/api/pedane/{pid}/stato",
                 json={"stato": "completo"}, timeout=15)
    assert r0.status_code == 200
    assert r0.json()["statoArrivo"] == "completo"

    # Add a second attesa pedana to the same order via office endpoint
    body = {
        "form": {"numeroOrdine": created_ids["tomorrow_num"], "agenzia": "TEST_AG",
                 "mittente": "TEST_MIT", "dataConsegna": _iso(1), "note": ""},
        "pedane": [{"codice": f"TEST-D-ADD-{int(time.time())}", "destinazione": "D2",
                    "numeroColli": "1", "mittente": "", "merce": "TESTMERCE"}],
    }
    r1 = s.post(f"{BASE_URL}/api/pedane", json=body, headers=auth, timeout=15)
    assert r1.status_code == 200
    extra_id = r1.json()[0]["id"]
    created_ids["all"].append(extra_id)

    # scarica → should only flip the 1 attesa (not re-touch the completo one)
    r = s.post(f"{BASE_URL}/api/ordini/scarica",
               json={"numeroOrdine": created_ids["tomorrow_num"]}, timeout=15)
    assert r.status_code == 200
    assert r.json()["aggiornate"] == 1, f"expected exactly 1 flipped, got {r.json()}"

    # verify both are now completo
    r2 = s.get(f"{BASE_URL}/api/pedane/tutte", timeout=15)
    rows = [p for p in r2.json() if p["numeroOrdine"] == created_ids["tomorrow_num"]]
    assert len(rows) == 2
    assert all(p["statoArrivo"] == "completo" for p in rows)


# scarica is PUBLIC (no auth required)
def test_scarica_is_public_no_auth_header(s, created_ids):
    # create a new TEST order on the fly
    pass  # covered by other tests which do not send auth headers to /ordini/scarica
