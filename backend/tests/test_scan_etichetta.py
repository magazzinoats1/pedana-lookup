"""Tests for POST /api/scan-etichetta (Gemini 3 Flash handwritten label reader)."""
import io
import os
import time
import pytest
import requests

from .conftest import BASE_URL

LABEL_URL = "https://customer-assets-0z36b82j.emergentagent.net/job_pedana-lookup/artifacts/04a42fbd6dd68c3d_37d10869-0ec6-470f-bec9-80dbe0a51415.webp"
EXPECTED_CODE = "2619-019331"


@pytest.fixture(scope="module")
def real_label_bytes():
    r = requests.get(LABEL_URL, timeout=30)
    assert r.status_code == 200, f"Could not download sample label: {r.status_code}"
    return r.content


# Core: real handwritten webp returns candidati with 2619-019331 (pedane>=1)
@pytest.mark.parametrize("attempt", [1, 2, 3])
def test_scan_real_handwritten_label(real_label_bytes, attempt):
    files = {"file": ("etichetta.webp", real_label_bytes, "image/webp")}
    t0 = time.time()
    r = requests.post(f"{BASE_URL}/api/scan-etichetta", files=files, timeout=60)
    dt = time.time() - t0
    assert r.status_code == 200, f"attempt {attempt}: {r.status_code} {r.text}"
    body = r.json()
    assert "candidati" in body and isinstance(body["candidati"], list)
    codes = [c["codice"] for c in body["candidati"]]
    assert EXPECTED_CODE in codes, f"attempt {attempt}: expected {EXPECTED_CODE} in {codes} (dt={dt:.1f}s, testo={body.get('testo','')[:120]})"
    hit = next(c for c in body["candidati"] if c["codice"] == EXPECTED_CODE)
    assert hit["pedane"] >= 1, f"attempt {attempt}: pedane={hit['pedane']} for {EXPECTED_CODE}"
    print(f"attempt {attempt}: dt={dt:.1f}s codes={codes}")


# Edge case: file > 8MB -> 413
def test_scan_too_large_returns_413():
    big = b"\xff" * (8 * 1024 * 1024 + 10)
    files = {"file": ("huge.jpg", big, "image/jpeg")}
    r = requests.post(f"{BASE_URL}/api/scan-etichetta", files=files, timeout=30)
    assert r.status_code == 413, f"expected 413, got {r.status_code} {r.text[:200]}"


# Edge case: image with no code -> candidati [] without crashing
def test_scan_image_without_code():
    # Build a tiny solid-color JPEG so Gemini sees no code
    try:
        from PIL import Image
    except ImportError:
        pytest.skip("Pillow not available")
    buf = io.BytesIO()
    Image.new("RGB", (200, 200), (240, 240, 240)).save(buf, format="JPEG")
    buf.seek(0)
    files = {"file": ("blank.jpg", buf.getvalue(), "image/jpeg")}
    r = requests.post(f"{BASE_URL}/api/scan-etichetta", files=files, timeout=45)
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    body = r.json()
    assert "candidati" in body and isinstance(body["candidati"], list)
    # No code expected (allow empty or at most noise); the key assertion is no crash
    print(f"blank candidati: {body['candidati']}")
