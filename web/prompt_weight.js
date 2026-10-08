import { t } from "./i18n.js";

// Only treat a selection as one weighted group when its outer parentheses
// enclose the entire selection (including nested or escaped parentheses).
function weightedGroup(text) {
  const match = /^\(([\s\S]*):([+-]?(?:\d+(?:\.\d*)?|\.\d+))\)$/.exec(text);
  if (!match || !Number.isFinite(Number(match[2]))) return null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") { i++; continue; }
    if (text[i] === "(") depth++;
    if (text[i] === ")" && --depth === 0 && i !== text.length - 1) return null;
    if (depth < 0) return null;
  }
  return depth === 0 ? { text: match[1], weight: Number(match[2]) } : null;
}

export function weightSelection(value, start, end, action) {
  let selected = value.slice(start, end);
  if (!selected.trim()) return null;
  let group = weightedGroup(selected);
  // Also allow selecting just the text inside an existing weighted group.
  if (!group && value[start - 1] === "(") {
    const suffix = /^:([+-]?(?:\d+(?:\.\d*)?|\.\d+))\)/.exec(value.slice(end));
    if (suffix) {
      const expanded = value.slice(start - 1, end + suffix[0].length);
      group = weightedGroup(expanded);
      if (group) { start--; end += suffix[0].length; }
    }
  }
  if (action === "wrap") return group ? null : { start, end, text: `(${selected})` };
  if (!group && selected.startsWith("(") && selected.endsWith(")")) {
    // A plain (text) group starts at weight 1 for explicit +/- adjustment.
    group = weightedGroup(`${selected.slice(0, -1)}:1)`);
  }
  const weight = Math.round(((group?.weight ?? 1) + (action === "increase" ? 0.1 : -0.1)) * 1e10) / 1e10;
  return { start, end, text: `(${group?.text ?? selected}:${weight})` };
}

export function attachPromptWeightControls(node, widget) {
  if (!widget || widget._pwWeightControls) return;
  const input = [widget.element, widget.inputEl, widget.inputElement]
    .find(element => element?.tagName === "TEXTAREA");
  if (!input) return;
  if (!document.getElementById("pw-node-weight-styles")) {
    const style = document.createElement("style");
    style.id = "pw-node-weight-styles";
    style.textContent = `
      .pw-node-prompt{display:flex;width:100%;height:100%;min-height:50px;overflow:hidden;gap:4px}
      .pw-node-prompt>textarea{flex:1;min-width:0;width:0!important;height:100%;box-sizing:border-box;resize:none}
      .pw-node-weight-controls{display:flex;flex-direction:column;gap:4px;flex:0 0 26px;padding:2px 0}
      .pw-node-weight-controls button{width:26px;height:28px;padding:0;border:1px solid #555;border-radius:4px;background:#222;color:#ddd;font:14px system-ui;cursor:pointer}
      .pw-node-weight-controls button:hover{background:#444;color:#fff}
      .pw-node-weight-controls button:focus-visible{outline:2px solid #7aa2d8;outline-offset:-2px}
    `;
    document.head.append(style);
  }
  const container = document.createElement("div");
  container.className = "pw-node-prompt";
  const controls = document.createElement("div");
  controls.className = "pw-node-weight-controls";
  // Preserve the original textarea and its ComfyUI bindings. The DOM widget
  // positions/resizes the wrapper, keeping the toolbar attached while zooming.
  if (input.parentNode) input.replaceWith(container);
  container.append(input, controls);
  widget.element = container;
  widget._pwWeightControls = controls;
  for (const [action, label, title] of [
    ["wrap", "( )", "wrapSelection"],
    ["increase", "+", "increaseWeight"],
    ["decrease", "-", "decreaseWeight"],
  ]) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = t(title);
    button.setAttribute("aria-label", t(title));
    button.dataset.weightAction = action;
    button.addEventListener("pointerdown", event => { event.preventDefault(); event.stopPropagation(); });
    button.addEventListener("click", event => {
      event.stopPropagation();
      const change = weightSelection(input.value, input.selectionStart, input.selectionEnd, action);
      if (!change) return;
      const scrollTop = input.scrollTop;
      input.focus({ preventScroll: true });
      input.setSelectionRange(change.start, change.end);
      let inserted = false;
      try { inserted = document.execCommand("insertText", false, change.text); } catch { /* fallback below */ }
      if (!inserted) {
        input.setRangeText(change.text, change.start, change.end, "select");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      // Keep the entire expression selected so repeated clicks adjust this group.
      input.setSelectionRange(change.start, change.start + change.text.length);
      input.scrollTop = scrollTop;
      node.setDirtyCanvas?.(true, true);
    });
    controls.append(button);
  }
}
