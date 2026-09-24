"""Offline check for lora_meta.build_parameters (stubs folder_paths, no ComfyUI import)."""

import hashlib
import importlib.util
import json
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LORAS_DIR = Path(r"D:\ComfyUI-aki-v3\ComfyUI\models\loras")
CKPT_DIR = ROOT / "tests" / "_tmp_lora_meta"
CKPT_NAME = "tiny-checkpoint.safetensors"
CKPT_PATH = CKPT_DIR / CKPT_NAME

# A stand-in checkpoint: the real files in the user's models folder are far too
# large to hash in a test, and only the file bytes matter to the hash.
CKPT_DIR.mkdir(parents=True, exist_ok=True)
if not CKPT_PATH.is_file():
    CKPT_PATH.write_bytes(b"prompt-warehouse stand-in checkpoint\n" * 4)

folder_paths = types.ModuleType("folder_paths")

ROOTS = {"loras": LORAS_DIR, "checkpoints": CKPT_DIR}


def get_full_path(folder, name):
    root = ROOTS.get(folder)
    if root is None:
        return None
    candidate = root / str(name)
    return str(candidate) if candidate.is_file() else None


folder_paths.get_full_path = get_full_path
folder_paths.get_filename_list = lambda folder: (
    [entry.name for entry in ROOTS[folder].iterdir()] if folder in ROOTS else []
)
sys.modules["folder_paths"] = folder_paths

spec = importlib.util.spec_from_file_location("lora_meta", ROOT / "lora_meta.py")
lora_meta = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lora_meta)


def short(path):
    """AutoV2: the first HASH_LENGTH characters of the file's SHA256."""
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()[:lora_meta.HASH_LENGTH]


GRAPH = {
    "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT_NAME}},
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

CKPT_ONLY_GRAPH = {
    "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT_NAME}},
    "2": {"class_type": "KSampler", "inputs": {"steps": 4, "cfg": 1.0, "seed": 1}},
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

ckpt_hash = short(CKPT_PATH)
lora_hash = short(LORAS_DIR / "Z-xhs888.safetensors")
second_hash = short(LORAS_DIR / "minimax_h3_turbo_v4_step600_ema.safetensors")

check("returns text", bool(text))
check("single line", "\n" not in text, repr(text[:30]))
check("no lora tags", "<lora:" not in text)
check("no positive prompt", "1girl" not in text)
check("no negative prompt", "bad hands" not in text and "Negative prompt" not in text)
check("sampler settings", "Steps: 28" in text and "CFG scale: 5.0" in text and "Seed: 12345" in text)
check("size", "Size: 832x1216" in text)
check("model hash", f"Model hash: {ckpt_hash}" in text, ckpt_hash)
check("model name", f"Model: {CKPT_NAME}" in text)
check("lora hashes line", f'Lora hashes: "Z-xhs888: {lora_hash},' in text)
check("enabled lora hashed", f"minimax_h3_turbo_v4_step600_ema: {second_hash}" in text)
check("disabled lora not duplicated", text.count(second_hash) == 1)
check("uninstalled lora left out", "missing-file" not in text)

check("hash is 10 characters", len(lora_hash) == 10, str(len(lora_hash)))
check("lora hash matches sha256[:10]", lora_meta.lora_hash("Z-xhs888.safetensors") == lora_hash)
check("hash cached", lora_meta.lora_hash("Z-xhs888.safetensors") == lora_hash)
check("checkpoint hash matches sha256[:10]",
      lora_meta.checkpoint_hash(CKPT_NAME) == ckpt_hash, lora_meta.checkpoint_hash(CKPT_NAME))
check("missing lora has no hash", lora_meta.lora_hash("missing-file.safetensors") == "")
check("missing checkpoint has no hash", lora_meta.checkpoint_hash("anything.safetensors") == "")

stock = lora_meta.build_parameters(STOCK_GRAPH, (512, 512))
print("--- stock graph ---")
print(stock)
check("stock LoraLoader recognised", bool(stock) and f"Lora hashes: \"Z-xhs888: {lora_hash}\"" in stock)
check("stock lora tags dropped", bool(stock) and "<lora:" not in stock)
check("stock prompt text dropped", bool(stock) and "hello" not in stock)
check("unhashable checkpoint still named", bool(stock) and "Model: anything.safetensors" in stock)
check("unhashable checkpoint has no hash", bool(stock) and "Model hash:" not in stock)

only_ckpt = lora_meta.build_parameters(CKPT_ONLY_GRAPH)
print("--- checkpoint only ---")
print(only_ckpt)
check("checkpoint alone is written", bool(only_ckpt) and f"Model hash: {ckpt_hash}" in only_ckpt)
check("no lora map without loras", bool(only_ckpt) and "Lora hashes" not in only_ckpt)
check("checkpoint alone keeps settings", bool(only_ckpt) and "Steps: 4" in only_ckpt)

check("empty graph -> None", lora_meta.build_parameters({}, None) is None)
check("garbage graph -> None", lora_meta.build_parameters({"1": {"inputs": {}}}, None) is None)
check("no checkpoint and no loras -> None",
      lora_meta.build_parameters({"3": {"class_type": "CLIPTextEncode",
                                        "inputs": {"text": "hello"}}}, None) is None)

print()
print("FAILURES:", failures or "none")
sys.exit(1 if failures else 0)
