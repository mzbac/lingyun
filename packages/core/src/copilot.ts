const RESPONSES_API_MINIMUM_GPT_VERSION = [5, 3, 0] as const;

function parseGptVersion(modelId: string): [number, number, number] | undefined {
  const match = String(modelId || '')
    .trim()
    .toLowerCase()
    .match(/(?:^|[/:])gpt-(\d+)(?:\.(\d+))?(?:\.(\d+))?(?=$|[-_:/])/);
  if (!match) return undefined;

  const major = Number.parseInt(match[1], 10);
  const minor = match[2] === undefined ? 0 : Number.parseInt(match[2], 10);
  const patch = match[3] === undefined ? 0 : Number.parseInt(match[3], 10);
  if (![major, minor, patch].every(Number.isFinite)) return undefined;
  return [major, minor, patch];
}

function isAtLeastMinimumGptVersion(version: [number, number, number]): boolean {
  for (let index = 0; index < RESPONSES_API_MINIMUM_GPT_VERSION.length; index += 1) {
    const minimum = RESPONSES_API_MINIMUM_GPT_VERSION[index];
    if (version[index] > minimum) return true;
    if (version[index] < minimum) return false;
  }
  return true;
}

/**
 * Returns true when the given model id must be routed through the
 * OpenAI `/responses`-style streaming path (as opposed to `/chat/completions`).
 *
 * Keep this centralized so provider-specific quirks (providerOptions namespaces,
 * prompt transforms, stream adapters) do not scatter across the codebase.
 */
export function shouldUseResponsesApiForModelId(modelId: string): boolean {
  const normalized = String(modelId || '').trim().toLowerCase();
  const version = parseGptVersion(normalized);
  return version !== undefined && isAtLeastMinimumGptVersion(version);
}

export function isCopilotResponsesModelId(modelId: string): boolean {
  return shouldUseResponsesApiForModelId(modelId);
}

/**
 * Responses-routed GPT models only accept the default temperature value.
 * Normalize temperature centrally so every request path behaves the same way.
 */
export function normalizeTemperatureForModel(modelId: string, temperature: number | undefined): number | undefined {
  if (shouldUseResponsesApiForModelId(modelId)) return 1;
  return temperature;
}
