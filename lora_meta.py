"""Build CivitAI/A1111-compatible image metadata that carries resource hashes.

ComfyUI's stock SaveImage only embeds the ``prompt`` and ``workflow`` PNG chunks.
CivitAI links the resources behind an upload by matching file hashes that it
reads out of the A1111 ``parameters`` chunk, so models wired through custom
loader nodes would otherwise have to be re-entered by hand on upload.

This module extracts the checkpoint and the LoRAs straight out of the execution
graph ComfyUI hands to the save node, so no workflow rewiring is needed. It
writes only the fields CivitAI matches on — ``Model hash``/``Model`` for the
checkpoint and a ``Lora hashes`` map for the LoRAs — plus the sampler settings.
Prompt text and LoRA strengths are deliberately never written, so an uploaded
image exposes neither the positive or negative prompt nor the strength each LoRA
was applied with.
"""

import hashlib
import json
import threading
from pathlib import Path

import folder_paths

CACHE_PATH = Path(__file__).resolve().parent / "data" / "lora_hashes.json"
_LOCK = threading.RLock()
_CACHE = None

# CivitAI resolves a resource by comparing the hash written into the metadata
# with the hashes it stored for that file when it was uploaded. The only short
# SHA256 form it keeps per file is AutoV2, the first **10** characters of the
# full SHA256 (AutoV1 is an 8-character hash of the first 100MB, AutoV3 a
# 12-character tensor hash). A 12-character SHA256 prefix is none of those and
# matched nothing until CivitAI added a separate SHA256_12 type, so 10 is the
# length both `Model hash` and `Lora hashes` have to use.
HASH_LENGTH = 10

# Nodes that load a LoRA. Anything the user's workflow uses is covered here.
_LORA_NODES = {"PromptWarehouseMultiLoraLoader", "LoraLoader", "LoraLoaderModelOnly"}

# Nodes that load a checkpoint. `Model hash`/`Model` describe a single file, so
# the first checkpoint in the graph wins — the same one A1111 records.
_CHECKPOINT_NODES = {"CheckpointLoaderSimple", "CheckpointLoader"}


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


def _short_sha256(path):
    """The file's SHA256 truncated to `HASH_LENGTH`, i.e. CivitAI's AutoV2."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()[:HASH_LENGTH]


def file_hash(folder, name):
    """Return the AutoV2 hash of a model file, cached by path + size + mtime.

    `name` is resolved through ComfyUI's own folder registry, so anything that is
    not actually installed (or a selection that resolves to nothing) yields an
    empty string and is simply left out of the metadata. The cache entry records
    `HASH_LENGTH` as well, so a hash written by an older version of this pack is
    recomputed instead of being reused.
    """
    try:
        path = folder_paths.get_full_path(folder, name)
        if not path:
            return ""
        stat = Path(path).stat()
    except (OSError, ValueError):
        return ""
    key = str(Path(path))
    stamp = {"size": stat.st_size, "mtime": int(stat.st_mtime), "len": HASH_LENGTH}
    with _LOCK:
        cache = _load_cache()
        entry = cache.get(key)
        if isinstance(entry, dict) and all(entry.get(field) == value for field, value in stamp.items()):
            return str(entry.get("hash", ""))
    try:
        digest = _short_sha256(path)
    except OSError:
        return ""
    with _LOCK:
        cache = _load_cache()
        cache[key] = {**stamp, "hash": digest}
        _store_cache(cache)
    return digest


def lora_hash(name):
    """AutoV2 hash of a LoRA, or "" when it is not installed."""
    return file_hash("loras", name)


def checkpoint_hash(name):
    """AutoV2 hash of a checkpoint, or "" when it is not installed."""
    return file_hash("checkpoints", name)


def _flat_name(name):
    """A ComfyUI folder-relative model name as a path, separators normalised."""
    return Path(str(name).replace("\\", "/"))


def lora_tag_name(name):
    """Key used in the ``Lora hashes`` map: the file name without extension."""
    return _flat_name(name).stem


def checkpoint_name(name):
    """Value used for the A1111 ``Model`` field: the bare file name."""
    return _flat_name(name).name


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


def _checkpoint_entry(graph):
    """Name of the checkpoint the graph loads, or ``None``."""
    for node in (graph or {}).values():
        if not isinstance(node, dict) or node.get("class_type") not in _CHECKPOINT_NODES:
            continue
        name = (node.get("inputs") or {}).get("ckpt_name")
        if isinstance(name, str) and name.strip():
            return name.strip()
    return None


def _is_link(value):
    return (
        isinstance(value, (list, tuple))
        and len(value) == 2
        and isinstance(value[0], (str, int))
        and not isinstance(value[1], (list, dict))
    )


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


def build_parameters(graph, image_size=None):
    """Return the A1111 ``parameters`` chunk for this run, or ``None``.

    The chunk holds the hashes CivitAI resolves resources with — ``Model
    hash``/``Model`` for the checkpoint and a ``Lora hashes`` map for the LoRAs —
    next to the sampler settings. It deliberately contains neither prompt text
    nor ``<lora:name:strength>`` tags, so an upload reveals which resources
    produced the image but not the prompt or the strengths. ``None`` means the
    caller should fall back to ComfyUI's native save, which writes no
    ``parameters`` chunk at all.
    """
    if not isinstance(graph, dict) or not graph:
        return None

    settings = []
    sampler_settings = _sampler_settings(graph)
    for key in ("Steps", "Sampler", "CFG scale", "Seed"):
        if key in sampler_settings:
            settings.append(f"{key}: {sampler_settings[key]}")
    if image_size:
        settings.append(f"Size: {image_size[0]}x{image_size[1]}")

    checkpoint = _checkpoint_entry(graph)
    if checkpoint:
        digest = checkpoint_hash(checkpoint)
        if digest:
            settings.append(f"Model hash: {digest}")
        settings.append(f"Model: {checkpoint_name(checkpoint)}")

    hashes = []
    for name, _strength in _lora_entries(graph):
        digest = lora_hash(name)
        if digest:
            hashes.append(f"{lora_tag_name(name)}: {digest}")
    if hashes:
        settings.append('Lora hashes: "' + ", ".join(hashes) + '"')

    if not settings:
        return None
    return ", ".join(settings)
