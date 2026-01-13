import * as assert from 'assert';

import { buildToolDiffView, computeUnifiedDiffStats, createUnifiedDiff, trimUnifiedDiff } from '../../ui/chat/toolDiff';

suite('toolDiff', () => {
  test('creates a unified diff and counts +/- lines', () => {
    const diff = createUnifiedDiff({
      filePath: 'foo.txt',
      beforeText: 'hello\n',
      afterText: 'hello world\n',
      context: 3,
    });

    assert.ok(diff.includes('--- a/foo.txt'));
    assert.ok(diff.includes('+++ b/foo.txt'));
    assert.ok(diff.includes('-hello'));
    assert.ok(diff.includes('+hello world'));

    const stats = computeUnifiedDiffStats(diff);
    assert.deepStrictEqual(stats, { additions: 1, deletions: 1 });
  });

  test('treats header-only diffs as 0/0', () => {
    const diff = createUnifiedDiff({
      filePath: 'same.txt',
      beforeText: 'same\n',
      afterText: 'same\n',
      context: 3,
    });

    const stats = computeUnifiedDiffStats(diff);
    assert.deepStrictEqual(stats, { additions: 0, deletions: 0 });
  });

  test('trims large diffs', () => {
    const before = Array.from({ length: 800 }, () => 'a').join('\n') + '\n';
    const after = Array.from({ length: 800 }, () => 'b').join('\n') + '\n';
    const diff = createUnifiedDiff({ filePath: 'big.txt', beforeText: before, afterText: after, context: 3 });
    const trimmed = trimUnifiedDiff(diff, { maxChars: 1500, maxLines: 40 });

    assert.strictEqual(trimmed.truncated, true);
    assert.ok(trimmed.text.includes('[TRUNCATED]'));
    assert.ok(trimmed.text.length <= 1600);
  });

  test('buildToolDiffView assigns old/new line numbers', () => {
    const diff = createUnifiedDiff({
      filePath: 'foo.txt',
      beforeText: 'a\nb\nc\n',
      afterText: 'a\nB\nc\n',
      context: 3,
    });

    const view = buildToolDiffView(diff, { filePath: 'foo.txt' });
    assert.ok(view);
    assert.strictEqual(view!.files[0].filePath, 'foo.txt');

    const hunks = view!.files[0].hunks;
    assert.ok(hunks.length > 0);
    const allLines = hunks.flatMap(h => h.lines);

    assert.ok(allLines.some(l => l.kind === 'ctx' && l.oldLine === 1 && l.newLine === 1 && l.text === 'a'));
    assert.ok(allLines.some(l => l.kind === 'del' && l.oldLine === 2 && l.text === 'b'));
    assert.ok(allLines.some(l => l.kind === 'add' && l.newLine === 2 && l.text === 'B'));
  });

  test('buildToolDiffView strips truncation marker', () => {
    const before = Array.from({ length: 200 }, (_v, i) => `a${i}`).join('\n') + '\n';
    const after = Array.from({ length: 200 }, (_v, i) => `b${i}`).join('\n') + '\n';
    const diff = createUnifiedDiff({ filePath: 'big.txt', beforeText: before, afterText: after, context: 3 });
    const trimmed = trimUnifiedDiff(diff, { maxChars: 2000, maxLines: 60 });

    const view = buildToolDiffView(trimmed.text, { filePath: 'big.txt' });
    assert.ok(view);

    const allLines = view!.files.flatMap(f => f.hunks.flatMap(h => h.lines));
    assert.ok(allLines.every(l => !String(l.text).includes('[TRUNCATED]')));
  });
});
