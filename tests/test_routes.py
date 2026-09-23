"""Check the HTTP routes: loopback-only, token-gated deletes, confined paths.

Self-contained: aiohttp, folder_paths and ComfyUI's server module are stubbed,
so this runs without a ComfyUI install.
"""

import asyncio
import importlib.util
import json
import os
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

JSON = "application/json"


class Headers(dict):
    """aiohttp hands handlers a case-insensitive mapping; mirror that."""

    def get(self, key, default=None):
        wanted = key.lower()
        for name, value in self.items():
            if name.lower() == wanted:
                return value
        return default


class Request:
    def __init__(self, remote, payload=None, headers=None, content_type=JSON):
        self.remote = remote
        self._payload = payload
        headers = dict(headers or {})
        if content_type is not None and headers.get("Content-Type") is None:
            headers["Content-Type"] = content_type
        self.headers = Headers(headers)

    async def json(self):
        return self._payload


failures = []


def check(label, condition, detail=""):
    print(f"{'PASS' if condition else 'FAIL'}  {label}{(' -> ' + detail) if detail else ''}")
    if not condition:
        failures.append(label)


def call(path, method, remote, payload=None, **kwargs):
    handler = handlers[(path, method)]
    return asyncio.run(handler(Request(remote, payload, **kwargs)))


def fresh(name, data=b"not really a png", subfolder=""):
    """Create a file under output/ and return it plus the entry a node reports."""
    parts = [part for part in subfolder.split("/") if part]
    path = OUTPUT.joinpath(*parts, name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path, {"filename": name, "subfolder": subfolder, "type": "output"}


PROMPTS = "/prompt-warehouse/prompts"
BACKUP = "/prompt-warehouse/backup"
SESSION = "/prompt-warehouse/session"
DELETE = "/prompt-warehouse/delete-output-images"


def delete(remote="127.0.0.1", images=None, token=routes_module.DELETE_TOKEN, **kwargs):
    """POST to the delete route; `token=None` sends the request without one."""
    headers = dict(kwargs.pop("headers", {}))
    if token is not None:
        headers[routes_module.TOKEN_HEADER] = token
    payload = {"images": [] if images is None else images}
    return call(DELETE, "POST", remote, payload, headers=headers, **kwargs)


check("all routes registered", len(handlers) == 5, str(sorted(handlers)))

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

# The delete token is only handed out to a local caller.
response = call(SESSION, "GET", "127.0.0.1")
token = response.body.get("token", "") if isinstance(response.body, dict) else ""
check("session hands the token to a local caller",
      response.status == 200 and token and token == routes_module.DELETE_TOKEN, f"status={response.status}")
check("session token is long enough to be unguessable", len(token) >= 32, f"len={len(token)}")

# A page in the user's browser is a local caller too, so the loopback check is
# not what protects the delete: the request needs a token and a JSON body.
victim, image = fresh("keep-me.png")

response = call(DELETE, "POST", "192.168.1.5", {"images": [image]})
check("remote delete denied", response.status == 403)
check("remote delete removed nothing", victim.exists())

response = delete(images=[image], token=None)
check("delete without a token is refused",
      response.status == 403 and response.body["code"] == "token", json.dumps(response.body))
check("token-less delete removed nothing", victim.exists())

response = delete(images=[image], token="not-the-token")
check("delete with a wrong token is refused", response.status == 403, json.dumps(response.body))
check("wrong-token delete removed nothing", victim.exists())

response = delete(images=[image], content_type="text/plain")
check("delete with a non-JSON content type is refused",
      response.status == 415 and response.body["error"] == routes_module.NOT_JSON_ERROR,
      json.dumps(response.body))
check("non-JSON delete removed nothing", victim.exists())

response = delete(images=[image], content_type=None)
check("delete without a content type is refused", response.status == 415, json.dumps(response.body))
check("content-type-less delete removed nothing", victim.exists())

# A real UI delete still works, including one inside a nested subfolder.
nested, nested_image = fresh("nested.png", subfolder="sub/dir")
response = delete(images=[nested_image])
check("local delete in a subfolder allowed",
      response.status == 200 and response.body["deleted"] == ["nested.png"], json.dumps(response.body))
check("subfolder delete removed the file", not nested.exists())

response = delete(images=[image])
check("local delete allowed",
      response.status == 200 and response.body["deleted"] == ["keep-me.png"], json.dumps(response.body))
check("local delete removed the file", not victim.exists())

response = delete(images=[{"filename": "gone.png", "subfolder": "", "type": "output"}])
check("a missing file is reported instead of deleted",
      response.status == 200 and response.body["missing"] == ["gone.png"], json.dumps(response.body))

# Path confinement: nothing outside output/ is reachable, however it is spelled.
outside = TMP / "outside.png"
outside.write_bytes(b"x")
rejected = [
    ("'..' in filename", {"filename": "../outside.png", "subfolder": "", "type": "output"}),
    ("'..' in subfolder", {"filename": "outside.png", "subfolder": "../", "type": "output"}),
    ("absolute subfolder", {"filename": "outside.png", "subfolder": str(TMP), "type": "output"}),
    ("absolute filename", {"filename": str(outside), "subfolder": "", "type": "output"}),
    ("drive-relative subfolder", {"filename": "outside.png", "subfolder": "C:\\temp", "type": "output"}),
    ("drive-relative filename", {"filename": "C:outside.png", "subfolder": "", "type": "output"}),
    ("UNC-style filename", {"filename": "\\\\server\\share\\outside.png", "subfolder": "", "type": "output"}),
    ("backslash traversal", {"filename": "..\\outside.png", "subfolder": "", "type": "output"}),
    ("separator inside filename", {"filename": "sub/nested.png", "subfolder": "", "type": "output"}),
    ("bare '..' filename", {"filename": "..", "subfolder": "", "type": "output"}),
    ("empty filename", {"filename": "", "subfolder": "", "type": "output"}),
    ("NUL byte in filename", {"filename": "a\x00.png", "subfolder": "", "type": "output"}),
    ("non-output type", {"filename": "outside.png", "subfolder": "", "type": "temp"}),
    ("entry is not an object", "outside.png"),
]
for label, entry in rejected:
    response = delete(images=[entry])
    check(f"{label} rejected", response.status == 400,
          f"status={response.status} {json.dumps(response.body)}")
    check(f"{label} left the outside file alone", outside.exists())

(OUTPUT / "dir-delete").mkdir()
response = delete(images=[{"filename": "dir-delete", "subfolder": "", "type": "output"}])
check("delete refuses a directory",
      response.status == 400 and (OUTPUT / "dir-delete").is_dir(), json.dumps(response.body))

# A symlink inside output/ pointing out of it must not become a way out: the
# real path is what gets compared, so the link itself is refused.
linked = TMP / "linked.png"
linked.write_bytes(b"x")
try:
    os.symlink(linked, OUTPUT / "link.png")
except (OSError, NotImplementedError):
    print("SKIP  symlink escaping the output directory (cannot create a symlink here)")
else:
    response = delete(images=[{"filename": "link.png", "subfolder": "", "type": "output"}])
    check("symlink escaping the output directory rejected",
          response.status == 400, json.dumps(response.body))
    check("the symlink's target survives", linked.exists())

# Batches are capped, and the cap is checked before anything is unlinked.
big, big_image = fresh("batch.png")
response = delete(images=[big_image] * (routes_module.MAX_DELETE_FILES + 1))
check("an oversized batch is rejected",
      response.status == 400 and big.exists(), json.dumps(response.body))

# Malformed payloads never reach the filesystem.
response = delete(images=[])
check("an empty batch is rejected", response.status == 400, json.dumps(response.body))
response = delete(images="keep-me.png")
check("a non-list images field is rejected", response.status == 400, json.dumps(response.body))
response = call(DELETE, "POST", "127.0.0.1", "not an object",
                headers={routes_module.TOKEN_HEADER: routes_module.DELETE_TOKEN})
check("a non-object payload is rejected", response.status == 400, json.dumps(response.body))

check("everything that should have survived is still there",
      outside.exists() and linked.exists() and big.exists() and (OUTPUT / "dir-delete").is_dir())

shutil.rmtree(TMP, ignore_errors=True)
print()
print("FAILURES:", failures or "none")
sys.exit(1 if failures else 0)
