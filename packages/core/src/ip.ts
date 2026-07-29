const DOT_CHAR_CODE = 46;
const ZERO_CHAR_CODE = 48;
const NINE_CHAR_CODE = 57;

export function isPrivateIpv4Address(value: string): boolean {
  let a = -1;
  let b = -1;
  let part = 0;
  let partCount = 0;
  let hasDigit = false;

  for (let i = 0; i <= value.length; i++) {
    const code = i < value.length ? value.charCodeAt(i) : DOT_CHAR_CODE;
    if (code >= ZERO_CHAR_CODE && code <= NINE_CHAR_CODE) {
      hasDigit = true;
      part = part * 10 + code - ZERO_CHAR_CODE;
      if (part > 255) return false;
      continue;
    }

    if (code !== DOT_CHAR_CODE || !hasDigit) return false;
    partCount++;
    if (partCount === 1) a = part;
    if (partCount === 2) b = part;
    if (partCount > 4) return false;
    part = 0;
    hasDigit = false;
  }

  if (partCount !== 4) return false;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}
