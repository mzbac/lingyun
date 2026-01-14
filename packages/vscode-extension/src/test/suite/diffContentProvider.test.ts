import * as assert from 'assert';

import { createLingyunDiffUri, LingyunDiffContentProvider, parseLingyunDiffUri } from '../../ui/chat/diffContentProvider';

suite('diffContentProvider', () => {
  test('creates and parses lingyun-diff URIs', () => {
    const uri = createLingyunDiffUri({ toolCallId: 'tool-123', side: 'before', fileName: 'foo.ts' });
    const parsed = parseLingyunDiffUri(uri);
    assert.deepStrictEqual(parsed, { toolCallId: 'tool-123', side: 'before' });
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

