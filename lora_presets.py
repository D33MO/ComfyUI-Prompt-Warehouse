"""Named LoRA combinations, independent of any workflow."""
import json
import math
import os
import threading
import uuid
from pathlib import Path

from .prompt_store import backup_dir

STORE_PATH = Path(__file__).resolve().parent / "data" / "lora_presets.json"
_LOCK = threading.RLock()


def clean_preset(raw):
    if not isinstance(raw, dict):
        raise ValueError("A preset must be an object")
    title = raw.get("title", "")
    if not isinstance(title, str) or not title.strip():
        raise ValueError("A preset title is required")
    rows = raw.get("loras")
    if not isinstance(rows, list) or not rows:
        raise ValueError("Add at least one LoRA before saving a preset")
    cleaned = []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("name"), str) or not row["name"]:
            raise ValueError("Every LoRA needs a file name")
        enabled = row.get("enabled", True)
        if not isinstance(enabled, bool):
            raise ValueError("LoRA enabled state must be a boolean")
        try:
            strength = float(row.get("strength", 1))
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError("LoRA strength must be a finite number") from exc
        if not math.isfinite(strength):
            raise ValueError("LoRA strength must be a finite number")
        cleaned.append({"name": row["name"], "strength": strength, "enabled": enabled})
    identifier = raw.get("id") or str(uuid.uuid4())
    if not isinstance(identifier, str):
        raise ValueError("Preset ID must be text")
    return {"id": identifier, "title": title.strip(), "loras": cleaned}


def _read(path):
    try:
        values = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(values, list):
            return None
        result = [clean_preset(value) for value in values]
        if len({item["id"] for item in result}) != len(result):
            return None
        return result
    except (OSError, ValueError, TypeError):
        return None


def _write(path, entries):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def load_presets():
    with _LOCK:
        entries = _read(STORE_PATH)
        # An intentionally empty list is valid and must not resurrect deleted presets.
        if entries is not None:
            return entries
        restored = _read(backup_dir() / "lora_presets.json") or []
        if restored:
            _write(STORE_PATH, restored)
        return restored


def update_presets(payload):
    if not isinstance(payload, dict):
        raise ValueError("Preset request must be an object")
    action = payload.get("action")
    with _LOCK:
        entries = load_presets()
        if action == "save":
            preset = clean_preset(payload.get("preset"))
            entries = [item for item in entries if item["id"] != preset["id"]] + [preset]
        elif action == "delete":
            identifier = payload.get("id")
            if not isinstance(identifier, str) or not identifier:
                raise ValueError("A preset ID is required")
            entries = [item for item in entries if item["id"] != identifier]
        else:
            raise ValueError("Unknown preset action")
        _write(STORE_PATH, entries)
        try:
            _write(backup_dir() / "lora_presets.json", entries)
        except OSError:
            pass
        return entries
