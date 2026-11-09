// 付费订阅包装地址：生成/复用随机 token，并把源地址替换为包装地址。
import { generateToken } from '../db.js';

export function buildWrapperUrl(workerUrl, token) {
  const base = String(workerUrl || '').replace(/\/+$/, '');
  return `${base}/subscribes?token=${token}`;
}

// 同一订阅只生成一次 token；并发创建时依赖 UNIQUE 约束兜底。
export async function ensureWrapperToken(env, subscriptionId) {
  const existing = await env.DB.prepare(
    'SELECT token FROM paid_sub_wrappers WHERE paid_subscription_id = ?'
  ).bind(subscriptionId).first();
  if (existing) return existing.token;

  const token = await generateToken();
  try {
    await env.DB.prepare(
      'INSERT INTO paid_sub_wrappers (paid_subscription_id, token) VALUES (?, ?)'
    ).bind(subscriptionId, token).run();
    return token;
  } catch {
    const row = await env.DB.prepare(
      'SELECT token FROM paid_sub_wrappers WHERE paid_subscription_id = ?'
    ).bind(subscriptionId).first();
    if (row) return row.token;
    throw new Error('无法生成付费订阅包装地址');
  }
}

// 对外结构：不含源地址，只带 wrapper_url；编辑详情通过 includeSource 单独放开。
export async function withWrapperUrl(env, subscription, workerUrl, { includeSource = false } = {}) {
  if (!subscription) return subscription;

  const token = subscription.wrapper_token
    || await ensureWrapperToken(env, subscription.id);

  const { wrapper_token, url, ...rest } = subscription;
  return {
    ...rest,
    ...(includeSource ? { url } : {}),
    wrapper_url: buildWrapperUrl(workerUrl, token),
  };
}

export async function attachWrapperUrls(env, subscriptions, workerUrl, options) {
  return Promise.all((subscriptions || []).map(sub => withWrapperUrl(env, sub, workerUrl, options)));
}
