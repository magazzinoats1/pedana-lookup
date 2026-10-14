"""
Tests for the LATEST feature changes:
- Multiple pedane with the SAME codice (posizione) must register without blocking.
- 'merce' field is persisted via POST, listed, searchable, and updatable via PUT.
- GET /api/pedane/cerca returns ALL pedane with the same codice, including merce.
"""
import uuid
import pytest
import requests
from .conftest import BASE_URL, DEFAULT_PW, PDF_URL


@pytest.fixture
def dup_pedane(api_client, auth_headers):
    """Create two pedane sharing the same codice with different merce under a TEST order."""
    numero = f"TEST{uuid.uuid4().hex[:8].upper()}"
    codice = f"TEST-{uuid.uuid4().hex[:6].upper()}"
    body = {
        "form": {
            "numeroOrdine": numero,
            "agenzia": "TEST AG",
            "mittente": "",
            "dataConsegna": "2026-02-20",
            "note": "merce+dup test",
        },
        "pedane": [
            {"codice": codice, "destinazione": "Milano", "numeroColli": "10",
             "mittente": "ORCHIDEA", "merce": "Uva rossa senza semi"},
            {"codice": codice, "destinazione": "Roma",   "numeroColli": "7",
             "mittente": "BERTOLI FRUIT", "merce": "Radicchio Trevisano"},
        ],
    }
    r = api_client.post(f"{BASE_URL}/api/pedane", json=body, headers=auth_headers)
    assert r.status_code == 200, r.text
    created = r.json()
    yield numero, codice, created
    for p in created:
        api_client.delete(f"{BASE_URL}/api/pedane/{p['id']}", headers=auth_headers)


class TestDuplicatePosizioneAndMerce:
    def test_both_pedane_created_with_same_codice(self, dup_pedane):
        _, codice, created = dup_pedane
        assert len(created) == 2
        assert created[0]["codice"] == codice
        assert created[1]["codice"] == codice
        # Each has distinct id
        assert created[0]["id"] != created[1]["id"]

    def test_merce_and_mittente_persisted(self, dup_pedane):
        _, _, created = dup_pedane
        merces = {p["merce"] for p in created}
        mittenti = {p["mittente"] for p in created}
        assert merces == {"Uva rossa senza semi", "Radicchio Trevisano"}
        assert mittenti == {"ORCHIDEA", "BERTOLI FRUIT"}

    def test_list_search_by_merce_text(self, api_client, auth_headers, dup_pedane):
        _, _, created = dup_pedane
        r = api_client.get(f"{BASE_URL}/api/pedane",
                           params={"q": "Radicchio Trevisano"}, headers=auth_headers)
        assert r.status_code == 200
        ids = {p["id"] for p in r.json()}
        assert created[1]["id"] in ids, "Search by merce text must return the matching pedana"

    def test_cerca_returns_all_pedane_with_same_codice(self, api_client, dup_pedane):
        _, codice, created = dup_pedane
        r = api_client.get(f"{BASE_URL}/api/pedane/cerca", params={"q": codice})
        assert r.status_code == 200
        rows = r.json()
        returned_ids = {p["id"] for p in rows}
        for p in created:
            assert p["id"] in returned_ids, f"cerca must return pedana {p['id']}"
        # merce present on each returned row
        for p in rows:
            if p["id"] in {c["id"] for c in created}:
                assert "merce" in p and p["merce"], "merce field must be present and non-empty"

    def test_put_updates_merce(self, api_client, auth_headers, dup_pedane):
        numero, codice, created = dup_pedane
        p = created[0]
        new_merce = "Uva bianca senza semi"
        body = {
            "form": {"numeroOrdine": numero, "agenzia": "TEST AG",
                     "mittente": "", "dataConsegna": "2026-02-20", "note": "edit"},
            "pedana": {"codice": p["codice"], "destinazione": p["destinazione"],
                       "numeroColli": p["numeroColli"], "mittente": p["mittente"],
                       "merce": new_merce},
        }
        r = api_client.put(f"{BASE_URL}/api/pedane/{p['id']}", json=body, headers=auth_headers)
        assert r.status_code == 200, r.text
        assert r.json()["merce"] == new_merce
        # GET confirms
        g = api_client.get(f"{BASE_URL}/api/pedane/{p['id']}")
        assert g.status_code == 200
        assert g.json()["merce"] == new_merce


class TestImportPdfMerceAndDup:
    def test_pdf_import_six_pedane_with_mittente_and_merce(self, auth_token):
        pdf_bytes = requests.get(PDF_URL, timeout=60).content
        assert pdf_bytes[:5] == b"%PDF-"
        h = {"Authorization": f"Bearer {auth_token}"}
        r = requests.post(
            f"{BASE_URL}/api/import-pdf",
            files={"file": ("ordine.pdf", pdf_bytes, "application/pdf")},
            headers=h,
            timeout=120,
        )
        assert r.status_code == 200, f"PDF import failed: {r.status_code} {r.text[:300]}"
        data = r.json()
        pedane = data.get("pedane", [])
        assert len(pedane) == 6, f"Expected 6 rows, got {len(pedane)}: {[p.get('codice') for p in pedane]}"

        # Expected short codici counts (duplicates allowed, not merged)
        from collections import Counter
        counts = Counter(p["codice"] for p in pedane)
        for expected_code in ("2619-019320", "2619-019318", "2619-019321"):
            assert counts.get(expected_code, 0) == 2, \
                f"Expected 2 occurrences of {expected_code}, got {counts.get(expected_code, 0)}. All codes: {dict(counts)}"

        # Every row has non-empty mittente and merce
        for p in pedane:
            assert p.get("mittente"), f"Row missing mittente: {p}"
            assert p.get("merce"), f"Row missing merce: {p}"

        # Mittente values must include the expected names (allow trailing suffixes like 'S.R')
        mitt_text = " | ".join(p["mittente"].upper() for p in pedane)
        for expected in ("ORCHIDEA", "BERTOLI FRUIT", "MORANDO GRAZIANO"):
            assert expected in mitt_text, \
                f"Expected mittente '{expected}' not present. Got: {mitt_text}"
