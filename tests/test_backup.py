"""Check the automatic Documents backup of the warehouse data."""

import importlib.util
import json
import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TMP = ROOT / "tests" / "_tmp"
if TMP.exists():
    shutil.rmtree(TMP)
TMP.mkdir(parents=True)

os.environ["PROMPT_WAREHOUSE_BACKUP_DIR"] = str(TMP / "Documents" / "ComfyUI-Prompt-Warehouse")

spec = importlib.util.spec_from_file_location("prompt_store", ROOT / "prompt_store.py")
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)

store.DATA_DIR = TMP / "data"
store.STORE_PATH = store.DATA_DIR / "prompts.json"

failures = []


def check(label, condition, detail=""):
    print(f"{'PASS' if condition else 'FAIL'}  {label}{(' -> ' + detail) if detail else ''}")
    if not condition:
        failures.append(label)


entries = [
    # Group names are free-form user data, so Chinese values stay valid here.
    {"id": "a", "title": "T1", "prompt": "1girl, solo", "group": "General", "width": 832, "height": 1216},
    {"id": "b", "title": "T2", "prompt": "风景", "group": "风景"},
]
saved = store.save_entries(entries)

mirror = store.backup_path()
check("backup path in Documents", "Documents" in str(mirror), str(mirror))
check("mirror written", mirror.is_file())
check("mirror content matches", json.loads(mirror.read_text(encoding="utf-8")) == saved)
check("snapshot written", len(list((mirror.parent / "backups").glob("prompts-*.json"))) == 1)

check("status reports file", store.backup_status()["exists"] is True)

# Restore: main file gone, backup present.
store.STORE_PATH.unlink()
restored = store.load_entries()
check("restores from backup", [item["id"] for item in restored] == ["a", "b"])
check("restored file recreated", store.STORE_PATH.is_file())

# An existing but empty main file (the shape shipped by default) must restore too.
store.STORE_PATH.write_text("[]\n", encoding="utf-8")
check("restores when main file is empty",
      [item["id"] for item in store.load_entries()] == ["a", "b"])
check("empty main file rewritten", json.loads(store.STORE_PATH.read_text(encoding="utf-8")) != [])

# A corrupt main file must not silently wipe the warehouse either.
store.STORE_PATH.write_text("{ not json", encoding="utf-8")
check("restores when main file is corrupt",
      [item["id"] for item in store.load_entries()] == ["a", "b"])

# Deliberately clearing the warehouse must stay cleared: saving writes the empty
# payload to the backup as well, so nothing is resurrected on the next load.
store.save_entries([])
check("intentionally cleared warehouse stays cleared", store.load_entries() == [])
store.save_entries(entries)

# Missing both -> empty, no crash.
store.STORE_PATH.unlink()
mirror.unlink()
check("empty when no backup", store.load_entries() == [])

# Snapshot pruning keeps the newest BACKUP_KEEP files.
store.save_entries(entries)
snapshots = mirror.parent / "backups"
for index in range(30):
    (snapshots / f"prompts-2020010{index // 10}-00000{index % 10}.json").write_text("[]", encoding="utf-8")
store.save_entries(entries)
check("snapshots pruned", len(list(snapshots.glob("prompts-*.json"))) <= store.BACKUP_KEEP,
      str(len(list(snapshots.glob("prompts-*.json")))))

# A broken backup target must never break saving.
blocker = TMP / "not-a-folder"
blocker.write_text("x", encoding="utf-8")
os.environ["PROMPT_WAREHOUSE_BACKUP_DIR"] = str(blocker)
result = store.save_entries(entries)
check("save survives broken backup target", len(result) == 2)
check("main file still written", store.STORE_PATH.is_file())

shutil.rmtree(TMP, ignore_errors=True)
print()
print("FAILURES:", failures or "none")
sys.exit(1 if failures else 0)
