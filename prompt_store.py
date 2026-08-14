import json
import os
import threading
import uuid
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
STORE_PATH = DATA_DIR / "prompts.json"
_LOCK = threading.RLock()

def _clean_dimension(value):
    if value in (None, ""):
        return None
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("width 和 height 必须是正整数或留空") from exc
    if number <= 0:
        raise ValueError("width 和 height 必须是正整数或留空")
    return number

def _clean_entry(raw):
    title = str(raw.get("title", "")).strip()
    prompt = str(raw.get("prompt", "")).strip()
    group = str(raw.get("group", "基础提示词")).strip() or "未分组"
    if not title:
        raise ValueError("标题不能为空")
    if not prompt:
        raise ValueError("提示词不能为空")
    return {"id": str(raw.get("id") or uuid.uuid4()), "title": title, "prompt": prompt,
            "group": group, "width": _clean_dimension(raw.get("width")),
            "height": _clean_dimension(raw.get("height"))}

def load_entries():
    with _LOCK:
        if not STORE_PATH.exists():
            return []
        try:
            content = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        if not isinstance(content, list):
            return []
        entries = []
        for item in content:
            try:
                entries.append(_clean_entry(item))
            except (TypeError, ValueError):
                continue
        return entries

def save_entries(raw_entries):
    if not isinstance(raw_entries, list):
        raise ValueError("仓库数据必须是列表")
    entries = [_clean_entry(item) for item in raw_entries]
    ids = [item["id"] for item in entries]
    if len(ids) != len(set(ids)):
        raise ValueError("提示词 ID 不能重复")
    with _LOCK:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        temporary = STORE_PATH.with_suffix(".tmp")
        temporary.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, STORE_PATH)
    return entries
