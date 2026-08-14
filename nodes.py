import random
from .prompt_store import load_entries

def _dimension(value):
    try:
        number = int(str(value).strip())
        return number if number > 0 else 0
    except (TypeError, ValueError):
        return 0

class PromptWarehouse:
    @classmethod
    def INPUT_TYPES(cls):
        groups = sorted({item["group"] for item in load_entries()})
        return {"required": {
            "prompt": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": False,
                                    "placeholder": "在这里输入提示词，或从仓库载入…"}),
            "width": ("STRING", {"default": "", "placeholder": "未设置"}),
            "height": ("STRING", {"default": "", "placeholder": "未设置"}),
            "random_group": (["全部", *groups], {"default": "全部"}),
            "random_enabled": ("BOOLEAN", {"default": False, "label_on": "开启", "label_off": "关闭"}),
        }}

    RETURN_TYPES = ("STRING", "INT", "INT")
    RETURN_NAMES = ("prompt", "width", "height")
    FUNCTION = "build"
    CATEGORY = "Prompt Warehouse"
    DESCRIPTION = "管理、选择或按分组随机抽取提示词及其可选尺寸。"

    @classmethod
    def IS_CHANGED(cls, prompt, width, height, random_group, random_enabled):
        if random_enabled:
            return float("nan")
        return (prompt, width, height)

    def build(self, prompt, width, height, random_group, random_enabled):
        selected = None
        if random_enabled:
            entries = load_entries()
            group = random_group.strip()
            if group and group != "全部":
                entries = [item for item in entries if item["group"] == group]
            if entries:
                selected = random.choice(entries)
                prompt, width, height = selected["prompt"], selected.get("width") or "", selected.get("height") or ""
        return {"ui": {"selected": [selected] if selected else []},
                "result": (prompt, _dimension(width), _dimension(height))}

NODE_CLASS_MAPPINGS = {"PromptWarehouse": PromptWarehouse}
NODE_DISPLAY_NAME_MAPPINGS = {"PromptWarehouse": "Prompt Warehouse / 提示词仓库"}
