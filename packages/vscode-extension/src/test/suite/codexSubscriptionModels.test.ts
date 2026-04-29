import * as assert from 'assert';

import {
  CODEX_SUBSCRIPTION_DEFAULT_MODEL_ID,
  createCodexFallbackModels,
  normalizeCodexModelsResponse,
} from '../../providers/codexSubscriptionModels';

suite('Codex subscription model catalog', () => {
  test('exports the shared default model id', () => {
    assert.strictEqual(CODEX_SUBSCRIPTION_DEFAULT_MODEL_ID, 'gpt-5.3-codex');
  });

  test('normalizes and sorts remote models with per-model fallback metadata', () => {
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
          max_context_window: 1000000,
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

    assert.deepStrictEqual(models, [
      {
        id: 'custom-codex-model',
        name: 'Custom Codex Model',
        vendor: 'chatgpt',
        family: 'gpt-codex',
        maxInputTokens: 105450,
        maxOutputTokens: 22000,
      },
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        vendor: 'chatgpt',
        family: 'gpt-5',
        maxInputTokens: 258400,
        maxOutputTokens: 128000,
      },
    ]);
    assert.ok(!models.some((model) => model.id === 'hidden-model'));
    assert.ok(!models.some((model) => model.id === 'gpt-5.3-codex'));
  });

  test('appends configured default model metadata when remote Codex catalog omits it', () => {
    const models = normalizeCodexModelsResponse({
      models: [
        {
          slug: 'custom-codex-model',
          display_name: 'Custom Codex Model',
          visibility: 'list',
          priority: 1,
          context_window: 111000,
          max_output_tokens: 22000,
        },
      ],
    }, { defaultModelId: 'gpt-5.3-codex' });

    assert.deepStrictEqual(models, [
      {
        id: 'custom-codex-model',
        name: 'Custom Codex Model',
        vendor: 'chatgpt',
        family: 'gpt-codex',
        maxInputTokens: 105450,
        maxOutputTokens: 22000,
      },
      {
        id: 'gpt-5.3-codex',
        name: 'GPT-5.3 Codex',
        vendor: 'chatgpt',
        family: 'gpt-codex',
        maxInputTokens: 380000,
        maxOutputTokens: 128000,
      },
    ]);
  });

  test('appends custom configured default model metadata when remote Codex catalog omits it', () => {
    const models = normalizeCodexModelsResponse({
      models: [
        {
          slug: 'gpt-5.4',
          display_name: 'GPT-5.4',
          visibility: 'list',
          priority: 1,
          context_window: 1000000,
        },
      ],
    }, { defaultModelId: '  custom-codex-default  ' });

    assert.deepStrictEqual(models, [
      {
        id: 'gpt-5.4',
        name: 'GPT-5.4',
        vendor: 'chatgpt',
        family: 'gpt-5',
        maxInputTokens: 950000,
        maxOutputTokens: 128000,
      },
      {
        id: 'custom-codex-default',
        name: 'custom-codex-default',
        vendor: 'chatgpt',
        family: 'gpt-codex',
      },
    ]);
  });

  test('uses explicit max input tokens and max context fallback before bundled metadata', () => {
    const models = normalizeCodexModelsResponse({
      models: [
        {
          slug: 'explicit-input',
          display_name: 'Explicit Input',
          visibility: 'list',
          priority: 1,
          context_window: 400000,
          effective_context_window_percent: 50,
          max_input_tokens: 123456,
        },
        {
          slug: 'max-context-only',
          display_name: 'Max Context Only',
          visibility: 'list',
          priority: 2,
          max_context_window: 400000,
          effective_context_window_percent: 50,
        },
        {
          slug: 'gpt-5.3-codex',
          display_name: 'GPT-5.3 Codex',
          visibility: 'list',
          priority: 3,
        },
      ],
    });

    assert.strictEqual(models.find((model) => model.id === 'explicit-input')?.maxInputTokens, 123456);
    assert.strictEqual(models.find((model) => model.id === 'max-context-only')?.maxInputTokens, 200000);
    assert.strictEqual(models.find((model) => model.id === 'gpt-5.3-codex')?.maxInputTokens, 380000);
    assert.strictEqual(models.find((model) => model.id === 'gpt-5.3-codex')?.maxOutputTokens, 128000);
  });

  test('accepts numeric string token metadata from remote Codex models', () => {
    const models = normalizeCodexModelsResponse({
      models: [
        {
          slug: 'string-explicit-limits',
          display_name: 'String Explicit Limits',
          visibility: 'list',
          priority: 1,
          max_input_tokens: '123456',
          max_output_tokens: '22000',
        },
        {
          slug: 'string-context-window',
          display_name: 'String Context Window',
          visibility: 'list',
          priority: 2,
          context_window: '400000',
          effective_context_window_percent: '50',
          maxOutputTokens: '64000',
        },
      ],
    });

    assert.strictEqual(models.find((model) => model.id === 'string-explicit-limits')?.maxInputTokens, 123456);
    assert.strictEqual(models.find((model) => model.id === 'string-explicit-limits')?.maxOutputTokens, 22000);
    assert.strictEqual(models.find((model) => model.id === 'string-context-window')?.maxInputTokens, 200000);
    assert.strictEqual(models.find((model) => model.id === 'string-context-window')?.maxOutputTokens, 64000);
  });

  test('sorts Codex models by numeric string priorities', () => {
    const models = normalizeCodexModelsResponse({
      models: [
        {
          slug: 'later-string-priority',
          display_name: 'AAA Later String Priority',
          visibility: 'list',
          priority: '2',
        },
        {
          slug: 'earlier-string-priority',
          display_name: 'ZZZ Earlier String Priority',
          visibility: 'list',
          priority: '1',
        },
        {
          slug: 'numeric-priority',
          display_name: 'Numeric Priority',
          visibility: 'list',
          priority: 3,
        },
      ],
    });

    assert.deepStrictEqual(models.slice(0, 3).map((model) => model.id), [
      'earlier-string-priority',
      'later-string-priority',
      'numeric-priority',
    ]);
  });

  test('skips malformed remote model entries while preserving valid remote models', () => {
    const models = normalizeCodexModelsResponse({
      models: [
        null,
        'bad-entry',
        42,
        {
          slug: 'valid-remote-model',
          display_name: 'Valid Remote Model',
          visibility: 'list',
          priority: 1,
          max_input_tokens: '12345',
          max_output_tokens: '6789',
        },
        {
          slug: 'missing-visible-id',
          visibility: 'hidden',
        },
      ],
    });

    assert.deepStrictEqual(models, [
      {
        id: 'valid-remote-model',
        name: 'Valid Remote Model',
        vendor: 'chatgpt',
        family: 'gpt-5',
        maxInputTokens: 12345,
        maxOutputTokens: 6789,
      },
    ]);
    assert.ok(!models.some((model) => model.id === 'gpt-5.3-codex'));
    assert.ok(!models.some((model) => model.id === 'missing-visible-id'));
  });

  test('appends custom configured default model metadata to bundled fallback models', () => {
    const models = createCodexFallbackModels({ defaultModelId: '  custom-codex-default  ' });

    assert.deepStrictEqual(
      models.map((model) => model.id),
      [
        'gpt-5.5',
        'gpt-5.4',
        'gpt-5.3-codex',
        'gpt-5.2',
        'gpt-5.2-codex',
        'gpt-5.1-codex',
        'gpt-5.1-codex-max',
        'gpt-5.1-codex-mini',
        'custom-codex-default',
      ],
    );
    assert.deepStrictEqual(models[models.length - 1], {
      id: 'custom-codex-default',
      name: 'custom-codex-default',
      vendor: 'chatgpt',
      family: 'gpt-codex',
    });
  });

  test('falls back to the built-in list when the payload is malformed', () => {
    const models = normalizeCodexModelsResponse({ models: 'not-an-array' });
    assert.deepStrictEqual(
      models.map((model) => model.id),
      [
        'gpt-5.5',
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

  test('falls back to the built-in list when the payload is empty', () => {
    const models = normalizeCodexModelsResponse({});
    assert.deepStrictEqual(
      models.map((model) => model.id),
      [
        'gpt-5.5',
        'gpt-5.4',
        'gpt-5.3-codex',
        'gpt-5.2',
        'gpt-5.2-codex',
        'gpt-5.1-codex',
        'gpt-5.1-codex-max',
        'gpt-5.1-codex-mini',
      ],
    );
    assert.strictEqual(models.find((model) => model.id === 'gpt-5.5')?.maxInputTokens, 950000);
    assert.strictEqual(models.find((model) => model.id === 'gpt-5.4')?.maxInputTokens, 950000);
    assert.strictEqual(models.find((model) => model.id === 'gpt-5.3-codex')?.maxInputTokens, 380000);
    assert.ok(models.every((model) => model.maxOutputTokens === 128000));
  });
});
