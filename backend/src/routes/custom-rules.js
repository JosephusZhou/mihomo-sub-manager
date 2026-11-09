// 用户级共享自定义规则读写
import { jsonResponse, requireAuth } from '../auth.js';
import { deleteAllProfileCaches } from '../services/cache.js';
import { getUserCustomRules, normalizeCustomRules } from '../services/custom-rules.js';

export async function handleCustomRules(request, env, path) {
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  if (path !== '/api/custom-rules') {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  if (request.method === 'GET') {
    return jsonResponse({ rules: await getUserCustomRules(env, auth.userId) });
  }

  if (request.method === 'PUT') {
    const body = await request.json();
    const { rules, errors } = normalizeCustomRules(body?.rules);
    if (errors.length) {
      return jsonResponse({ error: 'Validation failed', details: errors }, 400);
    }

    await env.DB.prepare(`
      INSERT INTO user_custom_rules (user_id, rules, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET rules = excluded.rules, updated_at = datetime('now')
    `).bind(auth.userId, JSON.stringify(rules)).run();

    await deleteAllProfileCaches(env, auth.userId);
    return jsonResponse({ rules });
  }

  return jsonResponse({ error: 'Method not allowed' }, 405);
}
