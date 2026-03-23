const COPILOT_RESPONSES_MODEL_IDS = new Set([
  'gpt-5.3-codex',
  'gpt-5.4',
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

/**
 * GPT-5.3 Codex and GPT-5.4 only accept the default temperature value.
 * Normalize temperature centrally so every request path behaves the same way.
 */
export function normalizeTemperatureForModel(modelId: string, temperature: number | undefined): number | undefined {
  const normalized = String(modelId || '').trim().toLowerCase();
  if (COPILOT_RESPONSES_MODEL_IDS.has(normalized)) return 1;
  return temperature;
}
