import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { t } from "./i18n.js";

const NODE_NAME = "PromptWarehouse";
const EMPTY_DRAFT = () => ({
  id: null,
  title: "",
  group: "",
  prompt: "",
  width: null,
  height: null,
});

const css = `
.pw-backdrop{position:fixed;inset:0;z-index:10000;background:rgba(8,12,18,.72);display:grid;place-items:center;padding:24px;font-family:Inter,system-ui,sans-serif}
.pw-modal{width:min(980px,96vw);height:min(720px,92vh);display:grid;grid-template-columns:300px 1fr;background:#151a22;color:#e8edf5;border:1px solid #343d4c;border-radius:14px;box-shadow:0 30px 90px #000a;overflow:hidden}
.pw-list{background:#10151c;border-right:1px solid #303846;padding:18px;overflow:auto}.pw-list-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}.pw-list h2{font-size:17px;margin:0}.pw-btn.pw-new-btn{padding:5px 9px;font-size:12px}.pw-list-note{font-size:12px;color:#7f8da0;margin:0 0 10px}.pw-filter{box-sizing:border-box;width:100%;margin:0 0 12px;padding:8px 9px;border:1px solid #344052;border-radius:7px;background:#171e28;color:#dce5f0;outline:none}.pw-filter:focus{border-color:#7aa2d8}
.pw-entry{display:block;margin:3px 0;border:1px solid transparent;border-radius:8px;overflow:hidden}.pw-entry:hover,.pw-entry.active{background:#202936;border-color:#394657}.pw-entry-main{box-sizing:border-box;width:100%;border:0;background:transparent;color:#dfe7f2;cursor:pointer;text-align:left;padding:9px 10px}.pw-entry-main small{display:block;color:#8795a8;margin-top:3px}
.pw-editor{padding:22px 26px;overflow:auto}.pw-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}.pw-head strong{font-size:18px}.pw-mode{display:inline-block;margin-left:8px;padding:3px 7px;border-radius:99px;background:#263448;color:#a9c6e8;font-size:11px;vertical-align:2px}.pw-mode.unsaved{background:#743b20;color:#ffd09e;box-shadow:0 0 0 1px #b76836}
.pw-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.pw-field{display:grid;gap:6px}.pw-field.full{grid-column:1/-1}.pw-field label{font-size:12px;color:#9aa8ba}.pw-field input,.pw-field textarea{box-sizing:border-box;width:100%;border:1px solid #3a4555;border-radius:8px;background:#0f141b;color:#edf3fa;padding:10px 11px;outline:none}.pw-field textarea{min-height:230px;resize:vertical}.pw-field input:focus,.pw-field textarea:focus{border-color:#7aa2d8;box-shadow:0 0 0 3px #527db32b}.pw-combobox{position:relative}.pw-combobox input{padding-right:38px}.pw-combo-toggle{position:absolute;right:1px;top:1px;width:36px;height:calc(100% - 2px);border:0;background:transparent;color:#a9b6c8;cursor:pointer}.pw-combo-toggle:hover{color:#fff}.pw-group-menu{position:absolute;z-index:4;left:0;right:0;top:calc(100% + 5px);max-height:190px;overflow:auto;padding:5px;background:#171e28;border:1px solid #3a4658;border-radius:8px;box-shadow:0 12px 30px #0008}.pw-group-menu[hidden]{display:none}.pw-group-option{display:block;width:100%;padding:9px 10px;border:0;border-radius:6px;background:transparent;color:#dfe7f2;text-align:left;cursor:pointer}.pw-group-option:hover,.pw-group-option:focus{background:#293647;color:#fff;outline:none}.pw-group-empty{padding:9px 10px;color:#7f8da0;font-size:12px}
.pw-actions{display:flex;justify-content:space-between;gap:10px;margin-top:20px}.pw-actions div{display:flex;gap:9px}.pw-btn{border:1px solid #3d495a;border-radius:8px;background:#222b37;color:#eaf0f7;padding:9px 14px;cursor:pointer}.pw-btn:hover{background:#2b3746}.pw-btn.primary{background:#4778ad;border-color:#5c8dc2}.pw-btn.danger{color:#ffb8b2}.pw-btn[disabled]{opacity:.4;cursor:not-allowed}.pw-empty{color:#8795a8;padding:12px 8px}.pw-status{font-size:12px;color:#93a3b7;margin-top:10px;min-height:18px}
@media(max-width:720px){.pw-modal{grid-template-columns:1fr;height:94vh}.pw-list{max-height:210px;border-right:0;border-bottom:1px solid #303846}.pw-grid{grid-template-columns:1fr}}
`;

function ensureStyles() {
  if (document.getElementById("pw-styles")) return;
  const style = document.createElement("style");
  style.id = "pw-styles";
  style.textContent = css;
  document.head.append(style);
}

function widget(node, name) {
  return node.widgets?.find((item) => item.name === name);
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>\"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  })[character]);
}

async function openWarehouse(node) {
  ensureStyles();
  const response = await api.fetchApi("/prompt-warehouse/prompts");
  const data = await response.json();
  let entries = data.entries || [];
  let editingId = null;
  let filterGroup = t("allGroups");

  const root = document.createElement("div");
  root.className = "pw-backdrop";
  root.innerHTML = `
    <section class="pw-modal" role="dialog" aria-modal="true" aria-label="${t("warehouse")}">
      <aside class="pw-list">
        <div class="pw-list-head"><h2>${t("warehouse")}</h2><button class="pw-btn pw-new-btn" data-new>${t("add")}</button></div>
        <p class="pw-list-note">${t("listHint")}</p>
        <select class="pw-filter" data-filter aria-label="${t("filterGroup")}"></select>
        <div data-list></div>
      </aside>
      <main class="pw-editor">
        <div class="pw-head">
          <strong><span data-editor-title>${t("newPrompt")}</span><span class="pw-mode" data-mode>${t("draft")}</span></strong>
          <button class="pw-btn" data-close>${t("close")}</button>
        </div>
        <div class="pw-grid">
          <div class="pw-field"><label>${t("title")}</label><input data-title placeholder="${t("titlePlaceholder")}"></div>
          <div class="pw-field"><label>${t("group")}</label><div class="pw-combobox" data-group-combo><input data-group role="combobox" aria-expanded="false" autocomplete="off" placeholder="${t("groupPlaceholder")}"><button class="pw-combo-toggle" data-group-toggle type="button" tabindex="-1" aria-label="${t("showGroups")}">▼</button><div class="pw-group-menu" data-groups role="listbox" hidden></div></div></div>
          <div class="pw-field full"><label>${t("prompt")}</label><textarea data-prompt placeholder="${t("promptPlaceholder")}"></textarea></div>
          <div class="pw-field"><label>Width (${t("optional")})</label><input data-width type="number" min="1" placeholder="${t("unset")}"></div>
          <div class="pw-field"><label>Height (${t("optional")})</label><input data-height type="number" min="1" placeholder="${t("unset")}"></div>
        </div>
        <div class="pw-status" data-status>${t("notSaved")}</div>
        <div class="pw-actions">
          <button class="pw-btn danger" data-delete disabled>${t("delete")}</button>
          <div>
            <button class="pw-btn" data-load disabled>${t("load")}</button>
            <button class="pw-btn primary" data-save>${t("save")}</button>
          </div>
        </div>
      </main>
    </section>`;
  document.body.append(root);

  const query = (selector) => root.querySelector(selector);
  const fields = ["title", "group", "prompt", "width", "height"];

  function readDraft() {
    const draft = { id: editingId || makeId() };
    for (const field of fields) {
      const value = query(`[data-${field}]`).value.trim();
      draft[field] = (field === "width" || field === "height") ? (value || null) : value;
    }
    return draft;
  }

  function writeDraft(draft) {
    for (const field of fields) query(`[data-${field}]`).value = draft[field] ?? "";
  }

  function renderGroups() {
    const groups = [...new Set(entries.map((entry) => entry.group).filter(Boolean))].sort();
    const search = query("[data-group]").value.trim().toLocaleLowerCase();
    const matchingGroups = groups.filter((group) => !search || group.toLocaleLowerCase().includes(search));
    query("[data-groups]").innerHTML = matchingGroups.length
      ? matchingGroups.map((group) => `<button class="pw-group-option" type="button" role="option" data-group-option="${escapeHtml(group)}">${escapeHtml(group)}</button>`).join("")
      : `<div class="pw-group-empty">${t("noGroupMatch")}</div>`;
    if (filterGroup !== t("allGroups") && !groups.includes(filterGroup)) filterGroup = t("allGroups");
    query("[data-filter]").innerHTML = [t("allGroups"), ...groups]
      .map((group) => `<option value="${escapeHtml(group)}" ${group === filterGroup ? "selected" : ""}>${escapeHtml(group)}</option>`)
      .join("");
  }

  function renderList() {
    renderGroups();
    const visibleEntries = filterGroup === t("allGroups")
      ? entries
      : entries.filter((entry) => entry.group === filterGroup);
    query("[data-list]").innerHTML = visibleEntries.length
      ? visibleEntries.map((entry) => `
          <div class="pw-entry ${entry.id === editingId ? "active" : ""}">
            <button class="pw-entry-main" data-select-id="${escapeHtml(entry.id)}">${escapeHtml(entry.title)}<small>${escapeHtml(entry.group)}</small></button>
          </div>`).join("")
      : `<div class="pw-empty">${t("noEntries")}</div>`;
  }

  function beginNew() {
    editingId = null;
    writeDraft(EMPTY_DRAFT());
    query("[data-editor-title]").textContent = t("newPrompt");
    query("[data-mode]").textContent = t("draft");
    query("[data-mode]").classList.add("unsaved");
    query("[data-delete]").disabled = true;
    query("[data-load]").disabled = true;
    query("[data-status]").textContent = t("notSaved");
    renderList();
    query("[data-title]").focus();
  }

  function beginEdit(entry) {
    editingId = entry.id;
    writeDraft({ ...entry });
    query("[data-editor-title]").textContent = t("editPrompt");
    query("[data-mode]").textContent = t("saved");
    query("[data-mode]").classList.remove("unsaved");
    query("[data-delete]").disabled = false;
    query("[data-load]").disabled = false;
    query("[data-status]").textContent = t("selectedHint");
    renderList();
  }

  function loadIntoNode(entry) {
    widget(node, "prompt").value = entry.prompt;
    widget(node, "width").value = entry.width ? String(entry.width) : "";
    widget(node, "height").value = entry.height ? String(entry.height) : "";
    const groupWidget = widget(node, "random_group");
    if (groupWidget?.options && !groupWidget.options.values.includes(entry.group)) {
      groupWidget.options.values.push(entry.group);
    }
    groupWidget.value = entry.group;
    node.setDirtyCanvas(true, true);
    query("[data-status]").textContent = t("loadedNode", { title: entry.title });
  }

  async function persist(nextEntries, successMessage) {
    const status = query("[data-status]");
    status.textContent = t("saving");
    try {
      const saveResponse = await api.fetchApi("/prompt-warehouse/prompts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: nextEntries }),
      });
      const body = await saveResponse.json();
      if (!saveResponse.ok) {
        status.textContent = body.error || t("saveInvalid");
        return false;
      }
      entries = body.entries;
      const groupWidget = widget(node, "random_group");
      if (groupWidget?.options) {
        groupWidget.options.values = ["全部", ...new Set(entries.map((entry) => entry.group).sort())];
      }
      beginNew();
      status.textContent = successMessage;
      return true;
    } catch (error) {
      status.textContent = t("saveConnectionFailed", { error: error.message || "ComfyUI backend unavailable" });
      return false;
    }
  }

  query("[data-list]").onclick = (event) => {
    const selectButton = event.target.closest("[data-select-id]");
    if (selectButton) {
      const entry = entries.find((item) => item.id === selectButton.dataset.selectId);
      if (entry) beginEdit(entry);
    }
  };

  query("[data-filter]").onchange = (event) => {
    filterGroup = event.target.value;
    renderList();
  };

  for (const field of fields) {
    query(`[data-${field}]`).addEventListener("input", () => {
      if (!editingId) return;
      query("[data-mode]").textContent = t("unsaved");
      query("[data-mode]").classList.add("unsaved");
      query("[data-status]").textContent = t("draftChanged");
    });
  }

  function setGroupMenu(open) {
    query("[data-groups]").hidden = !open;
    query("[data-group]").setAttribute("aria-expanded", String(open));
    if (open) renderGroups();
  }

  query("[data-group]").onfocus = () => setGroupMenu(true);
  query("[data-group]").oninput = () => setGroupMenu(true);
  query("[data-group]").onkeydown = (event) => {
    if (event.key === "Escape") setGroupMenu(false);
  };
  query("[data-group-toggle]").onclick = () => setGroupMenu(query("[data-groups]").hidden);
  query("[data-groups]").onclick = (event) => {
    const option = event.target.closest("[data-group-option]");
    if (!option) return;
    query("[data-group]").value = option.dataset.groupOption;
    query("[data-group]").focus();
    setGroupMenu(false);
  };
  root.addEventListener("pointerdown", (event) => {
    if (!event.target.closest("[data-group-combo]")) setGroupMenu(false);
  });

  query("[data-save]").onclick = async () => {
    const draft = readDraft();
    const nextEntries = editingId
      ? entries.map((entry) => entry.id === editingId ? draft : entry)
      : [...entries, draft];
    await persist(nextEntries, editingId ? t("editSaved") : t("newSaved"));
  };
  query("[data-new]").onclick = beginNew;
  query("[data-load]").onclick = () => {
    if (!editingId) return;
    loadIntoNode(readDraft());
  };
  query("[data-delete]").onclick = async () => {
    if (!editingId) return;
    const entry = entries.find((item) => item.id === editingId);
    if (!entry || !confirm(t("deletePromptQuestion", { title: entry.title }))) return;
    await persist(entries.filter((item) => item.id !== editingId), t("promptDeleted"));
  };

  const close = () => root.remove();
  query("[data-close]").onclick = close;
  root.onclick = (event) => { if (event.target === root) close(); };
  root.onkeydown = (event) => { if (event.key === "Escape") close(); };
  beginNew();
}

app.registerExtension({
  name: "D33MO.PromptWarehouse",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments);
      const randomIndex = this.widgets?.findIndex((item) => item.name === "random_group") ?? -1;
      if (randomIndex >= 0) {
        this.widgets.splice(randomIndex, 0, {
          name: "warehouse_divider", type: "pw-divider", value: null,
          options: { serialize: false },
          computeSize(width) { return [width, 14]; },
          draw(context, _node, width, y, height) {
            context.save(); context.strokeStyle = "#485364"; context.globalAlpha = 0.7;
            context.beginPath(); context.moveTo(12, y + height / 2); context.lineTo(width - 12, y + height / 2);
            context.stroke(); context.restore();
          },
        });
      }
      this.addWidget("button", t("openWarehouse"), null, () => openWarehouse(this));
      this.size = [Math.max(this.size[0], 360), Math.max(this.size[1], 445)];
      return result;
    };
    const executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      executed?.apply(this, arguments);
      const entry = message?.selected?.[0];
      if (!entry) return;
      widget(this, "prompt").value = entry.prompt;
      widget(this, "width").value = entry.width ? String(entry.width) : "";
      widget(this, "height").value = entry.height ? String(entry.height) : "";
      this.setDirtyCanvas(true, true);
    };
  },
});
