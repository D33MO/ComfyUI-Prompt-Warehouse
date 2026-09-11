"""Offline check for lora_meta.build_parameters (stubs folder_paths, no ComfyUI import)."""

import importlib.util
import json
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LORAS_DIR = Path(r"D:\ComfyUI-aki-v3\ComfyUI\models\loras")

folder_paths = types.ModuleType("folder_paths")


def get_full_path(folder, name):
    if folder != "loras":
        return None
    candidate = LORAS_DIR / str(name)
    return str(candidate) if candidate.is_file() else None


folder_paths.get_full_path = get_full_path
folder_paths.get_filename_list = lambda folder: (
    [entry.name for entry in LORAS_DIR.iterdir()] if folder == "loras" else []
)
sys.modules["folder_paths"] = folder_paths

spec = importlib.util.spec_from_file_location("lora_meta", ROOT / "lora_meta.py")
lora_meta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lora_meta)

GRAPH = {
    "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "anything.safetensors"}},
    "2": {
        "class_type": "PromptWarehouseMultiLoraLoader",
        "inputs": {
            "model": ["1", 0],
            "clip": ["1", 1],
            "lora_config": json.dumps([
                {"enabled": True, "name": "Z-xhs888.safetensors", "strength": 0.8},
                {"enabled": False, "name": "minimax_h3_turbo_v4_step600_ema.safetensors", "strength": 1.0},
                {"enabled": True, "name": "minimax_h3_turbo_v4_step600_ema.safetensors", "strength": 0.65},
                {"enabled": True, "name": "missing-file.safetensors", "strength": 1.0},
            ]),
        },
    },
    "3": {
        "class_type": "PromptWarehouse",
        "inputs": {
            "prompt": "1girl, solo",
            "width": "832",
            "height": "1216",
            "random_group": "\u5168\u90e8",
            "random_enabled": False,
            "clip": ["2", 1],
        },
    },
    "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "bad hands", "clip": ["2", 1]}},
    "5": {
        "class_type": "KSampler",
        "inputs": {
            "model": ["2", 0],
            "positive": ["3", 3],
            "negative": ["4", 0],
            "steps": 28,
            "cfg": 5.0,
            "sampler_name": "dpmpp_2m",
            "seed": 12345,
        },
    },
}

STOCK_GRAPH = {
    "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "anything.safetensors"}},
    "2": {"class_type": "LoraLoader", "inputs": {"model": ["1", 0], "clip": ["1", 1],
                                                  "lora_name": "Z-xhs888.safetensors",
                                                  "strength_model": 1.0, "strength_clip": 1.0}},
    "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "hello", "clip": ["2", 1]}},
    "4": {"class_type": "CLIPTextEncode", "inputs": {"text": "", "clip": ["2", 1]}},
    "5": {"class_type": "KSampler", "inputs": {"positive": ["3", 0], "negative": ["4", 0],
                                               "steps": 20, "cfg": 7.0, "sampler_name": "euler",
                                               "seed": 7}},
}

failures = []


def check(label, condition, detail=""):
    print(f"{'PASS' if condition else 'FAIL'}  {label}{(' -> ' + detail) if detail else ''}")
    if not condition:
        failures.append(label)


text = lora_meta.build_parameters(GRAPH, (832, 1216))
print("--- parameters chunk ---")
print(text)
print("------------------------")

check("returns text", bool(text))
check("no positive prompt", "1girl" not in text, text.splitlines()[0])
check("head is lora tags", text.splitlines()[0].startswith("<lora:"), text.splitlines()[0])
check("lora tag 1", "<lora:Z-xhs888:0.8>" in text)
check("lora tag 2", "<lora:minimax_h3_turbo_v4_step600_ema:0.65>" in text)
check("disabled lora skipped", "<lora:minimax_h3_turbo_v4_step600_ema:1>" not in text)
check("no negative prompt", "bad hands" not in text and "Negative prompt" not in text)
check("sampler settings", "Steps: 28" in text and "CFG scale: 5.0" in text and "Seed: 12345" in text)
check("size", "Size: 832x1216" in text)
check("lora hashes line", 'Lora hashes: "Z-xhs888: ' in text)

hashes = lora_meta.lora_hash("Z-xhs888.safetensors")
import hashlib

expected = hashlib.sha256((LORAS_DIR / "Z-xhs888.safetensors").read_bytes()).hexdigest()[:12]
check("autov2 hash matches sha256[:12]", hashes == expected, f"{hashes} vs {expected}")
check("hash cached", lora_meta.lora_hash("Z-xhs888.safetensors") == expected)
check("missing lora has no hash", lora_meta.lora_hash("missing-file.safetensors") == "")

stock = lora_meta.build_parameters(STOCK_GRAPH, (512, 512))
print("--- stock graph ---")
print(stock)
check("stock LoraLoader recognised", stock and "<lora:Z-xhs888:1>" in stock)
check("stock prompt text dropped", stock and "hello" not in stock)

check("empty graph -> None", lora_meta.build_parameters({}, None) is None)
check("garbage graph -> None", lora_meta.build_parameters({"1": {"inputs": {}}}, None) is None)
check("no loras -> None", lora_meta.build_parameters({"3": {"class_type": "CLIPTextEncode",
                                                           "inputs": {"text": "hello"}}}, None) is None)

print()
print("FAILURES:", failures or "none")
sys.exit(1 if failures else 0)
