import type { OfficeWorkType } from '../../shared/officeProtocol';

export type { OfficeWorkType } from '../../shared/officeProtocol';

function classifyBashWorkType(command: unknown): OfficeWorkType {
  const raw = typeof command === 'string' ? command.trim() : '';
  if (!raw) return 'execute';

  // Extremely lightweight heuristics:
  // - Treat common file inspection/search commands as "read/search" work.
  // - Everything else is "execute" work (terminals/PCs).
  //
  // Note: real commands often look like `cd repo && cat README.md`, so we
  // inspect the first "meaningful" segment in a simple command chain.
  const normalized = raw.replace(/\s+/g, ' ').trim();
  const segments = normalized
    .split(/(?:\s*&&\s*|\s*;\s*|\n+)/)
    .map((s) => s.trim())
    .filter(Boolean);

  const classifySegment = (segment: string): OfficeWorkType | null => {
    let seg = segment.replace(/^[({[]\s*/, '').trim();
    if (!seg) return null;

    // Ignore common prelude commands.
    if (/^(cd|export|set)\b/i.test(seg)) return null;
    if (/^(pwd|echo)\b/i.test(seg)) return null;

    // Optional privilege prefix.
    seg = seg.replace(/^sudo\s+/i, '');

    if (/^(rg|grep|find)\b/i.test(seg)) return 'search';
    if (/^(cat|sed|head|tail|less|more|bat|ls|tree|stat|file)\b/i.test(seg)) return 'read';

    // Git often used for file inspection / searching.
    if (/^git\s+(-C\s+\S+\s+)?(diff|show|status|log|ls-files)\b/i.test(seg)) return 'read';
    if (/^git\s+(-C\s+\S+\s+)?(grep)\b/i.test(seg)) return 'search';

    return 'execute';
  };

  for (const seg of segments) {
    const result = classifySegment(seg);
    if (result) return result;
  }

  // Fallback: look anywhere in the command string (for cases like `cd ... && cat ...` in a single segment).
  if (/\b(rg|grep|find|git\s+grep)\b/i.test(normalized)) return 'search';
  if (
    /\b(cat|sed|head|tail|less|more|bat|git\s+(diff|show|status|log|ls-files)|ls|tree|stat|file)\b/i.test(
      normalized,
    )
  ) {
    return 'read';
  }

  return 'execute';
}

export function classifyOfficeWorkType(toolName: string, args: Record<string, unknown>): OfficeWorkType {
  const tool = (toolName || '').trim().toLowerCase();
  if (!tool) return 'other';

  // Todo tools represent planning/reviewing work and should happen at a board.
  if (tool === 'todowrite' || tool === 'todoread') return 'task';

  if (
    tool === 'read' ||
    tool === 'read_range' ||
    tool === 'list' ||
    tool === 'symbols_peek' ||
    tool === 'lsp' ||
    tool === 'get_memory'
  ) {
    return 'read';
  }
  if (tool === 'grep' || tool === 'glob' || tool === 'symbols_search') return 'search';
  if (tool === 'write' || tool === 'edit') return 'write';
  // The Task tool represents a background "subagent" job; keep the character at a computer.
  if (tool === 'task') return 'write';
  if (tool === 'bash') return classifyBashWorkType(args.command);

  return 'other';
}
