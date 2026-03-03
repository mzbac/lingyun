import { FurnitureType } from '../types.js'
import type { FurnitureCatalogEntry, SpriteData } from '../types.js'
import type { OfficeFurnitureAsset } from '../../../src/shared/officeProtocol.js'
import {
  DESK_SQUARE_SPRITE,
  BOOKSHELF_SPRITE,
  FILE_CABINET_SPRITE,
  PLANT_SPRITE,
  COOLER_SPRITE,
  WHITEBOARD_SPRITE,
  CHAIR_SPRITE,
  SOFA_SPRITE,
  PC_SPRITE,
  LAPTOP_SPRITE,
  SERVER_RACK_SPRITE,
  LAMP_SPRITE,
  TRASH_BIN_SPRITE,
} from '../sprites/spriteData.js'

export type FurnitureCategory = 'desks' | 'chairs' | 'storage' | 'decor' | 'electronics' | 'wall' | 'misc'

export interface CatalogEntryWithCategory extends FurnitureCatalogEntry {
  category: FurnitureCategory
}

export const FURNITURE_CATALOG: CatalogEntryWithCategory[] = [
  // ── Original hand-drawn sprites ──
  { type: FurnitureType.DESK,       label: 'Desk',       footprintW: 2, footprintH: 2, sprite: DESK_SQUARE_SPRITE,  isDesk: true,  category: 'desks' },
  { type: FurnitureType.BOOKSHELF,  label: 'Bookshelf',  footprintW: 1, footprintH: 2, sprite: BOOKSHELF_SPRITE,    isDesk: false, category: 'storage', backgroundTiles: 1 },
  { type: FurnitureType.FILE_CABINET,label: 'File Cabinet',footprintW: 1, footprintH: 2, sprite: FILE_CABINET_SPRITE, isDesk: false, category: 'storage', backgroundTiles: 1 },
  { type: FurnitureType.PLANT,      label: 'Plant',      footprintW: 1, footprintH: 1, sprite: PLANT_SPRITE,        isDesk: false, category: 'decor' },
  { type: FurnitureType.COOLER,     label: 'Cooler',     footprintW: 1, footprintH: 2, sprite: COOLER_SPRITE,       isDesk: false, category: 'misc', backgroundTiles: 1 },
  { type: FurnitureType.WHITEBOARD, label: 'Blackboard', footprintW: 2, footprintH: 2, sprite: WHITEBOARD_SPRITE,   isDesk: false, category: 'wall', canPlaceOnWalls: true },
  { type: FurnitureType.CHAIR,      label: 'Chair',      footprintW: 1, footprintH: 1, sprite: CHAIR_SPRITE,        isDesk: false, category: 'chairs' },
  { type: FurnitureType.SOFA,       label: 'Sofa',       footprintW: 2, footprintH: 1, sprite: SOFA_SPRITE,         isDesk: false, category: 'chairs' },
  { type: FurnitureType.PC,         label: 'PC',         footprintW: 1, footprintH: 1, sprite: PC_SPRITE,           isDesk: false, category: 'electronics', canPlaceOnSurfaces: true },
  { type: FurnitureType.LAPTOP,     label: 'Laptop',     footprintW: 1, footprintH: 1, sprite: LAPTOP_SPRITE,       isDesk: false, category: 'electronics', canPlaceOnSurfaces: true },
  { type: FurnitureType.SERVER_RACK,label: 'Server Rack',footprintW: 1, footprintH: 2, sprite: SERVER_RACK_SPRITE,  isDesk: false, category: 'electronics' },
  { type: FurnitureType.LAMP,       label: 'Lamp',       footprintW: 1, footprintH: 1, sprite: LAMP_SPRITE,         isDesk: false, category: 'decor', canPlaceOnSurfaces: true },
  { type: FurnitureType.TRASH_BIN,  label: 'Trash Bin',  footprintW: 1, footprintH: 1, sprite: TRASH_BIN_SPRITE,    isDesk: false, category: 'misc' },

]

let dynamicCatalog: CatalogEntryWithCategory[] = []

export function getCatalogEntry(type: string): CatalogEntryWithCategory | undefined {
  return dynamicCatalog.find((e) => e.type === type) || FURNITURE_CATALOG.find((e) => e.type === type)
}

export function getCatalogByCategory(category: FurnitureCategory): CatalogEntryWithCategory[] {
  const base = FURNITURE_CATALOG.filter((e) => e.category === category)
  const dynamic = dynamicCatalog.filter((e) => e.category === category)
  return [...base, ...dynamic]
}

export function getActiveCatalog(): CatalogEntryWithCategory[] {
  return [...FURNITURE_CATALOG, ...dynamicCatalog]
}

export function getActiveCategories(): Array<{ id: FurnitureCategory; label: string }> {
  return FURNITURE_CATEGORIES
}

export const FURNITURE_CATEGORIES: Array<{ id: FurnitureCategory; label: string }> = [
  { id: 'desks', label: 'Desks' },
  { id: 'chairs', label: 'Chairs' },
  { id: 'storage', label: 'Storage' },
  { id: 'electronics', label: 'Tech' },
  { id: 'decor', label: 'Decor' },
  { id: 'wall', label: 'Wall' },
  { id: 'misc', label: 'Misc' },
]

export function applyFurnitureSpriteOverrides(sprites: Record<string, SpriteData>): void {
  if (!sprites) return
  for (const entry of getActiveCatalog()) {
    const sprite = sprites[entry.type]
    if (sprite) {
      entry.sprite = sprite
    }
  }
}

export function loadDynamicFurnitureAssets(
  assets: OfficeFurnitureAsset[],
  sprites: Record<string, SpriteData>,
): void {
  const next: CatalogEntryWithCategory[] = []
  for (const asset of assets || []) {
    const sprite = sprites?.[asset.type] ?? [['']]
    next.push({
      type: asset.type,
      label: asset.label,
      footprintW: asset.footprintW,
      footprintH: asset.footprintH,
      sprite,
      isDesk: asset.isDesk,
      category: asset.category,
      ...(asset.orientation ? { orientation: asset.orientation } : {}),
      ...(asset.canPlaceOnSurfaces ? { canPlaceOnSurfaces: true } : {}),
      ...(typeof asset.backgroundTiles === 'number' ? { backgroundTiles: asset.backgroundTiles } : {}),
      ...(asset.canPlaceOnWalls ? { canPlaceOnWalls: true } : {}),
    })
  }
  dynamicCatalog = next
}

// ── Rotation helpers ─────────────────────────────────────────────

/** Returns the next asset ID in the rotation group (cw or ccw), or null if not rotatable. */
export function getRotatedType(currentType: string, direction: 'cw' | 'ccw'): string | null {
  void currentType
  void direction
  return null
}

/** Returns the toggled state variant (on↔off), or null if no state variant exists. */
export function getToggledType(currentType: string): string | null {
  void currentType
  return null
}

/** Returns the "on" variant if this type has one, otherwise returns the type unchanged. */
export function getOnStateType(currentType: string): string {
  return currentType
}

/** Returns the "off" variant if this type has one, otherwise returns the type unchanged. */
export function getOffStateType(currentType: string): string {
  return currentType
}

/** Returns true if the given furniture type is part of a rotation group. */
export function isRotatable(type: string): boolean {
  void type
  return false
}
