# kookaburra

> Kookaburra is the agent orchestration layer for agentic workflows — infrastructure that abstracts models, tools, memory, and execution so agents can be built once and run anywhere.

`@kooka/kookaburra` is a reference runtime built on `@kooka/agent-sdk`.

## Quick Start

1. Create a workspace config file:

- `<workspace>/.kookaburra/runtime.json`

You can generate a starter config with:

```bash
pnpm -C packages/kookaburra build
pnpm -C packages/kookaburra kookaburra -- onboard
```

`onboard` also creates skeleton identity files in the workspace root if they are missing:
`IDENTITY.md`, `SOUL.md`, `USER.md`, `AGENTS.md`.

```json
{
  "llm": {
    "provider": "openaiCompatible",
    "baseURL": "http://localhost:8080/v1",
    "model": "your-model-id"
  },
  "agent": { "mode": "build" },
  "security": { "allowExternalPaths": false },
  "persistence": { "sessionsDir": ".kookaburra/sessions" },
  "cron": {
    "enabled": true,
    "pollMs": 15000,
    "maxConcurrent": 4,
    "jobsFile": ".kookaburra/cron/jobs.json"
  }
}
```

2. Set environment variables (recommended for secrets):

```bash
export KOOKABURRA_API_KEY="..."   # optional, only if your endpoint requires it
export KOOKABURRA_BASE_URL="http://localhost:8080/v1"
export KOOKABURRA_MODEL="your-model-id"
```

3. Build and run:

```bash
pnpm -C packages/kookaburra build

# One-shot
pnpm -C packages/kookaburra kookaburra -- agent --message "Reply with: ok"

# Interactive
pnpm -C packages/kookaburra kookaburra -- agent
```

## Identity Files (Optional)

If these files exist in your workspace root, Kookaburra appends them to the agent system prompt:

- `IDENTITY.md` (who the agent is)
- `SOUL.md` (personality/values)
- `USER.md` (who the agent helps)
- `AGENTS.md` (behavior guidelines)

## Plugins (Tools + Hooks)

Kookaburra can load plugins that provide additional tools (and optional hooks) via `@kooka/agent-sdk`.

- Auto-discovery (disabled by default): `<workspace>/.kookaburra/plugin/*.js|mjs|cjs`
- Explicit modules: file paths (use `./relative/path.mjs` or absolute paths) or Node module specifiers (resolved from the workspace root).

Example config:

```json
{
  "plugins": {
    "autoDiscover": true,
    "workspaceDirName": ".kookaburra",
    "modules": ["./plugins/my-plugin.mjs"]
  }
}
```

Example (Gmail + Calendar tools):

```bash
kookaburra agent --plugin @kooka/plugin-google
```

## Daemon (HTTP Gateway)

Start a long-running local gateway:

```bash
pnpm -C packages/kookaburra kookaburra -- daemon --host 127.0.0.1 --port 8787 --autonomy full
```

Then trigger runs:

```bash
curl -sS http://127.0.0.1:8787/v1/run \
  -H 'content-type: application/json' \
  -d '{"message":"Say ok","sessionId":"default"}'
```

## Cron (Scheduler)

Create jobs:

```bash
# Every 5 minutes (5-part cron: min hour dom mon dow)
kookaburra cron add "*/5 * * * *" "Process unread threads"

# Every 30 minutes
kookaburra cron every 30m "Process unread threads"

# One-shot in 10 minutes
kookaburra cron once 10m "Run a one-time task"
```

List jobs:

```bash
kookaburra cron list
```

Cron jobs are executed by `kookaburra daemon` when `cron.enabled=true`.

## Sessions

- Default location: `<workspace>/.kookaburra/sessions/*.json` (session IDs are filename-encoded)
- Commands:
  - `kookaburra sessions list`
  - `kookaburra sessions clear`
- Interactive commands:
  - `/help`, `/exit`, `/clear`, `/session <id>`

Session snapshots are **best-effort redacted** before writing to disk (tool args and model outputs may still contain secrets if tools read them).

## Security Notes

- External paths are blocked by default. Enable with `--allow-external-paths` or `security.allowExternalPaths: true`.
- Tool calls prompt for approval; you can allowlist a tool for the current run with the `always` option in the prompt.
- For non-interactive runs (daemon/CI), use `--autonomy full` (or config `agent.autoApprove: true`) or tool calls will usually be denied.
- This CLI is intended to stay “runtime-thin”: provider wiring, tool registry, approvals, and session persistence.
