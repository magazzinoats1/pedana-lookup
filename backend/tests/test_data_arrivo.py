"""Tests for per-pedana dataArrivo/oraArrivo (arrival at Antolini Verona) vs order dataConsegna (customer delivery)."""
import time
import pytest
import requests
from conftest import BASE_URL, PDF_URL

X = "2031-03-15"
X_MINUS_1 = "2031-03-14"


@pytest.fixture(scope="module")
def created(auth_headers):
    """Create TEST pedane with different dataArrivo/dataConsegna combos; delete by id after."""
    stamp = int(time.time())
    ids = []
    def mk(num, cons, rows):
        r = requests.post(f"{BASE_URL}/api/pedane", headers=auth_headers, json={
            "form": {"numeroOrdine": num, "agenzia": "TEST", "mittente": "TEST-MIT", "dataConsegna": cons, "note": ""},
            "pedane": rows})
        assert r.status_code == 200, r.text
        ids.extend(p["id"] for p in r.json())
        return r.json()
    a = mk(f"TEST_ARR_A_{stamp}", "2031-03-16", [
        {"codice": f"TEST-A1-{stamp}", "destinazione": "VR", "dataArrivo": X, "oraArrivo": "15:00"}])
    b = mk(f"TEST_ARR_B_{stamp}", X, [
        {"codice": f"TEST-B1-{stamp}", "destinazione": "VR", "dataArrivo": "", "oraArrivo": ""}])
    c = mk(f"TEST_ARR_C_{stamp}", X, [
        {"codice": f"TEST-C1-{stamp}", "destinazione": "VR", "dataArrivo": X_MINUS_1, "oraArrivo": "08:30"}])
    yield {"a": a[0], "b": b[0], "c": c[0], "stamp": stamp}
    for pid in ids:
        requests.delete(f"{BASE_URL}/api/pedane/{pid}", headers=auth_headers)


# Create persistence
def test_create_persists_arrivo(created):
    a = created["a"]
    assert a["dataArrivo"] == X and a["oraArrivo"] == "15:00" and a["dataConsegna"] == "2031-03-16"
    g = requests.get(f"{BASE_URL}/api/pedane/{a['id']}")
    assert g.status_code == 200
    assert g.json()["dataArrivo"] == X and g.json()["oraArrivo"] == "15:00"


# Update persistence
def test_update_arrivo(created, auth_headers):
    a = created["a"]
    body = {"form": {"numeroOrdine": a["numeroOrdine"], "agenzia": "TEST", "mittente": "TEST-MIT",
                     "dataConsegna": "2031-03-16", "note": ""},
            "pedana": {"codice": a["codice"], "destinazione": "VR", "dataArrivo": X, "oraArrivo": "16:45"}}
    r = requests.put(f"{BASE_URL}/api/pedane/{a['id']}", headers=auth_headers, json=body)
    assert r.status_code == 200 and r.json()["oraArrivo"] == "16:45"
    g = requests.get(f"{BASE_URL}/api/pedane/{a['id']}").json()
    assert g["oraArrivo"] == "16:45" and g["dataArrivo"] == X


# Riepilogo uses dataArrivo with fallback to dataConsegna
def test_riepilogo_arrivo_logic(created, auth_headers):
    r = requests.get(f"{BASE_URL}/api/riepilogo", params={"data": X}, headers=auth_headers)
    assert r.status_code == 200
    ids = {p["id"] for p in r.json()}
    assert created["a"]["id"] in ids, "dataArrivo==X must be included"
    assert created["b"]["id"] in ids, "old pedana (no dataArrivo) with dataConsegna==X must be included"
    assert created["c"]["id"] not in ids, "dataArrivo=X-1, dataConsegna=X must NOT be included"
    r2 = requests.get(f"{BASE_URL}/api/riepilogo", params={"data": X_MINUS_1}, headers=auth_headers)
    assert created["c"]["id"] in {p["id"] for p in r2.json()}


# PDF import extracts dataArrivo/oraArrivo per row
def test_import_pdf_arrivo(auth_headers):
    pdf = requests.get(PDF_URL, timeout=60).content
    h = {"Authorization": auth_headers["Authorization"]}
    r = requests.post(f"{BASE_URL}/api/import-pdf", headers=h,
                      files={"file": ("t.pdf", pdf, "application/pdf")}, timeout=180)
    assert r.status_code == 200, r.text
    d = r.json()
    print(d)
    assert d["dataConsegna"] == "2026-10-14"
    assert d["pedane"]
    for p in d["pedane"]:
        m = p["mittente"].upper()
        if "ORCHIDEA" in m:
            assert (p["dataArrivo"], p["oraArrivo"]) == ("2026-10-12", "15:00"), p
        elif "BERTOLI" in m or "MORANDO" in m:
            assert (p["dataArrivo"], p["oraArrivo"]) == ("2026-10-13", "15:00"), p
