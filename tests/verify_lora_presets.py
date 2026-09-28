"""Exercise preset persistence, recovery and HTTP access controls without ComfyUI."""
import asyncio
import importlib.util
import json
import os
import sys
import tempfile
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
package = types.ModuleType("preset_test")
package.__path__ = [str(ROOT)]
sys.modules[package.__name__] = package
handlers = {}


class Routes:
    def __getattr__(self, method):
        return lambda path: lambda fn: handlers.setdefault((path, method), fn)


class Response:
    def __init__(self, body, status=200):
        self.body, self.status = body, status


sys.modules["aiohttp"] = types.SimpleNamespace(web=types.SimpleNamespace(json_response=Response))
sys.modules["server"] = types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=Routes())))
sys.modules["folder_paths"] = types.SimpleNamespace(get_filename_list=lambda _: ["a.safetensors"])
spec = importlib.util.spec_from_file_location("preset_test.routes", ROOT / "routes.py")
routes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routes)
store = sys.modules["preset_test.lora_presets"]


class Request:
    def __init__(self, payload=None, remote="127.0.0.1", token=routes.DELETE_TOKEN, content_type="application/json"):
        self.remote, self.payload = remote, payload
        self.headers = {"Content-Type": content_type, routes.TOKEN_HEADER: token}

    async def json(self):
        return self.payload


def call(method, **kwargs):
    return asyncio.run(handlers[("/prompt-warehouse/lora-presets", method)](Request(**kwargs)))


with tempfile.TemporaryDirectory(dir=ROOT / "tests") as temporary:
    folder = Path(temporary)
    store.STORE_PATH = folder / "data" / "lora_presets.json"
    os.environ["PROMPT_WAREHOUSE_BACKUP_DIR"] = str(folder / "backup")
    preset = {"id": "first", "title": "Style mix", "loras": [
        {"name": "a.safetensors", "strength": .65, "enabled": True},
        {"name": "missing.safetensors", "strength": -1.2, "enabled": False}]}
    payload = {"action": "save", "preset": preset}
    assert call("get").body["entries"] == []
    for method in ("get", "post"):
        assert call(method, remote="192.168.1.1", payload=payload).status == 403
    assert call("post", payload=payload, token="stale").status == 403
    assert call("post", payload=payload, content_type="text/plain").status == 415
    assert not store.STORE_PATH.exists()
    assert call("post", payload=payload).body["entries"] == [preset]
    # Existing files with a legacy group still load, without grouping the preset.
    assert store.clean_preset({**preset, "group": "Legacy"}) == preset
    assert call("get").body["lora_names"] == ["a.safetensors"]
    preset["title"] = "Renamed"
    assert len(call("post", payload=payload).body["entries"]) == 1
    mirror = folder / "backup" / "lora_presets.json"
    assert json.loads(mirror.read_text()) == [preset]
    store.STORE_PATH.unlink()
    assert store.load_presets() == [preset] and store.STORE_PATH.exists()
    store.STORE_PATH.write_text("corrupt")
    assert store.load_presets() == [preset]
    for malformed in ([], None, {"action": "unknown"}, {"action": "save", "preset": {"title": "Empty", "loras": []}}):
        assert call("post", payload=malformed).status == 400
    for bad in (float("nan"), float("inf"), "bad", None):
        invalid = json.loads(json.dumps(preset))
        invalid["loras"][0]["strength"] = bad
        assert call("post", payload={"action": "save", "preset": invalid}).status == 400
        assert store.load_presets() == [preset]
    assert call("post", payload={"action": "delete", "id": "first"}).body["entries"] == []
    # Even a stale nonempty mirror must not resurrect a deliberately empty store.
    mirror.write_text(json.dumps([preset]))
    assert store.load_presets() == []
print("PASS: preset round-trip, update, backup/recovery, empty deletion, validation and local token-gated routes")
