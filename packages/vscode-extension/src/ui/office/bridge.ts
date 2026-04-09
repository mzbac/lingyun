import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';

import type { ToolCall, ToolDefinition, ToolResult } from '../../core/types';
import type { OfficeAgentSeat, OfficeToWebviewMessage } from '../../shared/officeProtocol';
import { classifyOfficeWorkType } from './workTypes';

export type { OfficeAgentSeat, OfficeWorkType } from '../../shared/officeProtocol';

type PersistedOfficeStateV2 = {
  version: 2;
  seatsByAgentId: Record<string, OfficeAgentSeat>;
  layout?: unknown;
  soundEnabled?: boolean;
};

const STORAGE_KEY = 'lingyun.office.state';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function basename(filePath: unknown): string {
  const raw = typeof filePath === 'string' ? filePath.trim() : '';
  if (!raw) return '';
  try {
    return path.basename(raw);
  } catch {
    return raw;
  }
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd() + '…';
}

function stableAgentIdForSessionId(sessionId: string): number {
  const trimmed = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (!trimmed) return -1;
  const hash = crypto.createHash('sha256').update(trimmed).digest();

  // 48-bit agent ID (safe integer) derived from the session ID.
  let id = 0;
  for (let i = 0; i < 6; i++) {
    id = id * 256 + (hash[i] ?? 0);
  }
  return id === 0 ? 1 : id;
}

function redactCommandPreview(command: string): string {
  let value = (command || '').replace(/\s+/g, ' ').trim();
  if (!value) return '';

  // Redact basic auth in URLs: https://user:pass@host
  value = value.replace(/\/\/([^:\s/]+):([^@\s/]+)@/g, '//***:***@');

  // Redact Authorization headers / bearer tokens.
  value = value.replace(/\b(Authorization:)\s*Bearer\s+[^\s"']+/gi, '$1 Bearer ***');
  value = value.replace(/\bBearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***');

  // Redact common secret env assignments.
  value = value.replace(
    /\b((?:OPENAI|ANTHROPIC|GITHUB|COPILOT|AZURE|AWS|GOOGLE|HF|HUGGINGFACE)[A-Z0-9_]*?(?:API_)?(?:KEY|TOKEN|SECRET|PASSWORD))=([^\s]+)/gi,
    '$1=***',
  );

  // Redact common CLI flags.
  value = value.replace(
    /(--?)(token|api[-_]?key|secret|password)(=|\s+)([^\s]+)/gi,
    (_match, dashes, name, sep) => `${dashes}${name}${sep}***`,
  );

  return value;
}

function parseSeatsByAgentId(raw: unknown): Record<string, OfficeAgentSeat> {
  if (!isRecord(raw)) return {};

  const out: Record<string, OfficeAgentSeat> = {};
  for (const [agentIdRaw, seatRaw] of Object.entries(raw)) {
    const agentIdNum = Number(agentIdRaw);
    if (!Number.isFinite(agentIdNum) || agentIdNum <= 0) continue;
    const agentId = String(Math.floor(agentIdNum));
    if (!isRecord(seatRaw)) continue;

    const palette =
      typeof seatRaw.palette === 'number' && Number.isFinite(seatRaw.palette)
        ? Math.floor(seatRaw.palette)
        : 0;
    const hueShift =
      typeof seatRaw.hueShift === 'number' && Number.isFinite(seatRaw.hueShift)
        ? Math.floor(seatRaw.hueShift)
        : 0;
    const seatId = typeof seatRaw.seatId === 'string' ? seatRaw.seatId : null;

    out[agentId] = { palette, hueShift, seatId };
  }
  return out;
}

export class OfficeBridge {
  private webview?: vscode.Webview;

  private seatsByAgentId: Record<string, OfficeAgentSeat> = {};
  private layout: unknown | undefined;
  private soundEnabled: boolean | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.load();
  }

  attachWebview(webview: vscode.Webview): void {
    this.webview = webview;
  }

  detachWebview(): void {
    this.webview = undefined;
  }

  getSoundEnabled(defaultValue = true): boolean {
    if (typeof this.soundEnabled === 'boolean') return this.soundEnabled;
    return defaultValue;
  }

  setSoundEnabled(enabled: boolean): void {
    this.soundEnabled = enabled;
    this.save();
  }

  getLayout(): unknown | undefined {
    return this.layout;
  }

  setLayout(layout: unknown): void {
    this.layout = layout;
    this.save();
  }

  clearLayout(): void {
    if (typeof this.layout === 'undefined') return;
    this.layout = undefined;
    this.save();
  }

  saveSeatsFromWebview(seatsByAgentId: Record<string, unknown>): void {
    for (const [agentIdRaw, seatRaw] of Object.entries(seatsByAgentId || {})) {
      const agentId = Number(agentIdRaw);
      if (!Number.isFinite(agentId)) continue;
      if (!isRecord(seatRaw)) continue;
      const paletteRaw = seatRaw.palette;
      const hueShiftRaw = seatRaw.hueShift;
      const palette = typeof paletteRaw === 'number' && Number.isFinite(paletteRaw) ? Math.floor(paletteRaw) : 0;
      const hueShift = typeof hueShiftRaw === 'number' && Number.isFinite(hueShiftRaw) ? Math.floor(hueShiftRaw) : 0;
      const seatId = typeof seatRaw.seatId === 'string' ? seatRaw.seatId : null;
      const key = String(Math.floor(agentId));
      this.seatsByAgentId[key] = { palette, hueShift, seatId };
    }
    this.save();
  }

  getAgentIdForSessionId(sessionId: string): number {
    return stableAgentIdForSessionId(sessionId);
  }

  syncSessions(
    sessions: Iterable<{ id: string; parentSessionId?: string }>,
    activeSessionId: string
  ): string | undefined {
    const normalizedSessions: Array<{ id: string; parentSessionId?: string }> = [];
    const sessionIdSet = new Set<string>();
    const agentIdSet = new Set<string>();

    for (const session of sessions) {
      const sessionId = typeof session?.id === 'string' ? session.id.trim() : '';
      if (!sessionId) continue;

      const parentSessionIdRaw =
        typeof session?.parentSessionId === 'string' ? session.parentSessionId.trim() : '';
      const parentSessionId = parentSessionIdRaw || undefined;

      normalizedSessions.push({ id: sessionId, ...(parentSessionId ? { parentSessionId } : {}) });
      sessionIdSet.add(sessionId);
      agentIdSet.add(String(stableAgentIdForSessionId(sessionId)));
    }

    // Prune stale persisted mappings once we have an authoritative session list.
    // Avoid pruning when sessions aren't loaded yet (empty list), to prevent wiping state.
    if (sessionIdSet.size > 0 && agentIdSet.size > 0) {
      let didPrune = false;

      const nextSeatsByAgentId: Record<string, OfficeAgentSeat> = {};
      for (const agentId of agentIdSet) {
        const seat = this.seatsByAgentId[agentId];
        if (seat) nextSeatsByAgentId[agentId] = seat;
      }
      if (Object.keys(nextSeatsByAgentId).length !== Object.keys(this.seatsByAgentId).length) {
        this.seatsByAgentId = nextSeatsByAgentId;
        didPrune = true;
      }

      if (didPrune) {
        this.save();
      }
    }

    const activeId = typeof activeSessionId === 'string' ? activeSessionId.trim() : '';
    const activeVisibleSessionId = activeId && sessionIdSet.has(activeId) ? activeId : normalizedSessions[0]?.id;

    const ids: number[] = [];
    const agentMeta: Record<number, OfficeAgentSeat> = {};
    let activeAgentId: number | undefined;

    const visibleSessionIds: string[] = [];
    if (activeVisibleSessionId) {
      const active = normalizedSessions.find((s) => s.id === activeVisibleSessionId);
      const parent = active?.parentSessionId;
      if (parent && sessionIdSet.has(parent)) {
        visibleSessionIds.push(parent);
      }
      visibleSessionIds.push(activeVisibleSessionId);
    }

    for (const sessionId of visibleSessionIds) {
      const agentId = this.getAgentIdForSessionId(sessionId);
      if (agentId <= 0) continue;
      if (sessionId === activeVisibleSessionId) {
        activeAgentId = agentId;
      }
      if (!ids.includes(agentId)) {
        ids.push(agentId);
      }
      const seat = this.seatsByAgentId[String(agentId)];
      if (seat) {
        agentMeta[agentId] = seat;
      }
    }

    this.postMessage({ type: 'existingAgents', agents: ids, agentMeta });

    if (typeof activeAgentId === 'number' && Number.isFinite(activeAgentId) && activeAgentId > 0) {
      this.postMessage({ type: 'agentSelected', id: activeAgentId });
    }

    return activeVisibleSessionId;
  }

  postAgentStatus(sessionId: string, status: 'active' | 'waiting' | 'idle'): void {
    const agentId = this.getAgentIdForSessionId(sessionId);
    if (agentId <= 0) return;
    this.postMessage({ type: 'agentStatus', id: agentId, status });
  }

  postAgentToolStart(params: {
    sessionId: string;
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }): void {
    const agentId = this.getAgentIdForSessionId(params.sessionId);
    if (agentId <= 0) return;
    const workType = classifyOfficeWorkType(params.toolName, params.args);
    this.postMessage({
      type: 'agentToolStart',
      id: agentId,
      toolId: params.toolCallId,
      toolName: params.toolName,
      workType,
      status: this.formatToolStatus(params.toolName, params.args),
    });
  }

  postAgentToolDone(sessionId: string, toolCallId: string): void {
    const agentId = this.getAgentIdForSessionId(sessionId);
    if (agentId <= 0) return;
    this.postMessage({ type: 'agentToolDone', id: agentId, toolId: toolCallId });
  }

  postAgentToolsClear(sessionId: string): void {
    const agentId = this.getAgentIdForSessionId(sessionId);
    if (agentId <= 0) return;
    this.postMessage({ type: 'agentToolsClear', id: agentId });
  }

  postAgentPermission(sessionId: string): void {
    const agentId = this.getAgentIdForSessionId(sessionId);
    if (agentId <= 0) return;
    this.postMessage({ type: 'agentToolPermission', id: agentId });
  }

  postAgentPermissionClear(sessionId: string): void {
    const agentId = this.getAgentIdForSessionId(sessionId);
    if (agentId <= 0) return;
    this.postMessage({ type: 'agentToolPermissionClear', id: agentId });
  }

  postSubagentToolStart(params: {
    parentSessionId: string;
    parentToolCallId: string;
    toolCallId: string;
    toolName: string;
    args: Record<string, unknown>;
  }): void {
    const agentId = this.getAgentIdForSessionId(params.parentSessionId);
    if (agentId <= 0) return;
    const workType = classifyOfficeWorkType(params.toolName, params.args);
    this.postMessage({
      type: 'subagentToolStart',
      id: agentId,
      parentToolId: params.parentToolCallId,
      toolId: params.toolCallId,
      toolName: params.toolName,
      workType,
      status: this.formatToolStatus(params.toolName, params.args),
    });
  }

  postSubagentToolDone(params: { parentSessionId: string; parentToolCallId: string; toolCallId: string }): void {
    const agentId = this.getAgentIdForSessionId(params.parentSessionId);
    if (agentId <= 0) return;
    this.postMessage({
      type: 'subagentToolDone',
      id: agentId,
      parentToolId: params.parentToolCallId,
      toolId: params.toolCallId,
    });
  }

  postSubagentPermission(params: { parentSessionId: string; parentToolCallId: string }): void {
    const agentId = this.getAgentIdForSessionId(params.parentSessionId);
    if (agentId <= 0) return;
    this.postMessage({
      type: 'subagentToolPermission',
      id: agentId,
      parentToolId: params.parentToolCallId,
    });
  }

  postSubagentClear(params: { parentSessionId: string; parentToolCallId: string }): void {
    const agentId = this.getAgentIdForSessionId(params.parentSessionId);
    if (agentId <= 0) return;
    this.postMessage({
      type: 'subagentClear',
      id: agentId,
      parentToolId: params.parentToolCallId,
    });
  }

  handleSubagentToolCall(params: {
    parentSessionId: string;
    parentToolCallId: string;
    tool: ToolCall;
    definition: ToolDefinition;
  }): void {
    const toolName = params.definition.id || params.tool.function.name;
    const args = this.tryParseArgs(params.tool.function.arguments);
    this.postSubagentToolStart({
      parentSessionId: params.parentSessionId,
      parentToolCallId: params.parentToolCallId,
      toolCallId: params.tool.id,
      toolName,
      args,
    });
  }

  handleSubagentToolResult(params: {
    parentSessionId: string;
    parentToolCallId: string;
    tool: ToolCall;
    result: ToolResult;
  }): void {
    this.postSubagentToolDone({
      parentSessionId: params.parentSessionId,
      parentToolCallId: params.parentToolCallId,
      toolCallId: params.tool.id,
    });
  }

  handleSubagentRequestApproval(params: {
    parentSessionId: string;
    parentToolCallId: string;
    tool: ToolCall;
    definition: ToolDefinition;
  }): void {
    this.postSubagentPermission({
      parentSessionId: params.parentSessionId,
      parentToolCallId: params.parentToolCallId,
    });
  }

  handleSubagentApprovalResolved(params: { parentSessionId: string; parentToolCallId: string }): void {
    // Current webview protocol only supports clearing all permission bubbles for the parent.
    // Keep it simple and clear parent + subagent bubbles at the same time.
    this.postAgentPermissionClear(params.parentSessionId);
  }

  private formatToolStatus(toolName: string, args: Record<string, unknown>): string {
    const tool = toolName.trim();

    if (tool === 'read') return `Reading ${basename(args.filePath || args.file_path || args.path)}`;
    if (tool === 'read_range') return `Reading ${basename(args.filePath || args.file_path || args.path)}`;
    if (tool === 'write') return `Writing ${basename(args.filePath || args.file_path || args.path)}`;
    if (tool === 'edit') return `Editing ${basename(args.filePath || args.file_path || args.path)}`;

    if (tool === 'glob') return 'Globbing files';
    if (tool === 'grep') return 'Searching code';
    if (tool === 'list') return 'Reading directory';
    if (tool === 'symbols_search') return 'Searching symbols';
    if (tool === 'symbols_peek') return 'Reading symbols';
    if (tool === 'lsp') return 'Reading editor state';
    if (tool === 'get_memory') return 'Reading memory';

    if (tool === 'todowrite') {
      const todos = Array.isArray(args.todos) ? args.todos : null;
      const count = todos ? todos.length : 0;
      return count > 0 ? `Updating todo list (${count})` : 'Updating todo list';
    }
    if (tool === 'todoread') return 'Reading todo list';

    if (tool === 'bash') {
      const cmd = typeof args.command === 'string' ? args.command : '';
      const preview = cmd ? truncate(redactCommandPreview(cmd), 40) : '';
      return preview ? `Running: ${preview}` : 'Running command';
    }

    if (tool === 'task') {
      const desc = typeof args.description === 'string' ? args.description.trim() : '';
      return `Task: ${truncate(desc || 'Subagent task', 60)}`;
    }

    return `Using ${toolName || 'tool'}`;
  }

  private tryParseArgs(json: string): Record<string, unknown> {
    const raw = typeof json === 'string' ? json : '';
    if (!raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw);
      if (isRecord(parsed)) return parsed;
      return {};
    } catch {
      return {};
    }
  }

  private postMessage(message: OfficeToWebviewMessage): void {
    if (!this.webview) return;
    try {
      void this.webview.postMessage(message);
    } catch {
      // ignore post errors (view may be gone)
    }
  }

  private load(): void {
    const raw = this.context.globalState.get<unknown>(STORAGE_KEY);
    if (!isRecord(raw) || raw.version !== 2) {
      return;
    }

    const parsed = raw as PersistedOfficeStateV2;
    this.seatsByAgentId = parseSeatsByAgentId(parsed.seatsByAgentId);
    if ('layout' in parsed) {
      this.layout = parsed.layout;
    }
    if (typeof parsed.soundEnabled === 'boolean') {
      this.soundEnabled = parsed.soundEnabled;
    }
  }

  private save(): void {
    const next: PersistedOfficeStateV2 = {
      version: 2,
      seatsByAgentId: this.seatsByAgentId,
      ...(typeof this.layout !== 'undefined' ? { layout: this.layout } : {}),
      ...(typeof this.soundEnabled === 'boolean' ? { soundEnabled: this.soundEnabled } : {}),
    };
    void this.context.globalState.update(STORAGE_KEY, next);
  }

  postSubagentCreated(params: {
    parentSessionId: string;
    parentToolCallId: string;
    label?: string;
    subagentType?: string;
  }): void {
    const agentId = this.getAgentIdForSessionId(params.parentSessionId);
    if (agentId <= 0) return;
    const label = typeof params.label === 'string' ? params.label.trim() : '';
    const subagentType = typeof params.subagentType === 'string' ? params.subagentType.trim() : '';

    this.postMessage({
      type: 'subagentCreated',
      id: agentId,
      parentToolId: params.parentToolCallId,
      ...(label ? { label } : {}),
      ...(subagentType ? { subagentType } : {}),
    });
  }
}
