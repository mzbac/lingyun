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

  test('includes safe provider diagnostics without exposing private URL or model id', () => {
    const err: any = new Error('request failed for http://127.0.0.1:8080/v1/responses using private-local-model');
    err.name = 'ProviderHttpError';
    err.statusCode = 429;
    err.url = 'http://127.0.0.1:8080/v1/responses';
    err.providerId = 'openaiCompatible';
    err.modelId = 'private-local-model';
    err.requestId = 'req_user_1';
    err.cfRay = 'ray_user_1';
    err.retryAfterMs = 1500;
    err.code = 'rate_limit_exceeded';
    err.type = 'rate_limit_error';
    err.responseBody = JSON.stringify({ error: { message: 'model private-local-model is rate limited' } });

    const message = formatErrorForUser(err, { llmProviderId: 'openaiCompatible' });

    assert.ok(message.includes('provider=openaiCompatible'));
    assert.ok(message.includes('requestId=req_user_1'));
    assert.ok(message.includes('cfRay=ray_user_1'));
    assert.ok(message.includes('retryAfterMs=1500'));
    assert.ok(message.includes('code=rate_limit_exceeded'));
    assert.ok(message.includes('type=rate_limit_error'));
    assert.ok(message.includes('Server response (truncated & redacted):'));
    assert.ok(message.includes('model <model> is rate limited'));
    assert.ok(!message.includes('127.0.0.1'));
    assert.ok(!message.includes('private-local-model'));
  });

  test('redacts secrets and private endpoints from non-provider user-facing errors', () => {
    const err: any = new Error('failed with sk-test-secret at http://10.0.0.2:8080/v1/chat/completions');
    err.cause = new Error('Authorization: Bearer abc123');

    const message = formatErrorForUser(err, { llmProviderId: 'openaiCompatible' });

    assert.ok(!message.includes('sk-test-secret'));
    assert.ok(!message.includes('10.0.0.2'));
    assert.ok(!message.includes('abc123'));
  });
});
