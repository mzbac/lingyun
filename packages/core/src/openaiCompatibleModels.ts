/**
 * Canonical openai-compatible model-record normalization.
 *
 * Shared by `@kooka/agent-sdk` (headless provider) and the VS Code extension
 * (model catalog). Kept here so a new provider token-key variant or parsing
 * rule is applied in exactly one place.
 */

export type OpenAICompatibleModelRecord = {
  id?: unknown;
  owned_by?: unknown;
  name?: unknown;
  display_name?: unknown;
  context_length?: unknown;
  contextLength?: unknown;
  context_window?: unknown;
  contextWindow?: unknown;
  max_context_window?: unknown;
  maxContextWindow?: unknown;
  max_model_len?: unknown;
  maxModelLen?: unknown;
  max_input_tokens?: unknown;
  maxInputTokens?: unknown;
  input_token_limit?: unknown;
  inputTokenLimit?: unknown;
  max_output_tokens?: unknown;
  maxOutputTokens?: unknown;
  max_completion_tokens?: unknown;
  maxCompletionTokens?: unknown;
  output_token_limit?: unknown;
  outputTokenLimit?: unknown;
  max_tokens?: unknown;
  maxTokens?: unknown;
  model_info?: unknown;
  modelInfo?: unknown;
  litellm_params?: unknown;
  litellmParams?: unknown;
  top_provider?: unknown;
  topProvider?: unknown;
  metadata?: unknown;
};

export const OPENAI_COMPATIBLE_NESTED_METADATA_KEYS = [
  'model_info',
  'modelInfo',
  'litellm_params',
  'litellmParams',
  'top_provider',
  'topProvider',
  'metadata',
] as const;

export const OPENAI_COMPATIBLE_MAX_INPUT_TOKEN_KEYS = [
  'max_input_tokens',
  'maxInputTokens',
  'input_token_limit',
  'inputTokenLimit',
  'context_length',
  'contextLength',
  'context_window',
  'contextWindow',
  'max_context_window',
  'maxContextWindow',
  'max_model_len',
  'maxModelLen',
  'max_tokens',
  'maxTokens',
] as const;

export const OPENAI_COMPATIBLE_MAX_OUTPUT_TOKEN_KEYS = [
  'max_output_tokens',
  'maxOutputTokens',
  'max_completion_tokens',
  'maxCompletionTokens',
  'output_token_limit',
  'outputTokenLimit',
  'max_tokens',
  'maxTokens',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function positiveFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return undefined;
}

function stringMetadata(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function positiveFiniteRecordMetadataNumber(record: Record<string, unknown>, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = positiveFiniteNumber(record[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

function positiveFiniteModelMetadataNumber(model: OpenAICompatibleModelRecord, keys: readonly string[]): number | undefined {
  for (const key of keys) {
    const value = positiveFiniteNumber(model[key as keyof OpenAICompatibleModelRecord]);
    if (value !== undefined) return value;
  }

  for (const nestedKey of OPENAI_COMPATIBLE_NESTED_METADATA_KEYS) {
    const nested = model[nestedKey];
    if (!isRecord(nested)) continue;

    const value = positiveFiniteRecordMetadataNumber(nested, keys);
    if (value !== undefined) return value;
  }

  return undefined;
}

export function getOpenAICompatibleMaxInputTokens(model: OpenAICompatibleModelRecord): number | undefined {
  return positiveFiniteModelMetadataNumber(model, OPENAI_COMPATIBLE_MAX_INPUT_TOKEN_KEYS);
}

export function getOpenAICompatibleMaxOutputTokens(model: OpenAICompatibleModelRecord): number | undefined {
  return positiveFiniteModelMetadataNumber(model, OPENAI_COMPATIBLE_MAX_OUTPUT_TOKEN_KEYS);
}

export function validOpenAICompatibleModelRecord(
  value: unknown,
): (OpenAICompatibleModelRecord & { id: string }) | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== 'string' || !value.id.trim()) return undefined;
  return value as OpenAICompatibleModelRecord & { id: string };
}

export { stringMetadata };
