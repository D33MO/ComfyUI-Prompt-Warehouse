import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_NAME = "PromptWarehouseSaveImageWithDelete";

function hideInlineConfirm(node) {
  const confirmButton = node._pwConfirmDeleteButton;
  if (!confirmButton) return;
  const index = node.widgets?.indexOf(confirmButton) ?? -1;
  if (index >= 0) node.widgets.splice(index, 1);
  node._pwConfirmDeleteButton = null;
  const count = node._pwSavedImages?.length || 0;
  if (node._pwDeleteButton) {
    node._pwDeleteButton.name = count ? `删除最近输出 (${count})` : "暂无可删除图片";
  }
  node.setDirtyCanvas(true, true);
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
      const button = this.addWidget("button", "暂无可删除图片", null, () => {
        showInlineConfirm(this);
      });
      button.options = { ...(button.options || {}), serialize: false };
      this._pwDeleteButton = button;
      return result;
    };

    const executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      const result = executed?.apply(this, arguments);
      hideInlineConfirm(this);
      this._pwSavedImages = (message?.images || []).filter((image) => image?.type === "output");
      if (this._pwDeleteButton) {
        const count = this._pwSavedImages.length;
        this._pwDeleteButton.name = count ? `删除最近输出 (${count})` : "暂无可删除图片";
      }
      this.setDirtyCanvas(true, true);
      return result;
    };
  },
});
