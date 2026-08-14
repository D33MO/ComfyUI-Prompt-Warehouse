# ComfyUI Prompt Warehouse

用于整理、复用和随机抽取提示词的 ComfyUI 自定义节点。每条记录包含标题、分组、多行提示词，以及可选的 width / height。

## 功能

- 在仓库弹窗中新增、编辑、删除提示词
- 自定义分组，并按分组与 seed 随机抽取
- 将整条记录载入节点，提示词和尺寸保持配套
- 输出 `prompt`、`width`、`height`
- 未设置尺寸时输出 `0`，便于下游自行决定默认值
- 数据保存在插件目录的 `data/prompts.json`

## 安装

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/D33MO/ComfyUI-Prompt-Warehouse.git
```

重启 ComfyUI 并刷新页面。插件没有第三方 Python 依赖。

## 使用

在 `Prompt Warehouse` 分类中添加 **Prompt Warehouse / 提示词仓库**。点击“打开仓库”整理记录；“载入节点”会同步提示词和可选尺寸。开启 Random 后，执行时从 `random_group` 分组抽取，填写“全部”则从所有记录抽取。
