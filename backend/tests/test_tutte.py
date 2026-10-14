"""
Tests for GET /api/pedane/tutte (public endpoint listing all registered pedane).
Verifies route ordering (tutte must be defined before /{pid}) and sorting.
"""
import uuid
import pytest


class TestPedaneTutte:
    def test_tutte_no_auth(self, api_client, base_url):
        """GET /api/pedane/tutte should be public (no auth required)."""
        r = api_client.get(f"{base_url}/api/pedane/tutte")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        # Shape check on first element (if any exist)
        if data:
            p = data[0]
            # merce field must be present (even if empty string)
            assert "merce" in p
            assert "codice" in p
            assert "mittente" in p
            assert "numeroColli" in p
            assert "dataConsegna" in p
            assert "statoArrivo" in p
            # mongo ObjectId must NOT leak
            assert "_id" not in p

    def test_tutte_returns_at_least_existing(self, api_client, base_url):
        """Should return the ~24 real pedane currently stored (allow >=1)."""
        r = api_client.get(f"{base_url}/api/pedane/tutte")
        assert r.status_code == 200
        data = r.json()
        # Non-blocking lower bound: the DB has real data; expect >= 1
        assert len(data) >= 1

    def test_tutte_sorted_by_dataConsegna_desc(self, api_client, base_url):
        """Results must be sorted by dataConsegna descending (then createdAt desc)."""
        r = api_client.get(f"{base_url}/api/pedane/tutte")
        assert r.status_code == 200
        data = r.json()
        if len(data) >= 2:
            dates = [d.get("dataConsegna", "") for d in data]
            # Each consecutive pair: dates[i] >= dates[i+1] (string ISO YYYY-MM-DD is lex-sortable)
            for i in range(len(dates) - 1):
                assert dates[i] >= dates[i + 1], (
                    f"Not sorted desc at index {i}: {dates[i]!r} < {dates[i+1]!r}"
                )

    def test_route_order_get_pedana_by_id_still_works(self, api_client, auth_headers, base_url):
        """Ensure /api/pedane/{pid} still resolves after /tutte route is added."""
        # Create a TEST pedana
        numero = f"TEST{uuid.uuid4().hex[:8].upper()}"
        body = {
            "form": {"numeroOrdine": numero, "agenzia": "TEST AG",
                     "mittente": "TEST Mittente", "dataConsegna": "2026-03-01", "note": ""},
            "pedane": [{"codice": f"TUTTE-{numero}", "destinazione": "X",
                        "numeroColli": "1", "mittente": "", "merce": "test merce"}],
        }
        created = api_client.post(f"{base_url}/api/pedane", json=body, headers=auth_headers).json()
        pid = created[0]["id"]
        try:
            # Direct GET by id must still work (route order check)
            r = api_client.get(f"{base_url}/api/pedane/{pid}")
            assert r.status_code == 200, r.text
            got = r.json()
            assert got["id"] == pid
            assert got["codice"] == f"TUTTE-{numero}"
            assert got["merce"] == "test merce"

            # 'tutte' is NOT a valid id — must NOT match /{pid} path (should return list, not 404)
            r2 = api_client.get(f"{base_url}/api/pedane/tutte")
            assert r2.status_code == 200
            assert isinstance(r2.json(), list)
        finally:
            api_client.delete(f"{base_url}/api/pedane/{pid}", headers=auth_headers)

    def test_tutte_includes_newly_created(self, api_client, auth_headers, base_url):
        """New pedana appears in /tutte list."""
        numero = f"TEST{uuid.uuid4().hex[:8].upper()}"
        body = {
            "form": {"numeroOrdine": numero, "mittente": "M", "dataConsegna": "2027-12-31"},
            "pedane": [{"codice": f"NEW-{numero}", "destinazione": "Z", "numeroColli": "2", "merce": "mele"}],
        }
        created = api_client.post(f"{base_url}/api/pedane", json=body, headers=auth_headers).json()
        pid = created[0]["id"]
        try:
            r = api_client.get(f"{base_url}/api/pedane/tutte")
            assert r.status_code == 200
            codes = [p["codice"] for p in r.json()]
            assert f"NEW-{numero}" in codes
            # And since dataConsegna is far-future, it should be near the top
            top5_codes = codes[:5]
            assert f"NEW-{numero}" in top5_codes
        finally:
            api_client.delete(f"{base_url}/api/pedane/{pid}", headers=auth_headers)
