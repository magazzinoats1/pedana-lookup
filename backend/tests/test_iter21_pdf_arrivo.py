"""Iteration 21: PDF import dataArrivo = Data di carico + 1 day, oraArrivo empty; trim + impossible-date validation."""
import time
import pytest
import requests
from conftest import BASE_URL, PDF_URL

NEW_PDF_URL = "https://customer-assets-0z36b82j.emergentagent.net/job_pedana-lookup/artifacts/b8a32bc471ae2ce1_app.pdf"
STAMP = int(time.time())


def _import(url, auth_headers):
    pdf = requests.get(url, timeout=60).content
    h = {"Authorization": auth_headers["Authorization"]}
    r = requests.post(f"{BASE_URL}/api/import-pdf", headers=h, files={"file": ("o.pdf", pdf, "application/pdf")}, timeout=180)
    assert r.status_code == 200, r.text
    return r.json()


# PDF import: new PDF (Ankara)
def test_import_new_pdf(auth_headers):
    d = _import(NEW_PDF_URL, auth_headers)
    print(d)
    assert d["dataConsegna"] == "2026-11-16"
    assert len(d["pedane"]) == 3
    codici = sorted(p["codice"] for p in d["pedane"])
    assert codici == ["2619-021262", "2619-021304", "2619-021304"]
    for p in d["pedane"]:
        assert p["dataArrivo"] == "2026-11-14", p
        assert p["oraArrivo"] == "", p
    mitt = {p["codice"]: p["mittente"] for p in d["pedane"]}
    assert "ORCHIDEA" in mitt["2619-021262"].upper()
    assert "FRUTTA ITALIA" in mitt["2619-021304"].upper()


# PDF import: old PDF regression
def test_import_old_pdf(auth_headers):
    d = _import(PDF_URL, auth_headers)
    print(d)
    assert d["dataConsegna"] == "2026-10-14"
    for p in d["pedane"]:
        assert p["oraArrivo"] == ""
        if "ORCHIDEA" in p["mittente"].upper():
            assert p["dataArrivo"] == "2026-10-13", p
        else:
            assert p["dataArrivo"] == "2026-10-14", p


def _body(num, **row):
    r = {"codice": f"TEST-I21-{STAMP}-{num}", "destinazione": "VR", "mittente": "TEST-MIT"}
    r.update(row)
    return {"form": {"numeroOrdine": f"TEST_I21_{STAMP}_{num}", "agenzia": "TEST", "mittente": "TEST-MIT",
                     "dataConsegna": "2031-05-01", "note": ""}, "pedane": [r]}


@pytest.fixture(scope="module")
def ids(auth_headers):
    out = []
    yield out
    for pid in out:
        requests.delete(f"{BASE_URL}/api/pedane/{pid}", headers=auth_headers)


# Trailing/leading spaces trimmed -> 200 stored '15:00'
@pytest.mark.parametrize("i,ora", [(1, "15:00 "), (2, " 15:00 ")])
def test_ora_trimmed(auth_headers, ids, i, ora):
    r = requests.post(f"{BASE_URL}/api/pedane", headers=auth_headers, json=_body(i, oraArrivo=ora, dataArrivo=" 2026-11-14 "))
    assert r.status_code == 200, r.text
    p = r.json()[0]
    ids.append(p["id"])
    assert p["oraArrivo"] == "15:00" and p["dataArrivo"] == "2026-11-14"
    g = requests.get(f"{BASE_URL}/api/pedane/{p['id']}").json()
    assert g["oraArrivo"] == "15:00" and g["dataArrivo"] == "2026-11-14"


# Impossible dates -> 422
@pytest.mark.parametrize("i,data", [(10, "2026-13-45"), (11, "2026-02-30"), (12, "2026-00-10")])
def test_impossible_date(auth_headers, ids, i, data):
    r = requests.post(f"{BASE_URL}/api/pedane", headers=auth_headers, json=_body(i, dataArrivo=data))
    if r.status_code == 200:
        ids.extend(p["id"] for p in r.json())
    assert r.status_code == 422, r.text


# PUT with impossible date -> 422, no change
def test_put_impossible_date(auth_headers, ids):
    assert ids
    g = requests.get(f"{BASE_URL}/api/pedane/{ids[0]}").json()
    body = {"form": {"numeroOrdine": g["numeroOrdine"], "agenzia": "TEST", "mittente": "TEST-MIT",
                     "dataConsegna": "2031-05-01", "note": ""},
            "pedana": {"codice": g["codice"], "destinazione": "VR", "dataArrivo": "2026-13-45", "oraArrivo": "15:00"}}
    r = requests.put(f"{BASE_URL}/api/pedane/{ids[0]}", headers=auth_headers, json=body)
    assert r.status_code == 422, r.text
    assert requests.get(f"{BASE_URL}/api/pedane/{ids[0]}").json()["dataArrivo"] == "2026-11-14"
