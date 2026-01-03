import type { LLMProvider, Message, ToolDefinition, ToolCall } from '../core/types';

export class MockLLMProvider implements LLMProvider {
  readonly id = 'mock';
  readonly name = 'Mock LLM (Testing)';

  private callCount = 0;

  async chat(
    messages: Message[],
    options: {
      model?: string;
      temperature?: number;
      tools?: ToolDefinition[];
      onToken?: (token: string) => void;
    } = {}
  ): Promise<Message> {
    this.callCount++;

    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const userContent = lastUserMsg?.content || '';

    const hasToolResult = messages.some(m => m.role === 'tool');

    if (hasToolResult && this.callCount > 1) {
      const response = `I executed the requested tool. Here's a summary of what happened based on the results.`;
      return this.streamResponse(response, options.onToken);
    }

    const tools = options.tools || [];
    const toolCall = this.detectToolCall(userContent, tools);

    if (toolCall) {
      return {
        role: 'assistant',
        content: '',
        tool_calls: [toolCall],
      };
    }

    const response = this.generateResponse(userContent, tools);
    return this.streamResponse(response, options.onToken);
  }

  private detectToolCall(input: string, tools: ToolDefinition[]): ToolCall | null {
    const lower = input.toLowerCase();

    if (tools.find(t => t.id === 'file.read')) {
      if (lower.includes('read') && (lower.includes('file') || lower.includes('content'))) {
        const fileMatch = input.match(/['"]([^'"]+)['"]/);
        const path = fileMatch?.[1] || 'README.md';
        return this.createToolCall('file.read', { path });
      }
    }

    if (tools.find(t => t.id === 'file.list')) {
      if (lower.includes('list') && lower.includes('file')) {
        return this.createToolCall('file.list', { pattern: '**/*' });
      }
    }

    if (tools.find(t => t.id === 'file.search')) {
      if (lower.includes('search') || lower.includes('find')) {
        const queryMatch = input.match(/(?:search|find)\s+(?:for\s+)?['"]?(\w+)['"]?/i);
        const query = queryMatch?.[1] || 'TODO';
        return this.createToolCall('file.search', { query });
      }
    }

    if (tools.find(t => t.id === 'shell.run')) {
      if (lower.includes('run') && (lower.includes('command') || lower.includes('shell'))) {
        const cmdMatch = input.match(/['"`]([^'"`]+)['"`]/);
        const command = cmdMatch?.[1] || 'echo "Hello from mock"';
        return this.createToolCall('shell.run', { command });
      }
    }

    for (const tool of tools) {
      if (tool.id.startsWith('workspace.')) {
        const toolName = tool.id.split('.')[1];
        if (lower.includes(toolName)) {
          return this.createToolCall(tool.id, {});
        }
      }
    }

    return null;
  }

  private createToolCall(toolId: string, args: Record<string, unknown>): ToolCall {
    return {
      id: `mock_${Date.now()}`,
      type: 'function',
      function: {
        name: toolId,
        arguments: JSON.stringify(args),
      },
    };
  }

  private generateResponse(input: string, tools: ToolDefinition[]): string {
    if (!input.trim()) {
      return "Hello! I'm a mock LLM for testing. I can simulate tool calls. Try asking me to read a file or run a command.";
    }

    const toolList = tools.map(t => `- ${t.id}: ${t.description}`).join('\n');

    return `[Mock LLM Response]

I received your message: "${input.substring(0, 100)}${input.length > 100 ? '...' : ''}"

Available tools:
${toolList || '(no tools registered)'}

To test tool calling, try:
- "Read the file 'package.json'"
- "List files in the project"
- "Search for TODO"
- "Run command 'ls -la'"

Note: This is a mock provider for testing without GitHub Copilot authentication.
`;
  }

  private async streamResponse(
    content: string,
    onToken?: (token: string) => void
  ): Promise<Message> {
    if (onToken) {
      const words = content.split(' ');
      for (const word of words) {
        onToken(word + ' ');
        await new Promise(r => setTimeout(r, 20));
      }
    }

    return {
      role: 'assistant',
      content,
    };
  }

  reset(): void {
    this.callCount = 0;
  }

  dispose(): void {
    this.reset();
  }
}
