import json
import os
import threading
import time
import uuid
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent / "data"
STORE_PATH = DATA_DIR / "prompts.json"
BACKUP_FOLDER = "ComfyUI-Prompt-Warehouse"
BACKUP_KEEP = 20
_LOCK = threading.RLock()


def _documents_dir():
    """User's Documents folder, tolerating OneDrive redirection."""
    for variable in ("OneDrive", "OneDriveCommercial", "OneDriveConsumer"):
        value = os.environ.get(variable)
        if value:
            candidate = Path(value) / "Documents"
            if candidate.is_dir():
                return candidate
    candidate = Path.home() / "Documents"
    if candidate.is_dir():
        return candidate
    return Path.home()


def backup_dir():
    """Where the automatic copy of the warehouse data is written."""
    override = os.environ.get("PROMPT_WAREHOUSE_BACKUP_DIR")
    if override:
        return Path(override).expanduser()
    return _documents_dir() / BACKUP_FOLDER


def backup_path():
    return backup_dir() / "prompts.json"


def backup_status():
    path = backup_path()
    try:
        modified = path.stat().st_mtime
    except OSError:
        modified = None
    return {"path": str(path), "exists": path.is_file(), "modified": modified}


def _prune_snapshots(folder):
    snapshots = sorted(folder.glob("prompts-*.json"))
    for stale in snapshots[:-BACKUP_KEEP]:
        try:
            stale.unlink()
        except OSError:
            pass


def _write_backup(text):
    """Mirror the warehouse data into Documents. Never let a failure break saving."""
    folder = backup_dir()
    try:
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / "prompts.json"
        temporary = folder / ".prompts.tmp"
        temporary.write_text(text, encoding="utf-8")
        os.replace(temporary, target)
        snapshots = folder / "backups"
        snapshots.mkdir(parents=True, exist_ok=True)
        (snapshots / f"prompts-{time.strftime('%Y%m%d-%H%M%S')}.json").write_text(text, encoding="utf-8")
        _prune_snapshots(snapshots)
    except OSError:
        pass


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

def _parse_entries(path):
    try:
        content = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(content, list):
        return None
    entries = []
    for item in content:
        try:
            entries.append(_clean_entry(item))
        except (TypeError, ValueError):
            continue
    return entries

def load_entries():
    with _LOCK:
        if STORE_PATH.exists():
            return _parse_entries(STORE_PATH) or []
        # The warehouse file is missing (fresh install or accidental delete):
        # restore it from the Documents backup instead of silently starting empty.
        restored = _parse_entries(backup_path())
        if not restored:
            return []
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            STORE_PATH.write_text(json.dumps(restored, ensure_ascii=False, indent=2) + "\n",
                                  encoding="utf-8")
        except OSError:
            pass
        return restored

def save_entries(raw_entries):
    if not isinstance(raw_entries, list):
        raise ValueError("仓库数据必须是列表")
    entries = [_clean_entry(item) for item in raw_entries]
    ids = [item["id"] for item in entries]
    if len(ids) != len(set(ids)):
        raise ValueError("提示词 ID 不能重复")
    payload = json.dumps(entries, ensure_ascii=False, indent=2) + "\n"
    with _LOCK:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        temporary = STORE_PATH.with_suffix(".tmp")
        temporary.write_text(payload, encoding="utf-8")
        os.replace(temporary, STORE_PATH)
        _write_backup(payload)
    return entries
