import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { extractSkillMentions, renderSkillsSectionForPrompt, selectSkillsForText } from '@kooka/core';
import { getSkillIndex, loadSkillFile } from '../../core/skills';

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, content, 'utf8');
}

async function rmDir(dir: string): Promise<void> {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

suite('Skills', () => {
  test('extractSkillMentions parses $skill tokens and dedupes', () => {
    assert.deepStrictEqual(extractSkillMentions('Use $one then $two then $one again.'), ['one', 'two']);
    assert.deepStrictEqual(extractSkillMentions('Write to $GITHUB_OUTPUT then run $one.'), ['one']);
    assert.deepStrictEqual(extractSkillMentions('Common vars like $PATH should not trigger skills.'), []);
    assert.deepStrictEqual(extractSkillMentions('No skills here.'), []);
  });

  test('selectSkillsForText returns mentioned skills in order', () => {
    const skillOne = {
      name: 'one',
      description: 'One',
      filePath: '/tmp/one/SKILL.md',
      dir: '/tmp/one',
      source: 'workspace' as const,
    };
    const skillTwo = {
      name: 'two',
      description: 'Two',
      filePath: '/tmp/two/SKILL.md',
      dir: '/tmp/two',
      source: 'workspace' as const,
    };

    const index = {
      skills: [skillOne, skillTwo],
      byName: new Map([
        ['one', skillOne],
        ['two', skillTwo],
      ]),
      scannedDirs: [],
    };

    assert.deepStrictEqual(selectSkillsForText('Try $two then $one.', index).selected.map((s) => s.name), ['two', 'one']);
    assert.deepStrictEqual(selectSkillsForText('Unknown $three.', index).selected.map((s) => s.name), []);
  });

  test('renderSkillsSectionForPrompt renders skill list and usage rules', () => {
    const skillOne = {
      name: 'one',
      description: 'One',
      filePath: '/tmp/one/SKILL.md',
      dir: '/tmp/one',
      source: 'workspace' as const,
    };

    assert.strictEqual(renderSkillsSectionForPrompt({ skills: [skillOne], maxSkills: 0 }), undefined);

    const rendered = renderSkillsSectionForPrompt({ skills: [skillOne], maxSkills: 50 });
    assert.ok(rendered);
    assert.ok(rendered.includes('## Skills'));
    assert.ok(rendered.includes('one: One'));
    assert.ok(rendered.includes('$<skill-name>'));

    const empty = renderSkillsSectionForPrompt({ skills: [], maxSkills: 50 });
    assert.ok(empty);
    assert.ok(empty.includes('- (none)'));
  });

  test('discovers workspace skills from configured dirs', async () => {
    const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lingyun-skills-workspace-'));

    try {
      await writeFile(
        path.join(workspaceRoot, '.lingyun', 'skills', 'one', 'SKILL.md'),
        [
          '---',
          'name: skill-one',
          'description: First skill',
          '---',
          '',
          '# Do the thing',
          'Step 1',
        ].join('\n')
      );
      await writeFile(
        path.join(workspaceRoot, '.lingyun', 'skills', 'two', 'SKILL.md'),
        [
          '---',
          'name: skill-two',
          'description: Second skill',
          '---',
          '',
          'Hello',
        ].join('\n')
      );

      const index = await getSkillIndex({
        workspaceRoot,
        searchPaths: ['.lingyun/skills'],
        allowExternalPaths: false,
        watchWorkspace: false,
      });

      assert.strictEqual(index.skills.length, 2);
      assert.deepStrictEqual(index.skills.map(s => s.name), ['skill-one', 'skill-two']);
    } finally {
      await rmDir(workspaceRoot);
    }
  });

  test('skips external directories when allowExternalPaths is disabled', async () => {
    const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lingyun-skills-workspace-'));
    const externalRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lingyun-skills-external-'));

    try {
      await writeFile(
        path.join(workspaceRoot, '.lingyun', 'skills', 'w', 'SKILL.md'),
        [
          '---',
          'name: workspace-skill',
          'description: Workspace skill',
          '---',
          '',
          'Workspace',
        ].join('\n')
      );
      await writeFile(
        path.join(externalRoot, 'x', 'SKILL.md'),
        [
          '---',
          'name: external-skill',
          'description: External skill',
          '---',
          '',
          'External',
        ].join('\n')
      );

      const disabled = await getSkillIndex({
        workspaceRoot,
        searchPaths: ['.lingyun/skills', externalRoot],
        allowExternalPaths: false,
        watchWorkspace: false,
      });

      assert.ok(disabled.byName.has('workspace-skill'));
      assert.ok(!disabled.byName.has('external-skill'));
      assert.ok(disabled.scannedDirs.some(d => d.absPath === path.resolve(externalRoot) && d.status === 'skipped_external'));

      const enabled = await getSkillIndex({
        workspaceRoot,
        searchPaths: ['.lingyun/skills', externalRoot],
        allowExternalPaths: true,
        watchWorkspace: false,
      });

      assert.ok(enabled.byName.has('workspace-skill'));
      assert.ok(enabled.byName.has('external-skill'));
    } finally {
      await rmDir(workspaceRoot);
      await rmDir(externalRoot);
    }
  });

  test('loadSkillFile returns markdown body without frontmatter', async () => {
    const workspaceRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lingyun-skills-workspace-'));

    try {
      await writeFile(
        path.join(workspaceRoot, '.lingyun', 'skills', 'one', 'SKILL.md'),
        [
          '---',
          'name: skill-one',
          'description: First skill',
          '---',
          '',
          'Line 1',
          'Line 2',
          '',
        ].join('\n')
      );

      const index = await getSkillIndex({
        workspaceRoot,
        searchPaths: ['.lingyun/skills'],
        allowExternalPaths: false,
        watchWorkspace: false,
      });

      const skill = index.byName.get('skill-one');
      assert.ok(skill);

      const loaded = await loadSkillFile(skill!);
      assert.strictEqual(loaded.content, 'Line 1\nLine 2');
    } finally {
      await rmDir(workspaceRoot);
    }
  });
});
