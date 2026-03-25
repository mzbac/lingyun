import * as assert from 'assert';

import {
  CODEX_SUBSCRIPTION_DEFAULT_MODEL_ID,
  normalizeCodexModelsResponse,
} from '../../providers/codexSubscriptionModels';

suite('Codex subscription model catalog', () => {
  test('exports the shared default model id', () => {
    assert.strictEqual(CODEX_SUBSCRIPTION_DEFAULT_MODEL_ID, 'gpt-5.3-codex');
  });

  test('normalizes, sorts, and merges remote models with fallback metadata', () => {
    const models = normalizeCodexModelsResponse({
      models: [
        {
          slug: 'hidden-model',
          display_name: 'Hidden Model',
          visibility: 'hidden',
          priority: 0,
          context_window: 123,
        },
        {
          slug: 'gpt-5.4',
          display_name: 'GPT-5.4',
          visibility: 'list',
          priority: 2,
          context_window: 272000,
        },
        {
          slug: 'custom-codex-model',
          display_name: 'Custom Codex Model',
          visibility: 'list',
          priority: 1,
          context_window: 111000,
          max_output_tokens: 22000,
        },
      ],
    });

    assert.deepStrictEqual(models.slice(0, 3), [
      {
        id: 'custom-codex-model',
        name: 'Custom Codex Model',
        vendor: 'chatgpt',
        family: 'gpt-codex',
        maxInputTokens: 111000,
        maxOutputTokens: 22000,
      },
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        vendor: 'chatgpt',
        family: 'gpt-5',
        maxInputTokens: 272000,
        maxOutputTokens: undefined,
      },
      {
        id: 'gpt-5.3-codex',
        name: 'GPT-5.3 Codex',
        vendor: 'chatgpt',
        family: 'gpt-codex',
      },
    ]);
    assert.ok(!models.some((model) => model.id === 'hidden-model'));
  });

  test('falls back to the built-in list when the payload is empty', () => {
    const models = normalizeCodexModelsResponse({});
    assert.deepStrictEqual(
      models.map((model) => model.id),
      [
        'gpt-5.4',
        'gpt-5.3-codex',
        'gpt-5.2',
        'gpt-5.2-codex',
        'gpt-5.1-codex',
        'gpt-5.1-codex-max',
        'gpt-5.1-codex-mini',
      ],
    );
  });
});
