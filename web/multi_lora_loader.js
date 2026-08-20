import { app } from "../../scripts/app.js";

const NODE_NAME = "PromptWarehouseMultiLoraLoader";

function parseConfig(widget) {
  try {
    const value = JSON.parse(widget?.value || "[]");
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

function hideWidget(widget) {
  if (!widget || widget._pwHidden) return;
  widget._pwHidden = true;
  widget.type = "pw-hidden-lora-config";
  widget.computeSize = () => [0, -4];
  widget.draw = () => {};
}

function removeEditorWidgets(node) {
  for (const item of node._pwLoraWidgets || []) {
    const index = node.widgets?.indexOf(item) ?? -1;
    if (index >= 0) node.widgets.splice(index, 1);
  }
  node._pwLoraWidgets = [];
}

function renderEditor(node, loraNames) {
  const configWidget = node.widgets?.find((item) => item.name === "lora_config");
  if (!configWidget) return;
  hideWidget(configWidget);
  removeEditorWidgets(node);

  const rows = parseConfig(configWidget);
  const added = node._pwLoraWidgets = [];
  const add = (type, name, value, callback, options) => {
    const item = node.addWidget(type, name, value, callback, options);
    item.options = { ...(item.options || {}), serialize: false };
    added.push(item);
    return item;
  };
  const save = () => {
    configWidget.value = JSON.stringify(rows);
    node.setDirtyCanvas(true, true);
  };

  rows.forEach((row, index) => {
    row.enabled ??= true;
    row.name ??= loraNames[0] || "";
    row.strength_model ??= 1;
    row.strength_clip ??= 1;

    add("toggle", `LoRA ${index + 1} · 启用`, row.enabled, (value) => {
      row.enabled = Boolean(value); save();
    }, { on: "启用", off: "停用" });
    add("combo", `LoRA ${index + 1}`, row.name, (value) => {
      row.name = value; save();
    }, { values: loraNames });
    add("number", "MODEL 强度", row.strength_model, (value) => {
      row.strength_model = Number(value); save();
    }, { min: -20, max: 20, step: 0.05, precision: 2 });
    add("number", "CLIP 强度", row.strength_clip, (value) => {
      row.strength_clip = Number(value); save();
    }, { min: -20, max: 20, step: 0.05, precision: 2 });
    add("button", `删除 LoRA ${index + 1}`, null, () => {
      rows.splice(index, 1);
      configWidget.value = JSON.stringify(rows);
      renderEditor(node, loraNames);
    });
  });

  add("button", "＋ Add LoRA", null, () => {
    rows.push({
      enabled: true,
      name: loraNames[0] || "",
      strength_model: 1,
      strength_clip: 1,
    });
    configWidget.value = JSON.stringify(rows);
    renderEditor(node, loraNames);
  });

  node.setSize([
    Math.max(node.size[0], 360),
    Math.max(node.computeSize()[1], rows.length ? 230 : 150),
  ]);
  node.setDirtyCanvas(true, true);
}

app.registerExtension({
  name: "D33MO.MultiLoraLoader",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;
    const loraNames = nodeData.input?.required?.lora_config?.[1]?.lora_names || [];

    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments);
      renderEditor(this, loraNames);
      return result;
    };

    const configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = configured?.apply(this, arguments);
      // Core restores widgets_values before onConfigure, so rebuilding here
      // restores every saved LoRA row as well as the permanent Add button.
      renderEditor(this, loraNames);
      return result;
    };
  },
});
