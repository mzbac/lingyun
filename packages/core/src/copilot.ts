const COPILOT_RESPONSES_MODEL_IDS = new Set([
  'gpt-5.3-codex',
]);

/**
 * Returns true when the given Copilot model id must be routed through the
 * OpenAI `/responses`-style streaming path (as opposed to `/chat/completions`).
 *
 * Keep this centralized so Copilot-specific quirks (providerOptions namespaces,
 * prompt transforms, stream adapters) do not scatter across the codebase.
 */
export function isCopilotResponsesModelId(modelId: string): boolean {
  const normalized = String(modelId || '').trim().toLowerCase();
  return COPILOT_RESPONSES_MODEL_IDS.has(normalized);
}

