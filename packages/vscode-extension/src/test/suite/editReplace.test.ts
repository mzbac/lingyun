import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
  IndentationFlexibleReplacer,
  ReadLinePrefixStrippingReplacer,
  WhitespaceNormalizedReplacer,
  replaceInContent,
} from '../../tools/builtin/editReplace';

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

  test('strips read line-number prefixes across multiple lines', () => {
    assert.deepStrictEqual(
      Array.from(ReadLinePrefixStrippingReplacer('', '00001| const a = 1;\n00002\tconst b = 2;\n')),
      ['const a = 1;\nconst b = 2;\n'],
    );
  });

  test('strips <file> wrappers from oldString', () => {
    const content = 'foo\n';
    const oldString = '<file>\nfoo\n</file>';
    const out = replaceInContent(content, oldString, 'bar', false);
    assert.strictEqual(out, 'bar\n');
  });

  test('matches inline whitespace-normalized snippets', () => {
    assert.deepStrictEqual(
      Array.from(WhitespaceNormalizedReplacer('const value = alpha   +\t beta;', 'alpha + beta')),
      ['alpha   +\t beta'],
    );
  });

  test('replaces a fuzzy block-anchor match', () => {
    const content = [
      'function thing() {',
      '  const value = computeFastPath(input);',
      '  return value + 1;',
      '}',
    ].join('\n');
    const oldString = [
      'function thing() {',
      '  const value = computeSlowPath(input);',
      '  return value + 1;',
      '}',
    ].join('\n');

    const out = replaceInContent(content, oldString, 'const replaced = true;', false);
    assert.strictEqual(out, 'const replaced = true;');
  });

  test('matches indentation-flexible blocks', () => {
    const content = [
      'if (ready) {',
      '    first();',
      '    if (nested) {',
      '      second();',
      '    }',
      '}',
    ].join('\n');
    const oldString = [
      'first();',
      'if (nested) {',
      '  second();',
      '}',
    ].join('\n');

    assert.deepStrictEqual(Array.from(IndentationFlexibleReplacer(content, oldString)), [
      [
        '    first();',
        '    if (nested) {',
        '      second();',
        '    }',
      ].join('\n'),
    ]);
  });

  test('levenshtein distance uses rolling rows instead of a full matrix', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/tools/builtin/editReplace.ts'), 'utf8');
    const start = source.indexOf('function levenshtein');
    assert.ok(start >= 0, 'expected levenshtein helper');
    const end = source.indexOf('export const SimpleReplacer', start);
    assert.ok(end > start, 'expected SimpleReplacer after levenshtein helper');
    const section = source.slice(start, end);

    assert.match(section, /let previous = new Array<number>\(target\.length \+ 1\);/);
    assert.match(section, /let current = new Array<number>\(target\.length \+ 1\);/);
    assert.match(section, /const nextPrevious = current;/);
    assert.match(section, /previous = nextPrevious;/);
    assert.doesNotMatch(section, /Array\.from/);
    assert.doesNotMatch(section, /matrix/);
  });

  test('single block-anchor candidate skips edit-distance scoring', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/tools/builtin/editReplace.ts'), 'utf8');
    const start = source.indexOf('if (candidates.length === 1)');
    assert.ok(start >= 0, 'expected single-candidate block-anchor branch');
    const end = source.indexOf('let bestMatch', start);
    assert.ok(end > start, 'expected multi-candidate branch after single-candidate branch');
    const section = source.slice(start, end);

    assert.match(section, /yield content\.substring\(matchStartIndex, matchEndIndex\);/);
    assert.doesNotMatch(section, /levenshtein/);
    assert.doesNotMatch(section, /similarity/);
    assert.doesNotMatch(section, /SINGLE_CANDIDATE_SIMILARITY_THRESHOLD/);
  });

  test('indentation-flexible normalization avoids filter map and spread arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/tools/builtin/editReplace.ts'), 'utf8');
    const start = source.indexOf('export const IndentationFlexibleReplacer');
    assert.ok(start >= 0, 'expected indentation-flexible replacer');
    const end = source.indexOf('export const EscapeNormalizedReplacer', start);
    assert.ok(end > start, 'expected escape-normalized replacer after indentation-flexible replacer');
    const section = source.slice(start, end);

    assert.match(section, /let minIndent = Number\.POSITIVE_INFINITY;/);
    assert.match(section, /for \(const line of lines\)/);
    assert.match(section, /while \(indent < line\.length\)/);
    assert.match(section, /normalized \+= i === 0 \? nextLine : '\\n' \+ nextLine;/);
    assert.doesNotMatch(section, /\.filter\(/);
    assert.doesNotMatch(section, /\.map\(/);
    assert.doesNotMatch(section, /Math\.min\(\s*\.\.\./);
    assert.doesNotMatch(section, /\[\.\.\./);
  });

  test('read line-prefix stripping scans without split map and join arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/tools/builtin/editReplace.ts'), 'utf8');
    const start = source.indexOf('export const ReadLinePrefixStrippingReplacer');
    assert.ok(start >= 0, 'expected read line-prefix stripping replacer');
    const end = source.indexOf('export const LineTrimmedReplacer', start);
    assert.ok(end > start, 'expected line-trimmed replacer after read prefix stripper');
    const section = source.slice(start, end);

    assert.match(section, /let lineStart = 0;/);
    assert.match(section, /for \(let i = 0; i <= find\.length; i\+\+\)/);
    assert.match(section, /find\.charCodeAt\(i\) !== 10/);
    assert.match(section, /line\.replace\(/);
    assert.doesNotMatch(section, /strippedLines/);
    assert.doesNotMatch(section, /\.split\(/);
    assert.doesNotMatch(section, /\.map\(/);
    assert.doesNotMatch(section, /\.join\(/);
  });

  test('whitespace-normalized inline matcher builds one regex without split map and join arrays', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../src/tools/builtin/editReplace.ts'), 'utf8');
    const patternStart = source.indexOf('function buildWhitespaceFlexiblePattern');
    assert.ok(patternStart >= 0, 'expected whitespace pattern builder');
    const levenshteinStart = source.indexOf('function levenshtein', patternStart);
    assert.ok(levenshteinStart > patternStart, 'expected levenshtein helper after whitespace pattern builder');
    const patternSection = source.slice(patternStart, levenshteinStart);

    const replacerStart = source.indexOf('export const WhitespaceNormalizedReplacer');
    assert.ok(replacerStart >= 0, 'expected whitespace-normalized replacer');
    const replacerEnd = source.indexOf('export const IndentationFlexibleReplacer', replacerStart);
    assert.ok(replacerEnd > replacerStart, 'expected indentation-flexible replacer after whitespace-normalized replacer');
    const replacerSection = source.slice(replacerStart, replacerEnd);

    assert.match(patternSection, /for \(let i = 0; i <= trimmed\.length; i\+\+\)/);
    assert.match(patternSection, /pattern \+= '\\\\s\+';/);
    assert.match(patternSection, /escapeRegExpLiteral\(trimmed\.slice\(tokenStart, i\)\)/);
    assert.match(replacerSection, /const whitespaceFlexibleRegex = new RegExp\(buildWhitespaceFlexiblePattern\(find\)\);/);
    assert.match(replacerSection, /const normalizedLine = normalizeWhitespace\(line\);/);
    assert.doesNotMatch(replacerSection, /find\.trim\(\)\.split/);
    assert.doesNotMatch(replacerSection, /words\.map/);
    assert.doesNotMatch(replacerSection, /\.join\('\\\\s\+'\)/);
    assert.doesNotMatch(replacerSection, /new RegExp\(pattern\)/);
  });
});
