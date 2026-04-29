import * as assert from 'assert';

import {
  isCopilotResponsesModelId,
  isGpt5FamilyModelId,
  normalizeTemperatureForModel,
  shouldUseResponsesApiForModelId,
} from '@kooka/core';

suite('Responses model routing', () => {
  test('routes GPT models at or above GPT-5.3 through Responses API', () => {
    for (const modelId of [
      'gpt-5.3',
      'gpt-5.3-codex',
      'openai/gpt-5.3-codex',
      'openai:gpt-5.3-codex',
      'gpt-5.4',
      'gpt-5.5',
      'gpt-5.5-codex',
      'gpt-6',
    ]) {
      assert.strictEqual(shouldUseResponsesApiForModelId(modelId), true, modelId);
      assert.strictEqual(isCopilotResponsesModelId(modelId), true, modelId);
    }
  });

  test('detects GPT-5 family model ids with provider prefixes', () => {
    for (const modelId of ['gpt-5', 'gpt-5.3-codex', 'openai/gpt-5.5', 'openai:gpt-5.5-codex']) {
      assert.strictEqual(isGpt5FamilyModelId(modelId), true, modelId);
    }

    for (const modelId of ['gpt-4o', 'gpt-50', 'my-gpt-5-wrapper', 'claude-sonnet-4.5', '']) {
      assert.strictEqual(isGpt5FamilyModelId(modelId), false, modelId);
    }
  });

  test('keeps GPT models below GPT-5.3 on chat completions', () => {
    for (const modelId of ['gpt-4o', 'gpt-5', 'gpt-5-mini', 'gpt-5.1-codex', 'gpt-5.2']) {
      assert.strictEqual(shouldUseResponsesApiForModelId(modelId), false, modelId);
      assert.strictEqual(isCopilotResponsesModelId(modelId), false, modelId);
    }
  });

  test('does not route non-GPT model ids through Responses API', () => {
    for (const modelId of ['claude-sonnet-4.5', 'o3', 'local-coder', '']) {
      assert.strictEqual(shouldUseResponsesApiForModelId(modelId), false, modelId);
    }
  });

  test('forces default temperature only for Responses-routed models', () => {
    assert.strictEqual(normalizeTemperatureForModel('gpt-5.3', 0.2), 1);
    assert.strictEqual(normalizeTemperatureForModel('gpt-5.5-codex', 0.2), 1);
    assert.strictEqual(normalizeTemperatureForModel('gpt-5.2', 0.2), 0.2);
    assert.strictEqual(normalizeTemperatureForModel('claude-sonnet-4.5', 0.2), 0.2);
  });
});
