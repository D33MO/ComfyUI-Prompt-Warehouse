# ComfyUI-Prompt-Warehouse — 长期备注

- 发布、版本号、评审约束一律以仓库根的 `AGENTS.md` 为准。版本号三处必须同步：
  `__init__.py` 用裸 `X.Y.Z`，`README.md` / `README.zh-CN.md` 用 `` `vX.Y.Z` ``。
- 跑测试：`test_routes.py` / `test_backup.py` / `test_lora_meta.py` 用任意 python 即可；
  `test_save_metadata.py` 需要 PIL + numpy + torch，必须用 `D:\ComfyUI-aki-v3\python\python.exe`。
- 删除接口的安全模型（自定义头 + 进程内令牌 + realpath/commonpath 收敛）记在
  `AGENTS.md` §4 item 7；动 `routes.py` 的删除路径或 `web/save_image_with_delete.js` 之前先读那一节。
- 评审方是 ComfyUI-Manager 维护者，PR #3180 仍开着：源码改动不会通知到他，修完要主动回评论。
- `Save Image with Delete` 写进 PNG 的 `parameters` 块**只有哈希、没有提示词、没有 `<lora:...>` 标签**：
  checkpoint 走 `Model hash`/`Model`，LoRA 走 `Lora hashes` 映射。哈希长度必须是 **AutoV2 = SHA256[:10]**，
  12 位在 CivitAI 匹配不到（AutoV1=前 100MB 的 8 位、AutoV3=12 位张量哈希）。动 `lora_meta.py` 前先读
  `HASH_LENGTH` 上的注释，别改回 12 位。
- 本机跑 `tests/test_routes.py` 要加 `CODEBUDDY_SAFE_DELETE_ENABLED=0`：WorkBuddy 的 python shim 把
  `shutil.rmtree` 改道回收站，回收站拒绝该目录会 fail-closed；半途失败还会留下悬挂符号链接
  `tests/_tmp_routes/output/link.png`，之后连关掉 shim 都删不动（WinError 5），只能用
  `rm -rf tests/_tmp_routes` 清。这是沙箱行为，不是仓库 bug。
