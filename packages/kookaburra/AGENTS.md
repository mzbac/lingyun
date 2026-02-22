# AGENTS.md (Kookaburra)

Kookaburra is a local agent orchestration CLI/daemon.
This file is for development guidance in `packages/kookaburra/` (keep it accurate, compact, and actionable).

## Development Policy (Important)

This project is in active development. Prefer breaking changes when they reduce complexity and lead to a cleaner architecture.

- No legacy compatibility: delete/replace old paths instead of layering.
- Minimal duplication: centralize shared logic (config loading, approvals, tool logging, session I/O).
- Persisted state: no migrations; users/devs can delete `.kookaburra/` artifacts.
- No sensitive info: never log/write API keys or private URLs.

## Current Architecture (Source of Truth)

- CLI entry + commands: `src/cli.ts`
- Config schema/loader: `src/config.ts`
- Session persistence: `src/sessions.ts`
- Approvals prompting + policy: `src/approvals.ts`
- Workspace identity prompt parts (`IDENTITY.md`, `SOUL.md`, `USER.md`, `AGENTS.md`): `src/identity.ts`
- Cron store + schedule computation: `src/cron.ts`

## Design Intent

- Runtime-thin: wire model, tools, plugins, approvals, persistence; avoid “product logic” here.
- Workspace-first: resolve paths relative to `--workspace` / `KOOKABURRA_WORKSPACE` / `INIT_CWD`.
- Local daemon: HTTP gateway is intended for localhost use; keep the surface area small.

