import { stripThinkBlocks, stripToolBlocks } from './agentText';

const MAX_NUMBERED_PLAN_LINES = 12;
const MAX_BULLET_PLAN_LINES = 8;
const MAX_QUESTION_PLAN_LINES = 3;

function hasWhitespaceAt(value: string, index: number): boolean {
  const char = value[index];
  return typeof char === 'string' && /\s/.test(char);
}

function getOrderedListItemText(line: string): { marker: '.' | ')'; text: string } | undefined {
  let digitIndex = 0;
  while (digitIndex < line.length) {
    const charCode = line.charCodeAt(digitIndex);
    if (charCode < 48 || charCode > 57) break;
    digitIndex++;
  }
  if (digitIndex === 0) return undefined;

  const marker = line[digitIndex];
  if (marker !== '.' && marker !== ')') return undefined;
  if (!hasWhitespaceAt(line, digitIndex + 1)) return undefined;

  const text = line.slice(digitIndex + 2).trim();
  return text ? { marker, text } : undefined;
}

function getBulletItemText(line: string): string {
  const first = line[0];
  if ((first !== '-' && first !== '*' && first !== '•') || !hasWhitespaceAt(line, 1)) return '';

  const text = line.slice(2).trim();
  if (text.length > 4 && text[0] === '[' && text[2] === ']' && hasWhitespaceAt(text, 3)) {
    const check = text[1];
    if (check === ' ' || check === 'x' || check === 'X') return text.slice(4).trim();
  }
  return text;
}

function formatNumberedItems(items: readonly string[]): string {
  let formatted = '';
  for (let i = 0; i < items.length; i++) {
    if (formatted) formatted += '\n';
    formatted += `${i + 1}. ${items[i]}`;
  }
  return formatted;
}

export function extractPlanFromReasoning(reasoning: string): string {
  const cleaned = stripToolBlocks(stripThinkBlocks(reasoning || '')).replace(/\r\n/g, '\n');
  const numbered: string[] = [];
  const bullets: string[] = [];
  const questions: string[] = [];

  let lineStart = 0;
  for (let i = 0; i <= cleaned.length; i++) {
    if (i < cleaned.length && cleaned.charCodeAt(i) !== 10) continue;

    const line = cleaned.slice(lineStart, i).trim();
    if (line) {
      const ordered = getOrderedListItemText(line);
      if (ordered && numbered.length < MAX_NUMBERED_PLAN_LINES) {
        numbered.push(ordered.marker === '.' ? line : `${numbered.length + 1}. ${ordered.text}`);
      }

      if (bullets.length < MAX_BULLET_PLAN_LINES) {
        const bullet = getBulletItemText(line);
        if (bullet) bullets.push(bullet);
      }

      if (questions.length < MAX_QUESTION_PLAN_LINES && line.endsWith('?')) {
        questions.push(ordered ? ordered.text : line);
      }
    }

    lineStart = i + 1;
  }

  if (numbered.length > 0) {
    return numbered.join('\n');
  }

  if (bullets.length > 0) {
    return formatNumberedItems(bullets);
  }

  if (questions.length > 0) {
    return formatNumberedItems(questions);
  }

  return '';
}
