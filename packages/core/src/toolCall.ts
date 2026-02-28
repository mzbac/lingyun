export type ToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export function toToolCall(toolCallId: string, toolName: string, input: unknown): ToolCall {
  let args = '{}';
  try {
    args = JSON.stringify(input ?? {});
  } catch {
    args = '{}';
  }

  return {
    id: toolCallId,
    type: 'function',
    function: {
      name: toolName,
      arguments: args,
    },
  };
}

