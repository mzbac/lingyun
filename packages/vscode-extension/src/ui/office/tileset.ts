import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { PNG } from 'pngjs';

import type { OfficeSpriteData } from '../../shared/officeProtocol';

type FurnitureCrop = {
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

// These coordinates are metadata only. The actual pixels are loaded from the bundled tileset at runtime.
const FURNITURE_CROPS: FurnitureCrop[] = [
  // `office-webview/public/assets/office-tileset.png` crops.
  // Generated via the `flux2-office-tileset` skill scripts (FLUX2 tileset generator).
  { type: 'desk', x: 0, y: 0, w: 32, h: 32 },
  { type: 'whiteboard', x: 32, y: 0, w: 32, h: 32 },
  { type: 'tv', x: 96, y: 0, w: 32, h: 32 },
  { type: 'sofa', x: 64, y: 0, w: 32, h: 16 },

  { type: 'kitchen_counter', x: 32, y: 96, w: 48, h: 16 },
  { type: 'kitchen_table', x: 0, y: 96, w: 32, h: 16 },

  { type: 'bookshelf', x: 0, y: 32, w: 16, h: 32 },
  { type: 'file_cabinet', x: 16, y: 32, w: 16, h: 32 },
  { type: 'cooler', x: 32, y: 32, w: 16, h: 32 },
  { type: 'server_rack', x: 48, y: 32, w: 16, h: 32 },

  { type: 'chair', x: 64, y: 32, w: 16, h: 16 },
  { type: 'plant', x: 80, y: 32, w: 16, h: 16 },
  { type: 'lamp', x: 96, y: 32, w: 16, h: 16 },
  { type: 'trash_bin', x: 112, y: 32, w: 16, h: 16 },

  { type: 'pc', x: 64, y: 48, w: 16, h: 16 },
  { type: 'laptop', x: 80, y: 48, w: 16, h: 16 },
  { type: 'microwave', x: 96, y: 48, w: 16, h: 16 },
  { type: 'coffee_machine', x: 112, y: 48, w: 16, h: 16 },

  { type: 'kanban_board', x: 0, y: 64, w: 32, h: 32 },
  { type: 'bulletin_board', x: 32, y: 64, w: 32, h: 32 },
  { type: 'wall_art', x: 64, y: 64, w: 32, h: 32 },
  { type: 'wall_clock', x: 96, y: 64, w: 16, h: 16 },
  { type: 'fridge', x: 112, y: 64, w: 16, h: 32 },
];

let cachedSprites: { pngPath: string; mtimeMs: number; sprites: Record<string, OfficeSpriteData> } | null = null;

function findTilesetPng(context: vscode.ExtensionContext): string | null {
  const candidates = [
    path.join(context.extensionPath, 'dist', 'office-webview', 'assets', 'office-tileset.png'),
    path.join(context.extensionPath, 'office-webview', 'public', 'assets', 'office-tileset.png'),
  ];

  for (const pngPath of candidates) {
    try {
      if (fs.existsSync(pngPath) && fs.statSync(pngPath).isFile()) return pngPath;
    } catch {
      // ignore invalid paths
    }
  }
  return null;
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, '0');
}

function rgbaToHex(r: number, g: number, b: number): string {
  return `#${hexByte(r)}${hexByte(g)}${hexByte(b)}`;
}

function extractSprite(png: PNG, crop: FurnitureCrop): OfficeSpriteData {
  const wPx = crop.w;
  const hPx = crop.h;
  const x0 = crop.x;
  const y0 = crop.y;

  const sprite: OfficeSpriteData = [];
  for (let y = 0; y < hPx; y++) {
    const row: string[] = [];
    for (let x = 0; x < wPx; x++) {
      const sx = x0 + x;
      const sy = y0 + y;
      if (sx < 0 || sy < 0 || sx >= png.width || sy >= png.height) {
        row.push('');
        continue;
      }
      const idx = (sy * png.width + sx) * 4;
      const a = png.data[idx + 3] ?? 0;
      if (a < 10) {
        row.push('');
        continue;
      }
      const r = png.data[idx] ?? 0;
      const g = png.data[idx + 1] ?? 0;
      const b = png.data[idx + 2] ?? 0;
      row.push(rgbaToHex(r, g, b));
    }
    sprite.push(row);
  }

  return sprite;
}

export function loadOfficeFurnitureSpriteOverrides(
  context: vscode.ExtensionContext,
): Record<string, OfficeSpriteData> | null {
  const pngPath = findTilesetPng(context);
  if (!pngPath) return null;

  try {
    const stat = fs.statSync(pngPath);
    if (cachedSprites && cachedSprites.pngPath === pngPath && cachedSprites.mtimeMs === stat.mtimeMs) {
      return cachedSprites.sprites;
    }
  } catch {
    // ignore stat failures
  }

  try {
    const png = PNG.sync.read(fs.readFileSync(pngPath));
    const sprites: Record<string, OfficeSpriteData> = {};
    for (const crop of FURNITURE_CROPS) {
      sprites[crop.type] = extractSprite(png, crop);
    }
    try {
      const stat = fs.statSync(pngPath);
      cachedSprites = { pngPath, mtimeMs: stat.mtimeMs, sprites };
    } catch {
      cachedSprites = { pngPath, mtimeMs: Date.now(), sprites };
    }
    return sprites;
  } catch {
    return null;
  }
}
