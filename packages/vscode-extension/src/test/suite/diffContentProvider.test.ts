import * as assert from 'assert';
import * as vscode from 'vscode';

import { createLingyunDiffUri, LingyunDiffContentProvider, LINGYUN_DIFF_SCHEME, parseLingyunDiffUri } from '../../ui/chat/diffContentProvider';

suite('diffContentProvider', () => {
  test('creates and parses lingyun-diff URIs', () => {
    const uri = createLingyunDiffUri({ toolCallId: 'tool/123', side: 'before', fileName: 'foo.ts' });
    const parsed = parseLingyunDiffUri(uri);
    assert.deepStrictEqual(parsed, { toolCallId: 'tool/123', side: 'before' });
  });

  test('parses diff URIs with repeated path separators', () => {
    const uri = vscode.Uri.from({
      scheme: LINGYUN_DIFF_SCHEME,
      path: '/after//tool-123//foo.ts',
    });

    assert.deepStrictEqual(parseLingyunDiffUri(uri), { toolCallId: 'tool-123', side: 'after' });
  });

  test('sanitizes diff URI filenames from nested paths', () => {
    const uri = createLingyunDiffUri({
      toolCallId: 'tool-123',
      side: 'before',
      fileName: String.raw`C:\tmp\bad:name?.ts`,
    });

    assert.match(uri.path, /\/bad_name_\.ts$/);
  });

  test('serves before/after snapshot content', () => {
    const provider = new LingyunDiffContentProvider((toolCallId) =>
      toolCallId === 'tool-123'
        ? { beforeText: 'before\n', afterText: 'after\n' }
        : undefined
    );

    const beforeUri = createLingyunDiffUri({ toolCallId: 'tool-123', side: 'before', fileName: 'foo.ts' });
    const afterUri = createLingyunDiffUri({ toolCallId: 'tool-123', side: 'after', fileName: 'foo.ts' });

    assert.strictEqual(provider.provideTextDocumentContent(beforeUri), 'before\n');
    assert.strictEqual(provider.provideTextDocumentContent(afterUri), 'after\n');
  });
});
