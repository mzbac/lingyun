# CLAUDE.md - Project Intelligence

> Plugin-based agentic AI framework for VSCode

## Overview

LingYun is an **extensible tool framework** that lets users and extensions contribute tools that an AI agent can use. Think of it like VSCode's extension system - but for AI capabilities.

**Key Design Principles:**
1. **Plugin Architecture** - Tools come from multiple sources
2. **Declarative Tools** - Define tools in JSON, implement in any language
3. **Provider Pattern** - Multiple providers can contribute tools
4. **Workspace Tools** - Users define custom tools in `.vscode/agent-tools.json`
5. **Extension API** - Other extensions can register tools programmatically

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Extension Host                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                    Public API                             │  │
│   │  registerToolProvider() | registerTool() | runAgent()     │  │
│   └──────────────────────────────────────────────────────────┘  │
│                              │                                   │
│   ┌──────────────────────────┼──────────────────────────────┐   │
│   │                     Tool Registry                        │   │
│   │  - Provider management                                   │   │
│   │  - Tool discovery                                        │   │
│   │  - Execution routing                                     │   │
│   └──────────────────────────┬──────────────────────────────┘   │
│                              │                                   │
│          ┌───────────────────┼───────────────────┐              │
│          ▼                   ▼                   ▼              │
│   ┌────────────┐     ┌────────────┐     ┌────────────┐         │
│   │  Built-in  │     │ Workspace  │     │ Extension  │         │
│   │  Provider  │     │  Provider  │     │ Providers  │         │
│   └────────────┘     └────────────┘     └────────────┘         │
│   │                  │                  │                       │
│   │ file.*           │ Loaded from      │ From other            │
│   │ shell.*          │ .vscode/         │ VSCode                │
│   │                  │ agent-tools.json │ extensions            │
│   │                  │                  │                       │
│   └──────────────────┴──────────────────┘                       │
│                              │                                   │
│   ┌──────────────────────────┼──────────────────────────────┐   │
│   │                    Agent Loop                            │   │
│   │  User → LLM → Tools → LLM → ... → Response               │   │
│   └──────────────────────────┬──────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│                      ┌────────────┐                             │
│                      │   Copilot  │                             │
│                      │  Provider  │                             │
│                      └────────────┘                             │
│                              │                                   │
└──────────────────────────────┼───────────────────────────────────┘
                               │
                               ▼
                        GitHub Copilot API
```

---

## Directory Structure

```
copilot-vscode-ext/
├── src/
│   ├── extension.ts        # Entry point, commands, public API
│   ├── index.ts            # Library exports
│   │
│   ├── core/
│   │   ├── types.ts        # All TypeScript interfaces
│   │   ├── registry.ts     # Tool registry (provider management)
│   │   └── agent.ts        # Agent loop (LLM orchestration)
│   │
│   ├── providers/
│   │   ├── copilot.ts      # GitHub Copilot LLM provider
│   │   ├── workspace.ts    # Loads .vscode/agent-tools.json
│   │   └── executors.ts    # Shell, HTTP, inline executors
│   │
│   ├── tools/
│   │   └── builtin/
│   │       ├── file.ts     # file.read, file.write, file.list, etc.
│   │       └── shell.ts    # shell.run, shell.terminal
│   │
│   └── ui/
│       ├── chat.ts         # Webview chat panel
│       └── approval.ts     # Tool approval dialogs
│
├── schemas/
│   └── agent-tools.schema.json   # JSON Schema for workspace tools
│
├── package.json
├── tsconfig.json
├── CLAUDE.md               # This file
└── README.md
```

---

## Core Interfaces

### ToolDefinition

```typescript
interface ToolDefinition {
  id: string;              // Unique ID (namespace.name format)
  name: string;            // Human-readable name
  description: string;     // For LLM to understand when to use
  parameters: {            // JSON Schema format
    type: 'object';
    properties: Record<string, ToolParameterSchema>;
    required?: string[];
  };
  execution: ToolExecution; // How to run
  metadata?: {
    category?: string;
    icon?: string;
    requiresApproval?: boolean;
    timeout?: number;
    tags?: string[];
  };
}
```

### ToolProvider

```typescript
interface ToolProvider {
  readonly id: string;
  readonly name: string;
  
  getTools(): ToolDefinition[] | Promise<ToolDefinition[]>;
  
  executeTool(
    toolId: string,
    args: Record<string, unknown>,
    context: ToolContext
  ): Promise<ToolResult>;
  
  dispose?(): void;
}
```

### ToolExecution Types

```typescript
type ToolExecution =
  | { type: 'function'; handler: string }  // JS function
  | { type: 'command'; command: string }   // VSCode command
  | { type: 'shell'; script: string; shell?: string }  // Shell command
  | { type: 'http'; url: string; method?: string; headers?: Record<string, string> }  // HTTP request
  | { type: 'inline'; code: string };      // Inline JS (sandboxed)
```

---

## Tool Sources

### 1. Built-in Tools

Ships with the extension:

| Tool | Description |
|------|-------------|
| `file.read` | Read file contents |
| `file.write` | Write to file |
| `file.list` | List files with glob |
| `file.search` | Search in files |
| `file.getCurrent` | Get active editor |
| `shell.run` | Run shell command |
| `shell.terminal` | Run in visible terminal |
| `shell.which` | Check if command exists |

### 2. Workspace Tools

Users define in `.vscode/agent-tools.json`:

```json
{
  "version": "1.0",
  "variables": {
    "API_URL": "https://api.example.com"
  },
  "tools": [
    {
      "id": "deploy",
      "name": "Deploy to Production",
      "description": "Deploy the current branch to production",
      "parameters": {
        "type": "object",
        "properties": {
          "environment": {
            "type": "string",
            "enum": ["staging", "production"]
          }
        },
        "required": ["environment"]
      },
      "execution": {
        "type": "shell",
        "script": "./scripts/deploy.sh $environment"
      },
      "requiresApproval": true,
      "category": "deployment"
    }
  ]
}
```

### 3. Extension Tools

Other extensions contribute via API:

```typescript
// In another extension's activate():
const lingyun = vscode.extensions.getExtension('your-publisher.lingyun');
const api = await lingyun.activate();

api.registerTool({
  id: 'jira.createTicket',
  name: 'Create Jira Ticket',
  description: 'Create a new Jira ticket',
  parameters: { ... },
  execution: { type: 'function', handler: 'jira.createTicket' },
  metadata: { requiresApproval: true }
}, async (args, context) => {
  // Implementation
  return { success: true, data: { key: 'PROJ-123' } };
});
```

---

## Extension API

```typescript
interface LingyunAPI {
  version: string;
  
  // Register a tool provider
  registerToolProvider(provider: ToolProvider): Disposable;
  
  // Register a single tool
  registerTool(definition: ToolDefinition, handler: ToolHandler): Disposable;
  
  // Get all tools
  getTools(): Promise<ToolDefinition[]>;
  
  // Execute a tool directly
  executeTool(toolId: string, args: Record<string, unknown>): Promise<ToolResult>;
  
  // Run the agent with a task
  runAgent(task: string, config?: AgentConfig): Promise<string>;
  
  // Events
  onDidRegisterTool: Event<ToolDefinition>;
  onDidUnregisterTool: Event<string>;
}
```

---

## Adding a Custom Tool Provider

```typescript
import * as vscode from 'vscode';
import type { ToolProvider, ToolDefinition, ToolContext, ToolResult } from 'lingyun';

class MyToolProvider implements ToolProvider {
  readonly id = 'my-provider';
  readonly name = 'My Tools';

  getTools(): ToolDefinition[] {
    return [
      {
        id: 'my-provider.hello',
        name: 'Say Hello',
        description: 'Returns a greeting',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Name to greet' }
          },
          required: ['name']
        },
        execution: { type: 'function', handler: 'my-provider.hello' },
        metadata: { category: 'greetings' }
      }
    ];
  }

  async executeTool(toolId: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    if (toolId === 'my-provider.hello') {
      return { success: true, data: `Hello, ${args.name}!` };
    }
    return { success: false, error: 'Unknown tool' };
  }
}

// Register in activate()
export async function activate(context: vscode.ExtensionContext) {
  const lingyun = await vscode.extensions.getExtension('publisher.lingyun')?.activate();
  const disposable = lingyun.registerToolProvider(new MyToolProvider());
  context.subscriptions.push(disposable);
}
```

---

## Configuration

```json
{
  "lingyun.useMockLLM": false,
  "lingyun.model": "gpt-4o",
  "lingyun.maxIterations": 20,
  "lingyun.autoApprove": false,
  "lingyun.toolFilter": ["file.*", "shell.run"],
  "lingyun.env": {}
}
```

---

## Development

```bash
# Install dependencies
npm install

# Compile
npm run compile

# Watch mode
npm run watch

# Debug: Press F5 in VSCode
```

---

## Self-Verification

The extension includes a comprehensive self-verification system designed for CI/CD and agentic coding tools.

### Running Verification

```bash
npm run verify
```

### Output Format

The script outputs:
- **stderr**: Human-readable progress with ✅/❌ indicators
- **stdout**: JSON report for machine parsing

```json
{
  "timestamp": "2025-12-09T...",
  "success": true,
  "summary": { "passed": 11, "failed": 0, "skipped": 0 },
  "checks": [
    { "name": "TypeScript compilation", "status": "passed" },
    { "name": "Manual tests", "status": "passed", "passed": 7, "failed": 0 },
    { "name": "Registry module", "status": "passed", "exports": ["ToolRegistry", "toolRegistry"] },
    ...
  ]
}
```

### Checks Performed

| Check | What it verifies |
|-------|-----------------|
| Project structure | Required source files exist |
| package.json | Valid manifest with commands, views |
| Dependencies | node_modules present |
| TypeScript compilation | `tsc` succeeds |
| Dist output | Compiled JS files exist |
| Manual tests | 7 unit tests pass |
| Registry module | Exports ToolRegistry class |
| Tool definitions | Built-in tools have correct structure |
| JSON Schema | agent-tools.schema.json valid |
| Type exports | .d.ts files export key types |
| Packaging | Publisher, README present |

### For Agentic Tools

To verify the extension programmatically:

```javascript
const { execSync } = require('child_process');

// Run verification
const output = execSync('npm run verify 2>/dev/null', {
  cwd: '/path/to/lingyun',
  encoding: 'utf-8'
});

// Parse JSON result
const result = JSON.parse(output);

if (result.success) {
  console.log('All checks passed!');
} else {
  const failures = result.checks.filter(c => c.status === 'failed');
  console.log('Failures:', failures);
}
```

---

## Key Design Decisions

1. **Provider Pattern over Monolith**
   - Multiple sources can contribute tools
   - Easy to add/remove tool sets
   - Extensions can contribute without forking

2. **Declarative Tool Definitions**
   - JSON-describable tools for workspace customization
   - AI can understand tool capabilities from description
   - Schema validation for user-defined tools

3. **Execution Abstraction**
   - Tools define WHAT they do, registry handles HOW
   - Multiple execution types (shell, HTTP, command, function)
   - Consistent result format regardless of execution type

4. **Approval System**
   - Tools declare if they need approval
   - Configurable per-user (autoApprove setting)
   - Context-aware (shell command safety checks)

---

## Reference Implementations

The `temp/` directory contains reference implementations for learning patterns:

- `temp/cline/` - Cline VSCode extension
  - Tool handlers with approval flow
  - Auto-approval based on tool type and file path
  - Real-time streaming in webview

- `temp/kilocode/` - Kilocode CLI
  - Minimal, compact tool display
  - Batch file operations
  - Tool result aggregation

Key patterns to follow:
- Tool display: minimal, single-line summaries (icon + action)
- Tool descriptions: include capabilities, limits, and usage hints
- Auto-approval: based on tool type and workspace context

---

## Future Extensions

- [ ] Tool marketplace/gallery
- [ ] Tool versioning
- [ ] Persistent tool state
- [ ] Tool chaining/pipelines
- [ ] MCP (Model Context Protocol) integration
- [ ] Multi-LLM provider support
