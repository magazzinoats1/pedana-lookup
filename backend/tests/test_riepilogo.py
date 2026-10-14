"""Backend tests for GET /api/riepilogo?data=YYYY-MM-DD and related persistence.

Covers:
- 401 without Bearer
- 422 on invalid date format
- 200 with correct ordering (numeroOrdine asc, codice asc)
- stato updates on test pedane reflected in riepilogo response
"""
import time
import uuid
import pytest
import requests
from datetime import date


@pytest.fixture(scope="module")
def today_iso():
    return date.today().isoformat()


@pytest.fixture(scope="module")
def seeded_test_pedane(base_url, auth_headers, today_iso):
    """Create 2 TEST orders (3 pedane) with dataConsegna=today, cleanup after."""
    created_ids = []
    stamp = int(time.time())
    orders = [
        {
            "form": {
                "numeroOrdine": f"TEST_RIEP_B_{stamp}",
                "agenzia": "TestAg B",
                "mittente": "",
                "dataConsegna": today_iso,
                "note": "",
            },
            "pedane": [
                {"codice": f"TEST-B2-{stamp}", "destinazione": "Verona", "numeroColli": "5",
                 "mittente": "TEST-MIT", "merce": "Uva"},
                {"codice": f"TEST-B1-{stamp}", "destinazione": "Verona", "numeroColli": "3",
                 "mittente": "TEST-MIT", "merce": "Mele"},
            ],
        },
        {
            "form": {
                "numeroOrdine": f"TEST_RIEP_A_{stamp}",
                "agenzia": "TestAg A",
                "mittente": "",
                "dataConsegna": today_iso,
                "note": "",
            },
            "pedane": [
                {"codice": f"TEST-A1-{stamp}", "destinazione": "Milano", "numeroColli": "2",
                 "mittente": "TEST-MIT", "merce": "Radicchio"},
            ],
        },
    ]
    created = []
    for o in orders:
        r = requests.post(f"{base_url}/api/pedane", json=o, headers=auth_headers, timeout=20)
        assert r.status_code == 200, r.text
        for p in r.json():
            created.append(p)
            created_ids.append(p["id"])

    yield {"ids": created_ids, "stamp": stamp, "orders": created}

    for pid in created_ids:
        try:
            requests.delete(f"{base_url}/api/pedane/{pid}", headers=auth_headers, timeout=10)
        except Exception:
            pass


class TestRiepilogoAuth:
    def test_requires_bearer(self, base_url, today_iso):
        r = requests.get(f"{base_url}/api/riepilogo", params={"data": today_iso}, timeout=10)
        assert r.status_code == 401

    def test_rejects_bad_date_format(self, base_url, auth_headers):
        r = requests.get(f"{base_url}/api/riepilogo", params={"data": "2026-1-1"},
                         headers=auth_headers, timeout=10)
        assert r.status_code == 422

    def test_rejects_non_iso_date(self, base_url, auth_headers):
        r = requests.get(f"{base_url}/api/riepilogo", params={"data": "01/01/2026"},
                         headers=auth_headers, timeout=10)
        assert r.status_code == 422


class TestRiepilogoData:
    def test_returns_only_today_sorted(self, base_url, auth_headers, today_iso, seeded_test_pedane):
        r = requests.get(f"{base_url}/api/riepilogo", params={"data": today_iso},
                         headers=auth_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # All returned pedane must match the requested dataConsegna
        for p in data:
            assert p["dataConsegna"] == today_iso

        # Our 3 test pedane must be present
        test_items = [p for p in data if p["id"] in seeded_test_pedane["ids"]]
        assert len(test_items) == 3

        # Sort check: numeroOrdine asc, codice asc. Our 2 seeded orders A < B,
        # within B the codice TEST-B1-* < TEST-B2-*
        idx = {p["id"]: i for i, p in enumerate(data)}
        a1 = next(p for p in test_items if p["codice"].startswith("TEST-A1"))
        b1 = next(p for p in test_items if p["codice"].startswith("TEST-B1"))
        b2 = next(p for p in test_items if p["codice"].startswith("TEST-B2"))
        assert idx[a1["id"]] < idx[b1["id"]] < idx[b2["id"]]

    def test_rejects_wrong_date_excludes_items(self, base_url, auth_headers, seeded_test_pedane):
        # Use a far-future date that no real data should match
        r = requests.get(f"{base_url}/api/riepilogo", params={"data": "2099-12-31"},
                         headers=auth_headers, timeout=15)
        assert r.status_code == 200
        data = r.json()
        # None of the TEST ids should appear
        test_ids = set(seeded_test_pedane["ids"])
        assert not any(p["id"] in test_ids for p in data)


class TestRiepilogoLiveStateUpdate:
    def test_stato_change_reflects_in_riepilogo(self, base_url, auth_headers, today_iso,
                                                 seeded_test_pedane):
        target = seeded_test_pedane["ids"][0]
        # Mark completo (public endpoint - no bearer required)
        r = requests.patch(f"{base_url}/api/pedane/{target}/stato",
                           json={"stato": "completo", "operatore": "Tester"},
                           timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["statoArrivo"] == "completo"
        assert body["arrivoCompletoDa"] == "Tester"
        assert body["arrivoCompletoAt"]

        # Fetch riepilogo and confirm the item carries the new state + operatore
        r2 = requests.get(f"{base_url}/api/riepilogo", params={"data": today_iso},
                          headers=auth_headers, timeout=15)
        assert r2.status_code == 200
        item = next(p for p in r2.json() if p["id"] == target)
        assert item["statoArrivo"] == "completo"
        assert item["arrivoCompletoDa"] == "Tester"
        assert item["arrivoCompletoAt"]
