# Helper for live-refresh UI tests: create/delete TEST pedane via public API
import sys, json, os, datetime, requests

BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
STATE = "/tmp/live_test_ids.json"


def token():
    r = requests.post(f"{BASE}/auth/login", json={"password": "antolini2024"}, timeout=15)
    r.raise_for_status()
    return r.json()["token"]


def create(numero):
    today = datetime.date.today().isoformat()
    body = {"form": {"numeroOrdine": numero, "dataConsegna": today, "note": "TEST live"},
            "pedane": [{"codice": f"{numero}-A1", "destinazione": "TEST_DEST", "mittente": "TEST_MITT", "dataArrivo": today}]}
    r = requests.post(f"{BASE}/pedane", json=body, headers={"Authorization": f"Bearer {token()}"}, timeout=15)
    print(r.status_code, r.text[:300])
    ids = json.load(open(STATE)) if os.path.exists(STATE) else []
    ids += [p["id"] for p in r.json()]
    json.dump(ids, open(STATE, "w"))


def cleanup(extra_numeri=()):
    t = token()
    h = {"Authorization": f"Bearer {t}"}
    ids = json.load(open(STATE)) if os.path.exists(STATE) else []
    for n in extra_numeri:
        for p in requests.get(f"{BASE}/pedane", params={"q": n}, headers=h, timeout=15).json():
            if p["numeroOrdine"] == n:
                ids.append(p["id"])
    for i in set(ids):
        r = requests.delete(f"{BASE}/pedane/{i}", headers=h, timeout=15)
        print("delete", i, r.status_code)
    if os.path.exists(STATE):
        os.remove(STATE)


if __name__ == "__main__":
    if sys.argv[1] == "create":
        create(sys.argv[2])
    else:
        cleanup(sys.argv[2:])
