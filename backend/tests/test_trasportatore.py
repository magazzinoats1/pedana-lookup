"""Tests for the 'trasportatore' field on pedana orders and PDF import extraction."""
import os
import pytest
import requests
from datetime import date

PDF_URL = "https://customer-assets-agu9un31.emergentagent.net/job_846b30f6-1732-451c-971b-ac9b8a670d74/artifacts/15af5b035dd7cb00_261014_103622_Transportauftrag_IT_GmbH.pdf"


@pytest.fixture(scope="module")
def today_iso():
    return date.today().isoformat()


@pytest.fixture(scope="module")
def created_ids():
    """Collect ids created across tests; teardown deletes them."""
    return []


@pytest.fixture(scope="module", autouse=True)
def cleanup(base_url, auth_headers, created_ids):
    yield
    for pid in created_ids:
        try:
            requests.delete(f"{base_url}/api/pedane/{pid}", headers=auth_headers, timeout=15)
        except Exception:
            pass


# ── POST /api/pedane : persists trasportatore on every pedana ────────────────
class TestCreateTrasportatore:
    def test_create_with_trasportatore_persists_on_all(self, base_url, auth_headers, today_iso, created_ids):
        payload = {
            "form": {
                "numeroOrdine": "TEST-TRASP-ANT-001",
                "agenzia": "TEST AG",
                "trasportatore": "Antolini Trasporti",
                "mittente": "",
                "dataConsegna": today_iso,
                "note": "",
            },
            "pedane": [
                {"codice": "TEST-C-ANT-01", "destinazione": "Milano", "numeroColli": "10", "numeroPedane": "1", "mittente": "MITT A", "merce": "Uva"},
                {"codice": "TEST-C-ANT-02", "destinazione": "Verona", "numeroColli": "5", "numeroPedane": "1", "mittente": "MITT B", "merce": "Mele"},
            ],
        }
        r = requests.post(f"{base_url}/api/pedane", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data) == 2
        for p in data:
            assert p["trasportatore"] == "Antolini Trasporti"
            created_ids.append(p["id"])

        # Verify via GET
        for p in data:
            g = requests.get(f"{base_url}/api/pedane/{p['id']}", timeout=15)
            assert g.status_code == 200
            assert g.json()["trasportatore"] == "Antolini Trasporti"

    def test_create_with_trasbordo_carrier(self, base_url, auth_headers, today_iso, created_ids):
        payload = {
            "form": {
                "numeroOrdine": "TEST-TRASP-TRASB-002",
                "agenzia": "",
                "trasportatore": "TEST Trasporti Rossi",
                "mittente": "",
                "dataConsegna": today_iso,
                "note": "",
            },
            "pedane": [{"codice": "TEST-C-TRB-01", "destinazione": "Bologna", "numeroColli": "3", "numeroPedane": "1", "mittente": "MITT X", "merce": "Radicchio"}],
        }
        r = requests.post(f"{base_url}/api/pedane", json=payload, headers=auth_headers, timeout=15)
        assert r.status_code == 200
        pid = r.json()[0]["id"]
        created_ids.append(pid)
        g = requests.get(f"{base_url}/api/pedane/{pid}", timeout=15).json()
        assert g["trasportatore"] == "TEST Trasporti Rossi"


# ── PUT /api/pedane/{id} : updates trasportatore ─────────────────────────────
class TestUpdateTrasportatore:
    def test_put_updates_trasportatore(self, base_url, auth_headers, today_iso, created_ids):
        # Create
        cr = requests.post(f"{base_url}/api/pedane", json={
            "form": {"numeroOrdine": "TEST-PUT-003", "agenzia": "", "trasportatore": "Antolini Trasporti", "mittente": "", "dataConsegna": today_iso, "note": ""},
            "pedane": [{"codice": "TEST-C-PUT-01", "destinazione": "Roma", "numeroColli": "1", "numeroPedane": "1", "mittente": "M", "merce": "X"}],
        }, headers=auth_headers, timeout=15)
        assert cr.status_code == 200
        p = cr.json()[0]
        pid = p["id"]
        created_ids.append(pid)

        # Update trasportatore -> trasbordo value
        upd = {
            "form": {"numeroOrdine": p["numeroOrdine"], "agenzia": "", "trasportatore": "TEST Autotrasporti Bianchi", "mittente": "", "dataConsegna": today_iso, "note": ""},
            "pedana": {"codice": p["codice"], "destinazione": p["destinazione"], "numeroColli": p["numeroColli"], "numeroPedane": p["numeroPedane"], "mittente": p["mittente"], "merce": p["merce"]},
        }
        r = requests.put(f"{base_url}/api/pedane/{pid}", json=upd, headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["trasportatore"] == "TEST Autotrasporti Bianchi"

        # GET to verify persisted
        g = requests.get(f"{base_url}/api/pedane/{pid}", timeout=15).json()
        assert g["trasportatore"] == "TEST Autotrasporti Bianchi"


# ── GET /api/pedane?q=<trasportatore> finds it ───────────────────────────────
class TestSearchByTrasportatore:
    def test_search_finds_by_trasportatore(self, base_url, auth_headers, today_iso, created_ids):
        # Ensure a known trasportatore exists
        unique = "TEST-UNIQUECarrier-ZYX-004"
        cr = requests.post(f"{base_url}/api/pedane", json={
            "form": {"numeroOrdine": "TEST-SEARCH-004", "agenzia": "", "trasportatore": unique, "mittente": "", "dataConsegna": today_iso, "note": ""},
            "pedane": [{"codice": "TEST-C-SEA-01", "destinazione": "Napoli", "numeroColli": "1", "numeroPedane": "1", "mittente": "M", "merce": "X"}],
        }, headers=auth_headers, timeout=15)
        assert cr.status_code == 200
        created_ids.append(cr.json()[0]["id"])

        r = requests.get(f"{base_url}/api/pedane", params={"q": "UNIQUECarrier-ZYX"}, headers=auth_headers, timeout=15)
        assert r.status_code == 200
        items = r.json()
        assert any(p["trasportatore"] == unique for p in items), f"Expected to find trasportatore '{unique}', got {len(items)} rows"


# ── POST /api/import-pdf : extracts trasportatore containing 'Antolini' ──────
class TestImportPdfTrasportatore:
    def test_import_pdf_returns_antolini(self, base_url, auth_headers):
        # Download the sample PDF
        pdf = requests.get(PDF_URL, timeout=60)
        assert pdf.status_code == 200, f"PDF download failed: {pdf.status_code}"
        files = {"file": ("ordine.pdf", pdf.content, "application/pdf")}
        # Multipart requires no explicit Content-Type JSON header
        hdr = {"Authorization": auth_headers["Authorization"]}
        r = requests.post(f"{base_url}/api/import-pdf", files=files, headers=hdr, timeout=120)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "trasportatore" in data, data
        tras = (data.get("trasportatore") or "").lower()
        assert "antolini" in tras, f"Expected 'antolini' in trasportatore, got: {data.get('trasportatore')!r}"
        # And we got some pedane rows
        assert isinstance(data.get("pedane"), list)
