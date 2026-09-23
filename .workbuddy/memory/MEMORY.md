# ComfyUI-Prompt-Warehouse — 长期备注

- 发布、版本号、评审约束一律以仓库根的 `AGENTS.md` 为准。版本号三处必须同步：
  `__init__.py` 用裸 `X.Y.Z`，`README.md` / `README.zh-CN.md` 用 `` `vX.Y.Z` ``。
- 跑测试：`test_routes.py` / `test_backup.py` / `test_lora_meta.py` 用任意 python 即可；
  `test_save_metadata.py` 需要 PIL + numpy + torch，必须用 `D:\ComfyUI-aki-v3\python\python.exe`。
- 删除接口的安全模型（自定义头 + 进程内令牌 + realpath/commonpath 收敛）记在
  `AGENTS.md` §4 item 7；动 `routes.py` 的删除路径或 `web/save_image_with_delete.js` 之前先读那一节。
- 评审方是 ComfyUI-Manager 维护者，PR #3180 仍开着：源码改动不会通知到他，修完要主动回评论。
