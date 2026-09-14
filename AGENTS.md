# AGENTS.md — instructions for coding agents

This file is for AI coding agents (and humans who want the same checklist) working in
`ComfyUI-Prompt-Warehouse`. It records the release/versioning workflow and the review
constraints this pack must keep satisfying.

---

## 1. Version bump — the three places that must always agree

The version is duplicated on purpose. **A release is only correct when all three match.**

| File | Location | Example |
|---|---|---|
| `__init__.py` | `__version__ = "X.Y.Z"` (no `v` prefix) | `__version__ = "0.4.1"` |
| `README.md` | `Current version: \`vX.Y.Z\`` (near the top, line ~6) | `Current version: \`v0.4.1\`` |
| `README.zh-CN.md` | `当前版本：\`vX.Y.Z\`` (near the top, line ~6) | `当前版本：\`v0.4.1\`` |

Rules:

- `__init__.py` uses a **bare** `X.Y.Z`; the two READMEs use **`vX.Y.Z`** with backticks.
- Never edit just one of them. Run the check in §3 before committing.
- `__version__` is what ComfyUI/ComfyUI-Manager surfaces for the pack, so a stale value
  makes the pack look older than it is. If you are asked to tag `vX.Y.Z` and
  `__init__.py` still holds the previous number, fix it **in the same commit** as the bump.

## 2. Release procedure

Run from the repository root (PowerShell on this machine):

```powershell
# 1. make sure the tree is clean and up to date
git status --short -b
git fetch origin
git pull --ff-only

# 2. bump the three places above, then verify
#    (edit __init__.py, README.md, README.zh-CN.md by hand or with the edit tool)

# 3. run the self-contained test scripts (no ComfyUI install needed)
python tests\test_routes.py
python tests\test_backup.py
python tests\test_lora_meta.py
python tests\test_save_metadata.py

# 4. commit the bump on its own
git add __init__.py README.md README.zh-CN.md
git commit -m "chore: bump version to vX.Y.Z"

# 5. annotated tag on that exact commit
git tag -a vX.Y.Z -m "vX.Y.Z"

# 6. publish
git push origin master
git push origin vX.Y.Z

# 7. confirm the tag really landed on the remote
git ls-remote --tags origin
```

Do **not** re-create an existing tag. Check first:

```powershell
git tag --list
git ls-remote --tags origin
```

If a tag already exists and points at the wrong commit, stop and ask the human — deleting
and re-pushing a published tag is a destructive, history-rewriting action.

## 3. Pre-commit verification (copy/paste)

```powershell
# all three version strings, with line numbers
Select-String -Path __init__.py,README.md,README.zh-CN.md -Pattern '0\.\d+\.\d+'
```

Everything printed must show the same `X.Y.Z`. A quick sanity check that the tag matches
the code:

```powershell
git show vX.Y.Z:__init__.py | Select-String __version__
```

## 4. Constraints this pack must keep (ComfyUI-Manager review requirements)

These come from maintainer review of the ComfyUI-Manager listing PR. Breaking any of them
gets the pack rejected, so check them before every release:

1. **UI strings are English by default.** No hardcoded Chinese in node widgets, combo
   options, placeholders, API errors or status text. The only tolerated Chinese literal is
   `nodes.py`'s `LEGACY_ALL_GROUPS = "全部"`, kept so old workflows still load, and it must
   never be *displayed* — `locales/en/nodeDefs.json` maps it to `All`.
2. **Translation is a per-user opt-in.** `web/i18n.js` resolves the language from
   ComfyUI's own `Comfy.Locale` setting only. Never sniff `navigator.language`, and do not
   make `document.documentElement.lang` the primary source; it is only a last-resort
   fallback.
3. **Node metadata goes through ComfyUI's locale mechanism** — `locales/en/nodeDefs.json`
   and `locales/zh/nodeDefs.json` (see ComfyUI PR #6558). Keep the `en` table complete
   whenever a node, input, output or combo option is added.
4. **Every HTTP route registered in `routes.py` must be loopback-only.** Call
   `_remote_only(request)` first and return its 403 response when it is not `None`. Any
   route that writes or deletes files must never be reachable from another machine.
5. **No third-party Python dependencies.** The pack must install by `git clone` alone.
6. **`data/prompts.json` stays out of Git.** Only `data/prompts.example.json` is tracked.

## 5. Tests

`tests/test_*.py` are standalone scripts: each stubs ComfyUI (`aiohttp`,
`folder_paths`, `server`) and prints its own result. Run each with plain `python`; a
non-zero exit code means failure. Scratch output lands in `tests/_tmp*` and `tests/_out`
and is not part of a release.

## 6. Listing status — ComfyUI-Manager PR #3180

- PR: <https://github.com/Comfy-Org/ComfyUI-Manager/pull/3180> — **open, not merged, not
  closed.** It only adds the entry to `custom-node-list.json`; it does not contain this
  pack's source, so source changes never show up in that PR.
- The pack is **not** in upstream `custom-node-list.json` yet. Verify with:
  `Select-String -Path <upstream list> -Pattern 'Prompt.Warehouse'`
- Outstanding review item (maintainer `ltdrdata`, 2026-09-10): the Chinese-UI complaint —
  addressed on `master` in `v0.4.1` (see §4 items 1–3).
- Because the fixes live in *this* repository, the maintainer receives **no notification**.
  A release does not advance the PR. After a fix like this, post a comment on PR #3180
  pinging `@ltdrdata` with the changed files and the tag it landed in.
- **Never open a second listing PR** while #3180 is open; a duplicate gets closed as noise.

When you bump the version, ask whether this release also answers an open review item — if
so, the PR comment is part of the release, not an optional extra.
