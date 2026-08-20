import { app } from "../../scripts/app.js";
import { t } from "./i18n.js";

const NODE_NAME = "PromptWarehouseMultiLoraLoader";
const ROW_HEIGHT = 23;

function showStrengthEditor(initialValue, onSave) {
  if (!document.getElementById("pw-lora-strength-style")) {
    const style = document.createElement("style");
    style.id = "pw-lora-strength-style";
    style.textContent = `
      .pw-lora-strength-backdrop{position:fixed;inset:0;z-index:10020;display:grid;place-items:center;background:#05070a99;font-family:Inter,system-ui,sans-serif}
      .pw-lora-strength-dialog{width:270px;padding:17px;background:#202226;color:#eceff4;border:1px solid #555b65;border-radius:10px;box-shadow:0 20px 60px #000a}
      .pw-lora-strength-dialog label{display:block;margin-bottom:9px;color:#cdd2da;font-size:13px}
      .pw-lora-strength-dialog input{box-sizing:border-box;width:100%;padding:9px 10px;background:#121417;color:#fff;border:1px solid #5c6470;border-radius:6px;outline:none;font-size:14px}
      .pw-lora-strength-dialog input:focus{border-color:#8b9fbd;box-shadow:0 0 0 3px #7791b426}
      .pw-lora-strength-error{min-height:17px;margin-top:5px;color:#ef8d8d;font-size:11px}
      .pw-lora-strength-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
      .pw-lora-strength-actions button{padding:6px 13px;color:#e7eaf0;background:#343840;border:1px solid #555c67;border-radius:6px;cursor:pointer}
      .pw-lora-strength-actions button[data-save]{background:#526f98;border-color:#6f89ad}
    `;
    document.head.append(style);
  }

  const root = document.createElement("div");
  root.className = "pw-lora-strength-backdrop";
  root.innerHTML = `
    <div class="pw-lora-strength-dialog" role="dialog" aria-modal="true" aria-label="LoRA strength">
      <label>${t("strength")}</label>
      <input type="number" step="0.05" inputmode="decimal" value="${Number(initialValue)}">
      <div class="pw-lora-strength-error"></div>
      <div class="pw-lora-strength-actions"><button data-cancel>${t("cancel")}</button><button data-save>${t("confirm")}</button></div>
    </div>`;
  document.body.append(root);
  const input = root.querySelector("input");
  const error = root.querySelector(".pw-lora-strength-error");
  const close = () => root.remove();
  const save = () => {
    const value = Number(input.value);
    if (!input.value.trim() || !Number.isFinite(value)) {
      error.textContent = t("invalidNumber");
      input.focus();
      return;
    }
    onSave(value);
    close();
  };
  root.querySelector("[data-save]").onclick = save;
  root.querySelector("[data-cancel]").onclick = close;
  root.onclick = (event) => { if (event.target === root) close(); };
  root.onkeydown = (event) => {
    if (event.key === "Enter") save();
    if (event.key === "Escape") close();
  };
  input.focus();
  input.select();
}

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
  widget.hidden = true;
  widget.type = "pw-hidden-lora-config";
  widget.computeSize = () => [0, -4];
  widget.draw = () => {};
  for (const element of [widget.element, widget.inputEl, widget.inputElement]) {
    if (element?.style) element.style.display = "none";
  }
}

function shortName(name, limit) {
  const value = String(name || `${t("selectLora")}…`).replace(/\\/g, "/");
  return value.length > limit ? `${value.slice(0, Math.max(1, limit - 1))}…` : value;
}

function chooseLora(event, names, callback) {
  const items = (names.length ? names : [t("noLora")]).map((name) => ({
    content: name,
    disabled: !names.length,
    callback: () => callback(name),
  }));
  new LiteGraph.ContextMenu(items, { event, title: t("selectLora") });
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
      ctx.roundRect(10, y, width - 20, height - 1, 6);
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
        showStrengthEditor(row.strength ?? 1, (value) => {
          row.strength = value;
          save();
        });
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
      content: row.enabled ? `⚫ ${t("toggleOff")}` : `🟢 ${t("toggleOn")}`,
      callback: () => { row.enabled = !row.enabled; save(); },
    },
    null,
    {
      content: `⬆ ${t("moveUp")}`,
      disabled: index === 0,
      callback: () => {
        if (index > 0) [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]];
        rebuild();
      },
    },
    {
      content: `⬇ ${t("moveDown")}`,
      disabled: index === rows.length - 1,
      callback: () => {
        if (index < rows.length - 1) [rows[index], rows[index + 1]] = [rows[index + 1], rows[index]];
        rebuild();
      },
    },
    {
      content: `🗑 ${t("remove")}`,
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

  const button = node.addWidget("button", t("addLora"), null, (_value, _canvas, _node, _pos, event) => {
    const add = (name) => {
      rows.push({ enabled: true, name, strength: 1 });
      rebuild();
    };
    if (event) chooseLora(event, names, add);
    else add("");
  });
  button.options = { ...(button.options || {}), serialize: false };
  added.push(button);
  node.setSize([Math.max(node.size[0], 355), Math.max(node.computeSize()[1], 105)]);
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
      this.size[0] = Math.max(355, (this.size?.[0] || 360) - 5);
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
