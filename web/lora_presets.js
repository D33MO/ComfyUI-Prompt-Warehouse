import { api } from "../../scripts/api.js";
import { t } from "./i18n.js";

const endpoint = "/prompt-warehouse/lora-presets";
const copy = (rows) => JSON.parse(JSON.stringify(rows));
const enabledRows = (rows) => copy(rows.filter((row) => row.enabled ?? true));

async function request(payload) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const options = payload ? {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Prompt-Warehouse-Token":
        (await (await api.fetchApi("/prompt-warehouse/session")).json()).token },
      body: JSON.stringify(payload),
    } : undefined;
    const response = await api.fetchApi(endpoint, options);
    const body = await response.json();
    if (payload && response.status === 403 && body.code === "token" && attempt === 0) continue;
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }
}

export async function openLoraPresets(node, readRows, applyRows) {
  let data;
  try { data = await request(); }
  catch (error) { alert(t("presetFailed", { error: error.message })); return; }
  if (!document.getElementById("pw-preset-style")) {
    const style = document.createElement("style");
    style.id = "pw-preset-style";
    style.textContent = `
      .pw-presets{position:fixed;inset:0;z-index:10010;display:grid;place-items:center;background:#080c12b8;padding:20px;font:13px system-ui,sans-serif;color:#e8edf5}
      .pw-presets *{box-sizing:border-box}.pw-presets section{width:min(860px,96vw);max-height:90vh;overflow:auto;background:#151a22;border:1px solid #343d4c;border-radius:12px;box-shadow:0 24px 70px #0009;padding:20px}
      .pw-presets header,.pw-presets footer{display:flex;align-items:center;justify-content:space-between;gap:10px}.pw-presets h2{font-size:18px;margin:0}.pw-presets p{color:#9aa8ba;line-height:1.5}
      .pw-presets-heading{display:flex;align-items:center;gap:10px}.pw-presets [data-mode]{padding:3px 7px;border-radius:99px;background:#263448;color:#a9c6e8;font-size:11px}.pw-presets [data-mode].unsaved{background:#743b20;color:#ffd09e;box-shadow:0 0 0 1px #b76836}
      .pw-presets button,.pw-presets input,.pw-presets select{font:inherit;border:1px solid #3a4555;border-radius:6px;padding:8px 10px;background:#222b37;color:#edf3fa}.pw-presets button{cursor:pointer}.pw-presets button:disabled{opacity:.45;cursor:default}.pw-presets :focus-visible{outline:2px solid #7aa2d8;outline-offset:2px}
      .pw-presets table{table-layout:fixed}.pw-presets th:nth-child(2){width:110px}.pw-presets th:last-child{width:38px}.pw-presets td select,.pw-presets td input{width:100%;min-width:0;background:#0f141b}.pw-presets input[aria-invalid=true]{border-color:#ef9b8e}.pw-presets [data-remove-lora]{padding:4px 7px;background:transparent;border-color:transparent;color:#ffb8b2;font-size:20px;line-height:1}.pw-presets [data-remove-lora]:hover{background:#743b2033}
      .pw-presets-row-actions{display:flex;flex-wrap:wrap;gap:8px}
      .pw-presets-layout{display:grid;grid-template-columns:240px 1fr;gap:20px;margin:16px 0}.pw-presets aside{border-right:1px solid #343d4c;padding-right:18px}.pw-presets aside input{width:100%;margin:8px 0;background:#0f141b}.pw-presets-list{max-height:360px;overflow:auto}.pw-presets-list button{display:block;width:100%;text-align:left;margin:4px 0;background:transparent}.pw-presets-list button[aria-pressed=true]{background:#263448;border-color:#7aa2d8}.pw-presets small{display:block;color:#9aa8ba;margin-top:4px}
      .pw-presets label{display:block;color:#9aa8ba;margin-bottom:12px}.pw-presets label input{display:block;width:100%;margin-top:5px;background:#0f141b}.pw-presets table{width:100%;border-collapse:collapse;margin:10px 0 18px}.pw-presets td,.pw-presets th{text-align:left;padding:8px 5px;border-bottom:1px solid #303846}.pw-presets th{color:#9aa8ba;font-weight:400}.pw-presets td:first-child{overflow-wrap:anywhere}.pw-presets td:nth-child(2){font-family:monospace}.pw-presets tr[data-disabled]{opacity:.5}.pw-presets .pw-missing{color:#ef9b8e}.pw-presets footer div{display:flex;gap:8px}.pw-presets [data-save]{background:#4778ad}.pw-presets [data-status]{min-height:20px}.pw-presets [data-delete]{color:#ffb8b2}
      @media(max-width:650px){.pw-presets-layout{grid-template-columns:1fr}.pw-presets aside{border-right:0;border-bottom:1px solid #343d4c;padding:0 0 12px}.pw-presets-list{max-height:130px}}
    `;
    document.head.append(style);
  }
  const previousFocus = document.activeElement;
  const root = document.createElement("div");
  root.className = "pw-presets";
  root.innerHTML = `<section role="dialog" aria-modal="true" aria-label="${t("loraPresets")}">
    <header><h2>${t("loraPresets")}</h2><button data-close>${t("close")}</button></header>
    <p>${t("presetHint")}</p>
    <div class="pw-presets-layout"><aside><button data-new>${t("newPreset")}</button>
      <input data-search aria-label="${t("searchPresets")}" placeholder="${t("searchPresets")}"><div class="pw-presets-list" data-list></div></aside>
      <main><div class="pw-presets-heading"><h2 data-editor-title>${t("newLoraPreset")}</h2><span data-mode role="status" aria-live="polite"></span></div>
      <label>${t("title")}<input data-title></label>
      <div class="pw-presets-row-actions"><button data-capture>${t("captureLoras")}</button><button data-add-lora>${t("addLora")}</button></div><div data-rows></div>
      <p data-status role="status" aria-live="polite"></p>
      <footer><button data-delete>${t("delete")}</button><div><button data-load>${t("load")}</button><button data-save>${t("save")}</button></div></footer>
      </main></div></section>`;
  document.body.append(root);
  const q = (name) => root.querySelector(`[data-${name}]`);
  let entries = data.entries;
  let id = null;
  let rows = enabledRows(readRows());
  let busy = false;
  let savedDraft = null;
  const draftSignature = () => JSON.stringify({ title: q("title").value.trim(), loras: rows });
  function renderMode() {
    const changed = !id || savedDraft !== draftSignature();
    q("editor-title").textContent = t(id ? "editLoraPreset" : "newLoraPreset");
    q("mode").textContent = t(busy ? "saving" : !id ? "draft" : changed ? "unsaved" : "saved");
    q("mode").classList.toggle("unsaved", changed);
  }
  const available = new Set(data.lora_names);
  const missing = () => rows.filter((row) => Number(row.strength) !== 0 && !available.has(row.name));
  const invalidStrength = () => rows.some((row) => typeof row.strength !== "number" || !Number.isFinite(row.strength));
  const status = (message) => { q("status").textContent = message; };
  function controls() {
    q("delete").disabled = busy || !id;
    q("save").disabled = busy || !rows.length || invalidStrength();
    q("load").disabled = busy || !rows.length || invalidStrength() || !!missing().length;
    for (const button of root.querySelectorAll("[data-new],[data-capture],[data-list] button")) button.disabled = busy;
    q("add-lora").disabled = busy || !available.size;
    q("add-lora").title = available.size ? "" : t("noLora");
    q("title").disabled = busy;
    for (const field of root.querySelectorAll("[data-rows] select,[data-rows] input")) field.disabled = busy;
    for (const button of root.querySelectorAll("[data-remove-lora]")) button.disabled = busy;
    renderMode();
  }
  function renderRows() {
    const table = document.createElement("table");
    const head = table.createTHead().insertRow();
    for (const label of [t("selectLora"), t("strength")]) {
      const th = document.createElement("th"); th.textContent = label; head.append(th);
    }
    const actionHeader = document.createElement("th");
    actionHeader.setAttribute("aria-label", t("remove"));
    head.append(actionHeader);
    const body = table.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      const absent = !available.has(row.name);
      const select = document.createElement("select");
      select.setAttribute("aria-label", `${t("selectLora")} ${body.rows.length}`);
      for (const name of absent ? [row.name, ...available] : available) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = available.has(name) ? name : `${name || t("selectLora")} (${t("missingLora")})`;
        select.append(option);
      }
      select.value = row.name;
      select.classList.toggle("pw-missing", absent);
      select.onchange = () => {
        row.name = select.value;
        select.classList.toggle("pw-missing", !available.has(row.name));
        status(t(missing().length ? "missingLoraHint" : "presetDraft"));
        controls();
      };
      tr.insertCell().append(select);
      const input = document.createElement("input");
      input.type = "number";
      input.step = "any";
      input.inputMode = "decimal";
      input.value = row.strength ?? "";
      input.setAttribute("aria-label", `${t("strength")} ${body.rows.length}`);
      input.oninput = () => {
        const valid = input.value.trim() !== "" && Number.isFinite(input.valueAsNumber);
        row.strength = valid ? input.valueAsNumber : null;
        input.setAttribute("aria-invalid", String(!valid));
        status(t(!valid ? "invalidNumber" : missing().length ? "missingLoraHint" : "presetDraft"));
        controls();
      };
      tr.insertCell().append(input);
      const remove = document.createElement("button");
      remove.textContent = "×";
      remove.dataset.removeLora = "";
      remove.setAttribute("aria-label", `${t("remove")} ${row.name}`);
      remove.title = t("remove");
      remove.onclick = () => {
        if (busy) return;
        const index = rows.indexOf(row);
        rows.splice(index, 1);
        status(t("presetDraft")); renderRows();
        const remaining = q("rows").querySelectorAll("[data-remove-lora]");
        (remaining[Math.min(index, remaining.length - 1)] || q("add-lora")).focus();
      };
      tr.insertCell().append(remove);
    }
    q("rows").replaceChildren(table);
    if (missing().length) status(t("missingLoraHint"));
    controls();
  }
  function renderList() {
    const search = q("search").value.toLocaleLowerCase();
    const filtered = entries.filter((entry) => entry.title.toLocaleLowerCase().includes(search));
    q("list").replaceChildren();
    for (const entry of filtered) {
      const button = document.createElement("button");
      button.textContent = entry.title;
      button.setAttribute("aria-pressed", String(entry.id === id));
      const detail = document.createElement("small");
      detail.textContent = `${entry.loras.filter((row) => row.enabled ?? true).length} LoRA`;
      button.append(detail);
      button.onclick = () => {
        id = entry.id; rows = enabledRows(entry.loras);
        q("title").value = entry.title;
        savedDraft = draftSignature();
        status(t("presetSelected")); renderRows(); renderList();
      };
      q("list").append(button);
    }
    if (!filtered.length) q("list").textContent = t("noPresets");
    controls();
  }
  const close = () => { if (!busy) { root.remove(); previousFocus?.focus?.(); } };
  q("close").onclick = close;
  root.onclick = (event) => { if (event.target === root) close(); };
  root.onkeydown = (event) => {
    event.stopPropagation();
    if (event.key === "Escape") close();
    if (event.key === "Tab") {
      const fields = [...root.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled)")];
      const first = fields[0], last = fields.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  };
  q("new").onclick = () => {
    id = null; savedDraft = null; rows = enabledRows(readRows()); q("title").value = "";
    status(t("presetDraft")); renderRows(); renderList(); q("title").focus();
  };
  q("capture").onclick = () => { rows = enabledRows(readRows()); status(t("presetDraft")); renderRows(); };
  q("add-lora").onclick = () => {
    if (busy || !available.size) return;
    rows.push({ name: available.values().next().value, strength: 1, enabled: true });
    status(t("presetDraft")); renderRows();
    q("rows").querySelector("tbody tr:last-child select")?.focus();
  };
  q("search").oninput = renderList;
  q("title").oninput = () => { status(t("presetDraft")); renderMode(); };
  q("load").onclick = () => {
    if (!node.graph) { status(t("presetNodeRemoved")); return; }
    applyRows(copy(rows)); close();
  };
  async function persist(payload) {
    busy = true; controls(); status(t("saving"));
    try { entries = (await request(payload)).entries; return true; }
    catch (error) { status(t("presetFailed", { error: error.message })); return false; }
    finally { busy = false; renderList(); }
  }
  q("save").onclick = async () => {
    if (!q("title").value.trim()) { q("title").focus(); status(t("presetTitleRequired")); return; }
    const nextId = id || globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
    if (await persist({ action: "save", preset: { id: nextId, title: q("title").value, loras: rows } })) {
      id = nextId; savedDraft = draftSignature(); renderList(); status(t("presetSaved"));
    }
  };
  q("delete").onclick = async () => {
    if (!confirm(t("deletePresetQuestion", { title: entries.find((entry) => entry.id === id)?.title }))) return;
    if (await persist({ action: "delete", id })) { q("new").click(); status(t("presetDeleted")); }
  };
  status(t("presetDraft")); renderRows(); renderList();
  requestAnimationFrame(() => q("title").focus());
}
