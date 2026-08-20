import random
import json

import comfy.sd
import comfy.utils
import folder_paths
from nodes import SaveImage as ComfySaveImage

from .prompt_store import load_entries

def _dimension(value):
    try:
        number = int(str(value).strip())
        return number if number > 0 else 0
    except (TypeError, ValueError):
        return 0

def _join_prompts(*values):
    parts = []
    for value in values:
        part = str(value or "").strip().strip(",").strip()
        if part:
            parts.append(part)
    return ", ".join(parts)

class PromptWarehouse:
    @classmethod
    def INPUT_TYPES(cls):
        groups = sorted({item["group"] for item in load_entries()})
        return {
            "required": {
                "prompt": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": False,
                                        "placeholder": "Enter a prompt or load one from the warehouse…"}),
                "width": ("STRING", {"default": "", "placeholder": "Not set"}),
                "height": ("STRING", {"default": "", "placeholder": "Not set"}),
                "random_group": (["全部", *groups], {"default": "全部"}),
                "random_enabled": ("BOOLEAN", {"default": False, "label_on": "On", "label_off": "Off"}),
            },
            "optional": {
                "prompt_in": ("STRING", {"forceInput": True}),
                "clip": ("CLIP",),
            },
        }

    RETURN_TYPES = ("STRING", "INT", "INT", "CONDITIONING")
    RETURN_NAMES = ("prompt", "width", "height", "conditioning")
    FUNCTION = "build"
    CATEGORY = "Prompt Warehouse"
    DESCRIPTION = "Manage, select, or randomly choose grouped prompts with optional dimensions."

    @classmethod
    def IS_CHANGED(cls, prompt, width, height, random_group, random_enabled, prompt_in="", clip=None):
        if random_enabled:
            return float("nan")
        return (prompt_in, prompt, width, height)

    def build(self, prompt, width, height, random_group, random_enabled, prompt_in="", clip=None):
        selected = None
        if random_enabled:
            entries = load_entries()
            group = random_group.strip()
            if group and group != "全部":
                entries = [item for item in entries if item["group"] == group]
            if entries:
                selected = random.choice(entries)
                prompt, width, height = selected["prompt"], selected.get("width") or "", selected.get("height") or ""
        prompt = _join_prompts(prompt_in, prompt)
        if prompt:
            prompt += ","
        conditioning = clip.encode_from_tokens_scheduled(clip.tokenize(prompt)) if clip is not None else []
        return {"ui": {"selected": [selected] if selected else []},
                "result": (prompt, _dimension(width), _dimension(height), conditioning)}

class PromptLine:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {
                    "default": "",
                    "multiline": False,
                    "dynamicPrompts": False,
                    "placeholder": "Enter a prompt…",
                }),
            },
            "optional": {
                "prompt_in": ("STRING", {"forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "output"
    CATEGORY = "Prompt Warehouse"
    DESCRIPTION = "Join an upstream prompt with a single-line prompt."

    def output(self, prompt, prompt_in=""):
        return (_join_prompts(prompt_in, prompt),)


class PromptMultiline:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "prompt": ("STRING", {
                    "default": "",
                    "multiline": True,
                    "dynamicPrompts": False,
                    "placeholder": "Enter a multiline prompt…",
                }),
            },
            "optional": {
                "prompt_in": ("STRING", {"forceInput": True}),
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("prompt",)
    FUNCTION = "output"
    CATEGORY = "Prompt Warehouse"
    DESCRIPTION = "Join an upstream prompt with a multiline prompt."

    def output(self, prompt, prompt_in=""):
        return (_join_prompts(prompt_in, prompt),)


class MultiLoraLoader:
    """Apply an ordered, workflow-persisted list of LoRAs to MODEL and CLIP."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "clip": ("CLIP",),
                # The web extension turns this into the multi-row editor. Keeping
                # one real widget is intentional: ComfyUI always serializes it.
                "lora_config": ("STRING", {
                    "default": "[]",
                    "multiline": False,
                    "lora_names": folder_paths.get_filename_list("loras"),
                }),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP")
    RETURN_NAMES = ("model", "clip")
    FUNCTION = "load_loras"
    CATEGORY = "Prompt Warehouse"
    DESCRIPTION = "Load multiple LoRAs in order with one strength applied to MODEL and CLIP."

    def __init__(self):
        self._cache = {}

    def _load(self, name):
        path = folder_paths.get_full_path_or_raise("loras", name)
        cached = self._cache.get(path)
        if cached is None:
            cached = comfy.utils.load_torch_file(path, safe_load=True)
            self._cache[path] = cached
        return cached

    def load_loras(self, model, clip, lora_config="[]"):
        try:
            entries = json.loads(lora_config or "[]")
        except (TypeError, json.JSONDecodeError) as error:
            raise ValueError(f"LoRA 配置不是有效的 JSON: {error}") from error
        if not isinstance(entries, list):
            raise ValueError("LoRA 配置必须是一个列表")

        available = set(folder_paths.get_filename_list("loras"))
        for entry in entries:
            if not isinstance(entry, dict) or not entry.get("enabled", True):
                continue
            name = str(entry.get("name", ""))
            if not name:
                continue
            if name not in available:
                raise ValueError(f"找不到 LoRA: {name}")
            strength = float(entry.get("strength", entry.get("strength_model", 1.0)))
            if strength == 0:
                continue
            model, clip = comfy.sd.load_lora_for_models(
                model, clip, self._load(name), strength, strength
            )
        return (model, clip)


class SaveImageWithDelete(ComfySaveImage):
    """ComfyUI's standard Save Image with a safe post-save delete action in the UI."""

    CATEGORY = "Prompt Warehouse"
    DESCRIPTION = "Save and preview images, then optionally delete their source files from output."


NODE_CLASS_MAPPINGS = {
    "PromptWarehouse": PromptWarehouse,
    "PromptLine": PromptLine,
    "PromptMultiline": PromptMultiline,
    "PromptWarehouseMultiLoraLoader": MultiLoraLoader,
    "PromptWarehouseSaveImageWithDelete": SaveImageWithDelete,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "PromptWarehouse": "Prompt Warehouse",
    "PromptLine": "Prompt Line",
    "PromptMultiline": "Prompt Multiline",
    "PromptWarehouseMultiLoraLoader": "Multi LoRA Loader",
    "PromptWarehouseSaveImageWithDelete": "Save Image with Delete",
}
