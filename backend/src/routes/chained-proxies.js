// Chained proxies: batch import HTTP/SOCKS5 proxies that dial through a private node.
import { jsonResponse, requireAuth } from '../auth.js';
import { invalidateUserCache } from '../services/cache.js';
import {
  MAX_IMPORT,
  parseChainedProxyText,
} from '../services/chained-proxy-parser.js';

export async function handleChainedProxies(request, env, path) {
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;
  const userId = auth.userId;

  if (path === '/api/chained-proxies' && request.method === 'GET') {
    return listChainedProxies(env, userId);
  }
  if (path === '/api/chained-proxies/preview' && request.method === 'POST') {
    return previewChainedProxies(request, env, userId);
  }
  if (path === '/api/chained-proxies/import' && request.method === 'POST') {
    return importChainedProxies(request, env, userId);
  }

  const idMatch = path.match(/^\/api\/chained-proxies\/(\d+)$/);
  if (idMatch && request.method === 'DELETE') {
    return deleteChainedProxy(env, userId, Number(idMatch[1]));
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

async function listChainedProxies(env, userId) {
  const rows = await env.DB.prepare(`
    SELECT id, name, type, server, port, config, dialer_proxy, sort_order, created_at, updated_at
    FROM proxies
    WHERE user_id = ? AND COALESCE(dialer_proxy, '') <> ''
    ORDER BY sort_order, id
  `).bind(userId).all();

  return jsonResponse({
    chained_proxies: rows.results.map(p => ({
      ...p,
      config: JSON.parse(p.config),
    })),
  });
}

async function previewChainedProxies(request, env, userId) {
  const parsed = await prepareBatch(request, env, userId);
  if (parsed.error) return parsed.error;

  return jsonResponse({
    pre_node: parsed.preNode,
    default_type: parsed.defaultType,
    total_lines: parsed.result.totalLines,
    valid_count: parsed.named.length,
    limit: MAX_IMPORT,
    valid: parsed.named,
    invalid: parsed.result.invalid,
    duplicates: parsed.result.duplicates,
  });
}

async function importChainedProxies(request, env, userId) {
  const parsed = await prepareBatch(request, env, userId);
  if (parsed.error) return parsed.error;

  if (!parsed.named.length) {
    return jsonResponse({ error: '没有可导入的代理', details: parsed.result.invalid }, 400);
  }

  const maxRow = await env.DB.prepare(
    'SELECT MAX(sort_order) as max_order FROM proxies WHERE user_id = ?'
  ).bind(userId).first();
  let sortOrder = Number(maxRow?.max_order) || 0;

  const statements = parsed.named.map(item => {
    sortOrder += 1;
    const config = {};
    if (item.username !== undefined) {
      config.username = item.username;
      config.password = item.password;
    }
    if (item.tls) config.tls = true;

    return env.DB.prepare(`
      INSERT INTO proxies (user_id, name, type, server, port, config, dialer_proxy, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      userId,
      item.name,
      item.type,
      item.server,
      item.port,
      JSON.stringify(config),
      parsed.preNode.name,
      sortOrder,
    );
  });

  // D1 batch 分片执行，避免一次提交过多语句。
  for (let i = 0; i < statements.length; i += 50) {
    await env.DB.batch(statements.slice(i, i + 50));
  }

  await invalidateUserCache(env, userId);

  return jsonResponse({
    created_count: parsed.named.length,
    created: parsed.named,
    invalid: parsed.result.invalid,
    duplicates: parsed.result.duplicates,
  }, 201);
}

async function deleteChainedProxy(env, userId, id) {
  const existing = await env.DB.prepare(
    'SELECT * FROM proxies WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();

  if (!existing || !existing.dialer_proxy) {
    return jsonResponse({ error: 'Not found' }, 404);
  }

  await env.DB.prepare('DELETE FROM proxies WHERE id = ? AND user_id = ?').bind(id, userId).run();
  await invalidateUserCache(env, userId);

  return jsonResponse({ message: 'Deleted' });
}

async function prepareBatch(request, env, userId) {
  let body;
  try {
    body = await request.json();
  } catch {
    return { error: jsonResponse({ error: 'Invalid JSON body' }, 400) };
  }

  const preId = Number(body?.pre_proxy_id);
  if (!Number.isInteger(preId) || preId <= 0) {
    return { error: jsonResponse({ error: 'pre_proxy_id is required' }, 400) };
  }

  const preNode = await env.DB.prepare(
    'SELECT id, name, type, dialer_proxy FROM proxies WHERE id = ? AND user_id = ?'
  ).bind(preId, userId).first();
  if (!preNode) {
    return { error: jsonResponse({ error: '前置节点不存在' }, 404) };
  }
  if (preNode.dialer_proxy) {
    return { error: jsonResponse({ error: '前置节点不能是链式代理，请选择普通私人节点' }, 400) };
  }

  const defaultType = body?.default_type === 'socks5' ? 'socks5' : 'http';
  const result = parseChainedProxyText(body?.text, { defaultType });

  if (result.fatal) {
    return { error: jsonResponse({ error: result.fatal }, 400) };
  }
  if (result.valid.length > MAX_IMPORT) {
    return {
      error: jsonResponse({
        error: `单次最多导入 ${MAX_IMPORT} 条，当前有效 ${result.valid.length} 条；请拆分后重试`,
        details: { limit: MAX_IMPORT, valid_count: result.valid.length },
      }, 400),
    };
  }

  const existing = await env.DB.prepare(
    'SELECT name FROM proxies WHERE user_id = ?'
  ).bind(userId).all();
  const taken = new Set(existing.results.map(r => r.name));
  const named = assignNames(result.valid, body?.label, taken);

  return { preNode, defaultType, result, named };
}

function assignNames(items, label, taken) {
  const prefix = sanitizeLabel(label);

  return items.map((item, index) => {
    const protocol = item.type === 'socks5' ? 'SOCKS5' : 'HTTP';
    const base = `${prefix}-${protocol}-${index + 1}`;
    let name = base.slice(0, 64);
    let suffix = 2;

    while (taken.has(name)) {
      const tail = `-${suffix++}`;
      name = `${base.slice(0, 64 - tail.length)}${tail}`;
    }
    taken.add(name);

    return { ...item, name };
  });
}

function sanitizeLabel(label) {
  const cleaned = String(label || '')
    .replace(/[^0-9A-Za-z_\-\u4e00-\u9fa5 ]/g, '')
    .trim()
    .slice(0, 16);
  return cleaned || '链式';
}
