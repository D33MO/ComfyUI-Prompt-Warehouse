from aiohttp import web
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
