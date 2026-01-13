# Contributing to LingYun

Thanks for helping improve LingYun.

## Quick start (local dev)
Prereqs:
- Node.js (recent LTS recommended)
- VS Code

Steps:
1. Install deps: `npm ci`
2. Build: `npm run compile`
3. Lint: `npm run lint`
4. Unit tests: `npm run test:unit`
5. Run the extension: VS Code debug config **Run Extension**

## Repo layout
- Extension entry: `src/extension.ts`
- Agent core: `src/core/agent/index.ts`
- Tool registry: `src/core/registry.ts`
- Providers: `src/providers/*`
- UI: `src/ui/*` and `media/*`

## Pull requests
- Keep PRs focused and small.
- Include tests when you change behavior.
- Avoid introducing new state migrations (users can clear sessions via command).

## Security & privacy
- **Do not** commit API keys, tokens, private URLs, internal IPs, or machine-specific paths.
- If you discover a vulnerability, follow `SECURITY.md`.

