# ComfyUI Prompt Warehouse

[![English](https://img.shields.io/badge/README-English-2f81f7?style=for-the-badge)](README.md)
[![简体中文](https://img.shields.io/badge/README-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-e34c26?style=for-the-badge)](README.zh-CN.md)

当前版本：`v0.4.2`

一个用于整理、复用和随机抽取提示词的 ComfyUI 自定义节点包，同时提供单行/多行提示词节点和支持工作流持久化的多 LoRA 加载器。

## 功能

- 新增、编辑、删除提示词记录
- 自定义分组，并在左侧列表按分组筛选
- 分组输入支持已有候选，也可以直接创建新分组
- 按指定分组或全部记录随机抽取
- 随机抽取时，Prompt、Width 和 Height 保持配套
- 通过左侧 `prompt_in` 接口拼接上游提示词
- 可选接收 `clip` 输入，并输出 `prompt`、`width`、`height`、`conditioning`
- 数据持久化保存在插件目录的 `data/prompts.json`
- 每次保存自动备份到用户“文档”目录，主文件丢失、为空或损坏时自动恢复
- 实际仓库数据不受 Git 管理，更新插件不会覆盖该文件
- 提供 `Prompt Line / 单行提示词` 节点，用单行输入框直接输出提示词
- 提供 `Prompt Multiline / 多行提示词` 节点，用多行输入框编辑并输出提示词
- 提供 `Multi LoRA Loader / 多 LoRA 加载器`，可按顺序加载任意多个 LoRA
- 每个 LoRA 可独立启停，以紧凑单行界面调整统一强度
- LoRA 列表及 `Add LoRA` 按钮在工作流重载或重启 ComfyUI 后会自动恢复
- 提供 `Save Image with Delete / 可删除图片保存`，保存预览后可删除 output 中的对应源文件
- 保存的 PNG 会附带 CivitAI 可识别的 checkpoint 与 LoRA 哈希，上传后自动关联对应资源，且不会写入提示词内容与 LoRA 强度
- 默认英文界面；将 ComfyUI 的 `Comfy → Locale` 设置为简体中文后界面一并切换；不会根据浏览器语言自动切换

## 安装

进入 ComfyUI 的自定义节点目录并克隆仓库：

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/D33MO/ComfyUI-Prompt-Warehouse.git
```

重启 ComfyUI，然后刷新浏览器页面。插件没有第三方 Python 依赖。

## 使用

在节点菜单的 `Prompt Warehouse` 分类中添加 **Prompt Warehouse / 提示词仓库**。

如需一个简单的单行提示词节点，可在同一分类中添加 **Prompt Line / 单行提示词**。节点会将左侧 `prompt_in` 接口传入的上游提示词与内部单行 `prompt` 输入框内容用 `, ` 拼接后输出，且不会覆盖输入框内容。

如需更大的编辑区域，可添加 **Prompt Multiline / 多行提示词**。它与单行节点的输入、拼接和输出逻辑完全一致，区别仅在于内部 `prompt` 使用多行输入框。

### 可删除图片保存

**Save Image with Delete / 可删除图片保存** 的保存、命名和预览行为与 ComfyUI 原生 `Save Image` 一致。节点完成输出后会记录本次保存的图片，并显示“删除最近输出”按钮；点击后会弹出二次确认框，确认后才会删除 ComfyUI `output` 目录中的对应源文件并清除节点预览。删除目标通过真实路径比较限制在 `output` 目录内，且只接受带有前端刚获取的会话令牌的请求，因此浏览器里其它无关页面无法触发删除（见 [接口安全限制](#接口安全限制)）。

保存时除了原生 `prompt` 和 `workflow` 元数据，还会额外写入 A1111 格式的 `parameters` 字段，用哈希标出这张图背后的资源：checkpoint 写入 `Model hash` / `Model`，本次执行实际使用的 LoRA 写入 `Lora hashes` 映射，后面跟上采样参数。哈希取文件 SHA256 的前 10 位，也就是 CivitAI 的 AutoV2 值——这正是 CivitAI 匹配上传图片时使用的那一种哈希，所以上传后 checkpoint 和 LoRA 都会自动识别并联上对应资源，不需要手动逐个填写。资源信息直接从执行图中读取，`Multi LoRA Loader` 的列表也能被正确识别，工作流无需额外连线。

该字段**不写入正向/负向提示词，也不写入 `<lora:名称:强度>` 标签**：提示词内容不会暴露，每个 LoRA 用了多大强度也不会被记录。也就是说上传的图片只说明「用了哪些资源」，不说明「怎么写的提示词、LoRA 调了多重」。图中既没有 checkpoint 也没有 LoRA 时才会不写该字段。

哈希结果按文件路径、大小和修改时间缓存在 `data/lora_hashes.json`，同一个模型只会计算一次；节点异常时会自动退回原生保存行为，不影响出图。

### 多 LoRA 加载器

在 `Prompt Warehouse` 分类中添加 **Multi LoRA Loader / 多 LoRA 加载器**，连接基础模型的 `MODEL` 和 `CLIP`，再点击节点底部的 `＋ Add LoRA` 添加任意数量的 LoRA。每个 LoRA 只占一行：点击左侧圆点启停，点击名称选择文件，使用 `− / +` 或点击数值调整强度；右键该行可以启停、上移、下移或删除。LoRA 会从上到下依次应用，同一强度同时作用于 MODEL 和 CLIP。

该节点的简洁单行界面和主要交互模仿并参考了 [rgthree-comfy 的 Power Lora Loader](https://github.com/rgthree/rgthree-comfy)。在此基础上，本项目采用了独立实现，并做了以下调整：

- 使用一个固定 JSON 配置保存完整 LoRA 列表，配置跟随当前工作流保存
- 重新启动 ComfyUI 或重新打开工作流后，恢复 LoRA、顺序、启停状态和 `Add LoRA` 按钮
- 使用单一强度同时作用于 MODEL 和 CLIP
- 提供自定义强度编辑弹窗，以及适配本项目的紧凑界面

### 管理仓库

1. 点击节点上的“打开仓库”。
2. 右侧默认是尚未保存的新增草稿。
3. 填写标题、分组、提示词，以及可选的 Width / Height。
4. 点击“保存”后，记录才会写入仓库。
5. 点击左侧记录后，内容会显示在右侧，可直接查看或编辑；修改内容需要再次点击“保存”才会生效。
6. 选中记录后点击“加载”，才会将右侧显示的内容载入当前节点。
7. 编辑已有记录时，可以点击左侧“＋ 新增”随时清空右侧并开始新建；草稿或已修改内容会显示醒目的未保存状态。
8. 编辑记录时点击“删除”并确认，记录会立即从仓库删除，无需再次保存。

### 随机抽取

开启 `random_enabled` 后，每次执行节点都会从 `random_group` 对应的仓库分组中重新随机抽取一条记录。选择“全部”时从所有记录中抽取。

如果一个分组中只有一条记录，随机结果始终是该记录；存在多条记录时，连续两次仍可能随机到相同内容。

### 拼接提示词

将上游字符串连接到节点左侧的 `prompt_in`。节点会把上游提示词放在前面，将当前或随机抽取的提示词放在后面，并用 `, ` 自动拼接。

Warehouse 节点输出非空提示词时，会默认在末尾补上一个英文逗号 `,`，方便继续拼接下游提示词。

### 连接 ComfyUI

- `prompt` → `CLIP Text Encode.text`
- `width` → `Empty Latent Image.width`
- `height` → `Empty Latent Image.height`
- `clip` ← 模型加载器的 `CLIP` 输出
- `conditioning` → 采样器的正面或负面条件输入

`clip` 不连接时不进行编码，原有的 `prompt`、`width` 和 `height` 输出仍可正常使用。

如果 `CLIP Text Encode` 的 `text` 仍显示为输入框，请右键该输入框并选择 **Convert widget to input**。

未填写 Width 或 Height 时，对应输出为 `0`，可由下游节点决定默认尺寸。

## 接口安全限制

插件通过 ComfyUI 自带的 HTTP 服务器暴露以下接口，它们会读写提示词仓库并删除 `output` 目录中的文件：

- `GET /prompt-warehouse/prompts`、`GET /prompt-warehouse/backup`、`GET /prompt-warehouse/session`
- `PUT /prompt-warehouse/prompts`
- `POST /prompt-warehouse/delete-output-images`

ComfyUI 的 API 本身没有鉴权，一旦用 `--listen` 启动，局域网内任何设备都能访问它。因此这些接口**只接受来自本机（回环地址）的请求**，其它来源一律返回 `403`。

但"来自本机"并不等于"是用户本人"：用户浏览器里开着的任意一个网页，发出的请求同样来自本机。所以删除接口在此基础上还要求两件事：

- **`Content-Type` 必须是 `application/json`**，否则返回 `415`。JSON 不属于 CORS 安全列表内的内容类型，跨源页面要发它就必须先过预检。
- **必须带 `X-Prompt-Warehouse-Token` 请求头**，值为 `GET /prompt-warehouse/session` 返回的令牌，否则返回 `403`。浏览器只允许在预检通过后发送自定义请求头，而 ComfyUI 的 `Access-Control-Allow-Headers` 固定为 `Content-Type, Authorization`，这个头永远不在其中，无论 ComfyUI 怎么启动。令牌本身是第二道锁：每次启动随机生成，只由 `session` 接口下发，且该接口不添加任何 CORS 头，其它来源读不到。前端按需获取令牌，若期间 ComfyUI 重启过则会静默重新获取一次并重试。

删除目标被限制在 output 目录内：每个请求文件都会用 `realpath` 解析，并必须仍位于 `realpath` 后的 output 根目录内（`commonpath` 比较）。因此绝对路径、`C:文件名` 这类带盘符的相对路径、`..` 片段、文件名中含路径分隔符、以及指向目录外的符号链接都会被拒绝；目录永远不会被删除，单次请求最多 100 个文件。没有任何方式能指向 ComfyUI `output` 目录之外的文件。

> 如果使用 nginx 等反向代理，请求在 ComfyUI 看来来自本机，该限制不会生效。请在代理层自行限制 `/prompt-warehouse/` 路径的访问。

## 数据与备份

提示词保存在 `data/prompts.json`。该文件已加入 `.gitignore`，不会进入 Git 提交；仓库中的 `data/prompts.example.json` 仅用于展示数据格式。

每次保存仓库时，插件会自动把同一份数据备份到当前用户“文档”目录下的 `ComfyUI-Prompt-Warehouse\prompts.json`：

```
C:\Users\<用户名>\Documents\ComfyUI-Prompt-Warehouse\prompts.json
```

同时在 `ComfyUI-Prompt-Warehouse\backups\` 下按时间留存快照（保留最近 20 份），方便误删或误改后回退。如果 `Documents` 被重定向到 OneDrive，会优先写入 OneDrive 下的文档目录；也可以用环境变量 `PROMPT_WAREHOUSE_BACKUP_DIR` 指定其它备份位置。

如果 `data/prompts.json` **丢失（重装、误删）、为空（默认安装生成的就是空数组 `[]`）、或内容损坏无法解析**，下次加载仓库时会自动从备份恢复并重新写回 `data/prompts.json`；只有当备份里确实有内容时才会写回，因此不会覆盖出更糟的结果。反之，如果主文件里有正常数据，则以主文件为准，不会用备份覆盖它。

注意：在界面上删光全部提示词并保存，会同时把备份写成空，之后不会被自动恢复（这是有意为之，避免删掉的内容又自己冒出来）。备份目录不可写时只会在后台忽略，不会影响保存操作。当前备份位置可通过 `GET /prompt-warehouse/backup` 或 `GET /prompt-warehouse/prompts` 返回的 `backup` 字段查看。

`backups\` 下的时间戳快照只做留存，不会被自动读取；要回退到某个历史版本，手动把它复制成 `data/prompts.json` 即可。

升级插件时，常规 `git pull` 不会覆盖实际提示词。删除或重新安装整个插件目录前，请单独备份 `data/prompts.json`。
