import * as assert from 'assert';

import { classifyOfficeWorkType } from '../../ui/office/workTypes';

suite('Office work type classification', () => {
  test('classifies core read/search/write/task tools', () => {
    assert.strictEqual(classifyOfficeWorkType('read', { filePath: 'README.md' }), 'read');
    assert.strictEqual(classifyOfficeWorkType('read_range', { filePath: 'README.md' }), 'read');
    assert.strictEqual(classifyOfficeWorkType('list', { path: '.' }), 'read');
    assert.strictEqual(classifyOfficeWorkType('grep', { pattern: 'needle' }), 'search');
    assert.strictEqual(classifyOfficeWorkType('glob', { pattern: '**/*.ts' }), 'search');
    assert.strictEqual(classifyOfficeWorkType('write', { filePath: 'a.txt' }), 'write');
    assert.strictEqual(classifyOfficeWorkType('edit', { filePath: 'a.txt' }), 'write');
    assert.strictEqual(classifyOfficeWorkType('task', { description: 'Do thing', prompt: '...' }), 'task');
  });

  test('classifies todo tools as board work (task)', () => {
    assert.strictEqual(classifyOfficeWorkType('todowrite', { todos: [] }), 'task');
    assert.strictEqual(classifyOfficeWorkType('todoread', {}), 'task');
  });

  test('classifies bash file inspection as read', () => {
    assert.strictEqual(classifyOfficeWorkType('bash', { command: 'cat README.md' }), 'read');
    assert.strictEqual(classifyOfficeWorkType('bash', { command: 'cd repo && cat README.md' }), 'read');
    assert.strictEqual(classifyOfficeWorkType('bash', { command: 'git diff' }), 'read');
    assert.strictEqual(classifyOfficeWorkType('bash', { command: 'cd repo && git show HEAD:README.md' }), 'read');
  });

  test('classifies bash searching as search', () => {
    assert.strictEqual(classifyOfficeWorkType('bash', { command: 'rg needle src' }), 'search');
    assert.strictEqual(classifyOfficeWorkType('bash', { command: 'cd repo && rg needle src' }), 'search');
    assert.strictEqual(classifyOfficeWorkType('bash', { command: 'git grep needle' }), 'search');
  });

  test('classifies bash execution as execute by default', () => {
    assert.strictEqual(classifyOfficeWorkType('bash', { command: 'npm test' }), 'execute');
    assert.strictEqual(classifyOfficeWorkType('bash', { command: 'pnpm -w lint' }), 'execute');
  });
});
