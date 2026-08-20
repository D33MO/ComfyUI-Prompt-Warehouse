from aiohttp import web
from pathlib import Path

import folder_paths
from server import PromptServer
from .prompt_store import load_entries, save_entries

routes = PromptServer.instance.routes

@routes.get("/prompt-warehouse/prompts")
async def get_prompts(_request):
    return web.json_response({"entries": load_entries()})

@routes.put("/prompt-warehouse/prompts")
async def put_prompts(request):
    try:
        payload = await request.json()
        return web.json_response({"entries": save_entries(payload.get("entries", []))})
    except (ValueError, TypeError) as exc:
        return web.json_response({"error": str(exc)}, status=400)


def _safe_output_file(image):
    if not isinstance(image, dict) or image.get("type", "output") != "output":
        raise ValueError("只允许删除 output 目录中的图片")
    filename = str(image.get("filename", ""))
    if not filename or Path(filename).name != filename:
        raise ValueError("无效的图片文件名")
    subfolder = Path(str(image.get("subfolder", "")))
    if subfolder.is_absolute() or ".." in subfolder.parts:
        raise ValueError("无效的图片子目录")
    output_root = Path(folder_paths.get_output_directory()).resolve()
    target = (output_root / subfolder / filename).resolve()
    try:
        target.relative_to(output_root)
    except ValueError as error:
        raise ValueError("图片路径不在 output 目录中") from error
    return target


@routes.post("/prompt-warehouse/delete-output-images")
async def delete_output_images(request):
    try:
        payload = await request.json()
        images = payload.get("images", [])
        if not isinstance(images, list) or not images:
            raise ValueError("没有可删除的图片")
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
