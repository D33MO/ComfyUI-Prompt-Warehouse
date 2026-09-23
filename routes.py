import os
import secrets
from ipaddress import ip_address

from aiohttp import web

import folder_paths
from server import PromptServer

from .prompt_store import backup_status, load_entries, save_entries

routes = PromptServer.instance.routes

# ComfyUI's HTTP API is unauthenticated, so when it runs with `--listen` every
# machine on the network can reach these routes. They read and overwrite the
# user's prompt data and delete files from the output directory, so they only
# answer requests that arrive over the loopback interface. Reverse proxies make
# the request look local: they must restrict `/prompt-warehouse/` themselves.
REMOTE_ONLY_ERROR = "This endpoint is only available from the local machine"

# Deleting files needs more than the loopback check above. A page the user
# happens to have open in the browser also sends its requests from the local
# machine, so "the caller is local" says nothing about who is asking.
#
# Two extra requirements close that:
#
# * `Content-Type: application/json`. JSON is not a CORS-safelisted content
#   type, so a cross-origin page cannot send it without a pre-flight request.
# * The `X-Prompt-Warehouse-Token` header. Browsers only allow a custom request
#   header after a successful pre-flight, and ComfyUI's `Access-Control-Allow-Headers`
#   is the fixed list `Content-Type, Authorization` (see its `create_cors_middleware`),
#   which never contains this header — no matter how ComfyUI was started. The
#   token is the second lock: it is regenerated on every start and handed out
#   only by `GET /prompt-warehouse/session` below, whose response carries no CORS
#   headers and is therefore unreadable from another origin.
DELETE_TOKEN = secrets.token_urlsafe(32)
TOKEN_HEADER = "X-Prompt-Warehouse-Token"
TOKEN_ERROR = "Missing or invalid session token"
NOT_JSON_ERROR = "Content-Type must be application/json"
# A larger batch than this is never a real click in the UI.
MAX_DELETE_FILES = 100


def _is_loopback(remote):
    if not remote:
        return False
    try:
        address = ip_address(remote)
    except ValueError:
        return False
    # Some stacks hand over IPv4 loopback as the mapped form ::ffff:127.0.0.1.
    if address.is_loopback:
        return True
    mapped = getattr(address, "ipv4_mapped", None)
    return bool(mapped and mapped.is_loopback)


def _remote_only(request):
    """A 403 response for non-local callers, otherwise None."""
    if _is_loopback(request.remote):
        return None
    return web.json_response({"error": REMOTE_ONLY_ERROR}, status=403)


@routes.get("/prompt-warehouse/prompts")
async def get_prompts(request):
    denied = _remote_only(request)
    if denied:
        return denied
    return web.json_response({"entries": load_entries(), "backup": backup_status()})

@routes.get("/prompt-warehouse/backup")
async def get_backup(request):
    denied = _remote_only(request)
    if denied:
        return denied
    return web.json_response(backup_status())

@routes.put("/prompt-warehouse/prompts")
async def put_prompts(request):
    denied = _remote_only(request)
    if denied:
        return denied
    try:
        payload = await request.json()
        return web.json_response({"entries": save_entries(payload.get("entries", []))})
    except (ValueError, TypeError) as exc:
        return web.json_response({"error": str(exc)}, status=400)


@routes.get("/prompt-warehouse/session")
async def get_session(request):
    """Hand the delete token to the ComfyUI page that is talking to us.

    Never add CORS headers to this response: the token is only a secret while
    another origin cannot read it.
    """
    denied = _remote_only(request)
    if denied:
        return denied
    return web.json_response({"token": DELETE_TOKEN})


def _has_drive(value):
    """`C:\\file.png` and `C:file.png` both point outside the output directory.

    `splitdrive` reports only the first form; the drive-relative one still
    carries a drive letter and has to be refused as well.
    """
    return bool(os.path.splitdrive(value)[0]) or (len(value) > 1 and value[1] == ":")


def _segments(value, label):
    """Split a subfolder into path segments, refusing anything unsafe."""
    raw = str(value or "")
    if "\x00" in raw:
        raise ValueError(f"Invalid image {label}")
    if os.path.isabs(raw) or _has_drive(raw):
        raise ValueError(f"Image {label} must be relative to the output directory")
    # Backslashes separate paths on Windows and are literal characters
    # elsewhere; normalising them keeps both platforms rejecting `..\\` alike.
    parts = [part for part in raw.replace("\\", "/").split("/") if part not in ("", ".")]
    if ".." in parts:
        raise ValueError(f"Image {label} must not contain '..'")
    return parts


def _inside(base, candidate):
    try:
        return os.path.commonpath([base, candidate]) == base
    except ValueError:
        # Different drives, or a relative path next to an absolute one.
        return False


def _safe_output_file(image):
    """Resolve one request entry to a path inside the output directory.

    The returned path is the only thing the caller ever unlinks, so every check
    here runs before any filesystem change. `realpath` resolves symlinks, which
    means a link pointing out of the tree ends up outside `root` and is rejected
    by the `commonpath` comparison below.
    """
    if not isinstance(image, dict) or image.get("type", "output") != "output":
        raise ValueError("Only images inside the output directory can be deleted")

    filename = image.get("filename")
    if not isinstance(filename, str) or not filename:
        raise ValueError("Invalid image filename")
    if "\x00" in filename or "/" in filename or "\\" in filename:
        raise ValueError("Invalid image filename")
    if filename in (".", "..") or os.path.isabs(filename) or _has_drive(filename):
        raise ValueError("Invalid image filename")

    root = os.path.realpath(folder_paths.get_output_directory())
    target = os.path.realpath(
        os.path.join(root, *_segments(image.get("subfolder", ""), "subfolder"), filename)
    )
    if not _inside(root, target):
        raise ValueError("Image path is outside the output directory")
    if target == root or os.path.isdir(target):
        raise ValueError("Refusing to delete a directory")
    return target


@routes.post("/prompt-warehouse/delete-output-images")
async def delete_output_images(request):
    denied = _remote_only(request)
    if denied:
        return denied
    if "application/json" not in (request.headers.get("Content-Type") or "").lower():
        return web.json_response({"error": NOT_JSON_ERROR}, status=415)
    if not secrets.compare_digest(request.headers.get(TOKEN_HEADER) or "", DELETE_TOKEN):
        # `code` lets the web UI tell a stale token (ComfyUI was restarted)
        # apart from a request that was never allowed in the first place.
        return web.json_response({"error": TOKEN_ERROR, "code": "token"}, status=403)
    try:
        payload = await request.json()
        images = payload.get("images", []) if isinstance(payload, dict) else []
        if not isinstance(images, list) or not images:
            raise ValueError("No images to delete")
        if len(images) > MAX_DELETE_FILES:
            raise ValueError(f"At most {MAX_DELETE_FILES} images can be deleted at once")
        targets = [_safe_output_file(image) for image in images]
        deleted = []
        missing = []
        for target in targets:
            name = os.path.basename(target)
            if os.path.isfile(target):
                os.unlink(target)
                deleted.append(name)
            else:
                missing.append(name)
        return web.json_response({"deleted": deleted, "missing": missing})
    except (ValueError, TypeError) as exc:
        return web.json_response({"error": str(exc)}, status=400)
