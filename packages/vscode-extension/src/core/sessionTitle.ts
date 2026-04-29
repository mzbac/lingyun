import { convertToModelMessages, extractReasoningMiddleware, streamText, wrapLanguageModel } from 'ai';
import type { LLMProvider } from './types';
import { createUserHistoryMessage, isCopilotResponsesModelId, normalizeTemperatureForModel, stripThinkBlocks } from '@kooka/core';
import { streamTextWithLingyunDefaults } from './streamText';

const DEFAULT_TITLE_PREFIX = 'New session - ';
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

export type SessionTitleLike = {
  title?: string;
  firstUserMessagePreview?: string;
};

export function createDefaultSessionTitle(now: Date = new Date()): string {
  return `${DEFAULT_TITLE_PREFIX}${now.toISOString()}`;
}

export function isDefaultSessionTitle(title: string): boolean {
  const value = (title || '').trim();
  if (!value) return true;

  // Legacy numbered titles are treated as auto-generated.
  if (/^Session\s+\d+$/i.test(value) || value === 'Session') return true;

  return new RegExp(
    `^${escapeForRegex(DEFAULT_TITLE_PREFIX)}\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$`,
  ).test(value);
}

export function createSessionPreview(text: string, maxChars = 80): string | undefined {
  const collapsed = String(text || '').replace(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;

  const limit = Math.max(1, Math.floor(maxChars));
  if (collapsed.length <= limit) return collapsed;
  if (limit <= 3) return collapsed.slice(0, limit);
  return collapsed.slice(0, limit - 3) + '...';
}

export function getSessionDisplayTitle(session: SessionTitleLike): string {
  const title = String(session.title || '').trim();
  if (title && !isDefaultSessionTitle(title)) return title;

  return createSessionPreview(session.firstUserMessagePreview || '') || title || 'Untitled session';
}

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

function escapeForRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  try {
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
    const useInstructionsOverride =
      params.llm.id === 'copilot' && isCopilotResponsesModelId(params.modelId);

    const stream = streamTextWithLingyunDefaults({
      model: model as unknown as Parameters<typeof streamText>[0]['model'],
      system: useInstructionsOverride ? undefined : TITLE_SYSTEM_PROMPT,
      messages,
      providerOptions: useInstructionsOverride
        ? {
            openai: { instructions: TITLE_SYSTEM_PROMPT },
            copilot: { instructions: TITLE_SYSTEM_PROMPT },
          }
        : undefined,
      temperature: normalizeTemperatureForModel(params.modelId, 0),
      maxRetries,
      maxOutputTokens,
      abortSignal: params.abortSignal,
    });

    const text = await stream.text;
    return cleanTitleLine(String(text || ''), maxChars);
  } catch (error) {
    try {
      params.llm.onRequestError?.(error, { modelId: params.modelId, mode: 'build' });
    } catch {
      // Ignore provider error hooks; preserve the original title-generation failure.
    }
    throw error;
  }
}
