r"""
Self-test for the Chanakya AI translator pack. Run it with the pack's own Python:

    python\python.exe selftest.py            (or double-click Verify-Translator.cmd)

Steps: 1) every model file matches pack-manifest.json (catches a damaged copy), 2) the packages import,
3) the service starts from THIS folder on a spare loopback port and reports all three models loaded,
4) English -> Tamil and Tamil -> English translations return text in the right script.
It proves the pack runs on THIS PC. It does not judge translation quality. Exit code 0 = every step passed.
"""
import hashlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
SKIP_INTEGRITY = "--skip-integrity" in sys.argv
results = []


def step(name, ok, detail=""):
    results.append(bool(ok))
    print(("PASS" if ok else "FAIL") + " - " + name + (" (" + detail + ")" if detail else ""), flush=True)
    return bool(ok)


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def integrity():
    try:
        with open(os.path.join(ROOT, "pack-manifest.json"), encoding="utf-8") as handle:
            manifest = json.load(handle)
    except Exception as error:  # noqa: BLE001
        return step("pack-manifest.json can be read", False, str(error))
    bad = []
    for relative, info in manifest.get("models", {}).items():
        path = os.path.join(ROOT, *relative.split("/"))
        if not os.path.isfile(path) or os.path.getsize(path) != info["size"] or sha256(path) != info["sha256"]:
            bad.append(relative)
    return step("model files match the manifest (%d files)" % len(manifest.get("models", {})), not bad, ", ".join(bad[:5]))


def imports():
    env = dict(os.environ, PYTHONNOUSERSITE="1")
    code = "import torch, transformers, fastapi, uvicorn; from IndicTransToolkit.processor import IndicProcessor; print('torch', torch.__version__, 'transformers', transformers.__version__)"
    done = subprocess.run([sys.executable, "-c", code], cwd=ROOT, env=env, capture_output=True, text=True)
    return step("packages import", done.returncode == 0, (done.stdout.strip() or done.stderr.strip()[-300:]))


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def call(url, payload=None, timeout=120):
    request = urllib.request.Request(url, data=None if payload is None else json.dumps(payload).encode("utf-8"),
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def has_range(text, low, high):
    return any(low <= ch <= high for ch in text)


def service():
    port = free_port()
    base = "http://127.0.0.1:%d" % port
    env = dict(os.environ, INDICTRANS_MODEL_PATH=os.path.join(ROOT, "models"), INDICTRANS_PORT=str(port),
               PYTHONNOUSERSITE="1", HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1")
    log_path = os.path.join(tempfile.gettempdir(), "chanakya-translator-selftest.log")
    log = open(log_path, "w", encoding="utf-8", errors="replace")
    child = subprocess.Popen([sys.executable, "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", str(port)],
                             cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    try:
        health = None
        started = time.time()
        while time.time() - started < 420:
            if child.poll() is not None:
                break
            try:
                health = call(base + "/health", timeout=3)
                if health.get("status") == "ok" and all(health.get("models_loaded", {}).values()):
                    break
            except (urllib.error.URLError, OSError, ValueError):
                pass
            time.sleep(2)
        loaded = bool(health) and health.get("status") == "ok" and bool(health.get("models_loaded")) and all(health["models_loaded"].values())
        step("service starts from this folder and loads all three models", loaded,
             "%.0fs, device=%s" % (time.time() - started, (health or {}).get("device")) if health else "see " + log_path)
        if not loaded:
            return
        english = "Hello, how are you today?"
        tamil = call(base + "/translate", {"source_lang": "eng_Latn", "target_lang": "tam_Taml", "text": english})["translation"]
        step("English -> Tamil returns Tamil script", has_range(tamil, "\u0b80", "\u0bff"), tamil)
        back = call(base + "/translate", {"source_lang": "tam_Taml", "target_lang": "eng_Latn", "text": tamil})["translation"]
        step("Tamil -> English returns Latin letters", any(ch.isascii() and ch.isalpha() for ch in back), back)
    except Exception as error:  # noqa: BLE001
        step("service answers translation requests", False, repr(error))
    finally:
        if child.poll() is None:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(child.pid), "/T", "/F"], capture_output=True)
            else:
                child.terminate()
        log.close()
        if not all(results):
            print("Service log: " + log_path)


if __name__ == "__main__":
    print("Chanakya AI translator pack self-test in " + ROOT, flush=True)
    if not SKIP_INTEGRITY:
        integrity()
    if imports():
        service()
    print("RESULT: " + ("ALL PASSED" if results and all(results) else "FAILED"), flush=True)
    sys.exit(0 if results and all(results) else 1)
