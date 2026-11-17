"""Iteration 24: order overwrite (sovrascrivi) + PDF import arrival-date rule (local loading = same day, far = +1)."""
import time
import pytest
import requests
from conftest import BASE_URL

NEW_PDF_URL = "https://customer-assets-0z36b82j.emergentagent.net/job_pedana-lookup/artifacts/9b1e0d5ff03216fb_261117_111311_Transportauftrag_IT_GmbH.pdf"
STAMP = int(time.time())
NUM = f"TEST_SOVR_API_{STAMP}"


def _body(codici, sovrascrivi=False, num=NUM):
    return {"form": {"numeroOrdine": num, "agenzia": "TEST", "mittente": "M", "dataConsegna": "2031-05-01", "note": ""},
            "pedane": [{"codice": c, "destinazione": "X", "mittente": "M"} for c in codici], "sovrascrivi": sovrascrivi}


def _dup(h, num=NUM):
    r = requests.post(f"{BASE_URL}/api/pedane/duplicati", headers=h, json={"numeroOrdine": num, "codici": []})
    assert r.status_code == 200, r.text
    return r.json()["numeroMatches"]


@pytest.fixture(scope="module")
def created(auth_headers):
    ids = []
    yield ids
    for pid in ids:
        requests.delete(f"{BASE_URL}/api/pedane/{pid}", headers=auth_headers)


# Overwrite: create, re-create with sovrascrivi -> only new pedane remain
def test_overwrite_replaces_old(auth_headers, created):
    r = requests.post(f"{BASE_URL}/api/pedane", headers=auth_headers, json=_body([f"TEST-A-{STAMP}", f"TEST-A2-{STAMP}"]))
    assert r.status_code == 200, r.text
    old_ids = [p["id"] for p in r.json()]
    created.extend(old_ids)
    assert len(_dup(auth_headers)) == 2
    r = requests.post(f"{BASE_URL}/api/pedane", headers=auth_headers, json=_body([f"TEST-B-{STAMP}"], sovrascrivi=True))
    assert r.status_code == 200, r.text
    created.extend(p["id"] for p in r.json())
    m = _dup(auth_headers)
    assert [x["codice"] for x in m] == [f"TEST-B-{STAMP}"]
    for pid in old_ids:
        assert requests.get(f"{BASE_URL}/api/pedane/{pid}").status_code == 404


# Without sovrascrivi -> appended (old behavior kept)
def test_no_overwrite_appends(auth_headers, created):
    r = requests.post(f"{BASE_URL}/api/pedane", headers=auth_headers, json=_body([f"TEST-C-{STAMP}"]))
    assert r.status_code == 200, r.text
    created.extend(p["id"] for p in r.json())
    assert sorted(x["codice"] for x in _dup(auth_headers)) == sorted([f"TEST-B-{STAMP}", f"TEST-C-{STAMP}"])


# Overwrite is case-insensitive on numeroOrdine and does not touch other orders
def test_overwrite_case_insensitive_and_scoped(auth_headers, created):
    other = f"{NUM}_OTHER"
    r = requests.post(f"{BASE_URL}/api/pedane", headers=auth_headers, json=_body([f"TEST-O-{STAMP}"], num=other))
    assert r.status_code == 200
    created.extend(p["id"] for p in r.json())
    r = requests.post(f"{BASE_URL}/api/pedane", headers=auth_headers, json=_body([f"TEST-D-{STAMP}"], sovrascrivi=True, num=NUM.lower()))
    assert r.status_code == 200
    created.extend(p["id"] for p in r.json())
    assert [x["codice"] for x in _dup(auth_headers)] == [f"TEST-D-{STAMP}"]
    assert [x["codice"] for x in _dup(auth_headers, other)] == [f"TEST-O-{STAMP}"]


# Overwrite with invalid payload must not delete old order
def test_overwrite_invalid_payload_keeps_old(auth_headers, created):
    b = _body([f"TEST-E-{STAMP}"], sovrascrivi=True)
    b["pedane"][0]["dataArrivo"] = "2026-13-45"
    r = requests.post(f"{BASE_URL}/api/pedane", headers=auth_headers, json=b)
    assert r.status_code == 422
    assert len(_dup(auth_headers)) == 1


# Overwrite requires auth
def test_overwrite_requires_auth():
    r = requests.post(f"{BASE_URL}/api/pedane", json=_body(["TEST-X"], sovrascrivi=True))
    assert r.status_code in (401, 403)


# PDF import: new KÖLLA PDF (far suppliers -> +1 day)
def test_import_new_pdf_dates(auth_headers):
    pdf = requests.get(NEW_PDF_URL, timeout=60).content
    r = requests.post(f"{BASE_URL}/api/import-pdf", headers={"Authorization": auth_headers["Authorization"]},
                      files={"file": ("o.pdf", pdf, "application/pdf")}, timeout=180)
    assert r.status_code == 200, r.text
    d = r.json()
    print(d)
    assert len(d["pedane"]) == 9
    assert d["dataConsegna"] == "2026-11-19"
    for p in d["pedane"]:
        assert p["dataArrivo"] == "2026-11-17", p
        assert p["destinazione"] == "Josef Ochs GmbH - St Ingbert", p
        assert p["oraArrivo"] == ""
