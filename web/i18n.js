import { app } from "../../scripts/app.js";

// UI copy for the frontend dialogs.
//
// Language resolution is deliberately narrow: the translation only turns on
// when the user picked Chinese in ComfyUI itself. The browser language is never
// sniffed and there is no separate extension setting, so switching ComfyUI's
// language is the single, explicit, per-user opt-in.
const STRINGS = {
  en: {
    addLora: "＋ Add LoRA", cancel: "Cancel", confirm: "Confirm", invalidNumber: "Enter a valid number.", strength: "LoRA Strength",
    selectLora: "Select LoRA", noLora: "No LoRA files found", toggleOff: "Toggle Off", toggleOn: "Toggle On", moveUp: "Move Up", moveDown: "Move Down", remove: "Remove",
    deleteRecent: "Delete Recent Output", deleteTitle: "Permanently delete?", deleteOneTarget: "the most recent image",
    deleteManyTarget: "the {count} most recent images", deleteMessage: "The source file(s) for {target} will be permanently removed from ComfyUI's output directory. This cannot be undone.",
    delete: "Delete", deleting: "Deleting…", deleteFailed: "Delete failed", fileMissing: "File no longer exists", deletedImages: "Deleted {count} image(s)",
    openWarehouse: "Open Warehouse", warehouse: "Prompt Warehouse", add: "＋ New", listHint: "Select an entry, then use Load to apply it to the node", filterGroup: "Filter by group",
    newPrompt: "New Prompt", editPrompt: "Edit Prompt", draft: "Draft", saved: "Saved", unsaved: "Unsaved", close: "Close",
    title: "Title", titlePlaceholder: "Example: Rainy night street", group: "Group", groupPlaceholder: "Select or enter a new group", showGroups: "Show existing groups",
    prompt: "Prompt", promptPlaceholder: "Enter the full prompt…", width: "Width", height: "Height", optional: "optional", unset: "Not set", notSaved: "Current content has not been saved.",
    load: "Load", save: "Save", noGroupMatch: "No matching group. Saving will create it.", all: "All", noEntries: "No saved prompts in this group.",
    selectedHint: "Selected. Load it or edit it on the right.", loadedNode: "Loaded into node: {title}", saving: "Saving…", saveInvalid: "Save failed. Check the fields.",
    saveConnectionFailed: "Save failed: {error}", draftChanged: "Changes are only in the draft. Click Save to apply them.", editSaved: "Changes saved.", newSaved: "New prompt saved.",
    deletePromptQuestion: "Delete “{title}”?", promptDeleted: "Prompt deleted.",
  },
  zh: {
    addLora: "＋ 添加 LoRA", cancel: "取消", confirm: "确定", invalidNumber: "请输入有效数字。", strength: "LoRA 强度",
    selectLora: "选择 LoRA", noLora: "未找到 LoRA 文件", toggleOff: "关闭", toggleOn: "启用", moveUp: "上移", moveDown: "下移", remove: "删除",
    deleteRecent: "删除最近输出", deleteTitle: "确认永久删除？", deleteOneTarget: "最近输出的图片",
    deleteManyTarget: "最近输出的 {count} 张图片", deleteMessage: "将从 ComfyUI output 目录永久删除{target}的源文件，此操作无法撤销。",
    delete: "删除", deleting: "正在删除…", deleteFailed: "删除失败", fileMissing: "文件已不存在", deletedImages: "已删除 {count} 张图片",
    openWarehouse: "打开仓库", warehouse: "提示词仓库", add: "＋ 新增", listHint: "点击条目选择，使用右侧按钮加载到节点", filterGroup: "按分组筛选",
    newPrompt: "新增提示词", editPrompt: "编辑提示词", draft: "草稿", saved: "已保存", unsaved: "未保存", close: "关闭",
    title: "标题", titlePlaceholder: "例如：雨夜街景", group: "分组", groupPlaceholder: "选择或输入新分组", showGroups: "显示已有分组",
    prompt: "提示词", promptPlaceholder: "输入完整提示词…", width: "宽度", height: "高度", optional: "可选", unset: "未设置", notSaved: "当前内容尚未保存。",
    load: "加载", save: "保存", noGroupMatch: "没有匹配分组，保存后将自动新增", all: "全部", noEntries: "该分组还没有已保存的提示词。",
    selectedHint: "已选择，可点击加载或在右侧修改。", loadedNode: "已载入节点：{title}", saving: "正在保存…", saveInvalid: "保存失败，请检查填写内容。",
    saveConnectionFailed: "保存失败：{error}", draftChanged: "修改只存在于草稿中，点击保存后生效。", editSaved: "修改已保存。", newSaved: "新提示词已保存。",
    deletePromptQuestion: "删除“{title}”？", promptDeleted: "提示词已删除。",
  },
};

// Canonical value stored by the `random_group` widget for "no group filter".
// The Python side accepts the legacy Chinese value too, so old workflows keep
// working; this module only maps a stored value onto the dropdown labels.
export const ALL_GROUPS = "All";

const LEGACY_ALL_GROUPS = "全部";
// Locale codes that share our "zh" table.
const SUPPORTED = [["zh", "zh-tw", "zh-hk", "zh-hans", "zh-hant", "zh-cn"], ["en"]];

function resolve(value) {
  const code = String(value ?? "").trim().toLowerCase();
  const group = SUPPORTED.find((candidate) => candidate.includes(code));
  return group ? group[0] : null;
}

/**
 * Read the locale ComfyUI is actually using.
 *
 * `Comfy.Locale` comes first because it is the authoritative source: it is the
 * very setting that drives the node titles, input names and category labels
 * ComfyUI itself renders for this pack. The frontend ships a static
 * `<html lang="en">` and never rewrites it, so the document language must only
 * ever be the last resort — checking it first is what previously pinned every
 * dialog to English while the node on the canvas stayed Chinese.
 *
 * Resolved on every call: the settings store may not exist yet while extensions
 * are still loading, and the user can switch language without a full page
 * reload.
 */
export function currentLanguage() {
  const sources = [
    () => app.ui?.settings?.getSettingValue?.("Comfy.Locale"),
    () => app.i18n?.locale?.value, // legacy (pre-Vue) frontend i18n instance
    () => document.documentElement?.lang, // some builds mirror the locale here
  ];
  for (const read of sources) {
    try {
      const active = resolve(read());
      if (active) return active;
    } catch (error) {
      console.warn("[Prompt Warehouse] Unable to read the ComfyUI locale:", error);
    }
  }
  return "en";
}

export function t(key, values = {}) {
  let text = STRINGS[currentLanguage()]?.[key] ?? STRINGS.en[key] ?? key;
  for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}

/**
 * The dropdown shows translated labels while the widget keeps the canonical
 * value. Legacy workflows store the Chinese label itself, so normalize it.
 */
export function groupChoice(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === LEGACY_ALL_GROUPS) return ALL_GROUPS;
  return raw;
}

/**
 * Label for the canonical "All" entry, shared by the dialog's group filter and
 * the node's `random_group` combo. It matches the value locales/zh/nodeDefs.json
 * declares for that option, so the node reads "全部" instead of "All".
 */
export function groupLabel(value) {
  return groupChoice(value) === ALL_GROUPS ? t("all") : value;
}
