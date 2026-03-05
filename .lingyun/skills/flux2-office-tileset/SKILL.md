---
name: flux2-office-tileset
description: Generate or regenerate the LingYun Office furniture tileset PNG (packages/vscode-extension/office-webview/public/assets/office-tileset.png) using flux2-cli (mzbac/FLUX.2-klein-9B-q8), pack sprites into a single tileset, and keep packages/vscode-extension/src/ui/office/tileset.ts crop coordinates in sync. Use when adding/updating furniture sprites (desk/boards/pc/laptop/etc.), matching a reference pixel-art palette, fixing transparency artifacts (“black holes”), or rebuilding the office-webview assets.
---

# Flux2 Office Tileset

Generate a single packed PNG tileset for the Office webview, then rebuild the webview so the extension loads the updated sprites.

## Workflow

### 1) Prereqs

- Have `flux2-cli` available (v0.0.1). Options:
  - Put it on your `PATH` as `flux2-cli`, or
  - Run `bash scripts/download-flux2-cli.sh` (downloads to your user cache and prints the installed path), or
  - Set `FLUX2_CLI=/absolute/path/to/flux2-cli`.
- Apple Silicon macOS + Metal (mlx-swift / MLX Swift).
- Install this skill’s Node deps (once):

```bash
cd /path/to/flux2-office-tileset
npm install
```

### 2) Regenerate the tileset PNG

From this skill directory:

```bash
# Regenerate raw FLUX images + process + pack + rebuild.
bash scripts/regenerate-office-tileset.sh --force --repo /path/to/lingyun.public
```

Targeted regen (faster when iterating on 1-2 assets):

```bash
OFFICE_TILESET_FORCE_TYPES=pc,laptop bash scripts/regenerate-office-tileset.sh --repo /path/to/lingyun.public
```

Outputs:

- Tileset PNG: `packages/vscode-extension/office-webview/public/assets/office-tileset.png`
- Debug previews: `temp/office-tileset/preview/office-tileset@8x.png` and `temp/office-tileset/preview/*@16x.png`

To only re-process/pack (no new FLUX generations), run without `OFFICE_TILESET_FORCE=1`.

### 3) Rebuild the office-webview bundle

```bash
pnpm --filter lingyun office:build
```

This writes the bundled tileset the extension loads at runtime:

- `packages/vscode-extension/dist/office-webview/assets/office-tileset.png`

## Editing sprites

### Add or tweak a sprite prompt

Edit `scripts/generate-office-tileset.js`:

- Update an existing entry in `ASSETS` (e.g. `pc`, `laptop`, `kanban_board`).
- Keep prompts **readable at target size**: “designed to read clearly at 16x16/32x32 pixels”, chunky shapes, no tiny details, no dithering/no noise.
- Keep a **solid magenta** background (`#ff00ff`) so background removal stays stable.
- Avoid readable text.

### Keep mapping/crops in sync

The extension crops from the packed PNG using `packages/vscode-extension/src/ui/office/tileset.ts` (`FURNITURE_CROPS`).

- Tileset grid is `8x7` tiles, `16px` tile size → output PNG `128x112`.
- Crop pixels are absolute: `x = tileX * 16`, `y = tileY * 16`, `w = outW`, `h = outH`.
- If you move a sprite in the packed sheet, update both the generator `tileX/tileY` and the crop entry.

## Style matching (palette reference)

The generator can snap sprite palettes to a style palette extracted from a reference image:

- Set: `OFFICE_TILESET_STYLE_PALETTE_IMAGE=/absolute/path/to/style.png`

Useful knobs:

- `OFFICE_TILESET_STYLE_PALETTE_COLORS` (default `64`)
- `OFFICE_TILESET_MAX_COLORS` (default `32`)
- `OFFICE_TILESET_OUTLINE_COLOR` (default `#180818`)

## Troubleshooting

- **“Black holes” / missing pixels:** usually background-like colors were mistaken as background. Keep a clear outline separating foreground from magenta bg; avoid large magenta-ish regions inside sprites; regenerate and inspect `temp/office-tileset/preview/*@16x.png`.
- **Looks muddy at 16x16:** simplify prompt (“no thin lines”, “2–4 tones”, “chunky shapes”), and prefer smaller `rawW/rawH` (128/256) for tiny sprites.
