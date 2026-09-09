"""Build CivitAI/A1111-compatible image metadata that carries LoRA information.

ComfyUI's stock SaveImage only embeds the ``prompt`` and ``workflow`` PNG chunks.
CivitAI reads LoRAs from the A1111 ``parameters`` chunk (``<lora:name:weight>``
tags plus a ``Lora hashes:`` map), which is why LoRAs wired through custom
loader nodes have to be re-entered by hand on upload.

This module extracts the LoRAs (and prompts) straight out of the execution
graph that ComfyUI hands to the save node, so no workflow rewiring is needed.
"""

import hashlib
import json
import threading
from pathlib import Path

import folder_paths

CACHE_PATH = Path(__file__).resolve().parent / "data" / "lora_hashes.json"
_LOCK = threading.RLock()
_CACHE = None
_MAX_DEPTH = 24

# Nodes that load a LoRA. Anything the user's workflow uses is covered here.
_LORA_NODES = {"PromptWarehouseMultiLoraLoader", "LoraLoader", "LoraLoaderModelOnly"}


def _load_cache():
    global _CACHE
    if _CACHE is not None:
        return _CACHE
    try:
        data = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        _CACHE = data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        _CACHE = {}
    return _CACHE


def _store_cache(cache):
    try:
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        temporary = CACHE_PATH.with_suffix(".tmp")
        temporary.write_text(json.dumps(cache, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        temporary.replace(CACHE_PATH)
    except OSError:
        pass


def _autov2(path):
    """CivitAI's AutoV2 hash: the first 12 hex characters of the file SHA256."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()[:12]


def lora_hash(name):
    """Return the AutoV2 hash of a LoRA, cached by path + size + mtime."""
    try:
        path = folder_paths.get_full_path("loras", name)
        if not path:
            return ""
        stat = Path(path).stat()
    except (OSError, ValueError):
        return ""
    key = str(Path(path))
    stamp = {"size": stat.st_size, "mtime": int(stat.st_mtime)}
    with _LOCK:
        cache = _load_cache()
        entry = cache.get(key)
        if isinstance(entry, dict) and entry.get("size") == stamp["size"] and entry.get("mtime") == stamp["mtime"]:
            return str(entry.get("hash", ""))
    try:
        value = _autov2(path)
    except OSError:
        return ""
    with _LOCK:
        cache = _load_cache()
        cache[key] = {**stamp, "hash": value}
        _store_cache(cache)
    return value


def lora_tag_name(name):
    """Name used inside ``<lora:...>`` tags and the ``Lora hashes`` map."""
    return Path(str(name).replace("\\", "/")).stem


def _lora_entries(graph):
    """Ordered, enabled LoRAs from the API-format execution graph."""
    found = []
    seen = set()
    for node in (graph or {}).values():
        if not isinstance(node, dict):
            continue
        class_type = node.get("class_type")
        inputs = node.get("inputs") or {}
        if class_type == "PromptWarehouseMultiLoraLoader":
            try:
                config = json.loads(inputs.get("lora_config") or "[]")
            except (TypeError, json.JSONDecodeError):
                continue
            if not isinstance(config, list):
                continue
            for entry in config:
                if not isinstance(entry, dict) or not entry.get("enabled", True):
                    continue
                name = str(entry.get("name", "") or "")
                if not name:
                    continue
                try:
                    strength = float(entry.get("strength", entry.get("strength_model", 1.0)))
                except (TypeError, ValueError):
                    strength = 1.0
                if strength == 0:
                    continue
                if name in seen:
                    continue
                seen.add(name)
                found.append((name, strength))
        elif class_type in _LORA_NODES:
            name = str(inputs.get("lora_name", "") or "")
            if not name or name.lower() == "none":
                continue
            try:
                strength = float(inputs.get("strength_model", inputs.get("strength", 1.0)))
            except (TypeError, ValueError):
                strength = 1.0
            if strength == 0 or name in seen:
                continue
            seen.add(name)
            found.append((name, strength))
    return found


def _is_link(value):
    return (
        isinstance(value, (list, tuple))
        and len(value) == 2
        and isinstance(value[0], (str, int))
        and not isinstance(value[1], (list, dict))
    )


_TEXT_KEYS = ("text", "text_g", "prompt", "string", "value")
_UPSTREAM_KEYS = ("prompt_in", "text_in", "input", "any_1", "conditioning", "positive", "negative")


def _text_from_node(graph, node, depth):
    if depth > _MAX_DEPTH or not isinstance(node, dict):
        return ""
    inputs = node.get("inputs") or {}
    parts = []
    for key in _UPSTREAM_KEYS:
        value = inputs.get(key)
        if _is_link(value):
            upstream = _text_from_link(graph, value[0], depth + 1)
            if upstream:
                parts.append(upstream)
    for key in _TEXT_KEYS:
        value = inputs.get(key)
        if isinstance(value, str) and value.strip():
            parts.append(value.strip())
    return ", ".join(part.strip().strip(",").strip() for part in parts if part).strip().strip(",").strip()


def _text_from_link(graph, node_id, depth):
    if depth > _MAX_DEPTH:
        return ""
    node = graph.get(str(node_id)) if isinstance(graph, dict) else None
    return _text_from_node(graph, node, depth)


def _first_link(inputs, *keys):
    for key in keys:
        value = inputs.get(key)
        if _is_link(value):
            return value
    return None


def _sampler_settings(graph):
    """Best-effort steps/cfg/sampler/seed, used to keep the chunk canonical."""
    settings = {}
    for node in (graph or {}).values():
        if not isinstance(node, dict):
            continue
        class_type = str(node.get("class_type") or "")
        inputs = node.get("inputs") or {}
        if "KSampler" in class_type or class_type == "SamplerCustomAdvanced":
            for key, name in (("steps", "Steps"), ("cfg", "CFG scale"), ("seed", "Seed"),
                              ("noise_seed", "Seed"), ("sampler_name", "Sampler")):
                value = inputs.get(key)
                if name not in settings and not _is_link(value) and value is not None:
                    settings[name] = value
        if class_type in ("BasicScheduler", "KSamplerSelect", "RandomNoise"):
            for key, name in (("steps", "Steps"), ("sampler_name", "Sampler"), ("noise_seed", "Seed")):
                value = inputs.get(key)
                if name not in settings and not _is_link(value) and value is not None:
                    settings[name] = value
    return settings


def _sampler_prompts(graph):
    for node in (graph or {}).values():
        if not isinstance(node, dict):
            continue
        class_type = str(node.get("class_type") or "")
        if "KSampler" not in class_type and class_type != "SamplerCustomAdvanced":
            continue
        inputs = node.get("inputs") or {}
        positive_link = _first_link(inputs, "positive", "guider")
        negative_link = _first_link(inputs, "negative")
        positive = _text_from_link(graph, positive_link[0], 0) if positive_link else ""
        negative = _text_from_link(graph, negative_link[0], 0) if negative_link else ""
        if positive or negative:
            return positive, negative
    return "", ""


def _fallback_prompt(graph):
    """Last resort: any prompt-ish text widget in the graph, in node order."""
    parts = []
    for node in (graph or {}).values():
        if not isinstance(node, dict):
            continue
        class_type = str(node.get("class_type") or "")
        if class_type not in (
            "PromptWarehouse", "PromptLine", "PromptMultiline",
            "CLIPTextEncode", "CLIPTextEncodeFlux", "CLIPTextEncodeSDXL",
        ):
            continue
        inputs = node.get("inputs") or {}
        for key in _TEXT_KEYS:
            value = inputs.get(key)
            if isinstance(value, str) and value.strip():
                parts.append(value.strip())
                break
    return ", ".join(parts)


def build_parameters(graph, image_size=None):
    """Return an A1111 ``parameters`` chunk carrying the LoRA info, or ``None``."""
    if not isinstance(graph, dict) or not graph:
        return None
    loras = _lora_entries(graph)
    positive, negative = _sampler_prompts(graph)
    if not positive:
        positive = _fallback_prompt(graph)
    if negative and negative == positive:
        negative = ""

    head = positive
    for name, strength in loras:
        head = f"{head} <lora:{lora_tag_name(name)}:{strength:g}>"
    head = head.strip()
    if not head:
        return None

    lines = [head]
    if negative:
        lines.append(f"Negative prompt: {negative}")

    settings = []
    sampler_settings = _sampler_settings(graph)
    for key in ("Steps", "Sampler", "CFG scale", "Seed"):
        if key in sampler_settings:
            settings.append(f"{key}: {sampler_settings[key]}")
    if image_size:
        settings.append(f"Size: {image_size[0]}x{image_size[1]}")

    hashes = []
    for name, _strength in loras:
        value = lora_hash(name)
        if value:
            hashes.append(f"{lora_tag_name(name)}: {value}")
    if hashes:
        settings.append('Lora hashes: "' + ", ".join(hashes) + '"')

    if settings:
        lines.append(", ".join(settings))
    return "\n".join(lines)
