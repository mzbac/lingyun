import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import type { ToolContext } from '../../index.js';
import { createSkillTool } from '../../tools/builtin/skill.js';

function createToolContext(workspaceRoot: string): ToolContext {
  return {
    workspaceRoot,
    allowExternalPaths: false,
    signal: new AbortController().signal,
    log: () => {},
  };
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

suite('Skill Tool', () => {
  test('lists available skills through shared catalog formatting', async () => {
    const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lingyun-sdk-skill-tool-'));

    try {
      await writeFile(
        path.join(workspaceRoot, '.lingyun', 'skills', 'alpha', 'SKILL.md'),
        ['---', 'name: alpha', 'description: Alpha skill', '---', '', 'Do alpha.'].join('\n')
      );

      const { handler } = createSkillTool({ searchPaths: ['.lingyun/skills'] });
      const result = await handler({}, createToolContext(workspaceRoot));

      assert.strictEqual(result.success, true);
      assert.strictEqual(
        result.data,
        [
          'Load a skill to get detailed instructions for a specific task.',
          'Call: skill { "name": "..." }',
          '',
          '<available_skills>',
          '  <skill>',
          '    <name>alpha</name>',
          '    <description>Alpha skill</description>',
          '  </skill>',
          '</available_skills>',
        ].join('\n')
      );
    } finally {
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
