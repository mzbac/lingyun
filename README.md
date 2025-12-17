# LingYun

> Plugin-based agentic AI framework for VSCode

An extensible AI agent that can use tools to accomplish tasks in your workspace. Define custom tools in JSON, or let other extensions contribute capabilities.

## Features

- 🔌 **Plugin Architecture** - Add tools from workspace config or extensions
- 🛠️ **Built-in Tools** - File operations, shell commands out of the box
- 📝 **Workspace Tools** - Define custom tools in `.vscode/agent-tools.json`
- 🔒 **Approval System** - Control which actions need confirmation
- 🤖 **Multiple Models** - GPT-4o, Claude, Gemini via GitHub Copilot

## Quick Start

### 1. Install & Launch

Press `F5` in VSCode to launch the Extension Development Host.

### 2. Open Chat

Click the 🤖 icon in the activity bar.

### 3. Give it a Task

```
"List all TypeScript files in src/"
"Read package.json and tell me the dependencies"
"Run the tests"
```

## Built-in Tools

| Tool | Description | Approval |
|------|-------------|----------|
| `file.read` | Read file contents | No |
| `file.write` | Write to file | Yes |
| `file.list` | List files with glob | No |
| `file.search` | Search in files | No |
| `file.getCurrent` | Get active editor file | No |
| `shell.run` | Run shell command | Depends |
| `shell.terminal` | Run in visible terminal | Yes |
| `shell.which` | Check if command exists | No |

## Workspace Tools

Create `.vscode/agent-tools.json` to define custom tools:

```json
{
  "version": "1.0",
  "variables": {
    "API_URL": "https://api.example.com"
  },
  "tools": [
    {
      "id": "deploy",
      "name": "Deploy",
      "description": "Deploy to an environment",
      "parameters": {
        "type": "object",
        "properties": {
          "env": {
            "type": "string",
            "enum": ["staging", "production"],
            "description": "Target environment"
          }
        },
        "required": ["env"]
      },
      "execution": {
        "type": "shell",
        "script": "./deploy.sh $env"
      },
      "requiresApproval": true
    },
    {
      "id": "get_status",
      "name": "Get API Status",
      "description": "Check API health",
      "parameters": {
        "type": "object",
        "properties": {},
        "required": []
      },
      "execution": {
        "type": "http",
        "url": "${API_URL}/health",
        "method": "GET"
      },
      "requiresApproval": false
    }
  ]
}
```

Run **"LingYun: Create Workspace Tools Config"** to generate a sample.

### Knowledge Base / RAG Tools

Connect the agent to your knowledge base by defining HTTP tools:

```json
{
  "version": "1.0",
  "variables": {
    "RAG_API": "https://your-rag-api.com"
  },
  "tools": [
    {
      "id": "kb.search",
      "name": "Knowledge Search",
      "description": "Semantic search across knowledge base. Use BEFORE answering factual questions about company docs, policies, or procedures.",
      "parameters": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Search query" }
        },
        "required": ["query"]
      },
      "execution": {
        "type": "http",
        "url": "${RAG_API}/search",
        "method": "POST",
        "headers": {
          "Authorization": "Bearer ${env:RAG_API_KEY}"
        }
      },
      "requiresApproval": false,
      "category": "knowledge"
    }
  ]
}
```

The agent will automatically use these tools based on their descriptions - no special configuration needed.

## Execution Types

### Shell

```json
{
  "execution": {
    "type": "shell",
    "script": "npm test -- $pattern",
    "cwd": "${workspaceFolder}"
  }
}
```

### HTTP

```json
{
  "execution": {
    "type": "http",
    "url": "https://api.example.com/items",
    "method": "POST",
    "headers": {
      "Authorization": "Bearer ${env:API_TOKEN}"
    },
    "body": "{\"name\": \"$name\"}"
  }
}
```

### Variable Substitution

| Syntax | Source | Example |
|--------|--------|---------|
| `${VAR}` | `variables` block in config | `${API_URL}` |
| `${env:VAR}` | Environment variable | `${env:API_KEY}` |
| `$arg` | Tool argument | `$query` |
| `${workspaceFolder}` | Workspace path | `${workspaceFolder}/src` |

Use `${env:VAR}` for secrets like API keys - they stay out of your tool config files.

### Setting Environment Variables

Add to `.vscode/settings.json`:

```json
{
  "lingyun.env": {
    "RAG_API_KEY": "your-api-key",
    "OTHER_SECRET": "another-value"
  }
}
```

These are checked first, then falls back to system environment variables.

### VSCode Command

```json
{
  "execution": {
    "type": "command",
    "command": "editor.action.formatDocument"
  }
}
```

## Extension API

Other extensions can contribute tools:

```typescript
const api = await vscode.extensions.getExtension('publisher.lingyun')?.activate();

api.registerTool({
  id: 'jira.create',
  name: 'Create Jira Ticket',
  description: 'Create a ticket in Jira',
  parameters: { ... },
  execution: { type: 'function', handler: 'jira.create' },
  metadata: { requiresApproval: true }
}, async (args, context) => {
  const ticket = await jiraAPI.create(args);
  return { success: true, data: ticket };
});
```

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `lingyun.useMockLLM` | `false` | Use mock LLM for testing (no auth needed) |
| `lingyun.model` | `gpt-4o` | AI model |
| `lingyun.maxIterations` | `20` | Max tool calls per task |
| `lingyun.autoApprove` | `false` | Skip approval dialogs |
| `lingyun.toolFilter` | `[]` | Only use matching tools |
| `lingyun.env` | `{}` | Environment variables for `${env:VAR}` in tools |

## Testing Without GitHub Copilot

Enable mock mode for testing without authentication:

```json
// .vscode/settings.json
{
  "lingyun.useMockLLM": true
}
```

The mock provider:
- Simulates tool calls based on keywords
- No network calls or authentication required
- Great for CI/CD and development testing

## Commands

| Command | Shortcut | Description |
|---------|----------|-------------|
| Start Task | `Ctrl+Shift+.` | Begin a new task |
| Abort | - | Stop running agent |
| Clear History | - | Clear conversation history |
| Show Logs | - | View output channel logs |
| List Tools | - | View all available tools |
| Run Tool | - | Execute a tool manually |
| Create Config | - | Generate sample tools config |

## Requirements

- VSCode 1.85+
- GitHub Copilot subscription

## Development

```bash
npm install
npm run watch
# Press F5 to debug
```

## Testing

### Self-Verification (for CI/Agents)

```bash
npm run verify
```

Outputs JSON to stdout with structured results:

```json
{
  "success": true,
  "summary": { "passed": 11, "failed": 0, "skipped": 0 },
  "checks": [
    { "name": "TypeScript compilation", "status": "passed" },
    { "name": "Manual tests", "status": "passed", "passed": 7, "failed": 0 },
    ...
  ]
}
```

**Exit codes:** `0` = all passed, `1` = some failed

**Checks performed:**
- Project structure validation
- package.json correctness  
- TypeScript compilation
- Dist output verification
- Manual unit tests (7 tests)
- Module export verification
- JSON schema validation
- Type declaration exports
- Packaging requirements

### Quick Manual Tests (no VSCode required)

```bash
npm run test:manual
```

Runs smoke tests for core functionality (registry, tools, providers) using mocked VSCode APIs.

### Full Integration Tests (requires VSCode)

```bash
npm test
```

Downloads VSCode test runner and executes full test suite in Extension Development Host.

### Debug Tests in VSCode

1. Open the project in VSCode
2. Go to Run & Debug (Ctrl+Shift+D)
3. Select "Run Extension Tests" 
4. Press F5

### Test Coverage

| Test Suite | What it tests |
|------------|--------------|
| `registry.test.ts` | Tool registration, providers, execution routing |
| `agent.test.ts` | LLM loop, tool calling, callbacks, approval flow |
| `extension.test.ts` | Commands, configuration, views |

### Manual Testing Checklist

When testing the extension manually:

- [ ] Extension activates without errors
- [ ] Chat view appears in sidebar
- [ ] "Start Task" command works (Ctrl+Shift+.)
- [ ] Built-in tools (file.read, shell.run) execute
- [ ] Workspace tools load from `.vscode/agent-tools.json`
- [ ] Tool approval dialog appears for dangerous operations
- [ ] Abort stops running agent

See [CLAUDE.md](./CLAUDE.md) for architecture details.

## License

MIT
