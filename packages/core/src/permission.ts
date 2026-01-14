export type PermissionAction = 'allow' | 'ask' | 'deny';

export type PermissionRule = {
  permission: string;
  pattern: string;
  action: PermissionAction;
};

export type PermissionRuleset = PermissionRule[];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wildcardToRegExp(pattern: string): RegExp {
  const normalized = String(pattern ?? '').trim();
  if (!normalized || normalized === '*') return /^.*$/;

  let re = '^';
  for (const ch of normalized) {
    if (ch === '*') {
      re += '.*';
    } else if (ch === '?') {
      re += '.';
    } else {
      re += escapeRegExp(ch);
    }
  }
  re += '$';
  return new RegExp(re);
}

export function wildcardMatch(pattern: string, value: string): boolean {
  try {
    return wildcardToRegExp(pattern).test(String(value ?? ''));
  } catch {
    return false;
  }
}

export function evaluatePermission(
  permission: string,
  pattern: string,
  ruleset: PermissionRuleset
): PermissionRule | undefined {
  let match: PermissionRule | undefined;
  for (const rule of ruleset) {
    if (!wildcardMatch(rule.permission, permission)) continue;
    if (!wildcardMatch(rule.pattern, pattern)) continue;
    match = rule;
  }
  return match;
}

export function mergeRulesets(...rulesets: Array<PermissionRuleset | undefined>): PermissionRuleset {
  const out: PermissionRuleset = [];
  for (const rs of rulesets) {
    if (!rs) continue;
    out.push(...rs);
  }
  return out;
}

