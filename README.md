# ComfyUI Prompt Warehouse

[![English](https://img.shields.io/badge/README-English-2f81f7?style=for-the-badge)](README.md)
[![简体中文](https://img.shields.io/badge/README-%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-e34c26?style=for-the-badge)](README.zh-CN.md)

Current version: `v0.4.0`

A ComfyUI custom node pack for organising, reusing and randomly drawing prompts, bundled with single-line and multiline prompt nodes and a multi-LoRA loader whose list is persisted with the workflow.

## Features

- Add, edit and delete prompt entries
- Free-form groups, with filtering by group in the list on the left
- The group field suggests existing groups but still lets you create new ones
- Random draw from a chosen group, or from every entry
- Prompt, Width and Height are drawn as a matched set
- Join an upstream prompt through the `prompt_in` input on the left
- Optional `clip` input, with `prompt`, `width`, `height` and `conditioning` outputs
- Data is persisted in `data/prompts.json` inside the plugin folder
- Every save is mirrored to the user's Documents folder, and a missing, empty or corrupt main file is restored from it automatically
- The real warehouse data is not tracked by Git, so updating the plugin never overwrites that file
- Ships a **Prompt Line** node that outputs a prompt typed into a single-line box
- Ships a **Prompt Multiline** node that edits a prompt in a multiline box
- Ships a **Multi LoRA Loader** that applies any number of LoRAs in order
- Each LoRA can be toggled on or off independently, with a shared strength on a compact single row
- The LoRA list and its `Add LoRA` button survive a workflow reload or a ComfyUI restart
- Ships a **Save Image with Delete** node that can delete the saved source file from `output`
- Saved PNGs carry CivitAI-readable LoRA metadata, so uploads link back to the LoRA resources automatically
- The interface is English by default; setting ComfyUI's `Comfy → Locale` to 简体中文 switches the node UI too. It does not follow the browser language.

## Installation

Change into ComfyUI's custom nodes directory and clone the repository:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/D33MO/ComfyUI-Prompt-Warehouse.git
```

Restart ComfyUI, then refresh the browser page. The plugin has no third-party Python dependencies.

## Usage

Add **Prompt Warehouse** from the `Prompt Warehouse` category in the node menu.

For a simple single-line prompt node, add **Prompt Line** from the same category. It joins the upstream prompt arriving on the `prompt_in` input with the contents of its own single-line `prompt` box using `, ` and outputs the result, without overwriting the input box.

For a larger editing area, add **Prompt Multiline**. Its inputs, joining and output behave exactly like the single-line node; only the internal `prompt` box is multiline.

### Save Image with Delete

**Save Image with Delete** saves, names and previews images exactly like ComfyUI's built-in `Save Image`. After the node has produced its output it remembers the images it just saved and shows a "delete latest output" button; clicking it opens a confirmation prompt, and only after confirming does it delete the corresponding source files from ComfyUI's `output` directory and clear the node preview. The delete endpoint validates the path and only accepts file information for files inside the `output` directory that were returned by the node.

Besides the native `prompt` and `workflow` metadata, saving also writes an A1111-style `parameters` field, appending the LoRAs actually used by this run to the end of the positive prompt as `<lora:name:strength>` and adding a `Lora hashes` line (the first 12 characters of the LoRA file's SHA256, which is CivitAI's AutoV2 value). Uploading such an image to CivitAI therefore detects and links the LoRA resources automatically, with no manual entry. LoRA information is read straight from the execution graph, so a `Multi LoRA Loader` list is recognised correctly and the workflow needs no extra wiring.

Hashes are cached in `data/lora_hashes.json` keyed by file path, size and modification time, so each LoRA is hashed only once. If the node fails for any reason it falls back to the native save behaviour, so image generation is never blocked.

### Multi LoRA Loader

Add **Multi LoRA Loader** from the `Prompt Warehouse` category, connect the base model's `MODEL` and `CLIP`, then click `＋ Add LoRA` at the bottom of the node to add any number of LoRAs. Each LoRA takes a single row: click the dot on the left to enable or disable it, click the name to pick a file, and use `− / +` or click the number to adjust strength; right-click a row to toggle, move up, move down or delete it. LoRAs are applied from top to bottom, and one strength applies to both MODEL and CLIP.

The compact single-row UI and the main interactions are modelled on and inspired by [Power Lora Loader from rgthree-comfy](https://github.com/rgthree/rgthree-comfy). This project is an independent implementation built on that idea, with these differences:

- The complete LoRA list is stored in one fixed JSON configuration that is saved with the current workflow
- Restarting ComfyUI or reopening the workflow restores the LoRAs, their order, their enabled state and the `Add LoRA` button
- A single strength applies to both MODEL and CLIP
- A custom strength editing dialog and a UI tuned to this project's compact layout

### Managing the warehouse

1. Click "open warehouse" on the node.
2. The right-hand side starts as an unsaved draft for a new entry.
3. Fill in the title, group, prompt and the optional Width / Height.
4. The entry is written to the warehouse only after you click "save".
5. Clicking an entry on the left shows its contents on the right, where you can read or edit it; edits take effect only after you click "save" again.
6. The content shown on the right is loaded into the current node only when you select an entry and click "load".
7. While editing an existing entry you can click "＋ new" on the left at any time to clear the right-hand side and start a new entry; drafts and modified content are flagged with a prominent unsaved state.
8. Clicking "delete" while editing an entry and confirming removes it from the warehouse immediately, with no second save needed.

### Random draw

With `random_enabled` turned on, every execution of the node draws a fresh random entry from the warehouse group selected in `random_group`. Selecting "all" draws from every entry.

If a group holds only one entry, that entry is always the result; with several entries, two consecutive runs can still draw the same content.

### Joining prompts

Connect an upstream string to the node's `prompt_in` input on the left. The node places the upstream prompt first and the current or randomly drawn prompt after it, joining them automatically with `, `.

When the Warehouse node outputs a non-empty prompt it appends an English comma `,` by default, making it easy to keep chaining prompts downstream.

### Wiring into ComfyUI

- `prompt` → `CLIP Text Encode.text`
- `width` → `Empty Latent Image.width`
- `height` → `Empty Latent Image.height`
- `clip` ← the `CLIP` output of a model loader
- `conditioning` → the positive or negative conditioning input of a sampler

When `clip` is not connected no encoding takes place, and the existing `prompt`, `width` and `height` outputs still work normally.

If `CLIP Text Encode`'s `text` still shows as a widget, right-click that widget and choose **Convert widget to input**.

When Width or Height is left empty the corresponding output is `0`, letting downstream nodes decide the default size.

## API access restriction

The plugin exposes the following endpoints through ComfyUI's built-in HTTP server. They read and write the prompt warehouse and delete files from the `output` directory:

- `GET /prompt-warehouse/prompts`, `GET /prompt-warehouse/backup`
- `PUT /prompt-warehouse/prompts`
- `POST /prompt-warehouse/delete-output-images`

ComfyUI's API itself has no authentication, so once it is started with `--listen` any device on the local network can reach it. These endpoints therefore **only accept requests from the local machine (loopback address)** and return `403` to every other source.

> Behind a reverse proxy such as nginx the request looks local to ComfyUI, so this restriction does not apply. Restrict access to the `/prompt-warehouse/` path in the proxy layer yourself.

## Data and backup

Prompts are stored in `data/prompts.json`. That file is listed in `.gitignore` and never enters a Git commit; the `data/prompts.example.json` in the repository only demonstrates the data format.

On every warehouse save the plugin automatically backs the same data up to `ComfyUI-Prompt-Warehouse\prompts.json` inside the current user's Documents folder:

```
C:\Users\<username>\Documents\ComfyUI-Prompt-Warehouse\prompts.json
```

It also keeps timestamped snapshots under `ComfyUI-Prompt-Warehouse\backups\` (the 20 most recent are retained) so you can roll back an accidental deletion or edit. If `Documents` is redirected to OneDrive, the OneDrive Documents folder is preferred; the environment variable `PROMPT_WAREHOUSE_BACKUP_DIR` can point the backup somewhere else.

If `data/prompts.json` is **missing (reinstall, accidental delete), empty (a default installation ships an empty `[]` array), or unparseable**, the next load restores it from the backup and writes it back to `data/prompts.json`. It only writes back when the backup actually holds content, so a restore can never leave you worse off. Conversely, when the main file does hold valid data it wins, and the backup is never used to overwrite it.

Note that clearing every prompt in the UI and saving also writes the empty payload to the backup, so nothing is restored afterwards. That is deliberate: deleted content must not reappear on its own. If the backup folder is not writable, failures are ignored in the background and saving is unaffected. The current backup location is reported by `GET /prompt-warehouse/backup`, or by the `backup` field returned from `GET /prompt-warehouse/prompts`.

The timestamped snapshots under `backups\` are kept for retention only and are never read automatically; to roll back to an earlier version, copy one over `data/prompts.json` by hand.

A routine `git pull` never overwrites your actual prompts when you upgrade the plugin. Before deleting or reinstalling the whole plugin directory, back up `data/prompts.json` separately.
