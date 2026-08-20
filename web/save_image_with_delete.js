import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "PromptWarehouseSaveImageWithDelete";

function removeWidget(node, widget) {
  if (!widget) return;
  const index = node.widgets?.indexOf(widget) ?? -1;
  if (index >= 0) node.widgets.splice(index, 1);
}

function hideInlineConfirm(node) {
  const confirmButton = node._pwConfirmDeleteButton;
  if (!confirmButton) return;
  removeWidget(node, confirmButton);
  node._pwConfirmDeleteButton = null;
  const count = node._pwSavedImages?.length || 0;
  if (node._pwDeleteButton) {
    node._pwDeleteButton.name = count ? `删除最近输出 (${count})` : "暂无可删除图片";
  }
  node.setDirtyCanvas(true, true);
}

function addDeleteButton(node) {
  removeWidget(node, node._pwDeleteButton);
  const count = node._pwSavedImages?.length || 0;
  const button = node.addWidget("button", `删除最近输出 (${count})`, null, () => {
    showInlineConfirm(node);
  });
  button.options = { ...(button.options || {}), serialize: false };
  node._pwDeleteButton = button;
  node.setSize([node.size[0], Math.max(node.size[1], node.computeSize()[1])]);
}

function showInlineConfirm(node) {
  if (node._pwConfirmDeleteButton) {
    hideInlineConfirm(node);
    return;
  }
  const count = node._pwSavedImages?.length || 0;
  if (!count) return;
  node._pwDeleteButton.name = "取消删除";
  const confirmButton = node.addWidget(
    "button",
    `⚠ 确认永久删除 (${count})`,
    null,
    () => deleteLastOutput(node, node._pwDeleteButton),
  );
  confirmButton.options = { ...(confirmButton.options || {}), serialize: false };
  node._pwConfirmDeleteButton = confirmButton;
  node.setSize([node.size[0], Math.max(node.size[1], node.computeSize()[1])]);
  node.setDirtyCanvas(true, true);
}

async function deleteLastOutput(node, button) {
  const images = node._pwSavedImages || [];
  if (!images.length) return;
  hideInlineConfirm(node);
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
      this._pwConfirmDeleteButton = null;
      return result;
    };

    const executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const result = executed?.apply(this, arguments);
      hideInlineConfirm(this);
      removeWidget(this, this._pwDeleteButton);
      this._pwDeleteButton = null;
      this._pwSavedImages = (message?.images || []).filter((image) => image?.type === "output");
      if (this._pwSavedImages.length) addDeleteButton(this);
      this.setDirtyCanvas(true, true);
      return result;
    };
  },
});
