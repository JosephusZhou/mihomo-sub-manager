// Proxies CRUD routes
import { jsonResponse, requireAuth } from '../auth.js';
import { invalidateUserCache } from '../services/cache.js';

const VALID_TYPES = ['ss', 'trojan', 'hysteria2', 'vmess', 'vless', 'tuic', 'http', 'socks5'];

export async function handleProxies(request, env, path) {
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  const idMatch = path.match(/^\/api\/proxies\/(\d+)$/);
  const id = idMatch ? Number(idMatch[1]) : null;

  if (path === '/api/proxies' && request.method === 'GET') {
    return listProxies(env, auth.userId);
  }
  if (path === '/api/proxies' && request.method === 'POST') {
    return createProxy(request, env, auth.userId);
  }
  if (id && request.method === 'GET') {
    return getProxy(env, auth.userId, id);
  }
  if (id && request.method === 'PUT') {
    return updateProxy(request, env, auth.userId, id);
  }
  if (id && request.method === 'DELETE') {
    return deleteProxy(env, auth.userId, id);
  }
  return jsonResponse({ error: 'Not found' }, 404);
}

async function listProxies(env, userId) {
  const proxies = await env.DB.prepare(
    'SELECT * FROM proxies WHERE user_id = ? ORDER BY sort_order, id'
  ).bind(userId).all();

  return jsonResponse({
    proxies: proxies.results.map(p => ({
      ...p,
      config: JSON.parse(p.config),
    })),
  });
}

async function getProxy(env, userId, id) {
  const proxy = await env.DB.prepare(
    'SELECT * FROM proxies WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();

  if (!proxy) return jsonResponse({ error: 'Not found' }, 404);

  return jsonResponse({ proxy: { ...proxy, config: JSON.parse(proxy.config) } });
}

async function createProxy(request, env, userId) {
  const body = await request.json();
  const errors = validateProxyInput(body);
  if (errors.length) return jsonResponse({ error: 'Validation failed', details: errors }, 400);

  const existing = await env.DB.prepare(
    'SELECT id FROM proxies WHERE user_id = ? AND name = ?'
  ).bind(userId, body.name).first();
  if (existing) return jsonResponse({ error: `Proxy name "${body.name}" already exists` }, 409);

  const result = await env.DB.prepare(
    'INSERT INTO proxies (user_id, name, type, server, port, config, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    userId, body.name, body.type, body.server, body.port,
    JSON.stringify(stripDialerKeys(body.config)), body.sort_order || 0,
  ).run();

  await invalidateUserCache(env, userId);

  const proxy = await env.DB.prepare('SELECT * FROM proxies WHERE id = ?').bind(result.meta.last_row_id).first();
  return jsonResponse({ proxy: { ...proxy, config: JSON.parse(proxy.config) } }, 201);
}

async function updateProxy(request, env, userId, id) {
  const existing = await env.DB.prepare(
    'SELECT * FROM proxies WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();
  if (!existing) return jsonResponse({ error: 'Not found' }, 404);

  const body = await request.json();
  const next = {
    name: body.name ?? existing.name,
    type: body.type ?? existing.type,
    server: body.server ?? existing.server,
    port: body.port ?? existing.port,
    config: body.config ?? JSON.parse(existing.config),
    sort_order: body.sort_order ?? existing.sort_order,
  };

  const errors = validateProxyInput(next);
  if (errors.length) return jsonResponse({ error: 'Validation failed', details: errors }, 400);

  if (next.name !== existing.name) {
    const dup = await env.DB.prepare(
      'SELECT id FROM proxies WHERE user_id = ? AND name = ? AND id != ?'
    ).bind(userId, next.name, id).first();
    if (dup) return jsonResponse({ error: `Proxy name "${next.name}" already exists` }, 409);
  }

  const config = JSON.stringify(stripDialerKeys(next.config));

  // 前置节点改名时，同步所有引用它的链式节点，避免 dialer-proxy 指向旧名称。
  if (next.name !== existing.name) {
    await env.DB.prepare(
      'UPDATE proxies SET dialer_proxy = ? WHERE user_id = ? AND dialer_proxy = ?'
    ).bind(next.name, userId, existing.name).run();
  }

  await env.DB.prepare(`
    UPDATE proxies SET
      name = ?, type = ?, server = ?, port = ?, config = ?,
      sort_order = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).bind(
    next.name, next.type, next.server, next.port, config,
    next.sort_order, id, userId,
  ).run();

  await invalidateUserCache(env, userId);

  const proxy = await env.DB.prepare('SELECT * FROM proxies WHERE id = ?').bind(id).first();
  return jsonResponse({ proxy: { ...proxy, config: JSON.parse(proxy.config) } });
}

async function deleteProxy(env, userId, id) {
  const existing = await env.DB.prepare(
    'SELECT * FROM proxies WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();
  if (!existing) return jsonResponse({ error: 'Not found' }, 404);

  // 删除前置节点时级联删除引用它的链式节点，避免留下无法拨号的孤儿节点。
  const chained = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM proxies WHERE user_id = ? AND dialer_proxy = ?'
  ).bind(userId, existing.name).first();

  await env.DB.prepare(
    'DELETE FROM proxies WHERE user_id = ? AND dialer_proxy = ?'
  ).bind(userId, existing.name).run();
  await env.DB.prepare('DELETE FROM proxies WHERE id = ? AND user_id = ?').bind(id, userId).run();
  await invalidateUserCache(env, userId);

  return jsonResponse({
    message: 'Deleted',
    deleted_chained: chained.cnt,
  });
}

// dialer_proxy 只允许通过链式代理接口写入列，配置里残留的链式字段统一丢弃。
function stripDialerKeys(config) {
  const next = { ...config };
  delete next.dialer_proxy;
  delete next['dialer-proxy'];
  return next;
}

function validateProxyInput(body) {
  const errors = [];
  if (!body.name || !/^[a-zA-Z0-9_\-\u4e00-\u9fff\u0020]{1,64}$/.test(body.name)) {
    errors.push('name: 1-64 chars, alphanumeric/hyphens/underscores/Chinese');
  }
  if (!body.type || !VALID_TYPES.includes(body.type)) {
    errors.push(`type: must be one of ${VALID_TYPES.join(', ')}`);
  }
  if (!body.server || body.server.length > 253) {
    errors.push('server: required, max 253 chars');
  }
  if (!Number.isInteger(body.port) || body.port < 1 || body.port > 65535) {
    errors.push('port: integer 1-65535');
  }
  if (!body.config || typeof body.config !== 'object' || Array.isArray(body.config)) {
    errors.push('config: required, must be an object');
  }
  if (body.sort_order !== undefined && !Number.isInteger(body.sort_order)) {
    errors.push('sort_order: must be an integer');
  }
  return errors;
}
