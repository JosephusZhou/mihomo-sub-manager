// 用户级共享自定义规则：读取与格式归一化

export const MAX_RULES = 500;
export const MAX_RULE_LENGTH = 512;

/**
 * 归一化规则数组：trim、去空、去重（保留首次出现顺序）、限制长度与条数。
 * 返回 { rules, errors }，errors 非空时调用方应返回 400。
 */
export function normalizeCustomRules(input) {
  if (!Array.isArray(input)) {
    return { rules: [], errors: ['rules: must be an array'] };
  }

  const errors = [];
  const seen = new Set();
  const rules = [];

  for (const raw of input) {
    if (typeof raw !== 'string') {
      errors.push('rules: each entry must be a string');
      continue;
    }
    const rule = raw.trim();
    if (!rule) continue;
    if (rule.length > MAX_RULE_LENGTH) {
      errors.push(`rules: entry exceeds ${MAX_RULE_LENGTH} chars`);
      continue;
    }
    if (/[\r\n]/.test(rule)) {
      errors.push('rules: entry must not contain line breaks');
      continue;
    }
    if (!rule.includes(',')) {
      errors.push(`rules: invalid format "${rule}"`);
      continue;
    }
    if (/^MATCH,/i.test(rule)) {
      errors.push('rules: MATCH is reserved and must not be added');
      continue;
    }
    if (seen.has(rule)) continue;
    seen.add(rule);
    rules.push(rule);
  }

  if (rules.length > MAX_RULES) {
    errors.push(`rules: at most ${MAX_RULES} entries`);
  }

  return { rules: rules.slice(0, MAX_RULES), errors };
}

export async function getUserCustomRules(env, userId) {
  const row = await env.DB.prepare(
    'SELECT rules FROM user_custom_rules WHERE user_id = ?'
  ).bind(userId).first();
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.rules);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
