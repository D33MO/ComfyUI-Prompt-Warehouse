import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { t } from "./i18n.js";

const NODE_NAME = "PromptWarehouseSaveImageWithDelete";
const DELETE_PATH = "/prompt-warehouse/delete-output-images";
const SESSION_PATH = "/prompt-warehouse/session";
const TOKEN_HEADER = "X-Prompt-Warehouse-Token";

// The server refuses a delete that does not carry a session token in a custom
// header. A page from another site cannot set that header — browsers require a
// pre-flight for custom headers and ComfyUI does not allow it — and cannot read
// the token either, so the delete stays an action only this UI can trigger.
// The token is regenerated every time ComfyUI starts, hence the single
// refetch-and-retry in `sendDelete`.
let sessionToken = null;

async function deleteToken(refresh = false) {
  if (sessionToken && !refresh) return sessionToken;
  const response = await api.fetchApi(SESSION_PATH);
  const payload = response.ok ? await response.json() : null;
  sessionToken = String(payload?.token || "");
  if (!sessionToken) throw new Error(t("deleteFailed"));
  return sessionToken;
}

async function sendDelete(images) {
  const send = (token) => api.fetchApi(DELETE_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json", [TOKEN_HEADER]: token },
    body: JSON.stringify({ images }),
  });
  const read = async (response) => {
    const payload = await response.json().catch(() => null);
    return { response, payload };
  };
  const first = await read(await send(await deleteToken()));
  if (first.response.status !== 403 || first.payload?.code !== "token") return first;
  // Stale token (ComfyUI restarted under us): fetch a fresh one, retry once.
  sessionToken = null;
  return read(await send(await deleteToken(true)));
}

function withCount(label, count) {
  return count > 1 ? `${label} (${count})` : label;
}

function removeWidget(node, widget) {
  if (!widget) return;
  const index = node.widgets?.indexOf(widget) ?? -1;
  if (index >= 0) node.widgets.splice(index, 1);
}

function addDeleteButton(node) {
  removeWidget(node, node._pwDeleteButton);
  const count = node._pwSavedImages?.length || 0;
  const button = node.addWidget("button", withCount(t("deleteRecent"), count), null, () => {
    showDeleteConfirm(node);
  });
  button.options = { ...(button.options || {}), serialize: false };
  node._pwDeleteButton = button;
  node.setSize([node.size[0], Math.max(node.size[1], node.computeSize()[1])]);
}

function previewMatchesOutput(node, images) {
  const filenames = new Set(images.map((image) => String(image.filename || "")));
  return Boolean(node.imgs?.some((image) => {
    let source = String(image?.src || "");
    try { source = decodeURIComponent(source); } catch (_) { /* Keep the raw URL. */ }
    return [...filenames].some((filename) => filename && source.includes(filename));
  }));
}

function addDeleteButtonAfterPreview(node, images, outputVersion, attempt = 0) {
  if (node._pwOutputVersion !== outputVersion || !images.length) return;
  if (previewMatchesOutput(node, images) || attempt >= 300) {
    // Wait one additional frame after the matching image appears so ComfyUI has
    // committed its preview layout before this widget is appended.
    requestAnimationFrame(() => {
      if (node._pwOutputVersion !== outputVersion) return;
      addDeleteButton(node);
      node.setDirtyCanvas(true, true);
    });
    return;
  }
  requestAnimationFrame(() => addDeleteButtonAfterPreview(node, images, outputVersion, attempt + 1));
}

function showDeleteConfirm(node) {
  const count = node._pwSavedImages?.length || 0;
  if (!count) return;
  if (!document.getElementById("pw-image-delete-style")) {
    const style = document.createElement("style");
    style.id = "pw-image-delete-style";
    style.textContent = `
      .pw-image-delete-backdrop{position:fixed;inset:0;z-index:10020;display:grid;place-items:center;background:#05070a99;font-family:Inter,system-ui,sans-serif}
      .pw-image-delete-dialog{width:330px;padding:19px;background:#202329;color:#edf0f5;border:1px solid #555d69;border-radius:11px;box-shadow:0 20px 60px #000a}
      .pw-image-delete-dialog strong{display:block;margin-bottom:8px;font-size:16px}.pw-image-delete-dialog p{margin:0;color:#adb6c3;font-size:13px;line-height:1.55}
      .pw-image-delete-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:17px}.pw-image-delete-actions button{padding:7px 14px;color:#e7ebf1;background:#353a43;border:1px solid #59616e;border-radius:6px;cursor:pointer}
      .pw-image-delete-actions button[data-confirm]{color:#fff;background:#a84545;border-color:#c25c5c}
    `;
    document.head.append(style);
  }
  const targetText = count > 1 ? t("deleteManyTarget", { count }) : t("deleteOneTarget");
  const root = document.createElement("div");
  root.className = "pw-image-delete-backdrop";
  root.innerHTML = `<div class="pw-image-delete-dialog" role="dialog" aria-modal="true">
    <strong>${t("deleteTitle")}</strong>
    <p>${t("deleteMessage", { target: targetText })}</p>
    <div class="pw-image-delete-actions"><button data-cancel>${t("cancel")}</button><button data-confirm>${t("delete")}</button></div>
  </div>`;
  document.body.append(root);
  const close = () => root.remove();
  root.querySelector("[data-cancel]").onclick = close;
  root.querySelector("[data-confirm]").onclick = () => {
    close();
    deleteLastOutput(node, node._pwDeleteButton);
  };
  root.onclick = (event) => { if (event.target === root) close(); };
  root.onkeydown = (event) => { if (event.key === "Escape") close(); };
}

async function deleteLastOutput(node, button) {
  const images = node._pwSavedImages || [];
  if (!images.length) return;
  button.name = t("deleting");
  node.setDirtyCanvas(true, true);
  try {
    const { response, payload } = await sendDelete(images);
    if (!response.ok) throw new Error(payload?.error || t("deleteFailed"));
    node._pwSavedImages = [];
    node.imgs = [];
    removeWidget(node, button);
    node._pwDeleteButton = null;
  } catch (error) {
    button.name = `${t("deleteFailed")}: ${error.message}`;
  }
  node.setDirtyCanvas(true, true);
}

app.registerExtension({
  name: "D33MO.SaveImageWithDelete",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_NAME) return;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments);
      this._pwDeleteButton = null;
      return result;
    };

    const executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const result = executed?.apply(this, arguments);
      removeWidget(this, this._pwDeleteButton);
      this._pwDeleteButton = null;
      this._pwSavedImages = (message?.images || []).filter((image) => image?.type === "output");
      const outputVersion = this._pwOutputVersion = (this._pwOutputVersion || 0) + 1;
      addDeleteButtonAfterPreview(this, this._pwSavedImages, outputVersion);
      this.setDirtyCanvas(true, true);
      return result;
    };
  },
});
