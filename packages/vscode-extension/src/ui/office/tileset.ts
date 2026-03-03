import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { PNG } from 'pngjs';

import type { OfficeFurnitureAsset, OfficeFurnitureCategory, OfficeSpriteData } from '../../shared/officeProtocol';

type FurnitureCrop = {
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

type TilesetAssetBounds = {
  x: number;
  y: number;
  w: number;
  h: number;
  footprintW: number;
  footprintH: number;
};

const TILE_SIZE_PX = 16;
const ALPHA_THRESHOLD = 10;
const MAX_FOOTPRINT_TILES = 4;
const MAX_TILESET_PIXELS = 4096 * 4096;
const MAX_DETECTED_ASSETS = 2000;

// These coordinates are metadata only. The actual pixels are loaded from the bundled tileset at runtime.
const FURNITURE_CROPS: FurnitureCrop[] = [
  // Office Tileset (16x16) pixel crops.
  // Note: many assets are not aligned to a 16px grid (e.g. y=183), so we use pixel coords.
  // Match Pixel Agents' laptop sprite (tileset metadata: LAPTOP_LEFT).
  { type: 'laptop', x: 177, y: 386, w: 16, h: 32 },
  { type: 'pc', x: 224, y: 359, w: 16, h: 16 },
  { type: 'chair', x: 64, y: 258, w: 16, h: 16 },
  { type: 'bookshelf', x: 128, y: 183, w: 16, h: 32 },
  { type: 'file_cabinet', x: 160, y: 183, w: 16, h: 32 },
  { type: 'cooler', x: 142, y: 264, w: 16, h: 32 },
  { type: 'whiteboard', x: 0, y: 415, w: 32, h: 32 },
];

type OfficeTilesetAssets = {
  catalog: OfficeFurnitureAsset[];
  sprites: Record<string, OfficeSpriteData>;
};

let cachedTilesetAssets: { pngPath: string; mtimeMs: number; assets: OfficeTilesetAssets } | null = null;

function findTilesetRoot(context: vscode.ExtensionContext): string | null {
  const candidates = [
    path.join(context.extensionPath, 'dist', 'office-webview', 'vendor', 'Office_Tileset'),
    path.join(context.extensionPath, 'office-webview', 'vendor', 'Office_Tileset'),
  ];

  for (const root of candidates) {
    try {
      if (fs.existsSync(root) && fs.statSync(root).isDirectory()) return root;
    } catch {
      // ignore invalid paths
    }
  }
  return null;
}

function findTilesetPng(root: string): string | null {
  const prefer = [
    'Office Tileset All 16x16 no shadow.png',
    'Office Tileset All 16x16.png',
  ];
  for (const fileName of prefer) {
    const full = path.join(root, fileName);
    try {
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
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
  const root = findTilesetRoot(context);
  if (!root) return null;

  const pngPath = findTilesetPng(root);
  if (!pngPath) return null;

  try {
    const png = PNG.sync.read(fs.readFileSync(pngPath));
    const sprites: Record<string, OfficeSpriteData> = {};
    for (const crop of FURNITURE_CROPS) {
      sprites[crop.type] = extractSprite(png, crop);
    }
    return sprites;
  } catch {
    return null;
  }
}

function classifyTilesetAsset(bounds: TilesetAssetBounds): {
  category: OfficeFurnitureCategory;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  canPlaceOnSurfaces: boolean;
} {
  const tileRow = Math.floor(bounds.y / TILE_SIZE_PX);

  const canPlaceOnWalls = tileRow >= 24 && bounds.footprintW >= 2 && bounds.footprintH >= 2;

  if (canPlaceOnWalls) {
    return {
      category: 'wall',
      isDesk: false,
      canPlaceOnWalls: true,
      canPlaceOnSurfaces: false,
    };
  }

  // Large 2x2+ furniture in the upper half of the tileset is typically desks/tables/counters.
  if (bounds.footprintW >= 2 && bounds.footprintH >= 2 && tileRow < 15) {
    return {
      category: 'desks',
      isDesk: true,
      canPlaceOnWalls: false,
      canPlaceOnSurfaces: false,
    };
  }

  // 1x1 assets around the chair strip tend to be chairs.
  if (bounds.footprintW === 1 && bounds.footprintH === 1 && tileRow >= 15 && tileRow < 20) {
    return {
      category: 'chairs',
      isDesk: false,
      canPlaceOnWalls: false,
      canPlaceOnSurfaces: false,
    };
  }

  // Tall, narrow assets near the top are usually shelves/cabinets.
  if (bounds.footprintH >= 2 && bounds.footprintW <= 2 && tileRow < 21) {
    return {
      category: 'storage',
      isDesk: false,
      canPlaceOnWalls: false,
      canPlaceOnSurfaces: false,
    };
  }

  // Small assets in the lower-middle strip are commonly desk electronics (monitors, laptops, etc).
  if (tileRow >= 20 && tileRow < 28 && bounds.footprintW <= 2 && bounds.footprintH <= 2) {
    return {
      category: 'electronics',
      isDesk: false,
      canPlaceOnWalls: false,
      canPlaceOnSurfaces: true,
    };
  }

  // Bottom strip has lots of decor/props.
  if (tileRow >= 28 && bounds.footprintW <= 2 && bounds.footprintH <= 2) {
    return {
      category: 'decor',
      isDesk: false,
      canPlaceOnWalls: false,
      canPlaceOnSurfaces: false,
    };
  }

  return {
    category: 'misc',
    isDesk: false,
    canPlaceOnWalls: false,
    canPlaceOnSurfaces: false,
  };
}

function detectTilesetAssets(png: PNG): TilesetAssetBounds[] {
  const width = png.width;
  const height = png.height;
  const visited = new Uint8Array(width * height);

  const alphaAt = (x: number, y: number): number => {
    const idx = (y * width + x) * 4;
    return png.data[idx + 3] ?? 0;
  };

  const assets: TilesetAssetBounds[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = y * width + x;
      if (visited[pos]) continue;

      const a = alphaAt(x, y);
      if (a < ALPHA_THRESHOLD) {
        visited[pos] = 1;
        continue;
      }

      // Flood-fill 4-connected region.
      visited[pos] = 1;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;

      const queueX: number[] = [x];
      const queueY: number[] = [y];
      for (let qi = 0; qi < queueX.length; qi++) {
        const cx = queueX[qi]!;
        const cy = queueY[qi]!;

        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        const neighbors: Array<[number, number]> = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nPos = ny * width + nx;
          if (visited[nPos]) continue;
          visited[nPos] = 1;
          if (alphaAt(nx, ny) < ALPHA_THRESHOLD) continue;
          queueX.push(nx);
          queueY.push(ny);
        }
      }

      const bboxW = maxX - minX + 1;
      const bboxH = maxY - minY + 1;
      const paddedW = Math.ceil(bboxW / TILE_SIZE_PX) * TILE_SIZE_PX;
      const paddedH = Math.ceil(bboxH / TILE_SIZE_PX) * TILE_SIZE_PX;
      const footprintW = paddedW / TILE_SIZE_PX;
      const footprintH = paddedH / TILE_SIZE_PX;

      if (footprintW > MAX_FOOTPRINT_TILES || footprintH > MAX_FOOTPRINT_TILES) continue;

      let paddedX = minX - Math.floor((paddedW - bboxW) / 2);
      let paddedY = minY - (paddedH - bboxH); // bottom-aligned

      paddedX = Math.max(0, Math.min(paddedX, width - paddedW));
      paddedY = Math.max(0, Math.min(paddedY, height - paddedH));

      assets.push({
        x: paddedX,
        y: paddedY,
        w: paddedW,
        h: paddedH,
        footprintW,
        footprintH,
      });
    }
  }

  // Stable ordering: top-left to bottom-right
  assets.sort((a, b) => a.y - b.y || a.x - b.x);
  return assets;
}

export function loadOfficeTilesetFurnitureAssets(
  context: vscode.ExtensionContext,
): OfficeTilesetAssets | null {
  const root = findTilesetRoot(context);
  if (!root) return null;
  const pngPath = findTilesetPng(root);
  if (!pngPath) return null;

  try {
    const stat = fs.statSync(pngPath);
    if (
      cachedTilesetAssets &&
      cachedTilesetAssets.pngPath === pngPath &&
      cachedTilesetAssets.mtimeMs === stat.mtimeMs
    ) {
      return cachedTilesetAssets.assets;
    }
  } catch {
    // ignore stat failures
  }

  try {
    const png = PNG.sync.read(fs.readFileSync(pngPath));
    if (png.width * png.height > MAX_TILESET_PIXELS) {
      console.warn(
        `[LingYun Office] Tileset image too large (${png.width}x${png.height}); skipping dynamic furniture extraction.`,
      );
      return null;
    }
    const detected = detectTilesetAssets(png);
    if (detected.length > MAX_DETECTED_ASSETS) {
      console.warn(
        `[LingYun Office] Detected ${detected.length} assets; truncating to ${MAX_DETECTED_ASSETS}.`,
      );
      detected.length = MAX_DETECTED_ASSETS;
    }

    const sprites: Record<string, OfficeSpriteData> = {};
    const catalog: OfficeFurnitureAsset[] = [];

    for (let i = 0; i < detected.length; i++) {
      const bounds = detected[i]!;
      const type = `ts_${String(i + 1).padStart(3, '0')}`;
      const label = `Tileset ${i + 1}`;
      const classified = classifyTilesetAsset(bounds);

      sprites[type] = extractSprite(png, { type, x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h });
      catalog.push({
        type,
        label,
        category: classified.category,
        footprintW: bounds.footprintW,
        footprintH: bounds.footprintH,
        isDesk: classified.isDesk,
        ...(classified.canPlaceOnWalls ? { canPlaceOnWalls: true } : {}),
        ...(classified.canPlaceOnSurfaces ? { canPlaceOnSurfaces: true } : {}),
      });
    }

    const assets: OfficeTilesetAssets = { catalog, sprites };
    try {
      const stat = fs.statSync(pngPath);
      cachedTilesetAssets = { pngPath, mtimeMs: stat.mtimeMs, assets };
    } catch {
      cachedTilesetAssets = { pngPath, mtimeMs: Date.now(), assets };
    }
    return assets;
  } catch {
    return null;
  }
}
