import { stripThinkBlocks, stripToolBlocks } from './agentText';

export function extractPlanFromReasoning(reasoning: string): string {
  const cleaned = stripToolBlocks(stripThinkBlocks(reasoning || '')).replace(/\r\n/g, '\n');
  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const numbered = lines.filter((line) => /^\d+\.\s+\S/.test(line));
  if (numbered.length > 0) {
    return numbered.slice(0, 12).join('\n').trim();
  }

  const bullets = lines
    .filter((line) => /^[-*•]\s+\S/.test(line))
    .map((line) => line.replace(/^[-*•]\s+/, '').trim())
    .filter(Boolean);
  if (bullets.length > 0) {
    return bullets
      .slice(0, 8)
      .map((item, i) => `${i + 1}. ${item}`)
      .join('\n')
      .trim();
  }

  const questions = lines.filter((line) => /\?\s*$/.test(line)).slice(0, 3);
  if (questions.length > 0) {
    return questions
      .map((q, i) => `${i + 1}. ${q.replace(/^\d+\.\s+/, '')}`)
      .join('\n')
      .trim();
  }

  return '';
}

