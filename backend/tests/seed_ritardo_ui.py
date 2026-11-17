"""Create/delete TEST data for UI ritardo + group summary checks. Usage: python seed_ritardo_ui.py create|delete"""
import json, sys, time, requests
from conftest import BASE_URL, DEFAULT_PW

tok = requests.post(f"{BASE_URL}/api/auth/login", json={"password": DEFAULT_PW}).json()["token"]
H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}
F = "/tmp/seed_ritardo_ui.json"

if sys.argv[1] == "create":
    s = int(time.time())
    def mk(num, rows):
        r = requests.post(f"{BASE_URL}/api/pedane", headers=H, json={
            "form": {"numeroOrdine": num, "agenzia": "TEST", "mittente": "TEST-MIT", "dataConsegna": "2026-11-20", "note": ""},
            "pedane": rows})
        assert r.status_code == 200, r.text
        return r.json()
    rit = mk(f"TESTRIT{s}", [
        {"codice": f"TEST-R16-{s}", "destinazione": "VR", "mittente": "TEST-MIT", "dataArrivo": "2026-11-13", "oraArrivo": "16:00"},
        {"codice": f"TEST-RNO-{s}", "destinazione": "VR", "mittente": "TEST-MIT", "dataArrivo": "2026-11-13", "oraArrivo": ""}])
    grp = mk(f"TESTGRP{s}", [
        {"codice": f"TEST-G1-{s}", "destinazione": "VR", "mittente": "TEST-MIT", "dataArrivo": "2026-11-14", "oraArrivo": "08:00"},
        {"codice": f"TEST-G2-{s}", "destinazione": "VR", "mittente": "TEST-MIT", "dataArrivo": "2026-11-12", "oraArrivo": ""}])
    d = {"rit": rit[0]["numeroOrdine"], "r16": rit[0]["id"], "rno": rit[1]["id"], "grp": grp[0]["numeroOrdine"],
         "ids": [p["id"] for p in rit + grp]}
    json.dump(d, open(F, "w"))
    print(json.dumps(d))
    print("tutte count:", len(requests.get(f"{BASE_URL}/api/pedane/tutte").json()))
else:
    d = json.load(open(F))
    for pid in d["ids"]:
        print(pid, requests.delete(f"{BASE_URL}/api/pedane/{pid}", headers=H).status_code)
    # leftover TESTX order if present
    for p in requests.get(f"{BASE_URL}/api/pedane/cerca", params={"q": "TESTX"}).json():
        if p.get("numeroOrdine") == "TESTX":
            print("TESTX", p["id"], requests.delete(f"{BASE_URL}/api/pedane/{p['id']}", headers=H).status_code)
