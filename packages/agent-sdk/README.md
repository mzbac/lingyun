# LingYun Agent SDK (Draft)

Goal: provide a **headless**, **Node-first** Agent SDK that reuses LingYun’s core interaction model (OpenCode-aligned “assistant message + parts” history, sequential tool loop, approvals) but can be embedded in non‑VS Code systems.

This SDK is intentionally **not** optimized for max parallelism. It follows LingYun’s current step/iteration loop: stream → (optional) tool calls → tool execution → continue until a final assistant response.

## Requirements

- Node.js **18+** (Node 20+ recommended)
- ESM (`"type":"module"` or `.mjs`) is recommended. CommonJS is supported via dynamic import.

## Install

```bash
npm i @kooka/agent-sdk
```

This package depends on `@kooka/core` (it will be installed automatically).

## Build (from source)

```bash
pnpm install
pnpm --filter @kooka/agent-sdk build
```

Tip: in a clean monorepo checkout, this auto-builds missing `@kooka/core` outputs (types + runtime entrypoints).

### As a dependency (local path)

In another project’s `package.json`:

```json
{
  "dependencies": {
    "@kooka/agent-sdk": "file:/absolute/path/to/lingyun/packages/agent-sdk"
  }
}
```

Then build the SDK once (it ships `dist/` via `files`, so consumers need the built output):

```bash
pnpm --dir /absolute/path/to/lingyun/packages/agent-sdk run build
```

## Publishing

`@kooka/core` and `@kooka/agent-sdk` are published together and must share the same version.

From the repo root:

```bash
pnpm --filter @kooka/core publish --no-git-checks
pnpm --filter @kooka/agent-sdk publish --no-git-checks
```

## Quickstart

Minimal “stream tokens + get final text” example:

```ts
import { createLingyunAgent, LingyunSession } from '@kooka/agent-sdk';

const { agent, llm } = createLingyunAgent({
  llm: {
    provider: 'openaiCompatible',
    baseURL: process.env.LINGYUN_BASE_URL ?? 'http://localhost:8080/v1',
    apiKey: process.env.LINGYUN_API_KEY,
    model: process.env.LINGYUN_MODEL ?? 'your-model-id',
  },
  agent: {
    mode: 'build',
    maxRetries: 1,
    maxOutputTokens: 2048,
    autoApprove: false,
  },
  workspaceRoot: process.cwd(),
  allowExternalPaths: false,
});

try {
  const session = new LingyunSession({ sessionId: 'demo' });

  const run = agent.run({
    session,
    input: 'Reply with exactly one word: ok',
    callbacks: {
      onRequestApproval: async () => false,
    },
  });

  for await (const ev of run.events) {
    if (ev.type === 'assistant_token') process.stdout.write(ev.token);
  }

  const result = await run.done;
  console.log('\\n\\nFinal:', result.text);
} finally {
  llm.dispose?.();
}
```

## Custom Tools

`createLingyunAgent(...)` returns a `ToolRegistry` so hosts can register their own tools:

```ts
import { createLingyunAgent, type ToolDefinition } from '@kooka/agent-sdk';

const { agent, registry } = createLingyunAgent({ /* ... */ });

const timeTool: ToolDefinition = {
  id: 'time_now',
  name: 'time_now',
  description: 'Get the current time as an ISO string.',
  parameters: { type: 'object', properties: {} },
  execution: { type: 'function', handler: 'time_now' },
  metadata: { readOnly: true },
};

registry.registerTool(timeTool, async () => ({
  success: true,
  data: { now: new Date().toISOString() },
}));
```

## CommonJS

```js
const { createLingyunAgent, LingyunSession } = await import('@kooka/agent-sdk')
```

## Sessions (Multi-Turn)

`LingyunSession` holds the OpenCode-aligned “assistant message + parts” history. Reuse the same `session` to continue a conversation:

```ts
const session = new LingyunSession({ sessionId: 'my-session' });
await agent.run({ session, input: 'Summarize README' }).done;
await agent.run({ session, input: 'Now list TODOs' }).done;
```

Persistence is the host’s responsibility. A simple JSON snapshot looks like:

```ts
const snapshot = {
  sessionId: session.sessionId,
  pendingPlan: session.pendingPlan,
  history: session.getHistory(),
};
```

## Streaming Events

`agent.run(...)` returns:

- `events`: `AsyncIterable<LingyunEvent>`
- `done`: `Promise<{ text, session }>`

Useful event types:

- `assistant_token`: user-facing assistant text (with `<think>` and tool-call markers removed)
- `thought_token`: model “thinking” tokens (only if the provider emits them)
- `notice`: user-facing notices from the runtime (e.g. subagent model fallback warnings)
- `tool_call` / `tool_result` / `tool_blocked`: tool lifecycle
- `compaction_start` / `compaction_end`: context overflow mitigation

## Tools

### Built-in tools

By default, `createLingyunAgent(...)` registers these built-ins:

- `read`, `write`, `list`, `glob`, `grep`, `bash`, `skill`

You can disable built-ins:

```ts
createLingyunAgent({ llm: { /*...*/ }, tools: { builtin: false } })
```

### Skills (`$skill-name`)

The SDK supports Codex-style `$skill-name` mentions.
If a user message includes `$<skill-name>`, LingYun:

1. Looks up the skill by `name:` in discovered `SKILL.md` files
2. Injects the skill body as a synthetic `<skill>...</skill>` user message before calling the model

Unknown skills are ignored.

Configure discovery/injection via `tools.builtinOptions.skills`:

```ts
createLingyunAgent({
  llm: { provider: 'openaiCompatible', baseURL: 'http://localhost:8080/v1', model: 'your-model-id' },
  workspaceRoot: process.cwd(),
  tools: {
    builtinOptions: {
      skills: {
        enabled: true,
        paths: ['.lingyun/skills', '~/.codex/skills'],
        maxPromptSkills: 50,
        maxInjectSkills: 5,
        maxInjectChars: 20_000,
      },
    },
  },
});
```

Note: the “Available skills” list included in the system prompt is built once per `LingyunAgent` instance. Create a new agent to refresh it.

### Approvals

Tools can require approval via `ToolDefinition.metadata.requiresApproval`.

- In Build mode, you can provide `callbacks.onRequestApproval` or set `agent.autoApprove=true`.
- In Plan mode, auto-approve is disabled and edit tools are blocked by default.

### Custom tools

Register a function-backed tool:

```ts
import { createLingyunAgent } from '@kooka/agent-sdk';

const { registry } = createLingyunAgent({
  llm: { provider: 'openaiCompatible', baseURL: 'http://localhost:8080/v1', model: 'your-model-id' },
  workspaceRoot: process.cwd(),
});

registry.registerTool(
  {
    id: 'demo_echo',
    name: 'Echo',
    description: 'Echo back the message argument',
    parameters: {
      type: 'object',
      properties: { message: { type: 'string' } },
      required: ['message'],
    },
    execution: { type: 'function', handler: 'demo_echo' },
    metadata: { requiresApproval: false, permission: 'read', readOnly: true },
  },
  async (args) => ({ success: true, data: `Echo: ${String(args.message ?? '')}` })
);
```

Return formatting hints via `ToolResult.metadata.outputText` / `title` to control what the agent sees.

### Browser automation (agent-browser)

If you install `agent-browser` and Chromium, you can register an **interactive browser toolset** (sessions + snapshot + actions):

```bash
npm i -g agent-browser
agent-browser install
```

Then in your host:

```ts
import { createLingyunAgent, registerAgentBrowserTools } from '@kooka/agent-sdk';

const { registry } = createLingyunAgent({
  llm: { provider: 'openaiCompatible', baseURL: 'http://localhost:8080/v1', model: 'your-model-id' },
  workspaceRoot: process.cwd(),
});

registerAgentBrowserTools(registry, {
  artifactsDir: '.kooka/agent-browser',
  timeoutMs: 30_000,
});
```

Tools:
- `browser_start_session` / `browser_close_session`
- `browser_snapshot` (read-only; returns accessibility tree with refs like `@e2`)
- `browser_run` (requires approval; runs click/fill/type/wait/get/screenshot/pdf/trace actions)

Security defaults:
- HTTPS-only and blocks private hosts / IPs by default
- No cookies/storage/state/headers APIs are exposed by this toolset (no auth-state support)
- Screenshot/PDF/trace artifacts are written under `artifactsDir` (relative to `workspaceRoot` when set)

If `agent-browser` is not on PATH, set `AGENT_BROWSER_BIN` or pass `agentBrowserBin` to `registerAgentBrowserTools`.

## Inspiration / Compatibility

- **OpenCode SDK**: OpenCode’s JavaScript SDK primarily wraps an HTTP server (client + server helpers). LingYun SDK starts with an **in‑process** agent runtime that can later be wrapped by an HTTP server if needed.
- **OpenCode patterns**: history model uses “assistant message + parts” so tool outputs cannot be orphaned from their tool calls.

## Concepts

### Agent

An agent is configured with:

- **LLM**: OpenAI-compatible endpoint config (base URL, API key, model ID).
- **Tools**: a tool registry (built-ins + user-registered tools).
- **Skills**: optional `SKILL.md` discovery + `skill` tool.
- **Plugins**: optional hook system to transform prompts / tool args / tool outputs / approval decisions.
- **Security**: workspace boundary enforcement (`allowExternalPaths`).

### Session

A session holds:

- message history (OpenCode-aligned “assistant message + parts”)
- any pending plan text (optional)

Sessions are serializable; persistence is the host application’s responsibility. The SDK does not write to disk.

You can snapshot + restore:

```ts
import { LingyunSession, snapshotSession, restoreSession } from '@kooka/agent-sdk';

const session = new LingyunSession({ sessionId: 's1' });

const snapshot = snapshotSession(session, {
  sessionId: 's1',
  // includeFileHandles: false, // omit fileId/path hints if you don't want to persist them
});

// Persist `snapshot` however you want (JSON files, sqlite, postgres, ...).

const restored = restoreSession(snapshot);
```

If you want SQLite, the SDK ships a `SqliteSessionStore` that works with any driver you provide:

```ts
import Database from 'better-sqlite3';
import { SqliteSessionStore, snapshotSession, restoreSession, type SqliteDriver } from '@kooka/agent-sdk';

const db = new Database('lingyun.db');

const driver: SqliteDriver = {
  execute: (sql, params = []) => void db.prepare(sql).run(...params),
  queryOne: (sql, params = []) => db.prepare(sql).get(...params),
  queryAll: (sql, params = []) => db.prepare(sql).all(...params),
};

const store = new SqliteSessionStore(driver);

const sessionId = 's1';
const session = new LingyunSession({ sessionId });

await store.save(sessionId, snapshotSession(session, { sessionId }));
const loaded = await store.load(sessionId);
const loadedSession = loaded ? restoreSession(loaded) : new LingyunSession({ sessionId });
```

Notes:
- The SDK does not bundle a SQLite client library; you bring your own (e.g. `better-sqlite3`, `sqlite3`).
- Session snapshots contain conversation text and may include file paths; treat persisted data as sensitive.

### Run + Streaming

`agent.run(...)` returns:

- `events`: `AsyncIterable<LingyunEvent>` (tokens, tool calls/results, status changes, compaction markers)
- `done`: a promise that resolves to `{ text, session }`

This makes it easy to integrate into CLIs, web servers, or desktop apps without coupling to a UI framework.

## Security Model

The SDK enforces workspace boundaries when `allowExternalPaths=false`:

- File tools must reject paths outside `workspaceRoot`.
- Shell tools must reject commands that reference paths outside the workspace (best-effort path detection; **not** a sandbox).
- Tools may declare `metadata.supportsExternalPaths` and provide `permissionPatterns` so the agent can detect when a call would escape the workspace.

Notes:

- The built-in `bash` tool **requires approval by default** (headless-safe default).
- Shell path enforcement is heuristic and can be bypassed (e.g. via shell expansion, interpreted code, or tools that access the network). For strict hosts, disable shell tools entirely via `toolFilter` / custom tool registration.

Approvals are handled via a host callback; `autoApprove` can bypass prompts (except for blocked external paths).

## Plugin Hooks (Subset)

Plugins can hook:

- system prompt shaping
- per-request params (temperature, provider options)
- message transforms before sending to the model
- approval decisions
- tool args before execution
- tool outputs before returning to the model

Plugins are loaded from module specifiers or file paths; hosts can also register hooks programmatically.
For security in headless environments, workspace plugin auto-discovery is **disabled by default** in the SDK (opt in via `plugins.autoDiscover: true`).

## Initial Scope (MVP)

- OpenAI-compatible LLM provider
- Tool registry + approvals + external-path enforcement
- Built-in tools: `read`, `write`, `list`, `glob`, `grep`, `bash`, `skill`
- Skills discovery compatible with `.lingyun/skills`, `.claude/skills`, `.opencode/skill(s)`, and `~/.codex/skills`

## Future Scope

- Optional HTTP server wrapper + client (OpenCode SDK style)
- More built-in tools (patch/multiedit, structured diff helpers, LSP adapters)
- Stronger shell/path safety checks (still not a sandbox)
- Richer step/operation events aligned with LingYun webview UI

## E2E Tests (Real Server)

The SDK includes a separate E2E test suite that hits a real OpenAI-compatible server over HTTP/SSE.
It is **skipped by default** unless you set `LINGYUN_E2E_BASE_URL`.

Run:

```bash
LINGYUN_E2E_BASE_URL="http://localhost:8080/v1" \
LINGYUN_E2E_MODEL="your-model-id" \
pnpm --filter @kooka/agent-sdk test:e2e
```

Environment variables:

- `LINGYUN_E2E_BASE_URL` (required): OpenAI-compatible base URL (with or without `/v1`)
- `LINGYUN_E2E_MODEL` (optional): model id; if omitted, the test will try `GET /models` and use the first returned id
- `LINGYUN_E2E_API_KEY` (optional): bearer token if required by your server
- `LINGYUN_E2E_TIMEOUT_MS` (optional): request timeout (default `300000`)
- `LINGYUN_E2E_MAX_OUTPUT_TOKENS` (optional): output cap for the “large stream” test (default `4096`)
- `LINGYUN_E2E_LARGE_MIN_CHARS` (optional): minimum characters required by the “large stream” test (default `8000`)
- `LINGYUN_E2E_ENABLE_TOOLCALLS` (optional): set to `0` to disable the tool-call E2E test (on by default)
