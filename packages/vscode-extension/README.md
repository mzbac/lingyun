# LingYun

LingYun is a VS Code extension for agentic coding work. It can inspect your workspace, edit files, run shell commands, use VS Code language features, delegate to subagents, persist sessions, compact long context, and optionally build transcript-backed memories.

## Providers

LingYun currently supports three LLM backends:

- GitHub Copilot
- ChatGPT Codex Subscription
- OpenAI-compatible servers

Provider selection is controlled by `lingyun.llmProvider`.

## Quickstart

1. Open the **LingYun** view.
2. Choose a provider and model from the chat header.
3. Describe a task, for example:
   - “Find where this function is defined and explain it.”
   - “Refactor this file and run tests.”
   - “Search the repo for X and update the docs.”

New tasks run with:

- `lingyun.mode = build` by default
- `lingyun.planFirst = true` by default

That means LingYun normally drafts a plan first for a new top-level task, then you can continue into execution. If you want strict read-only behavior, switch the mode to **Plan**.

## Modes

- **Build**: full tool use, including edits and shell commands, subject to approvals.
- **Plan**: read-only. Write/edit tools are denied and auto-approve is disabled.
- **Plan First**: a UI behavior controlled by `lingyun.planFirst`. This is separate from `lingyun.mode`.

## Built-in tools

LingYun ships with these built-in tools:

- Workspace discovery: `list`, `glob`, `grep`, `read`, `read_range`
- Editing: `edit`, `write`
- Code intelligence: `lsp`, `symbols_search`, `symbols_peek`
- Shell: `bash`
- Reusable instructions: `skill`
- Delegation: `task`
- Todos: `todoread`, `todowrite`
- Memory access: `get_memory`

Workspace-defined tools can also be loaded from:

- `.vscode/agent-tools.json`
- `.vscode/agent-tools/*.json`

Schema: `schemas/agent-tools.schema.json`

## Approvals and path safety

- Tool approvals are driven by tool metadata plus `lingyun.autoApprove`.
- `lingyun.autoApprove` only affects Build mode.
- External paths are blocked by default, even when auto-approve is enabled.
- External-path access is controlled by `lingyun.security.allowExternalPaths`.

## Providers and setup

### GitHub Copilot

Copilot is the default provider:

```json
{
  "lingyun.llmProvider": "copilot",
  "lingyun.model": "gpt-4o"
}
```

`lingyun.copilot.reasoningEffort` defaults to `high` and is used for GPT-5-family Copilot requests.

### ChatGPT Codex Subscription

The Codex subscription provider uses a ChatGPT account session and exposes sign-in/sign-out in the chat header when auth UI is available.

If `lingyun.model` is empty or still set to the Copilot default, LingYun falls back to `lingyun.codexSubscription.defaultModelId`, which defaults to `gpt-5.3-codex`.

```json
{
  "lingyun.llmProvider": "codexSubscription",
  "lingyun.codexSubscription.defaultModelId": "gpt-5.4"
}
```

### OpenAI-compatible server

```json
{
  "lingyun.llmProvider": "openaiCompatible",
  "lingyun.openaiCompatible.baseURL": "http://localhost:8080/v1",
  "lingyun.openaiCompatible.defaultModelId": "your-model-id",
  "lingyun.openaiCompatible.maxTokens": 32000
}
```

If your server needs a key, LingYun reads it from `OPENAI_API_KEY` by default. Override that env var name with `lingyun.openaiCompatible.apiKeyEnv`.

## Sessions, compaction, and memories

### Sessions

- `lingyun.sessions.persist` defaults to `true`
- Persisted sessions are workspace-scoped
- Clear them with `LingYun: Clear Saved Sessions`

### Context compaction

LingYun automatically compacts long sessions by default:

```json
{
  "lingyun.compaction.auto": true,
  "lingyun.compaction.prune": true,
  "lingyun.compaction.toolOutputMode": "afterToolCall"
}
```

You can also compact the current session manually with `LingYun: Compact Session`.

Per-model context limits live under `lingyun.modelLimits`. Keys can be either plain model ids or provider-scoped keys:

```json
{
  "lingyun.modelLimits": {
    "gpt-4o": { "context": 128000, "output": 32000 },
    "codexSubscription:gpt-5.4": { "context": 258400, "output": 32000 }
  }
}
```

Provider-scoped entries take precedence, and plain model-id entries still work as the backward-compatible fallback. Codex Subscription model limits are normally discovered from the provider; the bundled fallback uses Codex's 95% effective window for the 272k-token default context.

### Memories

The memory pipeline is enabled by default:

- `lingyun.features.memories = true`
- `lingyun.memories.autoRecall = true`

LingYun can extract transcript-backed memory from persisted sessions, auto-recall relevant context before top-level turns, and expose memory artifacts through the `get_memory` tool.

Useful commands:

- `LingYun: Update Memories`
- `LingYun: Drop Memories`

## Skills

LingYun supports reusable `SKILL.md` files.

Default search paths include:

- Workspace-relative: `.lingyun/skills`, `.claude/skills`, `.opencode/skill`, `.opencode/skills`
- Home-directory paths: `~/.config/lingyun/skills`, `~/.agent/skills`, `~/.agents/skills`, `~/.codex/skills`, `~/.claude/skills`

Home-directory paths are ignored unless `lingyun.security.allowExternalPaths = true`.

Mention `$skill-name` in a prompt to auto-inject that skill for the current turn.

Relevant settings:

```json
{
  "lingyun.skills.enabled": true,
  "lingyun.skills.maxPromptSkills": 50,
  "lingyun.skills.maxInjectSkills": 5,
  "lingyun.skills.maxInjectChars": 20000
}
```

## Subagents

LingYun can delegate work through the `task` tool. It also supports an optional automatic explore prepass before each user turn:

```json
{
  "lingyun.subagents.explorePrepass.enabled": true,
  "lingyun.subagents.explorePrepass.maxChars": 8000,
  "lingyun.subagents.model": ""
}
```

Task-subagent output injected back into the main session is capped by `lingyun.subagents.task.maxOutputChars`.

## Commands

Main commands:

- `LingYun: Start Task`
- `LingYun: Open Agent`
- `LingYun: Open Office`
- `LingYun: Abort`
- `LingYun: Clear History`
- `LingYun: Show Logs`

Session and context commands:

- `LingYun: Clear Saved Sessions`
- `LingYun: Compact Session`
- `LingYun: Update Memories`
- `LingYun: Drop Memories`

History commands:

- `LingYun: Undo`
- `LingYun: Redo`

Tooling commands:

- `LingYun: List Tools`
- `LingYun: Create Tools Config`
- `LingYun: Run Tool`

Default keybinding:

- `Cmd+Shift+.` on macOS
- `Ctrl+Shift+.` elsewhere

## Troubleshooting

- **OpenAI-compatible models do not load**: make sure `lingyun.openaiCompatible.baseURL` includes `/v1` and the server answers `GET /v1/models`.
- **Responses cut off**: increase `lingyun.openaiCompatible.maxTokens` or configure `lingyun.modelLimits`.
- **Compaction is too aggressive or not aggressive enough**: set `lingyun.modelLimits` for the exact model, or use a provider-scoped key like `codexSubscription:gpt-5.4`.
- **Need more visibility**: use `LingYun: Show Logs` and enable `lingyun.debug.details` for fuller logs with visible paths/URLs/hosts, or turn on `lingyun.debug.llm`, `lingyun.debug.tools`, or `lingyun.debug.plugins` individually.

## Advanced

- Workspace tools: `.vscode/agent-tools.json` and `.vscode/agent-tools/*.json`
- Workspace plugins: `.lingyun/plugin/*.js`
- Skills docs: `../../docs/SKILLS.md`
- Plugin docs: `../../docs/PLUGINS.md`
- Development and architecture notes: `../../AGENTS.md`

## License

Apache License 2.0
