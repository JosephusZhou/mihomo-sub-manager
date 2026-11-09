// Templates CRUD routes
import { jsonResponse, requireAuth } from '../auth.js';
import { deleteAllProfileCaches } from '../services/cache.js';
import { generateRulesPreview } from '../services/config-generator.js';
import { getUserCustomRules } from '../services/custom-rules.js';

const VALID_DNS_MODES = ['fake-ip', 'real-ip'];
const ALL_REGIONS = [
  '香港', '台湾', '韩国', '日本', '新加坡',
  '美国', '亚洲其他', '美洲其他', '欧洲', '其他',
];

export async function handleTemplates(request, env, path) {
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  const idMatch = path.match(/^\/api\/templates\/(\d+)$/);
  const id = idMatch ? Number(idMatch[1]) : null;
  const previewMatch = path.match(/^\/api\/templates\/(\d+)\/preview-rules$/);
  const previewId = previewMatch ? Number(previewMatch[1]) : null;

  if (path === '/api/templates' && request.method === 'GET') {
    return listTemplates(env, auth.userId);
  }
  if (path === '/api/templates' && request.method === 'POST') {
    return createTemplate(request, env, auth.userId);
  }
  if (previewId && request.method === 'GET') {
    return previewTemplateRules(env, auth.userId, previewId);
  }
  if (id && request.method === 'GET') {
    return getTemplate(env, auth.userId, id);
  }
  if (id && request.method === 'PUT') {
    return updateTemplate(request, env, auth.userId, id);
  }
  if (id && request.method === 'DELETE') {
    return deleteTemplate(env, auth.userId, id);
  }
  return jsonResponse({ error: 'Not found' }, 404);
}

async function listTemplates(env, userId) {
  const templates = await env.DB.prepare(
    'SELECT * FROM templates WHERE user_id = ? OR user_id = 0 ORDER BY is_system DESC, id'
  ).bind(userId).all();

  return jsonResponse({
    templates: templates.results.map(t => ({
      ...t,
      regions: JSON.parse(t.regions),
    })),
  });
}

async function getTemplate(env, userId, id) {
  const template = await env.DB.prepare(
    'SELECT * FROM templates WHERE id = ? AND (user_id = ? OR user_id = 0)'
  ).bind(id, userId).first();

  if (!template) return jsonResponse({ error: 'Not found' }, 404);

  return jsonResponse({
    template: {
      ...template,
      regions: JSON.parse(template.regions),
    },
  });
}

async function previewTemplateRules(env, userId, id) {
  const template = await env.DB.prepare(
    'SELECT * FROM templates WHERE id = ? AND (user_id = ? OR user_id = 0)'
  ).bind(id, userId).first();

  if (!template) return jsonResponse({ error: 'Not found' }, 404);

  // 与真实生成一致：模板勾选时才注入该用户的共享规则，顺序由生成器决定（自定义在前）。
  const customRules = template.include_custom_rules
    ? await getUserCustomRules(env, userId)
    : [];

  return jsonResponse({
    yaml: generateRulesPreview({
      adBlocking: template.ad_blocking === 1,
      customRules,
    }),
  });
}

async function createTemplate(request, env, userId) {
  const body = await request.json();
  const errors = validateTemplateInput(body);
  if (errors.length) return jsonResponse({ error: 'Validation failed', details: errors }, 400);

  const existing = await env.DB.prepare(
    'SELECT id FROM templates WHERE user_id = ? AND name = ?'
  ).bind(userId, body.name).first();
  if (existing) return jsonResponse({ error: `Template name "${body.name}" already exists` }, 409);

  const result = await env.DB.prepare(
    'INSERT INTO templates (user_id, name, is_system, dns_mode, ad_blocking, regions, include_custom_rules) VALUES (?, ?, 0, ?, ?, ?, ?)'
  ).bind(
    userId, body.name,
    body.dns_mode || 'fake-ip',
    body.ad_blocking !== undefined ? (body.ad_blocking ? 1 : 0) : 1,
    JSON.stringify(body.regions || []),
    body.include_custom_rules !== undefined ? (body.include_custom_rules ? 1 : 0) : 1,
  ).run();

  const template = await env.DB.prepare('SELECT * FROM templates WHERE id = ?')
    .bind(result.meta.last_row_id).first();

  return jsonResponse({
    template: {
      ...template,
      regions: JSON.parse(template.regions),
    },
  }, 201);
}

async function updateTemplate(request, env, userId, id) {
  const existing = await env.DB.prepare(
    'SELECT * FROM templates WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();

  if (!existing) {
    const system = await env.DB.prepare(
      'SELECT * FROM templates WHERE id = ? AND user_id = 0'
    ).bind(id).first();
    if (system) return jsonResponse({ error: 'Cannot modify system templates' }, 403);
    return jsonResponse({ error: 'Not found' }, 404);
  }

  const body = await request.json();
  const nextName = body.name ?? existing.name;

  if (!nextName || typeof nextName !== 'string' || nextName.length > 128) {
    return jsonResponse({ error: 'name: required, max 128 chars' }, 400);
  }

  if (nextName !== existing.name) {
    const dup = await env.DB.prepare(
      'SELECT id FROM templates WHERE user_id = ? AND name = ? AND id != ?'
    ).bind(userId, nextName, id).first();
    if (dup) return jsonResponse({ error: `Template name "${nextName}" already exists` }, 409);
  }

  if (body.dns_mode && !VALID_DNS_MODES.includes(body.dns_mode)) {
    return jsonResponse({ error: `dns_mode must be one of: ${VALID_DNS_MODES.join(', ')}` }, 400);
  }

  if (body.regions !== undefined) {
    if (!Array.isArray(body.regions)) {
      return jsonResponse({ error: 'regions: must be an array' }, 400);
    }
    const invalid = body.regions.filter(r => !ALL_REGIONS.includes(r));
    if (invalid.length) {
      return jsonResponse({ error: `Invalid regions: ${invalid.join(', ')}` }, 400);
    }
  }

  for (const key of ['include_custom_rules', 'ad_blocking']) {
    const value = body[key];
    if (value !== undefined && typeof value !== 'boolean' && value !== 0 && value !== 1) {
      return jsonResponse({ error: `${key} must be a boolean` }, 400);
    }
  }

  const regions = body.regions !== undefined
    ? JSON.stringify(body.regions)
    : existing.regions;
  const includeCustomRules = body.include_custom_rules !== undefined
    ? (body.include_custom_rules ? 1 : 0)
    : existing.include_custom_rules;

  await env.DB.prepare(`
    UPDATE templates SET
      name = ?, dns_mode = ?, ad_blocking = ?, regions = ?,
      include_custom_rules = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).bind(
    nextName,
    body.dns_mode ?? existing.dns_mode,
    body.ad_blocking !== undefined ? (body.ad_blocking ? 1 : 0) : existing.ad_blocking,
    regions,
    includeCustomRules,
    id, userId,
  ).run();

  await deleteAllProfileCaches(env, userId);

  const template = await env.DB.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first();
  return jsonResponse({
    template: {
      ...template,
      regions: JSON.parse(template.regions),
    },
  });
}

async function deleteTemplate(env, userId, id) {
  const existing = await env.DB.prepare(
    'SELECT * FROM templates WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();

  if (!existing) {
    const system = await env.DB.prepare(
      'SELECT * FROM templates WHERE id = ? AND user_id = 0'
    ).bind(id).first();
    if (system) return jsonResponse({ error: 'Cannot delete system templates' }, 403);
    return jsonResponse({ error: 'Not found' }, 404);
  }

  const referenced = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM profiles WHERE template_id = ?'
  ).bind(id).first();

  if (referenced.cnt > 0) {
    return jsonResponse({ error: `Template is used by ${referenced.cnt} profile(s)`, conflict: true }, 409);
  }

  await env.DB.prepare('DELETE FROM templates WHERE id = ? AND user_id = ?').bind(id, userId).run();

  return jsonResponse({ message: 'Deleted' });
}

function validateTemplateInput(body) {
  const errors = [];
  if (!body.name || typeof body.name !== 'string' || body.name.length > 128) {
    errors.push('name: required, max 128 chars');
  }
  if (body.dns_mode && !VALID_DNS_MODES.includes(body.dns_mode)) {
    errors.push(`dns_mode: must be one of ${VALID_DNS_MODES.join(', ')}`);
  }
  if (body.regions !== undefined) {
    if (!Array.isArray(body.regions)) {
      errors.push('regions: must be an array');
    } else {
      const invalid = body.regions.filter(r => !ALL_REGIONS.includes(r));
      if (invalid.length) {
        errors.push(`regions: invalid entries: ${invalid.join(', ')}`);
      }
    }
  }
  for (const key of ['include_custom_rules', 'ad_blocking']) {
    const value = body[key];
    if (value !== undefined && typeof value !== 'boolean' && value !== 0 && value !== 1) {
      errors.push(`${key}: must be a boolean`);
    }
  }
  return errors;
}
