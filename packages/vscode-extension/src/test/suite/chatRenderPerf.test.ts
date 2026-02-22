import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

suite('Chat Render Perf Guards', () => {
  test('assistant markdown streaming uses debounced queue instead of per-token reparse', () => {
    const mainJsPath = path.resolve(__dirname, '../../../media/chat/main.js');
    const source = fs.readFileSync(mainJsPath, 'utf8');

    const debounceMatch = source.match(/const\s+MARKDOWN_RENDER_DEBOUNCE_MS\s*=\s*(\d+)\s*;/);
    assert.ok(debounceMatch, 'expected markdown debounce constant');
    const debounceMs = Number(debounceMatch?.[1] || 0);
    assert.ok(Number.isFinite(debounceMs) && debounceMs > 0 && debounceMs <= 100, 'debounce should be bounded');

    const tokenCaseStart = source.indexOf("case 'token':");
    assert.ok(tokenCaseStart >= 0, 'expected token case in webview message handler');
    const tokenCaseEnd = source.indexOf("case 'updateTool':", tokenCaseStart);
    assert.ok(tokenCaseEnd > tokenCaseStart, 'expected end of token case block');
    const tokenCaseBody = source.slice(tokenCaseStart, tokenCaseEnd);

    assert.ok(
      tokenCaseBody.includes('queueAssistantMarkdownToken('),
      'token branch should enqueue assistant markdown tokens'
    );
    assert.ok(
      !tokenCaseBody.includes('renderMarkdown('),
      'token branch must not call renderMarkdown directly for each chunk'
    );

    const updateCaseStart = source.indexOf("case 'updateMessage':");
    assert.ok(updateCaseStart >= 0, 'expected updateMessage case in webview message handler');
    const updateCaseEnd = source.indexOf("case 'processing':", updateCaseStart);
    assert.ok(updateCaseEnd > updateCaseStart, 'expected end of updateMessage case block');
    const updateCaseBody = source.slice(updateCaseStart, updateCaseEnd);

    assert.ok(
      updateCaseBody.includes('flushAssistantMarkdownRender('),
      'updateMessage branch should flush pending markdown queue'
    );
  });
});
