import { convertToModelMessages, extractReasoningMiddleware, streamText, wrapLanguageModel } from 'ai';
import type { LLMProvider } from './types';
import { createUserHistoryMessage, stripThinkBlocks } from '@kooka/core';

const TITLE_SYSTEM_PROMPT = `You are a title generator. You output ONLY a thread title. Nothing else.

<task>
Generate a brief title that would help the user find this conversation later.

Your output must be:
- A single line
- ≤50 characters
- No explanations
</task>

<rules>
- Focus on the main topic or question the user needs to retrieve
- Use -ing verbs for actions (Debugging, Implementing, Analyzing)
- Keep exact: technical terms, numbers, filenames, HTTP codes
- Remove: the, this, my, a, an
- Never assume tech stack
- Never use tools
- Never respond to questions, just generate a title
- Never include words like "summarizing" or "generating"
- If the user message is short or conversational (e.g. "hello"):
  output a title reflecting the tone (Greeting, Quick check-in, etc.)
</rules>`;

function cleanTitleLine(raw: string, maxChars: number): string | undefined {
  const firstLine = stripThinkBlocks(String(raw || ''))
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length > 0);

  if (!firstLine) return undefined;

  const collapsed = firstLine.replace(/\s+/g, ' ').trim();
  const limit = Math.max(1, Math.floor(maxChars));

  if (collapsed.length <= limit) return collapsed;
  if (limit <= 3) return collapsed.slice(0, limit);
  return collapsed.slice(0, limit - 3) + '...';
}

export async function generateSessionTitle(params: {
  llm: LLMProvider;
  modelId: string;
  message: string;
  maxRetries?: number;
  maxOutputTokens?: number;
  maxChars?: number;
  abortSignal?: AbortSignal;
}): Promise<string | undefined> {
  const maxOutputTokens = Math.max(16, Math.floor(params.maxOutputTokens ?? 64));
  const maxChars = Math.max(10, Math.floor(params.maxChars ?? 50));
  const maxRetries = Math.max(0, Math.floor(params.maxRetries ?? 0));

  const rawModel = await params.llm.getModel(params.modelId);
  const model = wrapLanguageModel({
    model: rawModel as unknown as Parameters<typeof wrapLanguageModel>[0]['model'],
    middleware: [extractReasoningMiddleware({ tagName: 'think', startWithReasoning: false })],
  });

  const messages = await convertToModelMessages(
    [
      createUserHistoryMessage('Generate a title for this conversation:', { synthetic: true }),
      createUserHistoryMessage(params.message),
    ] as unknown as Parameters<typeof convertToModelMessages>[0],
    { tools: {} } as Parameters<typeof convertToModelMessages>[1],
  );

  const stream = streamText({
    model: model as unknown as Parameters<typeof streamText>[0]['model'],
    system: TITLE_SYSTEM_PROMPT,
    messages,
    temperature: 0,
    maxRetries,
    maxOutputTokens,
    abortSignal: params.abortSignal,
  });

  const text = await stream.text;
  return cleanTitleLine(String(text || ''), maxChars);
}
