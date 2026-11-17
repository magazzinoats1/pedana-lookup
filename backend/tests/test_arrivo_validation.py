"""Validation of PedanaIn.dataArrivo (YYYY-MM-DD) and oraArrivo (HH:MM) on POST/PUT /api/pedane."""
import time
import pytest
import requests
from conftest import BASE_URL

STAMP = int(time.time())


def _body(num, **row):
    r = {"codice": f"TEST-V-{STAMP}-{num}", "destinazione": "VR", "mittente": "TEST-MIT"}
    r.update(row)
    return {"form": {"numeroOrdine": f"TEST_VAL_{STAMP}_{num}", "agenzia": "TEST", "mittente": "TEST-MIT",
                     "dataConsegna": "2031-05-01", "note": ""}, "pedane": [r]}


@pytest.fixture(scope="module")
def ids(auth_headers):
    out = []
    yield out
    for pid in out:
        requests.delete(f"{BASE_URL}/api/pedane/{pid}", headers=auth_headers)


# Invalid oraArrivo / dataArrivo -> 422
@pytest.mark.parametrize("i,row", [
    (1, {"oraArrivo": "25:99"}),
    (2, {"oraArrivo": "abc"}),
    (3, {"dataArrivo": "13/11/2026"}),
    (4, {"oraArrivo": "24:00"}),
    (5, {"dataArrivo": "2026-1-5"}),
])
def test_invalid_rejected(auth_headers, ids, i, row):
    r = requests.post(f"{BASE_URL}/api/pedane", headers=auth_headers, json=_body(i, **row))
    if r.status_code == 200:
        ids.extend(p["id"] for p in r.json())
    assert r.status_code == 422, r.text


# Valid values -> 200 and persisted
def test_valid_create_and_get(auth_headers, ids):
    r = requests.post(f"{BASE_URL}/api/pedane", headers=auth_headers,
                      json=_body(10, dataArrivo="2026-11-13", oraArrivo="15:00"))
    assert r.status_code == 200, r.text
    p = r.json()[0]
    ids.append(p["id"])
    assert p["dataArrivo"] == "2026-11-13" and p["oraArrivo"] == "15:00"
    g = requests.get(f"{BASE_URL}/api/pedane/{p['id']}").json()
    assert g["dataArrivo"] == "2026-11-13" and g["oraArrivo"] == "15:00"


# Empty strings allowed
def test_empty_allowed(auth_headers, ids):
    r = requests.post(f"{BASE_URL}/api/pedane", headers=auth_headers, json=_body(11, dataArrivo="", oraArrivo=""))
    assert r.status_code == 200, r.text
    p = r.json()[0]
    ids.append(p["id"])
    assert p["dataArrivo"] == "" and p["oraArrivo"] == ""


# Single-digit hour accepted (consistent with frontend regex)
def test_single_digit_hour(auth_headers, ids):
    r = requests.post(f"{BASE_URL}/api/pedane", headers=auth_headers, json=_body(12, oraArrivo="9:30"))
    assert r.status_code == 200, r.text
    ids.append(r.json()[0]["id"])


# PUT validation also applies
def test_put_invalid_ora(auth_headers, ids):
    assert ids, "need a created pedana"
    g = requests.get(f"{BASE_URL}/api/pedane/{ids[0]}").json()
    body = {"form": {"numeroOrdine": g["numeroOrdine"], "agenzia": "TEST", "mittente": "TEST-MIT",
                     "dataConsegna": "2031-05-01", "note": ""},
            "pedana": {"codice": g["codice"], "destinazione": "VR", "dataArrivo": "2026-11-13", "oraArrivo": "abc"}}
    r = requests.put(f"{BASE_URL}/api/pedane/{ids[0]}", headers=auth_headers, json=body)
    assert r.status_code == 422, r.text
    assert requests.get(f"{BASE_URL}/api/pedane/{ids[0]}").json()["oraArrivo"] == "15:00"


# Whitespace-padded time (frontend validates trimmed value but sends raw)
def test_padded_ora(auth_headers, ids):
    r = requests.post(f"{BASE_URL}/api/pedane", headers=auth_headers, json=_body(13, oraArrivo=" 15:00 "))
    if r.status_code == 200:
        ids.extend(p["id"] for p in r.json())
    assert r.status_code == 200, f"padded time rejected: {r.status_code} {r.text[:200]}"
