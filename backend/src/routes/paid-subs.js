// Paid subscriptions CRUD routes
// 源地址只存数据库，对外统一返回包装地址 /subscribes?token=<wrapper_token>。
import { jsonResponse, requireAuth } from '../auth.js';
import { deleteAllProfileCaches, deletePaidSubCache } from '../services/cache.js';
import { validateSourceUrl } from '../services/paid-sub-fetcher.js';
import { attachWrapperUrls, withWrapperUrl } from '../services/paid-sub-wrapper.js';

export async function handlePaidSubs(request, env, path) {
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  const workerUrl = env.WORKER_URL || new URL(request.url).origin;
  const idMatch = path.match(/^\/api\/paid-subs\/(\d+)$/);
  const id = idMatch ? Number(idMatch[1]) : null;

  if (path === '/api/paid-subs' && request.method === 'GET') {
    return listPaidSubs(env, auth.userId, workerUrl);
  }
  if (path === '/api/paid-subs' && request.method === 'POST') {
    return createPaidSub(request, env, auth.userId, workerUrl);
  }
  if (id && request.method === 'GET') {
    return getPaidSub(env, auth.userId, id, workerUrl);
  }
  if (id && request.method === 'PUT') {
    return updatePaidSub(request, env, auth.userId, id, workerUrl);
  }
  if (id && request.method === 'DELETE') {
    return deletePaidSub(env, auth.userId, id);
  }
  return jsonResponse({ error: 'Not found' }, 404);
}

async function listPaidSubs(env, userId, workerUrl) {
  const subs = await env.DB.prepare(
    'SELECT * FROM paid_subscriptions WHERE user_id = ? ORDER BY sort_order, id'
  ).bind(userId).all();

  return jsonResponse({
    paid_subscriptions: await attachWrapperUrls(env, subs.results, workerUrl),
  });
}

async function getPaidSub(env, userId, id, workerUrl) {
  const sub = await env.DB.prepare(
    'SELECT * FROM paid_subscriptions WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();
  if (!sub) return jsonResponse({ error: 'Not found' }, 404);

  return jsonResponse({
    paid_subscription: await withWrapperUrl(env, sub, workerUrl, { includeSource: true }),
  });
}

async function createPaidSub(request, env, userId, workerUrl) {
  const { name, url } = await request.json();

  if (!name || typeof name !== 'string' || name.length > 128) {
    return jsonResponse({ error: 'name: required, max 128 chars' }, 400);
  }
  const nameError = await nameConflict(env, userId, name);
  if (nameError) return jsonResponse({ error: nameError }, 409);
  const urlError = validateSourceUrl(url);
  if (urlError) {
    return jsonResponse({ error: `url: ${urlError}` }, 400);
  }

  const result = await env.DB.prepare(
    'INSERT INTO paid_subscriptions (user_id, name, url) VALUES (?, ?, ?)'
  ).bind(userId, name, url).run();

  await deleteAllProfileCaches(env, userId);

  const sub = await env.DB.prepare('SELECT * FROM paid_subscriptions WHERE id = ?')
    .bind(result.meta.last_row_id).first();
  return jsonResponse({
    paid_subscription: await withWrapperUrl(env, sub, workerUrl),
  }, 201);
}

async function updatePaidSub(request, env, userId, id, workerUrl) {
  const existing = await env.DB.prepare(
    'SELECT * FROM paid_subscriptions WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();
  if (!existing) return jsonResponse({ error: 'Not found' }, 404);

  const body = await request.json();
  const nextName = body.name ?? existing.name;

  if (!nextName || typeof nextName !== 'string' || nextName.length > 128) {
    return jsonResponse({ error: 'name: required, max 128 chars' }, 400);
  }
  if (body.sort_order !== undefined && !Number.isInteger(body.sort_order)) {
    return jsonResponse({ error: 'sort_order: must be an integer' }, 400);
  }
  if (nextName !== existing.name) {
    const nameError = await nameConflict(env, userId, nextName, id);
    if (nameError) return jsonResponse({ error: nameError }, 409);
  }

  if (body.url !== undefined) {
    const urlError = validateSourceUrl(body.url);
    if (urlError) return jsonResponse({ error: `url: ${urlError}` }, 400);
  }

  await env.DB.prepare(`
    UPDATE paid_subscriptions SET
      name = ?, url = ?, sort_order = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).bind(
    nextName,
    body.url ?? existing.url,
    body.sort_order ?? existing.sort_order,
    id, userId,
  ).run();

  await invalidatePaidCache(env, id);
  await deleteAllProfileCaches(env, userId);

  const sub = await env.DB.prepare('SELECT * FROM paid_subscriptions WHERE id = ?').bind(id).first();
  return jsonResponse({
    paid_subscription: await withWrapperUrl(env, sub, workerUrl),
  });
}

async function deletePaidSub(env, userId, id) {
  const existing = await env.DB.prepare(
    'SELECT * FROM paid_subscriptions WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();
  if (!existing) return jsonResponse({ error: 'Not found' }, 404);

  const affected = await env.DB.prepare(
    'SELECT COUNT(*) as cnt FROM profile_paid_subs WHERE paid_subscription_id = ?'
  ).bind(id).first();

  // 先按 token 删除缓存，再删除 token 与订阅本身。
  await invalidatePaidCache(env, id);

  await env.DB.prepare('DELETE FROM paid_sub_wrappers WHERE paid_subscription_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM paid_subscriptions WHERE id = ? AND user_id = ?').bind(id, userId).run();
  await deleteAllProfileCaches(env, userId);

  return jsonResponse({ message: 'Deleted', affected_profiles: affected.cnt });
}

async function invalidatePaidCache(env, subscriptionId) {
  if (!env.CACHE) return;
  const wrapper = await env.DB.prepare(
    'SELECT token FROM paid_sub_wrappers WHERE paid_subscription_id = ?'
  ).bind(subscriptionId).first();
  if (wrapper) await deletePaidSubCache(env, wrapper.token);
}

async function nameConflict(env, userId, name, excludeId = null) {
  if (name === '自建节点') {
    return 'name: "自建节点" 已用于私人节点提供者';
  }
  const dup = excludeId
    ? await env.DB.prepare(
      'SELECT id FROM paid_subscriptions WHERE user_id = ? AND name = ? AND id != ?'
    ).bind(userId, name, excludeId).first()
    : await env.DB.prepare(
      'SELECT id FROM paid_subscriptions WHERE user_id = ? AND name = ?'
    ).bind(userId, name).first();
  return dup ? `name: "${name}" already exists` : null;
}
