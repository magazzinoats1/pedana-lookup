"""
Regression test for the 'numeroPedane' feature (user bug report).
Covers:
- POST /api/pedane persists numeroPedane and GET /api/pedane/{id} returns it
- PUT /api/pedane/{id} updates numeroPedane
- GET /api/pedane/tutte and GET /api/riepilogo include numeroPedane
- POST /api/import-pdf returns 6 pedane with numeroPedane = ['1','1','2','1','1','0']
  for the reference order 25023467
"""
import uuid
import requests
import pytest
from .conftest import BASE_URL, PDF_URL


# ── CRUD with numeroPedane ────────────────────────────────────────────────────
@pytest.fixture
def seeded_order(api_client, auth_headers):
    numero = f"TEST_NP_{uuid.uuid4().hex[:6].upper()}"
    data_consegna = "2026-03-10"
    body = {
        "form": {"numeroOrdine": numero, "agenzia": "TEST AG",
                 "mittente": "TEST Mittente", "dataConsegna": data_consegna, "note": "np"},
        "pedane": [
            {"codice": f"TEST-{numero}-A", "destinazione": "Milano",
             "numeroColli": "5", "numeroPedane": "2", "mittente": "", "merce": "Uva"},
            {"codice": f"TEST-{numero}-B", "destinazione": "Roma",
             "numeroColli": "3", "numeroPedane": "0", "mittente": "", "merce": "Radicchio"},
        ],
    }
    r = api_client.post(f"{BASE_URL}/api/pedane", json=body, headers=auth_headers)
    assert r.status_code == 200, r.text
    created = r.json()
    yield numero, data_consegna, created
    for p in created:
        api_client.delete(f"{BASE_URL}/api/pedane/{p['id']}", headers=auth_headers)


class TestNumeroPedaneCRUD:
    def test_create_persists_numero_pedane(self, seeded_order):
        _, _, created = seeded_order
        a, b = created
        assert a["numeroPedane"] == "2", f"expected '2', got {a['numeroPedane']!r}"
        assert b["numeroPedane"] == "0", f"expected '0', got {b['numeroPedane']!r}"

    def test_get_by_id_returns_numero_pedane(self, api_client, seeded_order):
        _, _, created = seeded_order
        a = created[0]
        r = api_client.get(f"{BASE_URL}/api/pedane/{a['id']}")
        assert r.status_code == 200
        assert r.json()["numeroPedane"] == "2"

    def test_update_sets_numero_pedane(self, api_client, auth_headers, seeded_order):
        numero, data_consegna, created = seeded_order
        a = created[0]
        body = {
            "form": {"numeroOrdine": numero, "agenzia": "TEST AG",
                     "mittente": "TEST Mittente", "dataConsegna": data_consegna, "note": "np edit"},
            "pedana": {"codice": a["codice"], "destinazione": "Torino",
                       "numeroColli": "9", "numeroPedane": "5", "mittente": "", "merce": ""},
        }
        r = api_client.put(f"{BASE_URL}/api/pedane/{a['id']}", json=body, headers=auth_headers)
        assert r.status_code == 200
        upd = r.json()
        assert upd["numeroPedane"] == "5"
        # verify persisted via GET
        g = api_client.get(f"{BASE_URL}/api/pedane/{a['id']}")
        assert g.json()["numeroPedane"] == "5"

    def test_tutte_and_riepilogo_expose_numero_pedane(self, api_client, auth_headers, seeded_order):
        numero, data_consegna, created = seeded_order
        ids = {p["id"] for p in created}

        # /pedane/tutte (public)
        r = api_client.get(f"{BASE_URL}/api/pedane/tutte")
        assert r.status_code == 200
        tutte = [p for p in r.json() if p["id"] in ids]
        assert len(tutte) == 2
        assert all("numeroPedane" in p for p in tutte)
        np_map = {p["codice"]: p["numeroPedane"] for p in tutte}
        assert np_map[f"TEST-{numero}-A"] == "2"
        assert np_map[f"TEST-{numero}-B"] == "0"

        # /riepilogo (auth)
        r2 = api_client.get(f"{BASE_URL}/api/riepilogo",
                            params={"data": data_consegna}, headers=auth_headers)
        assert r2.status_code == 200
        rows = [p for p in r2.json() if p["id"] in ids]
        assert len(rows) == 2
        assert all("numeroPedane" in p for p in rows)


# ── Import PDF: numeroPedane extraction ───────────────────────────────────────
class TestImportPdfNumeroPedane:
    def test_import_pdf_returns_expected_numero_pedane(self, auth_token):
        pdf_bytes = requests.get(PDF_URL, timeout=60).content
        assert pdf_bytes[:5] == b"%PDF-"
        h = {"Authorization": f"Bearer {auth_token}"}
        r = requests.post(
            f"{BASE_URL}/api/import-pdf",
            files={"file": ("ordine.pdf", pdf_bytes, "application/pdf")},
            headers=h,
            timeout=120,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text[:400]}"
        data = r.json()
        assert data["numeroOrdine"] == "25023467"
        pedane = data.get("pedane", [])
        assert len(pedane) == 6, f"Expected 6 rows, got {len(pedane)}: {pedane}"
        # Each row must have a numeroPedane field (string, integer-like, no decimals, no 'EUR')
        for p in pedane:
            assert "numeroPedane" in p
            assert "EUR" not in p["numeroPedane"]
            assert "." not in p["numeroPedane"] and "," not in p["numeroPedane"], \
                f"numeroPedane should be int-string, got {p['numeroPedane']!r}"
        # Expected sequence per bug report: ['1','1','2','1','1','0']
        got = [p["numeroPedane"] for p in pedane]
        assert got == ["1", "1", "2", "1", "1", "0"], \
            f"Expected ['1','1','2','1','1','0'], got {got} (codes={[p['codice'] for p in pedane]})"
        # Positional codes (per bug report: 2619-019320 x2, 2619-019318 x2, 2619-019321 x2)
        codes = [p["codice"] for p in pedane]
        assert codes[0:2] == ["2619-019320", "2619-019320"], f"rows 1-2 codes: {codes[0:2]}"
        assert codes[2:4] == ["2619-019318", "2619-019318"], f"rows 3-4 codes: {codes[2:4]}"
        assert codes[4:6] == ["2619-019321", "2619-019321"], f"rows 5-6 codes: {codes[4:6]}"
