#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Generates the Office furniture tileset PNG used by the extension/webview.
 *
 * Requirements:
 * - flux2-cli v0.0.1 (https://github.com/mzbac/flux2.swift/releases/tag/v0.0.1)
 * - Apple Silicon macOS with Metal (mlx-swift requirement)
 * - Node deps installed in this skill dir (`npm install`) for `pngjs`
 *
 * Usage:
 *   node generate-office-tileset.js --repo /path/to/lingyun.public
 *
 * Optional env vars:
 *   FLUX2_CLI=/path/to/flux2-cli
 *   FLUX2_MODEL=mzbac/FLUX.2-klein-9B-q8
 *   OFFICE_TILESET_FORCE=1                  # regenerate raw FLUX images
 *   OFFICE_TILESET_FORCE_TYPES=pc,laptop    # regenerate only these raw assets (comma-separated)
 *   OFFICE_TILESET_MAX_COLORS=32            # palette quantization colors
 *   OFFICE_TILESET_OUTLINE=1                # 1px outline hardening (0/false to disable)
 *   OFFICE_TILESET_OUTLINE_COLOR=#180818    # outline color (hex)
 *   OFFICE_TILESET_SUPERSAMPLES=4           # downscale supersamples per axis (1..8)
 *   OFFICE_TILESET_COVERAGE_THRESHOLD=0.35  # alpha coverage threshold (0..1)
 *   OFFICE_TILESET_STYLE_PALETTE_IMAGE=/path/to/style.png  # optional palette source image
 */

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

function usage() {
  console.log('Usage: node generate-office-tileset.js --repo /path/to/lingyun.public');
}

function parseArgs(argv) {
  const out = { repoRoot: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      usage();
      process.exit(0);
    }
    if (a === '--repo') {
      out.repoRoot = argv[i + 1] || null;
      i++;
      continue;
    }
    throw new Error(`Unknown argument: ${a}`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(args.repoRoot || process.env.LINGYUN_REPO_ROOT || process.cwd());
const vscodeExtensionRoot = path.resolve(repoRoot, 'packages', 'vscode-extension');

if (!fs.existsSync(path.join(vscodeExtensionRoot, 'package.json'))) {
  console.error(`[office-tileset] invalid repo root (missing packages/vscode-extension/package.json): ${repoRoot}`);
  process.exit(1);
}

let PNG;
try {
  ({ PNG } = require('pngjs'));
} catch (err) {
  const skillRoot = path.resolve(__dirname, '..');
  console.error('[office-tileset] missing dependency: pngjs');
  console.error(`[office-tileset] install it by running: (cd "${skillRoot}" && npm install)`);
  console.error(err && err.message ? err.message : err);
  process.exit(1);
}

const TILE_SIZE_PX = 16;
const OUT_TILESET_W_TILES = 8;
const OUT_TILESET_H_TILES = 7;

const FLUX2_CLI = process.env.FLUX2_CLI ? path.resolve(process.env.FLUX2_CLI) : 'flux2-cli';
const FLUX2_MODEL = process.env.FLUX2_MODEL || 'mzbac/FLUX.2-klein-9B-q8';
const FORCE_REGENERATE = ['1', 'true', 'yes'].includes(String(process.env.OFFICE_TILESET_FORCE || '').toLowerCase());
const FORCE_TYPES = String(process.env.OFFICE_TILESET_FORCE_TYPES || '')
  .split(',')
  .map((t) => t.trim())
  .filter(Boolean);
const FORCE_TYPE_SET = FORCE_TYPES.length > 0 ? new Set(FORCE_TYPES) : null;

const MAX_COLORS = Math.max(
  2,
  Math.min(64, Number.parseInt(String(process.env.OFFICE_TILESET_MAX_COLORS || '32'), 10) || 32),
);
const OUTLINE_ENABLED = !['0', 'false', 'no'].includes(String(process.env.OFFICE_TILESET_OUTLINE || '').toLowerCase());
const OUTLINE_COLOR_HEX = String(process.env.OFFICE_TILESET_OUTLINE_COLOR || '#180818');
const SUPERSAMPLES = Math.max(
  1,
  Math.min(8, Number.parseInt(String(process.env.OFFICE_TILESET_SUPERSAMPLES || '4'), 10) || 4),
);
const COVERAGE_THRESHOLD = Math.max(
  0,
  Math.min(1, Number.parseFloat(String(process.env.OFFICE_TILESET_COVERAGE_THRESHOLD || '0.35')) || 0.35),
);

const STYLE_PALETTE_IMAGE = process.env.OFFICE_TILESET_STYLE_PALETTE_IMAGE
  ? path.resolve(process.env.OFFICE_TILESET_STYLE_PALETTE_IMAGE)
  : null;
const STYLE_PALETTE_COLORS = Math.max(
  4,
  Math.min(128, Number.parseInt(String(process.env.OFFICE_TILESET_STYLE_PALETTE_COLORS || '64'), 10) || 64),
);

const outputTilesetPath = path.resolve(
  vscodeExtensionRoot,
  'office-webview',
  'public',
  'assets',
  'office-tileset.png',
);

const workDir = path.resolve(repoRoot, 'temp', 'office-tileset');
const rawDir = path.join(workDir, 'raw');
const processedDir = path.join(workDir, 'processed');
const previewDir = path.join(workDir, 'preview');

function rgbAt(png, x, y) {
  const idx = (y * png.width + x) * 4;
  return [png.data[idx] ?? 0, png.data[idx + 1] ?? 0, png.data[idx + 2] ?? 0];
}

function colorDistSq(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

function clamp255(v) {
  return Math.max(0, Math.min(255, v | 0));
}

function parseHexColor(hex) {
  const raw = String(hex || '').trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(raw);
  if (!m) return [10, 10, 20];
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Computes a background mask by flood-filling from the image border using local
 * color similarity. This is robust even when the subject shares the background hue
 * (e.g. purple sofa on magenta bg) as long as there's an outline separating them.
 */
function computeBackgroundMask(png, { localThreshold = 70, globalThreshold = 150 } = {}) {
  const width = png.width;
  const height = png.height;
  const localThresholdSq = localThreshold * localThreshold;
  const globalThresholdSq = globalThreshold * globalThreshold;
  const visited = new Uint8Array(width * height);

  // Average border color (the prompted background).
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  for (let x = 0; x < width; x++) {
    const [r1, g1, b1] = rgbAt(png, x, 0);
    sumR += r1;
    sumG += g1;
    sumB += b1;
    count++;
    if (height > 1) {
      const [r2, g2, b2] = rgbAt(png, x, height - 1);
      sumR += r2;
      sumG += g2;
      sumB += b2;
      count++;
    }
  }
  for (let y = 1; y < height - 1; y++) {
    const [r1, g1, b1] = rgbAt(png, 0, y);
    sumR += r1;
    sumG += g1;
    sumB += b1;
    count++;
    if (width > 1) {
      const [r2, g2, b2] = rgbAt(png, width - 1, y);
      sumR += r2;
      sumG += g2;
      sumB += b2;
      count++;
    }
  }

  const borderAvg = count > 0 ? [sumR / count, sumG / count, sumB / count] : [0, 0, 0];

  const queueX = [];
  const queueY = [];

  const push = (x, y) => {
    const pos = y * width + x;
    if (visited[pos]) return;
    visited[pos] = 1;
    queueX.push(x);
    queueY.push(y);
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    if (height > 1) push(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    push(0, y);
    if (width > 1) push(width - 1, y);
  }

  for (let qi = 0; qi < queueX.length; qi++) {
    const cx = queueX[qi];
    const cy = queueY[qi];
    const cRgb = rgbAt(png, cx, cy);

    const neighbors = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nPos = ny * width + nx;
      if (visited[nPos]) continue;
      const nRgb = rgbAt(png, nx, ny);
      if (colorDistSq(nRgb, borderAvg) > globalThresholdSq) continue;
      if (colorDistSq(cRgb, nRgb) > localThresholdSq) continue;
      visited[nPos] = 1;
      queueX.push(nx);
      queueY.push(ny);
    }
  }

  return { mask: visited, borderAvg, globalThresholdSq };
}

function readPng(pngPath) {
  return PNG.sync.read(fs.readFileSync(pngPath));
}

function writePng(pngPath, png) {
  fs.mkdirSync(path.dirname(pngPath), { recursive: true });
  fs.writeFileSync(pngPath, PNG.sync.write(png));
}

function findForegroundBounds(png, background) {
  const width = png.width;
  const height = png.height;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = y * width + x;
      if (background.mask[pos]) continue;
      // If flood-fill didn't reach a tiny background island, treat it as background only when it
      // borders the reached background (prevents "magenta-ish" foreground details like sticky notes
      // from being cut out on boards).
      if (colorDistSq(rgbAt(png, x, y), background.borderAvg) <= background.globalThresholdSq) {
        const neighbors = [
          [x + 1, y],
          [x - 1, y],
          [x, y + 1],
          [x, y - 1],
        ];
        let touchesBackground = false;
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (background.mask[ny * width + nx]) {
            touchesBackground = true;
            break;
          }
        }
        if (touchesBackground) continue;
      }

      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function renderProcessedSprite({ inputPath, outW, outH, padPx }) {
  const src = readPng(inputPath);
  const background = computeBackgroundMask(src);
  const bounds = findForegroundBounds(src, background);
  if (!bounds) throw new Error(`No foreground detected in ${inputPath}`);

  const innerW = Math.max(1, outW - padPx * 2);
  const innerH = Math.max(1, outH - padPx * 2);
  const scale = Math.min(innerW / bounds.w, innerH / bounds.h);
  const scaledW = Math.max(1, Math.min(innerW, Math.round(bounds.w * scale)));
  const scaledH = Math.max(1, Math.min(innerH, Math.round(bounds.h * scale)));

  const xOff = Math.floor((outW - scaledW) / 2);
  const yOff = outH - padPx - scaledH; // bottom-aligned

  const out = new PNG({ width: outW, height: outH });

  const isForeground = (x, y) => {
    if (x < 0 || y < 0 || x >= src.width || y >= src.height) return false;
    const pos = y * src.width + x;
    if (background.mask[pos]) return false;
    const rgb = rgbAt(src, x, y);
    if (colorDistSq(rgb, background.borderAvg) <= background.globalThresholdSq) {
      // Only treat "background-like" pixels as background if they border the reached background.
      // This avoids punching holes in legitimate pink/purple foreground details.
      const neighbors = [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= src.width || ny >= src.height) continue;
        if (background.mask[ny * src.width + nx]) return false;
      }
    }
    return true;
  };

  // Supersampled downscale with hard alpha coverage threshold to avoid fuzzy edges.
  for (let y = 0; y < scaledH; y++) {
    for (let x = 0; x < scaledW; x++) {
      const srcX0 = bounds.x + (x * bounds.w) / scaledW;
      const srcX1 = bounds.x + ((x + 1) * bounds.w) / scaledW;
      const srcY0 = bounds.y + (y * bounds.h) / scaledH;
      const srcY1 = bounds.y + ((y + 1) * bounds.h) / scaledH;

      let fgCount = 0;
      const samples = [];
      const total = SUPERSAMPLES * SUPERSAMPLES;
      for (let sy = 0; sy < SUPERSAMPLES; sy++) {
        for (let sx = 0; sx < SUPERSAMPLES; sx++) {
          const fx = (sx + 0.5) / SUPERSAMPLES;
          const fy = (sy + 0.5) / SUPERSAMPLES;
          const px = Math.floor(srcX0 + (srcX1 - srcX0) * fx);
          const py = Math.floor(srcY0 + (srcY1 - srcY0) * fy);
          if (!isForeground(px, py)) continue;
          const idx = (py * src.width + px) * 4;
          const r = src.data[idx] ?? 0;
          const g = src.data[idx + 1] ?? 0;
          const b = src.data[idx + 2] ?? 0;
          // Sort key approximating luma (more weight on green).
          samples.push([r * 3 + g * 6 + b, r, g, b]);
          fgCount++;
        }
      }

      if (fgCount / total < COVERAGE_THRESHOLD) continue;

      // Median sample selection keeps edges crisp (avoids averaging into blurry mid-tones).
      samples.sort((a, b) => a[0] - b[0]);
      const mid = samples[Math.floor(samples.length / 2)];
      const r = clamp255(mid?.[1] ?? 0);
      const g = clamp255(mid?.[2] ?? 0);
      const b = clamp255(mid?.[3] ?? 0);

      const dstX = xOff + x;
      const dstY = yOff + y;
      const dIdx = (dstY * outW + dstX) * 4;
      out.data[dIdx] = r;
      out.data[dIdx + 1] = g;
      out.data[dIdx + 2] = b;
      out.data[dIdx + 3] = 255;
    }
  }

  return out;
}

function medianCutPalette(pixels, maxColors) {
  if (!pixels || pixels.length === 0) return [];

  const makeBox = (px) => {
    let rMin = 255; let rMax = 0;
    let gMin = 255; let gMax = 0;
    let bMin = 255; let bMax = 0;
    for (const p of px) {
      if (p[0] < rMin) rMin = p[0]; if (p[0] > rMax) rMax = p[0];
      if (p[1] < gMin) gMin = p[1]; if (p[1] > gMax) gMax = p[1];
      if (p[2] < bMin) bMin = p[2]; if (p[2] > bMax) bMax = p[2];
    }
    return { px, rMin, rMax, gMin, gMax, bMin, bMax };
  };

  const boxes = [makeBox(pixels)];

  const getRange = (box) => ({
    r: box.rMax - box.rMin,
    g: box.gMax - box.gMin,
    b: box.bMax - box.bMin,
  });

  while (boxes.length < maxColors) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.px.length < 2) continue;
      const { r, g, b } = getRange(box);
      const score = Math.max(r, g, b);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx === -1 || bestScore <= 0) break;

    const box = boxes[bestIdx];
    const ranges = getRange(box);
    const channel = ranges.r >= ranges.g && ranges.r >= ranges.b ? 0 : ranges.g >= ranges.b ? 1 : 2;
    const sorted = [...box.px].sort((a, b) => a[channel] - b[channel]);
    const mid = Math.floor(sorted.length / 2);
    const left = sorted.slice(0, mid);
    const right = sorted.slice(mid);
    if (left.length === 0 || right.length === 0) break;

    boxes.splice(bestIdx, 1, makeBox(left), makeBox(right));
  }

  const palette = [];
  for (const box of boxes) {
    let sr = 0; let sg = 0; let sb = 0;
    for (const p of box.px) {
      sr += p[0];
      sg += p[1];
      sb += p[2];
    }
    const n = box.px.length || 1;
    palette.push([clamp255(Math.round(sr / n)), clamp255(Math.round(sg / n)), clamp255(Math.round(sb / n))]);
  }
  return palette;
}

function medianCutPaletteWeighted(colors, maxColors) {
  if (!colors || colors.length === 0) return [];

  const makeBox = (items) => {
    let rMin = 255; let rMax = 0;
    let gMin = 255; let gMax = 0;
    let bMin = 255; let bMax = 0;
    let weightSum = 0;
    for (const c of items) {
      if (c.r < rMin) rMin = c.r; if (c.r > rMax) rMax = c.r;
      if (c.g < gMin) gMin = c.g; if (c.g > gMax) gMax = c.g;
      if (c.b < bMin) bMin = c.b; if (c.b > bMax) bMax = c.b;
      weightSum += c.weight;
    }
    return { items, rMin, rMax, gMin, gMax, bMin, bMax, weightSum };
  };

  const boxes = [makeBox(colors)];

  const getRange = (box) => ({
    r: box.rMax - box.rMin,
    g: box.gMax - box.gMin,
    b: box.bMax - box.bMin,
  });

  while (boxes.length < maxColors) {
    let bestIdx = -1;
    let bestScore = -1;

    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.items.length < 2) continue;
      const { r, g, b } = getRange(box);
      const maxRange = Math.max(r, g, b);
      if (maxRange <= 0) continue;
      const score = maxRange * box.weightSum;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx === -1) break;

    const box = boxes[bestIdx];
    const ranges = getRange(box);
    const channel = ranges.r >= ranges.g && ranges.r >= ranges.b ? 'r' : ranges.g >= ranges.b ? 'g' : 'b';
    const sorted = [...box.items].sort((a, b) => {
      const d = a[channel] - b[channel];
      if (d !== 0) return d;
      const dr = a.r - b.r;
      if (dr !== 0) return dr;
      const dg = a.g - b.g;
      if (dg !== 0) return dg;
      return a.b - b.b;
    });

    const totalWeight = box.weightSum || 1;
    const half = totalWeight / 2;
    let acc = 0;
    let splitIdx = 0;
    for (let i = 0; i < sorted.length; i++) {
      acc += sorted[i].weight;
      if (acc >= half) {
        splitIdx = i + 1;
        break;
      }
    }
    splitIdx = Math.max(1, Math.min(sorted.length - 1, splitIdx));
    const left = sorted.slice(0, splitIdx);
    const right = sorted.slice(splitIdx);
    if (left.length === 0 || right.length === 0) break;

    boxes.splice(bestIdx, 1, makeBox(left), makeBox(right));
  }

  const palette = [];
  for (const box of boxes) {
    let sr = 0; let sg = 0; let sb = 0;
    let w = 0;
    for (const c of box.items) {
      sr += c.r * c.weight;
      sg += c.g * c.weight;
      sb += c.b * c.weight;
      w += c.weight;
    }
    w = w || 1;
    palette.push([clamp255(Math.round(sr / w)), clamp255(Math.round(sg / w)), clamp255(Math.round(sb / w))]);
  }
  return palette;
}

function extractStylePaletteFromPng(png, { maxColors, backgroundBins = 2 } = {}) {
  const bins = 32 * 32 * 32;
  const counts = new Uint32Array(bins);
  const sumR = new Uint32Array(bins);
  const sumG = new Uint32Array(bins);
  const sumB = new Uint32Array(bins);

  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (y * png.width + x) * 4;
      const a = png.data[idx + 3] ?? 0;
      if (a < 10) continue;
      const r = png.data[idx] ?? 0;
      const g = png.data[idx + 1] ?? 0;
      const b = png.data[idx + 2] ?? 0;
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      counts[key]++;
      sumR[key] += r;
      sumG[key] += g;
      sumB[key] += b;
    }
  }

  const present = [];
  for (let i = 0; i < bins; i++) {
    if (counts[i] > 0) present.push(i);
  }
  present.sort((a, b) => counts[b] - counts[a]);

  const bgKeys = present.slice(0, Math.max(0, Math.min(backgroundBins, present.length)));
  const bgSet = new Set(bgKeys);

  const pushKey = (key) => {
    const n = counts[key] || 1;
    return [
      clamp255(Math.round(sumR[key] / n)),
      clamp255(Math.round(sumG[key] / n)),
      clamp255(Math.round(sumB[key] / n)),
    ];
  };

  const bgPalette = bgKeys.map((key) => pushKey(key));
  const remaining = Math.max(0, maxColors - bgPalette.length);
  if (remaining === 0) return bgPalette;

  const weighted = [];
  for (const key of present) {
    if (bgSet.has(key)) continue;
    const n = counts[key] || 0;
    if (n <= 0) continue;
    const c = pushKey(key);
    weighted.push({ r: c[0], g: c[1], b: c[2], weight: n });
  }

  const palette = medianCutPaletteWeighted(weighted, remaining);
  return [...bgPalette, ...palette];
}

function quantizePngInPlace(png, { maxColors, palette: paletteOverride } = {}) {
  const stylePalette = Array.isArray(paletteOverride) ? paletteOverride : null;

  const pixels = [];
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (y * png.width + x) * 4;
      const a = png.data[idx + 3] ?? 0;
      if (a < 10) continue;
      pixels.push([png.data[idx] ?? 0, png.data[idx + 1] ?? 0, png.data[idx + 2] ?? 0]);
    }
  }

  let palette = medianCutPalette(pixels, maxColors);
  if (palette.length === 0) return;

  // If a style palette is provided, snap the per-sprite palette to it instead of
  // quantizing every pixel directly to the style palette. This keeps sprites readable
  // at tiny sizes while still matching the reference color mood.
  if (stylePalette && stylePalette.length > 0) {
    const snapped = [];
    for (const c of palette) {
      let best = stylePalette[0];
      let bestD = Infinity;
      for (const s of stylePalette) {
        const d = colorDistSq(c, s);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
      snapped.push(best);
    }

    // De-duplicate exact RGB matches while preserving order.
    const seen = new Set();
    const deduped = [];
    for (const c of snapped) {
      const key = `${c[0]},${c[1]},${c[2]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(c);
    }
    if (deduped.length > 0) palette = deduped;
  }

  const nearest = (r, g, b) => {
    let best = palette[0];
    let bestD = Infinity;
    for (const c of palette) {
      const d = colorDistSq([r, g, b], c);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  };

  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (y * png.width + x) * 4;
      const a = png.data[idx + 3] ?? 0;
      if (a < 10) continue;
      const r = png.data[idx] ?? 0;
      const g = png.data[idx + 1] ?? 0;
      const b = png.data[idx + 2] ?? 0;
      const c = nearest(r, g, b);
      png.data[idx] = c[0];
      png.data[idx + 1] = c[1];
      png.data[idx + 2] = c[2];
    }
  }
}

function applyOutlineInPlace(png, { outlineRgb }) {
  const alpha = new Uint8Array(png.width * png.height);
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const idx = (y * png.width + x) * 4;
      alpha[y * png.width + x] = (png.data[idx + 3] ?? 0) >= 10 ? 1 : 0;
    }
  }

  const isSolid = (x, y) => {
    if (x < 0 || y < 0 || x >= png.width || y >= png.height) return false;
    return alpha[y * png.width + x] === 1;
  };

  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (!isSolid(x, y)) continue;
      const boundary =
        !isSolid(x - 1, y) ||
        !isSolid(x + 1, y) ||
        !isSolid(x, y - 1) ||
        !isSolid(x, y + 1);
      if (!boundary) continue;
      const idx = (y * png.width + x) * 4;
      png.data[idx] = outlineRgb[0];
      png.data[idx + 1] = outlineRgb[1];
      png.data[idx + 2] = outlineRgb[2];
      png.data[idx + 3] = 255;
    }
  }
}

function scaleNearest(png, scale) {
  const out = new PNG({ width: png.width * scale, height: png.height * scale });
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const sx = Math.floor(x / scale);
      const sy = Math.floor(y / scale);
      const sIdx = (sy * png.width + sx) * 4;
      const dIdx = (y * out.width + x) * 4;
      out.data[dIdx] = png.data[sIdx] ?? 0;
      out.data[dIdx + 1] = png.data[sIdx + 1] ?? 0;
      out.data[dIdx + 2] = png.data[sIdx + 2] ?? 0;
      out.data[dIdx + 3] = png.data[sIdx + 3] ?? 0;
    }
  }
  return out;
}

function runFlux2Generate({ prompt, width, height, seed, outputPath }) {
  const args = [
    'generate',
    '--model',
    FLUX2_MODEL,
    '--prompt',
    prompt,
    '--seed',
    String(seed),
    '--guidance-scale',
    '1.0',
    '--steps',
    '4',
    '--width',
    String(width),
    '--height',
    String(height),
    '--output',
    outputPath,
  ];

  const result = childProcess.spawnSync(FLUX2_CLI, args, {
    stdio: 'inherit',
    cwd: repoRoot,
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`flux2-cli exited with code ${result.status}`);
}

const ASSETS = [
  {
    type: 'desk',
    outW: 32,
    outH: 32,
    rawW: 256,
    rawH: 256,
    padPx: 2,
    tileX: 0,
    tileY: 0,
    prompt:
      'pixel art sprite of a modern software company workstation desk, simple chunky shapes readable at 32x32 pixels, charcoal/gray surface with subtle cool-blue accents, a few simple desk items (mouse, notebook) with no tiny details, top-down orthographic view, crisp pixels, subtle 3D shading with 2-4 tones, clean 1px dark outline, centered with lots of empty margin, isolated on solid magenta background (#ff00ff), no readable text, no watermark',
  },
  {
    type: 'whiteboard',
    outW: 32,
    outH: 32,
    rawW: 256,
    rawH: 256,
    padPx: 2,
    tileX: 2,
    tileY: 0,
    prompt:
      'pixel art sprite of a wall-mounted glass whiteboard for a software team, simple readable shapes at 32x32 pixels, thin dark frame, simple boxes + arrows + sticky notes (no readable text), marker tray, flat front view, crisp pixels, subtle shading, clean 1px dark outline, centered with lots of empty margin, isolated on solid magenta background (#ff00ff), no readable text, no watermark',
  },
  {
    type: 'tv',
    outW: 32,
    outH: 32,
    rawW: 256,
    rawH: 256,
    maxColors: 28,
    padPx: 2,
    tileX: 6,
    tileY: 0,
    prompt:
      'pixel art sprite of a wall-mounted flat screen TV in a modern software company lounge, simple readable shapes at 32x32 pixels, dark bezel with subtle cool-blue status light, screen has a soft blue glow with 2-3 large UI blocks (no text), flat front view, crisp pixels, subtle shading with 2-4 tones, clean 1px dark outline, centered with lots of empty margin, isolated on solid magenta background (#ff00ff), no readable text, no watermark',
  },
  {
    type: 'kanban_board',
    outW: 32,
    outH: 32,
    rawW: 256,
    rawH: 256,
    padPx: 2,
    tileX: 0,
    tileY: 4,
    prompt:
      'pixel art sprite of a wall-mounted kanban board in a modern software company office, simple chunky shapes readable at 32x32 pixels, three columns with dividers, many colorful sticky notes and small status dots, flat front view, crisp pixels, subtle shading, clean 1px dark outline, no readable text, centered with lots of empty margin, isolated on solid magenta background (#ff00ff), no watermark',
  },
  {
    type: 'bulletin_board',
    outW: 32,
    outH: 32,
    rawW: 256,
    rawH: 256,
    padPx: 2,
    tileX: 2,
    tileY: 4,
    prompt:
      'pixel art sprite of a bulletin board in a software company office, simple readable shapes at 32x32 pixels, cork texture with pinned UI mockup thumbnails and sticky notes (no readable text), a few colored pins, flat front view, crisp pixels, subtle shading, clean 1px dark outline, centered with lots of empty margin, isolated on solid magenta background (#ff00ff), no readable text, no watermark',
  },
  {
    type: 'wall_art',
    outW: 32,
    outH: 32,
    rawW: 256,
    rawH: 256,
    padPx: 2,
    tileX: 4,
    tileY: 4,
    prompt:
      'pixel art sprite of framed wall art for a modern software company, simple readable shapes at 32x32 pixels, abstract geometric poster with muted cool colors, flat front view, crisp pixels, subtle shading, clean 1px dark outline, centered with lots of empty margin, isolated on solid magenta background (#ff00ff), no readable text, no watermark',
  },
  {
    type: 'sofa',
    outW: 32,
    outH: 16,
    rawW: 256,
    rawH: 128,
    padPx: 1,
    tileX: 4,
    tileY: 0,
    prompt:
      'pixel art sprite of a modern modular lounge sofa for a tech office, simple chunky shapes readable at 32x16 pixels, muted fabric tones with a subtle cool accent pillow, top-down orthographic view, crisp pixels, subtle 3D shading, clean 1px dark outline, centered with lots of empty margin, isolated on solid magenta background (#ff00ff), no watermark',
  },
  {
    type: 'kitchen_counter',
    outW: 48,
    outH: 16,
    rawW: 384,
    rawH: 128,
    maxColors: 28,
    padPx: 1,
    tileX: 2,
    tileY: 6,
    prompt:
      'pixel art sprite of a wide office kitchenette counter (3 tiles wide) with a flat countertop spanning the full 48x16 area, designed to read clearly at 48x16 pixels, top-down orthographic view, left-back corner has a small sink + faucet, the rest is empty countertop space meant to place a microwave and coffee machine, matte light-gray countertop with dark base cabinets and subtle cool-blue accent, simple chunky shapes, no tiny details, crisp pixels, subtle 3D shading with 2-4 tones, clean 1px dark outline, wide horizontal composition (avoid tall/square shape), isolated on solid magenta background (#ff00ff), no readable text, no watermark',
  },
  {
    type: 'kitchen_table',
    outW: 32,
    outH: 16,
    rawW: 256,
    rawH: 128,
    maxColors: 28,
    padPx: 1,
    tileX: 0,
    tileY: 6,
    prompt:
      'pixel art sprite of a small modern kitchen / dining table for a software company lounge, designed to read clearly at 32x16 pixels, top-down orthographic view, matte light-gray surface with subtle cool-blue accent, simple chunky shape (rounded rectangle top, thick legs shadow), optionally 1-2 simple cup/plate silhouettes with no tiny details, crisp pixels, subtle 3D shading, clean 1px dark outline, centered with lots of empty margin, isolated on solid magenta background (#ff00ff), no readable text, no watermark',
  },
  {
    type: 'bookshelf',
    outW: 16,
    outH: 32,
    rawW: 128,
    rawH: 256,
    maxColors: 24,
    padPx: 1,
    tileX: 0,
    tileY: 2,
    prompt:
      'pixel art sprite of a modern office bookshelf in a software company, designed to read clearly at 16x32 pixels, straight-on front view, matte light-gray frame with thick shelf dividers, each shelf has 2-4 large book blocks in muted colors (blue/teal/green with a few warm accents), one simple trophy or plant silhouette, crisp pixels, subtle shading with 2-4 tones, clean 1px dark outline, limited palette, no dithering, no noise, centered with generous margin, isolated on solid magenta background (#ff00ff), no readable text, no watermark',
  },
  {
    type: 'file_cabinet',
    outW: 16,
    outH: 32,
    rawW: 128,
    rawH: 256,
    padPx: 1,
    tileX: 1,
    tileY: 2,
    prompt:
      'pixel art sprite of a slim modern office file cabinet, simple chunky shapes readable at 16x32 pixels, light gray metal with dark handles and a subtle cool accent strip, top-down orthographic view, crisp pixels, subtle 3D shading, clean 1px dark outline, centered with lots of empty margin, isolated on solid magenta background (#ff00ff), no watermark',
  },
  {
    type: 'cooler',
    outW: 16,
    outH: 32,
    rawW: 128,
    rawH: 256,
    padPx: 1,
    tileX: 2,
    tileY: 2,
    prompt:
      'pixel art sprite of a modern office water dispenser for a software company, simple chunky shapes readable at 16x32 pixels, stainless base with a subtle cool LED ring and a clear water jug, top-down orthographic view, crisp pixels, subtle 3D shading, clean 1px dark outline, centered with lots of empty margin, isolated on solid magenta background (#ff00ff), no watermark',
  },
  {
    type: 'fridge',
    outW: 16,
    outH: 32,
    rawW: 128,
    rawH: 256,
    maxColors: 24,
    padPx: 1,
    tileX: 7,
    tileY: 4,
    prompt:
      'pixel art sprite of a compact office mini fridge for a software company lounge, designed to read clearly at 16x32 pixels, straight-on front view, matte light-gray body with a dark door seam, simple thick handle, subtle cool-blue status LED, minimal shading with 2-4 tones, clean 1px dark outline, limited palette, no dithering, no noise, centered with generous margin, isolated on solid magenta background (#ff00ff), no readable text, no watermark',
  },
  {
    type: 'server_rack',
    outW: 16,
    outH: 32,
    rawW: 128,
    rawH: 256,
    padPx: 1,
    tileX: 3,
    tileY: 2,
    prompt:
      'pixel art sprite of a tall server rack in a software company office, simple chunky shapes readable at 16x32 pixels, matte dark chassis with cool blue/teal LED lights, top-down orthographic view, crisp pixels, subtle 3D shading, clean 1px dark outline, centered with lots of empty margin, isolated on solid magenta background (#ff00ff), no readable text, no watermark',
  },
  {
    type: 'chair',
    outW: 16,
    outH: 16,
    rawW: 128,
    rawH: 128,
    padPx: 1,
    tileX: 4,
    tileY: 2,
    prompt:
      'pixel art sprite of an ergonomic software company office chair, simple chunky shapes readable at 16x16 pixels, dark gray with subtle cool trim, top-down orthographic view, crisp pixels, subtle 3D shading, clean 1px dark outline, centered with lots of empty margin, isolated on solid magenta background (#ff00ff), no watermark',
  },
  {
    type: 'plant',
    outW: 16,
    outH: 16,
    rawW: 128,
    rawH: 128,
    padPx: 1,
    tileX: 5,
    tileY: 2,
    prompt:
      'pixel art sprite of a small desk plant, simple chunky shapes readable at 16x16 pixels, simple ceramic pot with a subtle cool stripe, fresh green leaves, top-down orthographic view, crisp pixels, subtle 3D shading, clean 1px dark outline, centered with lots of empty margin, isolated on solid magenta background (#ff00ff), no watermark',
  },
  {
    type: 'lamp',
    outW: 16,
    outH: 16,
    rawW: 128,
    rawH: 128,
    padPx: 1,
    tileX: 6,
    tileY: 2,
    prompt:
      'pixel art sprite of a sleek LED desk lamp for a modern software company, simple chunky shapes readable at 16x16 pixels, dark body with a subtle cool glow, top-down orthographic view, crisp pixels, subtle 3D shading, clean 1px dark outline, centered with lots of empty margin, isolated on solid magenta background (#ff00ff), no watermark',
  },
  {
    type: 'trash_bin',
    outW: 16,
    outH: 16,
    rawW: 128,
    rawH: 128,
    padPx: 1,
    tileX: 7,
    tileY: 2,
    prompt:
      'pixel art sprite of a small modern office trash bin, simple chunky shapes readable at 16x16 pixels, dark gray with subtle cool highlight, top-down orthographic view, crisp pixels, subtle 3D shading, clean 1px dark outline, centered with lots of empty margin, isolated on solid magenta background (#ff00ff), no watermark',
  },
  {
    type: 'pc',
    outW: 16,
    outH: 16,
    rawW: 128,
    rawH: 128,
    padPx: 0,
    tileX: 4,
    tileY: 3,
    prompt:
      'pixel art sprite of a modern computer monitor for a software company office, designed to read clearly at 16x16 pixels, top-down orthographic view (seen from directly above), thick dark bezel, bright blue screen area with 1-2 large UI blocks (no thin lines, no readable text), simple small stand/base, clean 1px dark outline, limited cool gray + blue palette, no dithering, no noise, centered with generous margin, isolated on solid magenta background (#ff00ff), no watermark',
  },
  {
    type: 'laptop',
    outW: 16,
    outH: 16,
    rawW: 128,
    rawH: 128,
    padPx: 0,
    tileX: 5,
    tileY: 3,
    prompt:
      'pixel art sprite of an open modern laptop, designed to read clearly at 16x16 pixels, top-down orthographic view (seen from directly above), screen is a large bright blue rectangle, base is a simple cool-gray rectangle, keyboard is 2-3 dark horizontal bars only (no individual keys), trackpad is a single small rectangle highlight, clean 1px dark outline, limited cool gray + blue palette, no dithering, no noise, centered with generous margin, isolated on solid magenta background (#ff00ff), no readable text, no watermark',
  },
  {
    type: 'microwave',
    outW: 16,
    outH: 16,
    rawW: 128,
    rawH: 128,
    maxColors: 24,
    padPx: 1,
    tileX: 6,
    tileY: 3,
    prompt:
      'pixel art sprite of a small office microwave, designed to read clearly at 16x16 pixels, top-down orthographic view, light-gray body with a single dark window rectangle and 2-3 big button blocks (no text), crisp pixels, subtle shading, clean 1px dark outline, limited palette, no dithering, no noise, centered with generous margin, isolated on solid magenta background (#ff00ff), no watermark',
  },
  {
    type: 'coffee_machine',
    outW: 16,
    outH: 16,
    rawW: 128,
    rawH: 128,
    maxColors: 24,
    padPx: 1,
    tileX: 7,
    tileY: 3,
    prompt:
      'pixel art sprite of a compact office coffee machine / espresso maker, designed to read clearly at 16x16 pixels, top-down orthographic view, dark-gray body with subtle teal/cool-blue accent, simple circular mug spot, no tiny details, crisp pixels, subtle shading, clean 1px dark outline, limited palette, no dithering, no noise, centered with generous margin, isolated on solid magenta background (#ff00ff), no readable text, no watermark',
  },
  {
    type: 'wall_clock',
    outW: 16,
    outH: 16,
    rawW: 128,
    rawH: 128,
    padPx: 1,
    tileX: 6,
    tileY: 4,
    prompt:
      'pixel art sprite of a round wall clock for a modern tech office, simple chunky shapes readable at 16x16 pixels, dark frame with light face, simple hands, no numbers, flat front view, crisp pixels, subtle shading, clean 1px dark outline, no readable text, centered with lots of empty margin, isolated on solid magenta background (#ff00ff), no watermark',
  },
];

function assertFlux2Available() {
  if (fs.existsSync(FLUX2_CLI)) return;

  const probe = childProcess.spawnSync(FLUX2_CLI, ['--help'], {
    stdio: 'ignore',
    cwd: repoRoot,
    env: process.env,
  });
  if (!probe.error && probe.status === 0) return;

  console.error(`flux2-cli not found or not runnable: ${FLUX2_CLI}`);
  console.error('Install it from: https://github.com/mzbac/flux2.swift/releases/tag/v0.0.1');
  console.error('Then either put it on your PATH as `flux2-cli` or set FLUX2_CLI=/absolute/path/to/flux2-cli.');
  process.exit(1);
}

function buildTilesetPng(processedSprites) {
  const out = new PNG({
    width: OUT_TILESET_W_TILES * TILE_SIZE_PX,
    height: OUT_TILESET_H_TILES * TILE_SIZE_PX,
  });

  for (const sprite of processedSprites) {
    const x0 = sprite.tileX * TILE_SIZE_PX;
    const y0 = sprite.tileY * TILE_SIZE_PX;
    if (x0 < 0 || y0 < 0 || x0 + sprite.png.width > out.width || y0 + sprite.png.height > out.height) {
      throw new Error(`Sprite ${sprite.type} does not fit in tileset output (${x0},${y0}).`);
    }

    for (let y = 0; y < sprite.png.height; y++) {
      for (let x = 0; x < sprite.png.width; x++) {
        const sIdx = (y * sprite.png.width + x) * 4;
        const a = sprite.png.data[sIdx + 3] ?? 0;
        if (a === 0) continue;
        const dIdx = ((y0 + y) * out.width + (x0 + x)) * 4;
        out.data[dIdx] = sprite.png.data[sIdx] ?? 0;
        out.data[dIdx + 1] = sprite.png.data[sIdx + 1] ?? 0;
        out.data[dIdx + 2] = sprite.png.data[sIdx + 2] ?? 0;
        out.data[dIdx + 3] = a;
      }
    }
  }
  return out;
}

function main() {
  assertFlux2Available();
  fs.mkdirSync(rawDir, { recursive: true });
  fs.mkdirSync(processedDir, { recursive: true });
  fs.mkdirSync(previewDir, { recursive: true });

  let stylePalette = null;
  if (STYLE_PALETTE_IMAGE) {
    try {
      if (!fs.existsSync(STYLE_PALETTE_IMAGE)) {
        console.warn(`[office-tileset] style palette image not found: ${STYLE_PALETTE_IMAGE}`);
      } else {
        const stylePng = readPng(STYLE_PALETTE_IMAGE);
        stylePalette = extractStylePaletteFromPng(stylePng, { maxColors: STYLE_PALETTE_COLORS });
        if (stylePalette.length > 0) {
          console.log(
            `[office-tileset] using style palette: ${STYLE_PALETTE_IMAGE} (${stylePalette.length} colors)`,
          );
        } else {
          console.warn(`[office-tileset] style palette extracted 0 colors: ${STYLE_PALETTE_IMAGE}`);
        }
      }
    } catch (err) {
      console.warn(`[office-tileset] failed to load style palette: ${STYLE_PALETTE_IMAGE}`);
      console.warn(err);
    }
  }

  // 1) Generate raw assets (skip if already present).
  for (const asset of ASSETS) {
    const rawPath = path.join(rawDir, `${asset.type}.png`);
    const forceThis = FORCE_REGENERATE || (FORCE_TYPE_SET ? FORCE_TYPE_SET.has(asset.type) : false);
    if (!forceThis && fs.existsSync(rawPath)) continue;
    console.log(`[office-tileset] generating ${asset.type} (${asset.rawW}x${asset.rawH})…`);
    runFlux2Generate({ prompt: asset.prompt, width: asset.rawW, height: asset.rawH, seed: 42, outputPath: rawPath });
  }

  // 2) Process into exact sprite sizes with transparent background.
  const processedSprites = [];
  const outlineRgb = parseHexColor(OUTLINE_COLOR_HEX);
  for (const asset of ASSETS) {
    const rawPath = path.join(rawDir, `${asset.type}.png`);
    const processedPath = path.join(processedDir, `${asset.type}.png`);
    console.log(`[office-tileset] processing ${asset.type} → ${asset.outW}x${asset.outH}`);
    const processedPng = renderProcessedSprite({ inputPath: rawPath, outW: asset.outW, outH: asset.outH, padPx: asset.padPx });
    const spriteMaxColors = Number.isFinite(asset.maxColors) ? asset.maxColors : MAX_COLORS;
    quantizePngInPlace(processedPng, { maxColors: spriteMaxColors, palette: stylePalette || undefined });
    if (OUTLINE_ENABLED) applyOutlineInPlace(processedPng, { outlineRgb });
    writePng(processedPath, processedPng);
    writePng(path.join(previewDir, `${asset.type}@16x.png`), scaleNearest(processedPng, 16));
    processedSprites.push({ type: asset.type, tileX: asset.tileX, tileY: asset.tileY, png: processedPng });
  }

  // 3) Pack into a single tileset PNG.
  const tileset = buildTilesetPng(processedSprites);
  writePng(outputTilesetPath, tileset);
  writePng(path.join(previewDir, `office-tileset@8x.png`), scaleNearest(tileset, 8));
  console.log(`[office-tileset] wrote tileset: ${outputTilesetPath}`);
}

main();
