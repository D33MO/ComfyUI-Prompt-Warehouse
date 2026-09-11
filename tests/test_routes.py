"""Check that the HTTP routes only answer requests from the local machine.

Self-contained: aiohttp, folder_paths and ComfyUI's server module are stubbed,
so this runs without a ComfyUI install.
"""

import asyncio
import importlib.util
import json
import shutil
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TMP = ROOT / "tests" / "_tmp_routes"
if TMP.exists():
    shutil.rmtree(TMP)
TMP.mkdir(parents=True)
OUTPUT = TMP / "output"
OUTPUT.mkdir()

sys.path.insert(0, str(ROOT))


class Response:
    def __init__(self, body, status=200):
        self.body = body
        self.status = status


web = types.ModuleType("aiohttp.web")
web.json_response = lambda body, status=200: Response(body, status)
aiohttp = types.ModuleType("aiohttp")
aiohttp.web = web
sys.modules["aiohttp"] = aiohttp
sys.modules["aiohttp.web"] = web

folder_paths = types.ModuleType("folder_paths")
folder_paths.get_output_directory = lambda: str(OUTPUT)
sys.modules["folder_paths"] = folder_paths

handlers = {}


class FakeRoutes:
    def get(self, path):
        return lambda handler: handlers.__setitem__((path, "GET"), handler)

    def put(self, path):
        return lambda handler: handlers.__setitem__((path, "PUT"), handler)

    def post(self, path):
        return lambda handler: handlers.__setitem__((path, "POST"), handler)


server = types.ModuleType("server")
server.PromptServer = types.SimpleNamespace(instance=types.SimpleNamespace(routes=FakeRoutes()))
sys.modules["server"] = server

package = types.ModuleType("pw_pkg")
package.__path__ = [str(ROOT)]
sys.modules["pw_pkg"] = package

spec = importlib.util.spec_from_file_location("pw_pkg.routes", ROOT / "routes.py")
routes_module = importlib.util.module_from_spec(spec)
sys.modules["pw_pkg.routes"] = routes_module
spec.loader.exec_module(routes_module)

# Swap the store for a temporary one so the test never touches real user data.
prompt_store = sys.modules["pw_pkg.prompt_store"]
prompt_store.DATA_DIR = TMP / "data"
prompt_store.STORE_PATH = prompt_store.DATA_DIR / "prompts.json"


class Request:
    def __init__(self, remote, payload=None):
        self.remote = remote
        self._payload = payload

    async def json(self):
        return self._payload


failures = []


def check(label, condition, detail=""):
    print(f"{'PASS' if condition else 'FAIL'}  {label}{(' -> ' + detail) if detail else ''}")
    if not condition:
        failures.append(label)


def call(path, method, remote, payload=None):
    handler = handlers[(path, method)]
    return asyncio.run(handler(Request(remote, payload)))


PROMPTS = "/prompt-warehouse/prompts"
BACKUP = "/prompt-warehouse/backup"
DELETE = "/prompt-warehouse/delete-output-images"

check("all routes registered", len(handlers) == 4, str(sorted(handlers)))

# Remote callers are refused everywhere, before any work happens.
for path, method in sorted(handlers):
    payload = {"entries": []} if method == "PUT" else (
        {"images": [{"filename": "a.png", "type": "output"}]} if method == "POST" else None)
    for remote in ("192.168.1.5", "10.0.0.7", "8.8.8.8", "2001:db8::1"):
        response = call(path, method, remote, payload)
        check(f"{method} {path} denied for {remote}",
              response.status == 403 and response.body["error"] == routes_module.REMOTE_ONLY_ERROR,
              f"status={response.status}")

# Local callers still work.
response = call(PROMPTS, "GET", "127.0.0.1")
check("GET prompts allowed for 127.0.0.1", response.status == 200 and "entries" in response.body)
response = call(BACKUP, "GET", "::1")
check("GET backup allowed for ::1", response.status == 200)
response = call(PROMPTS, "PUT", "::ffff:127.0.0.1", {"entries": [
    {"id": "a", "title": "T", "prompt": "p", "group": "General"}]})
check("PUT prompts allowed for mapped loopback", response.status == 200 and len(response.body["entries"]) == 1,
      f"status={response.status}")

check("local put did not write outside the temp store",
      prompt_store.STORE_PATH.is_file() and str(prompt_store.STORE_PATH).startswith(str(TMP)))

# The delete endpoint ignores a remote caller's payload: the file must survive.
victim = OUTPUT / "keep-me.png"
victim.write_bytes(b"not really a png")
image = {"filename": "keep-me.png", "subfolder": "", "type": "output"}
response = call(DELETE, "POST", "192.168.1.5", {"images": [image]})
check("remote delete denied", response.status == 403)
check("remote delete removed nothing", victim.exists())

# A local delete still works.
response = call(DELETE, "POST", "127.0.0.1", {"images": [image]})
check("local delete allowed", response.status == 200 and response.body["deleted"] == ["keep-me.png"],
      json.dumps(response.body))
check("local delete removed the file", not victim.exists())

# Path traversal is still rejected for an allowed caller.
outside = TMP / "outside.png"
outside.write_bytes(b"x")
response = call(DELETE, "POST", "127.0.0.1",
                {"images": [{"filename": "../outside.png", "subfolder": "", "type": "output"}]})
check("traversal rejected", response.status == 400 and outside.exists(), json.dumps(response.body))

shutil.rmtree(TMP, ignore_errors=True)
print()
print("FAILURES:", failures or "none")
sys.exit(1 if failures else 0)
