import os
import random
import json

import numpy as np
from PIL import Image
from PIL.PngImagePlugin import PngInfo

import comfy.sd
import comfy.utils
import folder_paths
from comfy.cli_args import args
from nodes import SaveImage as ComfySaveImage

from .lora_meta import build_parameters
from .prompt_store import load_entries

# Canonical value of the `random_group` widget that means "use every group".
# Workflows saved before v0.4.1 stored the Chinese label instead; it is still
# accepted so existing graphs keep the same behaviour.
ALL_GROUPS = "All"
LEGACY_ALL_GROUPS = "全部"

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
                "random_group": ([ALL_GROUPS, *groups], {"default": ALL_GROUPS}),
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
            if group and group not in (ALL_GROUPS, LEGACY_ALL_GROUPS):
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
            raise ValueError(f"LoRA configuration is not valid JSON: {error}") from error
        if not isinstance(entries, list):
            raise ValueError("LoRA configuration must be a list")

        available = set(folder_paths.get_filename_list("loras"))
        for entry in entries:
            if not isinstance(entry, dict) or not entry.get("enabled", True):
                continue
            name = str(entry.get("name", ""))
            if not name:
                continue
            if name not in available:
                raise ValueError(f"LoRA not found: {name}")
            strength = float(entry.get("strength", entry.get("strength_model", 1.0)))
            if strength == 0:
                continue
            model, clip = comfy.sd.load_lora_for_models(
                model, clip, self._load(name), strength, strength
            )
        return (model, clip)


class SaveImageWithDelete(ComfySaveImage):
    """ComfyUI's standard Save Image with a safe post-save delete action in the UI.

    It additionally embeds an A1111-style ``parameters`` chunk so CivitAI picks up
    the LoRAs (including the ones loaded by :class:`MultiLoraLoader`) on upload.
    """

    CATEGORY = "Prompt Warehouse"
    DESCRIPTION = "Save and preview images with CivitAI-readable LoRA metadata, then optionally delete their source files from output."

    def save_images(self, images, filename_prefix="ComfyUI", prompt=None, extra_pnginfo=None):
        parameters = None
        if not args.disable_metadata:
            try:
                parameters = build_parameters(prompt, (images[0].shape[1], images[0].shape[0]))
            except Exception:
                parameters = None
        if not parameters:
            return super().save_images(images, filename_prefix, prompt, extra_pnginfo)

        filename_prefix += self.prefix_append
        full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
            filename_prefix, self.output_dir, images[0].shape[1], images[0].shape[0])
        results = []
        for batch_number, image in enumerate(images):
            pixels = 255. * image.cpu().numpy()
            img = Image.fromarray(np.clip(pixels, 0, 255).astype(np.uint8))
            metadata = PngInfo()
            if prompt is not None:
                metadata.add_text("prompt", json.dumps(prompt))
            if extra_pnginfo is not None:
                for key in extra_pnginfo:
                    metadata.add_text(key, json.dumps(extra_pnginfo[key]))
            metadata.add_text("parameters", parameters)
            filename_with_batch_num = filename.replace("%batch_num%", str(batch_number))
            file = f"{filename_with_batch_num}_{counter:05}_.png"
            img.save(os.path.join(full_output_folder, file), pnginfo=metadata,
                     compress_level=self.compress_level)
            results.append({"filename": file, "subfolder": subfolder, "type": self.type})
            counter += 1
        return {"ui": {"images": results}, "result": (images,)}


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
