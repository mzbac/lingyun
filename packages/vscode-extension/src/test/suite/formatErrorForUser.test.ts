import * as assert from 'assert';

import { formatErrorForUser } from '../../ui/chat/utils';

suite('formatErrorForUser', () => {
  test('uses Copilot-specific auth tip for 401/403', () => {
    const err: any = new Error('Unauthorized');
    err.statusCode = 401;
    err.url = 'https://api.githubcopilot.com/chat/completions';

    const message = formatErrorForUser(err, { llmProviderId: 'copilot' });

    assert.ok(message.includes('GitHub Copilot auth expired'), 'expected Copilot auth hint');
    assert.ok(
      !message.includes('lingyun.openaiCompatible.apiKeyEnv'),
      'should not show OpenAI-compatible auth hint for Copilot errors',
    );
  });

  test('uses OpenAI-compatible auth tip for 401/403', () => {
    const err: any = new Error('Unauthorized');
    err.statusCode = 401;
    err.url = 'http://127.0.0.1:8080/v1/chat/completions';

    const message = formatErrorForUser(err, { llmProviderId: 'openaiCompatible' });

    assert.ok(
      message.includes('lingyun.openaiCompatible.apiKeyEnv'),
      'expected OpenAI-compatible auth hint when provider is openaiCompatible',
    );
  });

  test('uses Codex-specific auth tip for 401/403', () => {
    const err: any = new Error('Unauthorized');
    err.statusCode = 401;
    err.url = 'https://chatgpt.com/backend-api/codex/responses';

    const message = formatErrorForUser(err, { llmProviderId: 'codexSubscription' });

    assert.ok(message.includes('ChatGPT Codex auth expired'), 'expected Codex auth hint');
  });
});
