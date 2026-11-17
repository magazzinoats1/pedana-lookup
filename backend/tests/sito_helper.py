# Helper for website (/api/sito) testing: count / cleanup pedane by numeroOrdine (deletes only by ids returned)
import os, sys, requests
BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
tok = requests.post(f"{BASE}/api/auth/login", json={"password": "antolini2024"}).json()["token"]
H = {"Authorization": f"Bearer {tok}"}
action, numero = sys.argv[1], sys.argv[2]
d = requests.post(f"{BASE}/api/pedane/duplicati", json={"numeroOrdine": numero, "codici": []}, headers=H).json()
m = d["numeroMatches"]
print(numero, "count:", len(m), "ids:", [x["id"] for x in m])
for x in m[:3]:
    print("  ", x["codice"], x["mittente"], x["destinazione"], x["dataConsegna"], x["dataArrivo"], x["statoArrivo"])
if action == "delete":
    if not numero.startswith("TEST_"):
        sys.exit("refuse to delete non-TEST data")
    for x in m:
        r = requests.delete(f"{BASE}/api/pedane/{x['id']}", headers=H)
        print("delete", x["id"], r.status_code)
    print("after:", len(requests.post(f"{BASE}/api/pedane/duplicati", json={"numeroOrdine": numero, "codici": []}, headers=H).json()["numeroMatches"]))
requests.post(f"{BASE}/api/auth/logout", headers=H)
