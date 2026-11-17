# Helper: create/delete a TEST_ magazziniere for live-refresh check on /api/sito
import os, sys, requests
BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
tok = requests.post(f"{BASE}/api/auth/login", json={"password": "antolini2024"}).json()["token"]
H = {"Authorization": f"Bearer {tok}"}
if sys.argv[1] == "create":
    r = requests.post(f"{BASE}/api/magazzinieri", json={"nome": "TEST_SitoWorker", "pin": "4321"}, headers=H)
    print(r.status_code, r.json())
else:
    r = requests.delete(f"{BASE}/api/magazzinieri/{sys.argv[2]}", headers=H)
    print("delete", r.status_code, r.text)
requests.post(f"{BASE}/api/auth/logout", headers=H)
