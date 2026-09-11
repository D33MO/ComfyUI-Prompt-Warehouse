from ipaddress import ip_address
from pathlib import Path

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


def _safe_output_file(image):
    if not isinstance(image, dict) or image.get("type", "output") != "output":
        raise ValueError("Only images inside the output directory can be deleted")
    filename = str(image.get("filename", ""))
    if not filename or Path(filename).name != filename:
        raise ValueError("Invalid image filename")
    subfolder = Path(str(image.get("subfolder", "")))
    if subfolder.is_absolute() or ".." in subfolder.parts:
        raise ValueError("Invalid image subfolder")
    output_root = Path(folder_paths.get_output_directory()).resolve()
    target = (output_root / subfolder / filename).resolve()
    try:
        target.relative_to(output_root)
    except ValueError as error:
        raise ValueError("Image path is outside the output directory") from error
    return target


@routes.post("/prompt-warehouse/delete-output-images")
async def delete_output_images(request):
    denied = _remote_only(request)
    if denied:
        return denied
    try:
        payload = await request.json()
        images = payload.get("images", [])
        if not isinstance(images, list) or not images:
            raise ValueError("No images to delete")
        targets = [_safe_output_file(image) for image in images]
        deleted = []
        missing = []
        for target in targets:
            if target.is_file():
                target.unlink()
                deleted.append(target.name)
            else:
                missing.append(target.name)
        return web.json_response({"deleted": deleted, "missing": missing})
    except (ValueError, TypeError) as exc:
        return web.json_response({"error": str(exc)}, status=400)
