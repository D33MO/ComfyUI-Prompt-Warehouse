import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "PromptWarehouseSaveImageWithDelete";

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
  const button = node.addWidget("button", withCount("删除最近输出", count), null, () => {
    showDeleteConfirm(node);
  });
  button.options = { ...(button.options || {}), serialize: false };
  node._pwDeleteButton = button;
  node.setSize([node.size[0], Math.max(node.size[1], node.computeSize()[1])]);
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
  const targetText = count > 1 ? `最近输出的 ${count} 张图片` : "最近输出的图片";
  const root = document.createElement("div");
  root.className = "pw-image-delete-backdrop";
  root.innerHTML = `<div class="pw-image-delete-dialog" role="dialog" aria-modal="true">
    <strong>确认永久删除？</strong>
    <p>将从 ComfyUI output 目录删除${targetText}的源文件，此操作无法撤销。</p>
    <div class="pw-image-delete-actions"><button data-cancel>取消</button><button data-confirm>删除</button></div>
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
  button.name = "正在删除…";
  node.setDirtyCanvas(true, true);
  try {
    const response = await api.fetchApi("/prompt-warehouse/delete-output-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "删除失败");
    node._pwSavedImages = [];
    node.imgs = [];
    button.name = result.missing?.length ? "文件已不存在" : `已删除 ${result.deleted.length} 张图片`;
  } catch (error) {
    button.name = `删除失败：${error.message}`;
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
      // ComfyUI lays out the preview after onExecuted returns. Creating the
      // control on the next frame places it below the finished image preview.
      requestAnimationFrame(() => {
        if (this._pwOutputVersion === outputVersion && this._pwSavedImages.length) {
          addDeleteButton(this);
          this.setDirtyCanvas(true, true);
        }
      });
      this.setDirtyCanvas(true, true);
      return result;
    };
  },
});
