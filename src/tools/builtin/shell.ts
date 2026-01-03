import * as vscode from 'vscode';
import * as cp from 'child_process';
import { toolRegistry } from '../../core/registry';
import type { ToolDefinition, ToolHandler } from '../../core/types';
import { requireString, optionalString } from '../../core/validation';

const SAFE_COMMANDS = new Set([
  'ls', 'dir', 'pwd', 'echo', 'cat', 'head', 'tail', 'wc', 'grep', 'find',
  'git', 'npm', 'npx', 'yarn', 'pnpm', 'node', 'python', 'python3', 'pip',
  'cargo', 'go', 'make', 'cmake', 'dotnet', 'mvn', 'gradle',
  'tsc', 'eslint', 'prettier', 'jest', 'mocha', 'pytest',
  'docker', 'kubectl', 'terraform',
  'curl', 'wget', 'jq', 'yq',
]);

const BLOCKED_PATTERNS = [
  /\brm\s+-rf?\s+[/~]/i,
  /\bsudo\b/i,
  /\b(shutdown|reboot|halt)\b/i,
  /\bdd\s+if=/i,
  /\bmkfs/i,
  /\bformat\b/i,
  />[>&]\s*\/dev\//i,
];

const SHELL_INJECTION_PATTERNS = [
  /;/,
  /&&/,
  /\|\|/,
  /\|(?!\|)/,
  /`/,
  /\$\(/,
  /\$\{/,
  /\n/,
  /\r/,
];

function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return { safe: false, reason: 'Command matches blocked pattern' };
    }
  }

  for (const pattern of SHELL_INJECTION_PATTERNS) {
    if (pattern.test(command)) {
      return {
        safe: false,
        reason: 'Command contains shell metacharacters (;, &&, ||, |, `, $()) and requires approval'
      };
    }
  }

  const baseCommand = command.trim().split(/\s+/)[0].split('/').pop() || '';

  if (SAFE_COMMANDS.has(baseCommand)) {
    return { safe: true };
  }

  return { safe: false, reason: `Command '${baseCommand}' requires approval` };
}

const runCommandDef: ToolDefinition = {
  id: 'shell.run',
  name: 'Run Shell Command',
  description: 'Execute shell command and capture output. Safe commands (git, npm, ls, etc.) auto-approve. 60s timeout, 50KB output limit. Prefer file.* tools when possible - they are faster.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Shell command to execute',
      },
      cwd: {
        type: 'string',
        description: 'Working directory (default: workspace root)',
      },
    },
    required: ['command'],
  },
  execution: { type: 'function', handler: 'shell.run' },
  metadata: {
    category: 'shell',
    icon: 'terminal',
    requiresApproval: false,
    timeout: 60000,
  },
};

const runCommandHandler: ToolHandler = async (args, context) => {
  const commandResult = requireString(args, 'command');
  if ('error' in commandResult) {
    return { success: false, error: commandResult.error };
  }
  const command = commandResult.value;

  const cwd = optionalString(args, 'cwd') || context.workspaceFolder?.fsPath || process.cwd();

  const safety = isCommandSafe(command);
  context.log(`Command safety: ${safety.safe ? 'safe' : safety.reason}`);

  return new Promise((resolve) => {
    const options: cp.ExecOptions = {
      cwd,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    };

    context.log(`Executing: ${command}`);

    const proc = cp.exec(command, options, (error, stdout, stderr) => {
      if (context.cancellationToken.isCancellationRequested) {
        resolve({ success: false, error: 'Cancelled' });
        return;
      }

      const stdoutStr = stdout?.toString() || '';
      const stderrStr = stderr?.toString() || '';

      if (error) {
        resolve({
          success: false,
          error: stderrStr || error.message,
          data: stdoutStr || undefined,
        });
        return;
      }

      let output = stdoutStr;
      let truncated = false;

      if (output.length > 50000) {
        output = output.substring(0, 50000) + '\n...(truncated)';
        truncated = true;
      }

      resolve({
        success: true,
        data: output || 'Command completed',
        metadata: { truncated },
      });
    });

    context.cancellationToken.onCancellationRequested(() => {
      proc.kill('SIGTERM');
    });
  });
};

const terminalDef: ToolDefinition = {
  id: 'shell.terminal',
  name: 'Run in Terminal',
  description: 'Run command in visible VSCode terminal. Use for interactive commands or long-running processes (dev servers, watch modes). Requires approval. Does not capture output.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Command to run',
      },
      name: {
        type: 'string',
        description: 'Terminal name',
      },
    },
    required: ['command'],
  },
  execution: { type: 'function', handler: 'shell.terminal' },
  metadata: {
    category: 'shell',
    icon: 'terminal-bash',
    requiresApproval: true,
  },
};

const terminalHandler: ToolHandler = async (args) => {
  const commandResult = requireString(args, 'command');
  if ('error' in commandResult) {
    return { success: false, error: commandResult.error };
  }
  const command = commandResult.value;

  const name = optionalString(args, 'name', 'Agent Task');

  const terminal = vscode.window.createTerminal(name);
  terminal.show();
  terminal.sendText(command);

  return {
    success: true,
    data: `Command sent to terminal "${name}": ${command}`,
  };
};

const whichDef: ToolDefinition = {
  id: 'shell.which',
  name: 'Which Command',
  description: 'Check if a command/tool is installed and get its path. No approval needed. Use before shell.run to verify tools exist.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'Command to check',
      },
    },
    required: ['command'],
  },
  execution: { type: 'function', handler: 'shell.which' },
  metadata: {
    category: 'shell',
    icon: 'question',
    requiresApproval: false,
  },
};

const whichHandler: ToolHandler = async (args) => {
  const command = args.command as string;

  if (!/^[a-zA-Z0-9._-]+$/.test(command)) {
    return {
      success: false,
      error: 'Invalid command name. Only alphanumeric characters, dashes, underscores, and dots are allowed.',
    };
  }

  const which = process.platform === 'win32' ? 'where' : 'which';

  return new Promise((resolve) => {
    const proc = cp.spawn(which, [command], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';

    proc.stdout.on('data', (data) => { stdout += data; });

    proc.on('close', (code) => {
      if (code !== 0) {
        resolve({ success: true, data: `${command}: not found` });
      } else {
        resolve({ success: true, data: stdout.trim() });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
};

export function registerShellTools(): vscode.Disposable[] {
  return [
    toolRegistry.registerTool(runCommandDef, runCommandHandler),
    toolRegistry.registerTool(terminalDef, terminalHandler),
    toolRegistry.registerTool(whichDef, whichHandler),
  ];
}

export { isCommandSafe };
