"""End-to-end check: run the real save node against the real ComfyUI install."""

import importlib.util
import json
import sys
import types
from pathlib import Path

from PIL import Image

COMFY = Path(r"D:\ComfyUI-aki-v3\ComfyUI")
PKG = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(COMFY))

package = types.ModuleType("pw_pkg")
package.__path__ = [str(PKG)]
sys.modules["pw_pkg"] = package

spec = importlib.util.spec_from_file_location("pw_pkg.nodes", PKG / "nodes.py")
nodes = importlib.util.module_from_spec(spec)
sys.modules["pw_pkg.nodes"] = nodes
spec.loader.exec_module(nodes)

import torch  # noqa: E402

GRAPH = {
    "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "anything.safetensors"}},
    "2": {
        "class_type": "PromptWarehouseMultiLoraLoader",
        "inputs": {
            "lora_config": json.dumps([
                {"enabled": True, "name": "Z-xhs888.safetensors", "strength": 0.8},
            ]),
        },
    },
    "3": {"class_type": "PromptWarehouse", "inputs": {"prompt": "1girl, solo", "clip": ["2", 1]}},
    "4": {"class_type": "KSampler", "inputs": {"positive": ["3", 3], "negative": ["3", 3],
                                               "steps": 28, "cfg": 5.0,
                                               "sampler_name": "dpmpp_2m", "seed": 12345}},
}

out_dir = PKG / "tests" / "_out"
out_dir.mkdir(parents=True, exist_ok=True)
for stale in out_dir.glob("*.png"):
    stale.unlink()

node = nodes.SaveImageWithDelete()
node.output_dir = str(out_dir)
node.prefix_append = ""

images = torch.zeros((1, 64, 96, 3))
result = node.save_images(images, "pwtest", prompt=GRAPH, extra_pnginfo={"workflow": {"nodes": []}})

saved = out_dir / result["ui"]["images"][0]["filename"]
print("saved:", saved)
with Image.open(saved) as png:
    chunks = dict(png.text)
    size = png.size

failures = []


def check(label, condition, detail=""):
    print(f"{'PASS' if condition else 'FAIL'}  {label}{(' -> ' + detail) if detail else ''}")
    if not condition:
        failures.append(label)


parameters = chunks.get("parameters", "")
print("--- parameters chunk in PNG ---")
print(parameters)
print("-------------------------------")

check("png exists", saved.is_file())
check("parameters chunk written", bool(parameters))
check("prompt chunk preserved", "PromptWarehouseMultiLoraLoader" in chunks.get("prompt", ""))
check("workflow chunk preserved", "workflow" in chunks)
check("lora tag", "<lora:Z-xhs888:0.8>" in parameters)
check("lora hash", 'Lora hashes: "Z-xhs888: bdff5f135b08"' in parameters)
check("no prompt text", "1girl" not in parameters and "Negative prompt" not in parameters)
check("size from image", f"Size: {size[0]}x{size[1]}" in parameters)

print()
print("FAILURES:", failures or "none")
sys.exit(1 if failures else 0)
