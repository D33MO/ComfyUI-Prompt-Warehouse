import { app } from "../../scripts/app.js";

const NODE_NAME = "PromptWarehouseMultiLoraLoader";
const ROW_HEIGHT = 28;

function parseConfig(widget) {
  try {
    const value = JSON.parse(widget?.value || "[]");
    return Array.isArray(value) ? value : [];
  } catch (_) {
    return [];
  }
}

function hideConfigWidget(widget) {
  if (!widget || widget._pwHidden) return;
  widget._pwHidden = true;
  widget.type = "pw-hidden-lora-config";
  widget.computeSize = () => [0, -4];
  widget.draw = () => {};
}

function shortName(name, limit) {
  const value = String(name || "Select a LoRA…").replace(/\\/g, "/");
  return value.length > limit ? `…${value.slice(1 - limit)}` : value;
}

function chooseLora(event, names, callback) {
  const items = (names.length ? names : ["No LoRA files found"]).map((name) => ({
    content: name,
    disabled: !names.length,
    callback: () => callback(name),
  }));
  new LiteGraph.ContextMenu(items, { event, title: "Select LoRA" });
}

function removeEditorWidgets(node) {
  for (const widget of node._pwLoraWidgets || []) {
    const index = node.widgets?.indexOf(widget) ?? -1;
    if (index >= 0) node.widgets.splice(index, 1);
  }
  node._pwLoraWidgets = [];
}

function makeRowWidget(node, row, index, rows, names, save, rebuild) {
  const widget = {
    name: `lora_${index}`,
    type: "pw-lora-row",
    value: row,
    options: { serialize: false },
    computeSize(width) { return [width, ROW_HEIGHT]; },
    draw(ctx, _node, width, y, height) {
      this.last_y = y;
      const midY = y + height / 2;
      const plusX = width - 20;
      const valueX = plusX - 40;
      const minusX = valueX - 28;
      const nameRight = minusX - 9;
      this._hit = { nameRight, minusX, valueX, plusX };

      ctx.save();
      ctx.globalAlpha = row.enabled ? 1 : 0.45;
      ctx.fillStyle = LiteGraph.WIDGET_BGCOLOR || "#222";
      ctx.strokeStyle = LiteGraph.WIDGET_OUTLINE_COLOR || "#555";
      ctx.beginPath();
      ctx.roundRect(10, y + 2, width - 20, height - 4, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = row.enabled ? "#68b36b" : "#555";
      ctx.beginPath();
      ctx.arc(21, midY, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR || "#ddd";
      ctx.font = "12px sans-serif";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(shortName(row.name, Math.max(8, Math.floor((nameRight - 35) / 7))), 34, midY);
      ctx.textAlign = "center";
      ctx.globalAlpha *= 0.72;
      ctx.fillText("−", minusX, midY);
      ctx.globalAlpha = row.enabled ? 1 : 0.45;
      ctx.fillText(Number(row.strength ?? 1).toFixed(2), valueX, midY);
      ctx.globalAlpha *= 0.72;
      ctx.fillText("+", plusX, midY);
      ctx.restore();
    },
    mouse(event, pos) {
      if (!this._hit || !["pointerdown", "mousedown"].includes(event.type) || event.button > 0) {
        return false;
      }
      const x = pos[0];
      if (x < 31) {
        row.enabled = !row.enabled;
        save();
      } else if (x < this._hit.nameRight) {
        chooseLora(event, names, (name) => { row.name = name; save(); });
      } else if (x < (this._hit.minusX + this._hit.valueX) / 2) {
        row.strength = Math.round((Number(row.strength ?? 1) - 0.05) * 100) / 100;
        save();
      } else if (x < (this._hit.valueX + this._hit.plusX) / 2) {
        const value = globalThis.prompt("LoRA strength", String(row.strength ?? 1));
        if (value !== null && Number.isFinite(Number(value))) {
          row.strength = Number(value);
          save();
        }
      } else {
        row.strength = Math.round((Number(row.strength ?? 1) + 0.05) * 100) / 100;
        save();
      }
      node.setDirtyCanvas(true, true);
      return true;
    },
  };

  widget._pwContextOptions = () => [
    {
      content: row.enabled ? "⚫ Toggle Off" : "🟢 Toggle On",
      callback: () => { row.enabled = !row.enabled; save(); },
    },
    null,
    {
      content: "⬆ Move Up",
      disabled: index === 0,
      callback: () => {
        if (index > 0) [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]];
        rebuild();
      },
    },
    {
      content: "⬇ Move Down",
      disabled: index === rows.length - 1,
      callback: () => {
        if (index < rows.length - 1) [rows[index], rows[index + 1]] = [rows[index + 1], rows[index]];
        rebuild();
      },
    },
    {
      content: "🗑 Remove",
      callback: () => { rows.splice(index, 1); rebuild(); },
    },
  ];
  return widget;
}

function renderEditor(node, names) {
  const configWidget = node.widgets?.find((widget) => widget.name === "lora_config");
  if (!configWidget) return;
  hideConfigWidget(configWidget);
  removeEditorWidgets(node);

  const rows = parseConfig(configWidget).map((row) => ({
    enabled: row.enabled ?? row.on ?? true,
    name: row.name ?? row.lora ?? "",
    strength: Number(row.strength ?? row.strength_model ?? 1),
  }));
  const added = node._pwLoraWidgets = [];
  const save = () => {
    configWidget.value = JSON.stringify(rows);
    node.setDirtyCanvas(true, true);
  };
  const rebuild = () => {
    configWidget.value = JSON.stringify(rows);
    renderEditor(node, names);
  };

  rows.forEach((row, index) => {
    const widget = makeRowWidget(node, row, index, rows, names, save, rebuild);
    node.addCustomWidget(widget);
    added.push(widget);
  });

  const button = node.addWidget("button", "＋ Add LoRA", null, (_value, _canvas, _node, _pos, event) => {
    const add = (name) => {
      rows.push({ enabled: true, name, strength: 1 });
      rebuild();
    };
    if (event) chooseLora(event, names, add);
    else add("");
  });
  button.options = { ...(button.options || {}), serialize: false };
  added.push(button);
  node.setSize([Math.max(node.size[0], 360), Math.max(node.computeSize()[1], 105)]);
  save();
}

app.registerExtension({
  name: "D33MO.MultiLoraLoader",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;
    const names = nodeData.input?.required?.lora_config?.[1]?.lora_names || [];

    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments);
      renderEditor(this, names);
      return result;
    };

    const configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = configured?.apply(this, arguments);
      renderEditor(this, names);
      return result;
    };

    const getSlot = nodeType.prototype.getSlotInPosition;
    nodeType.prototype.getSlotInPosition = function (canvasX, canvasY) {
      const slot = getSlot?.apply(this, arguments);
      if (slot) return slot;
      const localY = canvasY - this.pos[1];
      const widget = this.widgets?.find((item) => item.type === "pw-lora-row"
        && localY >= item.last_y && localY <= item.last_y + ROW_HEIGHT);
      return widget ? { widget, output: { type: "LORA" } } : slot;
    };

    const getMenu = nodeType.prototype.getSlotMenuOptions;
    nodeType.prototype.getSlotMenuOptions = function (slot) {
      if (slot?.widget?._pwContextOptions) return slot.widget._pwContextOptions();
      return getMenu?.apply(this, arguments);
    };
  },
});
