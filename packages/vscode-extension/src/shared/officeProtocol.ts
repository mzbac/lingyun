export type OfficeWorkType = 'read' | 'search' | 'write' | 'execute' | 'task' | 'other';

export type OfficeSpriteData = string[][];

export type OfficeFurnitureCategory =
  | 'desks'
  | 'chairs'
  | 'storage'
  | 'decor'
  | 'electronics'
  | 'wall'
  | 'misc';

export type OfficeFurnitureAsset = {
  type: string;
  label: string;
  category: OfficeFurnitureCategory;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  orientation?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  canPlaceOnWalls?: boolean;
};

export type OfficeAgentSeat = {
  palette: number;
  hueShift: number;
  seatId: string | null;
};

export type OfficeAgentMeta = Partial<OfficeAgentSeat>;

export type OfficeToWebviewMessage =
  | { type: 'layoutLoaded'; layout: unknown | null }
  | { type: 'resetLayoutToDefault' }
  | { type: 'settingsLoaded'; soundEnabled: boolean }
  | { type: 'existingAgents'; agents: number[]; agentMeta?: Record<number, OfficeAgentMeta> }
  | { type: 'agentSelected'; id: number }
  | { type: 'agentStatus'; id: number; status: 'active' | 'waiting' | 'idle' }
  | { type: 'agentToolStart'; id: number; toolId: string; toolName?: string; workType?: OfficeWorkType; status: string }
  | { type: 'agentToolDone'; id: number; toolId: string }
  | { type: 'agentToolsClear'; id: number }
  | { type: 'agentToolPermission'; id: number }
  | { type: 'subagentToolPermission'; id: number; parentToolId: string }
  | { type: 'agentToolPermissionClear'; id: number }
  | { type: 'furnitureCatalogLoaded'; catalog: OfficeFurnitureAsset[] }
  | { type: 'furnitureSpritesLoaded'; sprites: Record<string, OfficeSpriteData> }
  | { type: 'subagentCreated'; id: number; parentToolId: string; label?: string; subagentType?: string }
  | {
      type: 'subagentToolStart';
      id: number;
      parentToolId: string;
      toolId: string;
      toolName?: string;
      workType?: OfficeWorkType;
      status: string;
    }
  | { type: 'subagentToolDone'; id: number; parentToolId: string; toolId: string }
  | { type: 'subagentClear'; id: number; parentToolId: string }
  | { type: 'characterSpritesLoaded'; characters: Array<{ down: string[][][]; up: string[][][]; right: string[][][] }> }
  | { type: 'floorTilesLoaded'; sprites: string[][][] }
  | { type: 'wallTilesLoaded'; sprites: string[][][] };

export type WebviewToExtensionMessage =
  | { type: 'webviewReady' }
  | { type: 'focusAgent'; id: number }
  | { type: 'closeAgent'; id: number }
  | { type: 'saveAgentSeats'; seats: Record<number, OfficeAgentSeat> }
  | { type: 'saveLayout'; layout: unknown }
  | { type: 'setSoundEnabled'; enabled: boolean }
  | { type: 'openSessionsFolder' }
  | { type: 'exportLayout' }
  | { type: 'importLayout' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function isOfficeToWebviewMessage(value: unknown): value is OfficeToWebviewMessage {
  if (!isRecord(value)) return false;
  const type = value.type;
  if (typeof type !== 'string') return false;

  switch (type) {
    case 'layoutLoaded':
      return 'layout' in value;
    case 'resetLayoutToDefault':
      return true;
    case 'settingsLoaded':
      return typeof value.soundEnabled === 'boolean';
    case 'existingAgents':
      return Array.isArray(value.agents) && value.agents.every((id) => typeof id === 'number');
    case 'agentSelected':
      return typeof value.id === 'number';
    case 'agentStatus':
      return (
        typeof value.id === 'number' &&
        (value.status === 'active' || value.status === 'waiting' || value.status === 'idle')
      );
    case 'agentToolStart':
      return typeof value.id === 'number' && typeof value.toolId === 'string' && typeof value.status === 'string';
    case 'agentToolDone':
      return typeof value.id === 'number' && typeof value.toolId === 'string';
    case 'agentToolsClear':
      return typeof value.id === 'number';
    case 'agentToolPermission':
      return typeof value.id === 'number';
    case 'subagentToolPermission':
      return typeof value.id === 'number' && typeof value.parentToolId === 'string';
    case 'agentToolPermissionClear':
      return typeof value.id === 'number';
    case 'furnitureCatalogLoaded':
      return Array.isArray(value.catalog);
    case 'furnitureSpritesLoaded':
      return isRecord(value.sprites);
    case 'subagentCreated':
      return typeof value.id === 'number' && typeof value.parentToolId === 'string';
    case 'subagentToolStart':
      return (
        typeof value.id === 'number' &&
        typeof value.parentToolId === 'string' &&
        typeof value.toolId === 'string' &&
        typeof value.status === 'string'
      );
    case 'subagentToolDone':
      return typeof value.id === 'number' && typeof value.parentToolId === 'string' && typeof value.toolId === 'string';
    case 'subagentClear':
      return typeof value.id === 'number' && typeof value.parentToolId === 'string';
    case 'characterSpritesLoaded':
      return Array.isArray(value.characters);
    case 'floorTilesLoaded':
      return Array.isArray(value.sprites);
    case 'wallTilesLoaded':
      return Array.isArray(value.sprites);
    default:
      return false;
  }
}

export function isWebviewToExtensionMessage(value: unknown): value is WebviewToExtensionMessage {
  if (!isRecord(value)) return false;
  const type = value.type;
  if (typeof type !== 'string') return false;

  switch (type) {
    case 'webviewReady':
      return true;
    case 'focusAgent':
      return typeof value.id === 'number';
    case 'closeAgent':
      return typeof value.id === 'number';
    case 'saveAgentSeats':
      return isRecord(value.seats);
    case 'saveLayout':
      return 'layout' in value;
    case 'setSoundEnabled':
      return typeof value.enabled === 'boolean';
    case 'openSessionsFolder':
      return true;
    case 'exportLayout':
      return true;
    case 'importLayout':
      return true;
    default:
      return false;
  }
}
