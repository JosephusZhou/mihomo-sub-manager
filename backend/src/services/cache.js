// 订阅/配置缓存的键生成与失效，集中维护，避免写入与删除使用不同的键格式。
import { sha256 } from '../db.js';

export async function subscriptionCacheKey(apiToken) {
  return `sub:v2:${await sha256(apiToken)}`;
}

export async function profileCacheKey(profileToken) {
  return `profile:${await sha256(profileToken)}`;
}

export async function paidSubCacheKey(wrapperToken) {
  return `paidsub:v2:${await sha256(wrapperToken)}`;
}

export async function deleteSubscriptionCache(env, apiToken) {
  if (!env.CACHE || !apiToken) return;
  await env.CACHE.delete(await subscriptionCacheKey(apiToken));
}

export async function deleteProfileCache(env, profileToken) {
  if (!env.CACHE || !profileToken) return;
  await env.CACHE.delete(await profileCacheKey(profileToken));
}

export async function deletePaidSubCache(env, wrapperToken) {
  if (!env.CACHE || !wrapperToken) return;
  await env.CACHE.delete(await paidSubCacheKey(wrapperToken));
}

export async function invalidateUserCache(env, userId) {
  if (!env.CACHE) return;
  const user = await env.DB.prepare('SELECT api_token FROM users WHERE id = ?').bind(userId).first();
  if (user?.api_token) await deleteSubscriptionCache(env, user.api_token);
  await deleteAllProfileCaches(env, userId);
}

export async function deleteAllProfileCaches(env, userId) {
  if (!env.CACHE) return;
  const profiles = await env.DB.prepare(
    'SELECT profile_token FROM profiles WHERE user_id = ?'
  ).bind(userId).all();
  await Promise.all(
    profiles.results.map(async p => env.CACHE.delete(`profile:${await sha256(p.profile_token)}`)),
  );
}
