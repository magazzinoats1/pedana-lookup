"""
Backend regression tests for Gestione Logistica Antolini.
Covers: auth, pedane CRUD, duplicati, cerca (no-auth), stato (no-auth),
settings, import-pdf (Gemini).
"""
import io
import os
import time
import uuid
import requests
import pytest
from .conftest import BASE_URL, DEFAULT_PW, PDF_URL


# ── Auth ──────────────────────────────────────────────────────────────────────
class TestAuth:
    def test_login_wrong_password(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/login", json={"password": "wrongpw"})
        assert r.status_code == 401
        assert "errata" in r.json()["detail"].lower()

    def test_login_ok_and_me(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/login", json={"password": DEFAULT_PW})
        assert r.status_code == 200
        token = r.json()["token"]
        assert isinstance(token, str) and len(token) > 10

        me = api_client.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json() == {"ok": True, "ruolo": "ufficio"}

    def test_me_without_token_401(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401

    def test_me_bad_token_401(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": "Bearer deadbeef"})
        assert r.status_code == 401

    def test_logout_invalidates_session(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/auth/login", json={"password": DEFAULT_PW})
        token = r.json()["token"]
        h = {"Authorization": f"Bearer {token}"}
        assert api_client.post(f"{BASE_URL}/api/auth/logout", headers=h).status_code == 200
        assert api_client.get(f"{BASE_URL}/api/auth/me", headers=h).status_code == 401


# ── Change password (restore afterwards) ──────────────────────────────────────
class TestChangePassword:
    def test_change_password_flow(self, api_client):
        # Login
        tok = api_client.post(f"{BASE_URL}/api/auth/login", json={"password": DEFAULT_PW}).json()["token"]
        h = {"Authorization": f"Bearer {tok}"}

        # Too short -> 422 pydantic
        short = api_client.post(f"{BASE_URL}/api/auth/change-password",
                                json={"vecchia": DEFAULT_PW, "nuova": "abc"}, headers=h)
        assert short.status_code == 422

        # Wrong old -> 400
        wrong = api_client.post(f"{BASE_URL}/api/auth/change-password",
                                json={"vecchia": "wrong_old", "nuova": "tempPass1"}, headers=h)
        assert wrong.status_code == 400

        # Change to temp
        new_pw = "tempPass1"
        ok = api_client.post(f"{BASE_URL}/api/auth/change-password",
                             json={"vecchia": DEFAULT_PW, "nuova": new_pw}, headers=h)
        assert ok.status_code == 200

        # Old password now fails
        assert api_client.post(f"{BASE_URL}/api/auth/login",
                               json={"password": DEFAULT_PW}).status_code == 401

        # Login with new pw
        tok2 = api_client.post(f"{BASE_URL}/api/auth/login",
                               json={"password": new_pw}).json()["token"]
        h2 = {"Authorization": f"Bearer {tok2}"}

        # Restore
        rest = api_client.post(f"{BASE_URL}/api/auth/change-password",
                               json={"vecchia": new_pw, "nuova": DEFAULT_PW}, headers=h2)
        assert rest.status_code == 200

        # Verify restore worked
        assert api_client.post(f"{BASE_URL}/api/auth/login",
                               json={"password": DEFAULT_PW}).status_code == 200


# ── Settings ──────────────────────────────────────────────────────────────────
class TestSettings:
    def test_get_settings_public(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/settings")
        assert r.status_code == 200
        assert "cooperativa" in r.json()

    def test_set_cooperativa_requires_auth(self, api_client):
        r = api_client.put(f"{BASE_URL}/api/settings/cooperativa", json={"cooperativa": "X"})
        assert r.status_code == 401

    def test_set_cooperativa_ok(self, api_client, auth_headers):
        value = f"TEST_coop_{uuid.uuid4().hex[:6]}"
        r = api_client.put(f"{BASE_URL}/api/settings/cooperativa",
                           json={"cooperativa": value}, headers=auth_headers)
        assert r.status_code == 200
        assert r.json()["cooperativa"] == value
        g = api_client.get(f"{BASE_URL}/api/settings")
        assert g.json()["cooperativa"] == value
        # cleanup
        api_client.put(f"{BASE_URL}/api/settings/cooperativa",
                       json={"cooperativa": ""}, headers=auth_headers)


# ── Pedane CRUD ───────────────────────────────────────────────────────────────
@pytest.fixture
def created_pedane(api_client, auth_headers):
    """Create 2 pedane under a unique TEST order and clean up after."""
    numero = f"TEST{uuid.uuid4().hex[:8].upper()}"
    body = {
        "form": {"numeroOrdine": numero, "agenzia": "TEST AG",
                 "mittente": "TEST Mittente", "dataConsegna": "2026-02-15", "note": "pytest"},
        "pedane": [
            {"codice": f"TEST-{numero}-A", "destinazione": "Milano", "numeroColli": "5", "mittente": ""},
            {"codice": f"TEST-{numero}-B", "destinazione": "Roma",   "numeroColli": "3", "mittente": "Override Supp"},
        ],
    }
    r = api_client.post(f"{BASE_URL}/api/pedane", json=body, headers=auth_headers)
    assert r.status_code == 200, r.text
    created = r.json()
    yield numero, created
    for p in created:
        api_client.delete(f"{BASE_URL}/api/pedane/{p['id']}", headers=auth_headers)


class TestPedaneCRUD:
    def test_create_requires_auth(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/pedane",
                            json={"form": {"numeroOrdine": "X", "mittente": "Y", "dataConsegna": "2026-01-01"},
                                  "pedane": [{"codice": "X", "destinazione": "Y"}]})
        assert r.status_code == 401

    def test_create_empty_pedane_rejected(self, api_client, auth_headers):
        r = api_client.post(f"{BASE_URL}/api/pedane",
                            json={"form": {"numeroOrdine": "X", "mittente": "Y", "dataConsegna": "2026-01-01"},
                                  "pedane": [{"codice": "   ", "destinazione": "Y"}]},
                            headers=auth_headers)
        assert r.status_code == 400

    def test_create_persists_fields(self, api_client, auth_headers, created_pedane):
        numero, created = created_pedane
        assert len(created) == 2
        a, b = created
        assert a["numeroOrdine"] == numero
        assert a["mittente"] == "TEST Mittente"  # inherits from form
        assert b["mittente"] == "Override Supp"   # per-row override
        assert a["statoArrivo"] == "attesa"
        assert "_id" not in a  # mongo ObjectId must be excluded
        # Verify GET
        g = api_client.get(f"{BASE_URL}/api/pedane/{a['id']}")
        assert g.status_code == 200
        assert g.json()["codice"] == a["codice"]

    def test_list_pedane_requires_auth(self, api_client):
        assert api_client.get(f"{BASE_URL}/api/pedane").status_code == 401

    def test_list_and_search(self, api_client, auth_headers, created_pedane):
        numero, _ = created_pedane
        r = api_client.get(f"{BASE_URL}/api/pedane", params={"q": numero}, headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert len(data) >= 2
        assert all(d["numeroOrdine"] == numero for d in data)

    def test_update_sets_ultimaRettifica(self, api_client, auth_headers, created_pedane):
        numero, created = created_pedane
        p = created[0]
        body = {
            "form": {"numeroOrdine": numero, "agenzia": "TEST AG",
                     "mittente": "TEST Mittente", "dataConsegna": "2026-02-15", "note": "edited"},
            "pedana": {"codice": p["codice"], "destinazione": "Torino", "numeroColli": "9", "mittente": ""},
        }
        r = api_client.put(f"{BASE_URL}/api/pedane/{p['id']}", json=body, headers=auth_headers)
        assert r.status_code == 200
        upd = r.json()
        assert upd["destinazione"] == "Torino"
        assert upd["numeroColli"] == "9"
        assert upd["note"] == "edited"
        assert upd["ultimaRettifica"] is not None

    def test_update_not_found(self, api_client, auth_headers):
        body = {"form": {"numeroOrdine": "N", "mittente": "M", "dataConsegna": "2026-01-01"},
                "pedana": {"codice": "C", "destinazione": "D"}}
        r = api_client.put(f"{BASE_URL}/api/pedane/nonexistent-id", json=body, headers=auth_headers)
        assert r.status_code == 404

    def test_duplicati(self, api_client, auth_headers, created_pedane):
        numero, created = created_pedane
        a = created[0]
        body = {"numeroOrdine": numero, "codici": [a["codice"], "codice-che-non-esiste-xyz"]}
        r = api_client.post(f"{BASE_URL}/api/pedane/duplicati", json=body, headers=auth_headers)
        assert r.status_code == 200
        d = r.json()
        assert len(d["codiceMatches"]) == 1
        assert d["codiceMatches"][0]["codice"] == a["codice"]
        assert len(d["numeroMatches"]) >= 2

        # excludeId skips the matched pedana
        body2 = {"numeroOrdine": numero, "codici": [a["codice"]], "excludeId": a["id"]}
        r2 = api_client.post(f"{BASE_URL}/api/pedane/duplicati", json=body2, headers=auth_headers)
        assert r2.status_code == 200
        assert r2.json()["codiceMatches"] == []

    def test_delete(self, api_client, auth_headers):
        # Create one to delete
        numero = f"TEST{uuid.uuid4().hex[:6].upper()}"
        body = {"form": {"numeroOrdine": numero, "mittente": "M", "dataConsegna": "2026-01-01"},
                "pedane": [{"codice": f"DEL-{numero}", "destinazione": "X"}]}
        p = api_client.post(f"{BASE_URL}/api/pedane", json=body, headers=auth_headers).json()[0]
        r = api_client.delete(f"{BASE_URL}/api/pedane/{p['id']}", headers=auth_headers)
        assert r.status_code == 200
        # Verify gone
        g = api_client.get(f"{BASE_URL}/api/pedane/{p['id']}")
        assert g.status_code == 404
        # Delete again -> 404
        assert api_client.delete(f"{BASE_URL}/api/pedane/{p['id']}", headers=auth_headers).status_code == 404


# ── Public search + stato (no auth) ───────────────────────────────────────────
class TestPublicSearchAndStato:
    def test_cerca_empty_returns_empty_list(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/pedane/cerca", params={"q": ""})
        assert r.status_code == 200
        assert r.json() == []

    def test_cerca_exact_then_partial(self, api_client, auth_headers, created_pedane):
        numero, created = created_pedane
        a = created[0]
        # Exact codice (no auth)
        r = api_client.get(f"{BASE_URL}/api/pedane/cerca", params={"q": a["codice"]})
        assert r.status_code == 200
        rows = r.json()
        assert any(x["id"] == a["id"] for x in rows)
        # Partial match on numeroOrdine
        r2 = api_client.get(f"{BASE_URL}/api/pedane/cerca", params={"q": numero[:6]})
        assert r2.status_code == 200
        assert any(x["numeroOrdine"] == numero for x in r2.json())

    def test_stato_transitions_no_auth(self, api_client, auth_headers, created_pedane):
        _, created = created_pedane
        p = created[0]
        # Parziale with note
        r = api_client.patch(f"{BASE_URL}/api/pedane/{p['id']}/stato",
                             json={"stato": "parziale", "noteParziale": "manca 1 collo"})
        assert r.status_code == 200
        d = r.json()
        assert d["statoArrivo"] == "parziale"
        assert d["arrivoParzialeAt"] is not None
        assert d["noteParziale"] == "manca 1 collo"
        # Completo
        r = api_client.patch(f"{BASE_URL}/api/pedane/{p['id']}/stato", json={"stato": "completo"})
        assert r.status_code == 200
        assert r.json()["statoArrivo"] == "completo"
        assert r.json()["arrivoCompletoAt"] is not None
        # Back to attesa resets timestamps
        r = api_client.patch(f"{BASE_URL}/api/pedane/{p['id']}/stato", json={"stato": "attesa"})
        assert r.status_code == 200
        d = r.json()
        assert d["statoArrivo"] == "attesa"
        assert d["arrivoCompletoAt"] is None
        assert d["arrivoParzialeAt"] is None
        assert d["noteParziale"] == ""

    def test_stato_not_found(self, api_client):
        r = api_client.patch(f"{BASE_URL}/api/pedane/nonexistent/stato", json={"stato": "completo"})
        assert r.status_code == 404


# ── PDF Import (Gemini) ───────────────────────────────────────────────────────
class TestImportPdf:
    def test_import_pdf_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/import-pdf",
                          files={"file": ("x.pdf", b"%PDF-1.4\n", "application/pdf")})
        assert r.status_code == 401

    def test_import_pdf_invalid_file(self, auth_token):
        h = {"Authorization": f"Bearer {auth_token}"}
        r = requests.post(f"{BASE_URL}/api/import-pdf",
                          files={"file": ("x.pdf", b"not a pdf", "application/pdf")},
                          headers=h)
        assert r.status_code == 400

    def test_import_pdf_sample_order(self, auth_token):
        pdf_bytes = requests.get(PDF_URL, timeout=60).content
        assert pdf_bytes[:5] == b"%PDF-", "Downloaded sample is not a PDF"
        h = {"Authorization": f"Bearer {auth_token}"}
        r = requests.post(
            f"{BASE_URL}/api/import-pdf",
            files={"file": ("ordine.pdf", pdf_bytes, "application/pdf")},
            headers=h,
            timeout=90,
        )
        assert r.status_code == 200, f"PDF import failed: {r.status_code} {r.text[:300]}"
        data = r.json()
        assert data["numeroOrdine"] == "25023467", f"Unexpected numeroOrdine: {data.get('numeroOrdine')}"
        pedane = data.get("pedane", [])
        assert len(pedane) == 6, f"Expected 6 pedane, got {len(pedane)}: {[p.get('codice') for p in pedane]}"
        for p in pedane:
            assert p["codice"], "Codice must be non-empty"
            assert p["destinazione"], "Destinazione must be non-empty"
