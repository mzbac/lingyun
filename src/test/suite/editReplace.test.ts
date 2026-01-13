import * as assert from 'assert';

import { replaceInContent } from '../../tools/builtin/editReplace';

suite('editReplace', () => {
  test('replaces exact match', () => {
    const out = replaceInContent('hello world', 'world', 'there');
    assert.strictEqual(out, 'hello there');
  });

  test('throws when oldString matches multiple times (replaceAll=false)', () => {
    assert.throws(() => replaceInContent('a a', 'a', 'b', false), /multiple/i);
  });

  test('replaces all occurrences when replaceAll=true', () => {
    const out = replaceInContent('a a', 'a', 'b', true);
    assert.strictEqual(out, 'b b');
  });

  test('strips read line-number prefixes like 00001|', () => {
    const content = 'const a = 1;\nconst b = 2;\n';
    const oldString = '00001| const a = 1;';
    const out = replaceInContent(content, oldString, 'const a = 3;', false);
    assert.ok(out.includes('const a = 3;'));
    assert.ok(out.includes('const b = 2;'));
  });

  test('strips <file> wrappers from oldString', () => {
    const content = 'foo\n';
    const oldString = '<file>\nfoo\n</file>';
    const out = replaceInContent(content, oldString, 'bar', false);
    assert.strictEqual(out, 'bar\n');
  });
});

