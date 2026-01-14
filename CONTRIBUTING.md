# Contributing to LingYun

Thanks for helping improve LingYun.

## Quick start (local dev)
Prereqs:
- Node.js (recent LTS recommended)
- pnpm
- VS Code

Steps:
1. Install deps: `pnpm install`
2. Build: `pnpm --filter lingyun compile`
3. Lint: `pnpm lint`
4. Unit tests: `pnpm --filter lingyun test:unit`
5. Run the extension: VS Code debug config **Run Extension**

## Repo layout
- VS Code extension: `packages/vscode-extension/`
  - Extension entry: `packages/vscode-extension/src/extension.ts`
  - Agent core: `packages/vscode-extension/src/core/agent/index.ts`
  - Tool registry: `packages/vscode-extension/src/core/registry.ts`
  - Providers: `packages/vscode-extension/src/providers/*`
  - UI: `packages/vscode-extension/src/ui/*` and `packages/vscode-extension/media/*`
- Headless agent SDK: `packages/agent-sdk/`
- Shared core library (WIP): `packages/core/`

## Pull requests
- Keep PRs focused and small.
- Include tests when you change behavior.
- Avoid introducing new state migrations (users can clear sessions via command).

## Security & privacy
- **Do not** commit API keys, tokens, private URLs, internal IPs, or machine-specific paths.
- If you discover a vulnerability, follow `SECURITY.md`.
