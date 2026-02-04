# LingYun

Agentic AI assistant for VS Code. LingYun can plan, use tools (files/shell/language features), and execute multi-step tasks in your workspace.

## Platform support

LingYun is currently supported on **macOS** and **Linux**. **Windows is not supported** yet because the built-in tools rely heavily on a `bash` shell environment.

## Quickstart

1. Open the **LingYun** view (Activity Bar → **LingYun** → **Chat**).
2. Pick a model from the model dropdown.
3. Describe a goal, for example:
   - “Find where this function is defined and explain it.”
   - “Refactor this file and run tests.”
   - “Search the repo for X and update the docs.”

By default LingYun starts in **Plan** mode:

- It drafts a short plan first.
- Click **Execute** to switch to **Build** mode and let it run.
- Use **Stop** anytime to cancel.

## Plan vs Build

- **Plan** (read-only): can inspect the workspace (list/glob/grep/read/lsp) and propose steps.
- **Build**: can edit/write files and run commands. Some tools require approval.

You can toggle modes from the header, and **Execute** in Plan switches to Build automatically.

## Tools & approvals

LingYun uses tools to do real work:

- Workspace discovery: `list`, `glob`, `grep`, `read`
- Editing: `edit`, `write`
- Commands: `bash`
- Code intelligence: `lsp` (definition/references/symbols via VS Code)
- Subagents: `task` (spawn a specialized subagent like `explore` or `general`)

When a tool needs approval you’ll see **Allow/Deny** (and **Allow all** for the current run). You can also enable:

- `lingyun.autoApprove` (not recommended)

## Subagents (optional)

The agent can delegate work to a separate “subagent” via the `task` tool. This can help reduce main-session context bloat by running exploration in a separate session and only returning a short summary.

Auto-run the **explore** subagent before each user turn (runtime-driven prepass):

```json
{
  "lingyun.subagents.explorePrepass.enabled": true,
  "lingyun.subagents.explorePrepass.maxChars": 8000,
  "lingyun.subagents.model": ""
}
```

## Skills (SKILL.md)

LingYun supports reusable “skills” (task playbooks) stored as `SKILL.md` files with YAML frontmatter (`name`, `description`).

- Workspace skills: `.lingyun/skills/**/SKILL.md` (also scans `.claude/skills` by default)
- Global skills: `~/.config/lingyun/skills/**/SKILL.md` and `~/.claude/skills/**/SKILL.md` (only when `lingyun.security.allowExternalPaths=true`)
- Auto-apply: mention `$skill-name` in your message to auto-inject that skill’s instructions for the current turn
- Tool: use `skill` with no args to list, or `skill { "name": "..." }` to load into the current conversation

Configure discovery with:

```json
{
  "lingyun.skills.enabled": true,
  "lingyun.skills.paths": [".lingyun/skills", "~/.config/lingyun/skills"],
  "lingyun.skills.maxPromptSkills": 50,
  "lingyun.skills.maxInjectSkills": 5,
  "lingyun.skills.maxInjectChars": 20000
}
```

## Sessions

Each chat runs in a session. Use the **Session** dropdown to switch sessions and **+** to start a new one.

Optional: persist sessions to disk so they restore after restarting VS Code:

```json
{
  "lingyun.sessions.persist": true
}
```

Clear persisted sessions with **LingYun: Clear Saved Sessions**.

## Use a local OpenAI-compatible server (optional)

LingYun can connect to local servers that implement the OpenAI API. The server must return models from `GET /v1/models`.

In VS Code settings:

```json
{
  "lingyun.llmProvider": "openaiCompatible",
  "lingyun.openaiCompatible.baseURL": "http://localhost:8080/v1",
  "lingyun.openaiCompatible.defaultModelId": "your-model-id",
  "lingyun.openaiCompatible.maxTokens": 32000
}
```

If your server requires an API key, set it in your environment (default env var: `OPENAI_API_KEY`). You can override the env var name with `lingyun.openaiCompatible.apiKeyEnv`.

## Commands

- `LingYun: Start Task` (`Ctrl+Shift+.` / `Cmd+Shift+.`)
- `LingYun: Abort`
- `LingYun: Clear History`
- `LingYun: Show Logs`

## Troubleshooting

- **Model shows “Loading…” forever**: make sure `lingyun.openaiCompatible.baseURL` includes `/v1` and the server responds to `GET /v1/models`.
- **Responses cut off**: increase `lingyun.openaiCompatible.maxTokens`.
- **See what’s happening**: run `LingYun: Show Logs` and enable `lingyun.debug.llm`.
- **Debug plugins**: enable `lingyun.debug.plugins` (workspace plugins live under `.lingyun/plugin/`).

## Advanced

- Custom workspace tools: `.vscode/agent-tools.json` (schema: `schemas/agent-tools.schema.json`)
- Workspace plugins/hooks: `.lingyun/plugin/*.cjs` (see `docs/PLUGINS.md`)
- Skills: `docs/SKILLS.md`
- Implementation details and dev notes: `AGENTS.md` and `docs/`

## Credits

LingYun is inspired by OpenCode. Thanks to the OpenCode open-source project and contributors for making this possible.

## License

Apache License 2.0
