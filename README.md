# LingYun

LingYun is a monorepo for a VS Code agentic coding assistant and its shared runtime libraries.

## Packages

- `packages/vscode-extension`: the VS Code extension (`mzbac.lingyun`)
- `packages/agent-sdk`: headless Node.js agent runtime
- `packages/core`: shared core logic used across the repo

## Current extension capabilities

The VS Code extension currently supports:

- GitHub Copilot
- ChatGPT Codex Subscription
- OpenAI-compatible servers
- Built-in workspace tools, shell execution, VS Code language-feature tools, skills, task subagents, session persistence, context compaction, and transcript-backed memories

Usage and configuration live in [`packages/vscode-extension/README.md`](packages/vscode-extension/README.md).

## Common commands

- `pnpm install`
- `pnpm build`
- `pnpm lint`
- `pnpm test`
