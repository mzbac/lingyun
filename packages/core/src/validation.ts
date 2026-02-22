import type { ToolParameterSchema } from './toolSchema';

export interface ValidationResult<T = Record<string, unknown>> {
  valid: boolean;
  errors: string[];
  data: T;
}

export function validateToolArgs(
  args: Record<string, unknown>,
  schema: {
    properties: Record<string, ToolParameterSchema>;
    required?: string[];
  }
): ValidationResult {
  const errors: string[] = [];
  const validated: Record<string, unknown> = {};

  for (const field of schema.required || []) {
    if (args[field] === undefined || args[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const value = args[key];

    if (value === undefined || value === null) {
      if (propSchema.default !== undefined) {
        validated[key] = propSchema.default;
      }
      continue;
    }

    const typeResult = validateType(value, propSchema, key);
    if (typeResult.error) {
      errors.push(typeResult.error);
    } else {
      validated[key] = typeResult.value;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    data: validated,
  };
}

function validateType(
  value: unknown,
  schema: ToolParameterSchema,
  fieldName: string
): { value?: unknown; error?: string } {
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') {
        return { error: `${fieldName}: expected string, got ${typeof value}` };
      }
      if (schema.enum && !schema.enum.includes(value)) {
        return {
          error: `${fieldName}: value '${value}' not in allowed values: ${schema.enum.join(', ')}`,
        };
      }
      return { value };
    }
    case 'number': {
      if (typeof value === 'number') {
        if (isNaN(value)) {
          return { error: `${fieldName}: expected number, got NaN` };
        }
        return { value };
      }
      if (typeof value === 'string') {
        const num = parseFloat(value);
        if (!isNaN(num)) {
          return { value: num };
        }
      }
      return { error: `${fieldName}: expected number, got ${typeof value}` };
    }
    case 'boolean': {
      if (typeof value === 'boolean') {
        return { value };
      }
      if (typeof value === 'string') {
        const lower = value.toLowerCase();
        if (lower === 'true' || lower === '1' || lower === 'yes') return { value: true };
        if (lower === 'false' || lower === '0' || lower === 'no') return { value: false };
      }
      return { error: `${fieldName}: expected boolean, got ${typeof value}` };
    }
    case 'array': {
      if (!Array.isArray(value)) {
        return { error: `${fieldName}: expected array, got ${typeof value}` };
      }
      if (schema.items) {
        const validatedItems: unknown[] = [];
        for (let i = 0; i < value.length; i++) {
          const itemResult = validateType(value[i], schema.items, `${fieldName}[${i}]`);
          if (itemResult.error) {
            return itemResult;
          }
          validatedItems.push(itemResult.value);
        }
        return { value: validatedItems };
      }
      return { value };
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return { error: `${fieldName}: expected object, got ${typeof value}` };
      }
      if (schema.properties) {
        const nestedResult = validateToolArgs(value as Record<string, unknown>, {
          properties: schema.properties,
          required: schema.required,
        });
        if (!nestedResult.valid) {
          return { error: `${fieldName}: ${nestedResult.errors.join(', ')}` };
        }
        return { value: nestedResult.data };
      }
      return { value };
    }
    default:
      return { value };
  }
}

export function requireString(
  args: Record<string, unknown>,
  field: string
): { value: string } | { error: string } {
  const value = args[field];
  if (typeof value !== 'string') {
    return { error: `${field} is required and must be a string` };
  }
  return { value };
}

export function normalizeSessionId(
  value: unknown,
  options?: { maxLength?: number }
): string | undefined {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return undefined;

  const maxLength =
    typeof options?.maxLength === 'number' && Number.isFinite(options.maxLength) && options.maxLength > 0
      ? Math.floor(options.maxLength)
      : 64;

  if (trimmed.length > maxLength) return undefined;

  // Prevent path traversal / weird filenames: only allow simple url-safe tokens.
  // This is used for session identifiers that may become part of a filename (e.g. `${id}.json`).
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return undefined;

  return trimmed;
}

export function optionalString(args: Record<string, unknown>, field: string, defaultValue?: string): string | undefined {
  const value = args[field];
  if (value === undefined || value === null) {
    return defaultValue;
  }
  return typeof value === 'string' ? value : defaultValue;
}

export function optionalNumber(args: Record<string, unknown>, field: string, defaultValue?: number): number | undefined {
  const value = args[field];
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === 'number' && !isNaN(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      return num;
    }
  }
  return defaultValue;
}

export function optionalBoolean(
  args: Record<string, unknown>,
  field: string,
  defaultValue?: boolean
): boolean | undefined {
  const value = args[field];
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const lower = value.toLowerCase();
    if (lower === 'true' || lower === '1' || lower === 'yes') return true;
    if (lower === 'false' || lower === '0' || lower === 'no') return false;
  }
  return defaultValue;
}

export type ShellCommandDecision =
  | { verdict: 'allow' }
  | { verdict: 'needs_approval'; reason: string }
  | { verdict: 'deny'; reason: string };

const SAFE_SHELL_COMMANDS = new Set([
  'ls',
  'dir',
  'pwd',
  'echo',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'find',
  'git',
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'node',
  'python',
  'python3',
  'pip',
  'cargo',
  'go',
  'make',
  'cmake',
  'dotnet',
  'mvn',
  'gradle',
  'tsc',
  'eslint',
  'prettier',
  'jest',
  'mocha',
  'pytest',
  'docker',
  'kubectl',
  'terraform',
  'curl',
  'wget',
  'jq',
  'yq',
]);

const BLOCKED_SHELL_PATTERNS = [
  /\brm\s+-rf?\s+[/~]/i,
  /\bsudo\b/i,
  /\b(shutdown|reboot|halt)\b/i,
  /\bdd\s+if=/i,
  /\bmkfs/i,
  /\bformat\b/i,
  />[>&]\s*\/dev\//i,
];

type ShellMetaHit =
  | { kind: 'separator'; token: ';' | '&&' | '||' | '|' }
  | { kind: 'redirection'; token: '<' | '>' }
  | { kind: 'background'; token: '&' }
  | { kind: 'subshell'; token: '`' | '$(' }
  | { kind: 'newline'; token: '\\n' | '\\r' };

type QuoteState = 'none' | 'single' | 'double';

function findFirstShellMeta(command: string): ShellMetaHit | undefined {
  let quote: QuoteState = 'none';
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (quote === 'single') {
      if (ch === "'") quote = 'none';
      continue;
    }

    // Outside single quotes, backslash escapes the next character.
    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (quote === 'double') {
      if (ch === '"') {
        quote = 'none';
        continue;
      }

      // Command substitution still executes inside double quotes.
      if (ch === '`') return { kind: 'subshell', token: '`' };
      if (ch === '$' && command[i + 1] === '(') return { kind: 'subshell', token: '$(' };

      continue;
    }

    // quote === 'none'
    if (ch === "'") {
      quote = 'single';
      continue;
    }
    if (ch === '"') {
      quote = 'double';
      continue;
    }

    if (ch === '\n') return { kind: 'newline', token: '\\n' };
    if (ch === '\r') return { kind: 'newline', token: '\\r' };

    if (ch === '<' || ch === '>') return { kind: 'redirection', token: ch };

    if (ch === ';') return { kind: 'separator', token: ';' };

    if (ch === '&') {
      if (command[i + 1] === '&') {
        i++;
        return { kind: 'separator', token: '&&' };
      }
      return { kind: 'background', token: '&' };
    }

    if (ch === '|') {
      if (command[i + 1] === '|') {
        i++;
        return { kind: 'separator', token: '||' };
      }
      return { kind: 'separator', token: '|' };
    }

    if (ch === '`') return { kind: 'subshell', token: '`' };
    if (ch === '$' && command[i + 1] === '(') return { kind: 'subshell', token: '$(' };
  }

  return undefined;
}

function stripLeadingEnvAssignments(command: string): string {
  const words = command.trim().split(/\s+/);
  let i = 0;
  while (i < words.length) {
    const word = words[i] || '';
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) {
      i++;
      continue;
    }
    break;
  }
  return words.slice(i).join(' ');
}

export function evaluateShellCommand(command: string): ShellCommandDecision {
  for (const pattern of BLOCKED_SHELL_PATTERNS) {
    if (pattern.test(command)) {
      return { verdict: 'deny', reason: 'Command matches blocked pattern' };
    }
  }

  const meta = findFirstShellMeta(command);
  if (meta) {
    const reason =
      meta.kind === 'separator'
        ? 'Command contains shell operators (;, &&, ||, |) and requires approval'
        : meta.kind === 'redirection'
          ? 'Command contains shell redirection (<, >) and requires approval'
          : meta.kind === 'background'
            ? 'Command contains background chaining (&) and requires approval'
            : meta.kind === 'subshell'
              ? 'Command contains command substitution (` or $()) and requires approval'
              : 'Command contains newlines and requires approval';
    return { verdict: 'needs_approval', reason };
  }

  const normalized = stripLeadingEnvAssignments(command);
  const baseCommand = normalized.trim().split(/\s+/)[0]?.split('/').pop() || '';
  if (SAFE_SHELL_COMMANDS.has(baseCommand)) {
    return { verdict: 'allow' };
  }

  return { verdict: 'needs_approval', reason: `Command '${baseCommand}' requires approval` };
}
