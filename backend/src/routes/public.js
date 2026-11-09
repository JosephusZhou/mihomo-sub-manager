// Public endpoints: /subscribes and /profiles (token-based, no JWT)
// /subscribes 同时承载两类订阅：
//   1. 用户私有节点订阅（token = users.api_token）
//   2. 付费订阅包装地址（token = paid_sub_wrappers.token，由 Worker 代理拉取源地址）
import {
  paidSubCacheKey,
  profileCacheKey,
  subscriptionCacheKey,
} from '../services/cache.js';
import { buildSubscriptionYaml } from '../services/subscription-builder.js';
import { generateProfileConfig } from '../services/config-generator.js';
import { getUserCustomRules } from '../services/custom-rules.js';
import {
  fetchPaidSubscription,
  resolveSubCacheTtl,
} from '../services/paid-sub-fetcher.js';
import { attachWrapperUrls } from '../services/paid-sub-wrapper.js';

export async function handlePublic(request, env, path) {
  const url = new URL(request.url);

  if (path === '/subscribes') {
    return handleSubscribes(url, env);
  }
  if (path === '/profiles') {
    return handleProfiles(url, env);
  }
  return new Response('Not found', { status: 404, headers: corsHeaders() });
}

async function handleSubscribes(url, env) {
  const token = url.searchParams.get('token');
  if (!token) {
    return jsonError(400, 'token parameter required');
  }

  const privateCacheKey = await subscriptionCacheKey(token);

  if (env.CACHE) {
    const cached = await env.CACHE.get(privateCacheKey);
    if (cached) {
      return yamlResponse(cached);
    }
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE api_token = ?').bind(token).first();
  if (user) {
    return handlePrivateSubscription(env, user, privateCacheKey);
  }

  return handlePaidSubscription(env, token);
}

async function handlePrivateSubscription(env, user, cacheKey) {
  // 链式代理不放进 proxy-provider：mihomo 的 dialer-proxy 只解析主 proxies/策略组，
  // 放进 provider 会导致前置节点名称在运行时找不到。
  const proxies = await env.DB.prepare(
    "SELECT * FROM proxies WHERE user_id = ? AND COALESCE(dialer_proxy, '') = '' ORDER BY sort_order, id"
  ).bind(user.id).all();

  const yaml = buildSubscriptionYaml(proxies.results);

  if (env.CACHE) {
    await env.CACHE.put(cacheKey, yaml, { expirationTtl: 600 });
  }

  return yamlResponse(yaml);
}

async function handlePaidSubscription(env, token) {
  const cacheKey = await paidSubCacheKey(token);

  // 缓存键由 token 派生，不含源地址；命中时与上游失败无关（失败结果不缓存）。
  if (env.CACHE) {
    const cached = await env.CACHE.get(cacheKey);
    if (cached) {
      try {
        const entry = JSON.parse(cached);
        return yamlResponse(entry.body, entry.userinfo);
      } catch {
        await env.CACHE.delete(cacheKey);
      }
    }
  }

  const wrapper = await env.DB.prepare(`
    SELECT ps.*, w.token AS wrapper_token FROM paid_sub_wrappers w
    JOIN paid_subscriptions ps ON ps.id = w.paid_subscription_id
    WHERE w.token = ?
  `).bind(token).first();

  if (!wrapper) {
    return jsonError(401, 'Invalid token');
  }

  let result;
  try {
    result = await fetchPaidSubscription(wrapper.url);
  } catch (err) {
    // 上游侧失败（超时、4xx/5xx、空内容、HTML 等）改为 302 重定向到源地址，
    // 保证客户端不会在我们这里拿不到订阅。请求侧失败（token 无效、SSRF）仍返回错误。
    // 注意：重定向会把源地址完整暴露给客户端，这是知情接受的设计取舍；
    // 失败结果不写入 KV（下方 put 仅在成功时执行），并显式 no-store 避免中间层缓存 302。
    if (err && err.redirectable) {
      return new Response('上游订阅暂不可用，已重定向到源地址', {
        status: 302,
        headers: {
          Location: wrapper.url,
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
          ...corsHeaders(),
        },
      });
    }
    const status = err && Number.isInteger(err.status) ? err.status : 502;
    return jsonError(status, err && err.message ? err.message : '上游订阅拉取失败');
  }

  if (env.CACHE) {
    const ttl = resolveSubCacheTtl(env.SUB_CACHE_TTL);
    await env.CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: ttl });
  }

  return yamlResponse(result.body, result.userinfo);
}

async function handleProfiles(url, env) {
  const token = url.searchParams.get('token');
  if (!token) {
    return jsonError(400, 'token parameter required');
  }

  const cacheKey = await profileCacheKey(token);

  if (env.CACHE) {
    const cached = await env.CACHE.get(cacheKey);
    if (cached) {
      return yamlResponse(cached);
    }
  }

  const profile = await env.DB.prepare('SELECT * FROM profiles WHERE profile_token = ?').bind(token).first();
  if (!profile) {
    return jsonError(401, 'Invalid token');
  }

  if (!profile.enabled) {
    return jsonError(403, 'Profile is disabled');
  }

  const template = await env.DB.prepare('SELECT * FROM templates WHERE id = ?').bind(profile.template_id).first();
  if (!template) {
    return jsonError(404, 'Template not found');
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(profile.user_id).first();

  const paidSubRows = await env.DB.prepare(`
    SELECT ps.* FROM paid_subscriptions ps
    JOIN profile_paid_subs pps ON pps.paid_subscription_id = ps.id
    WHERE pps.profile_id = ?
    ORDER BY ps.sort_order, ps.id
  `).bind(profile.id).all();

  const workerUrl = env.WORKER_URL || url.origin;
  // 生成配置只使用包装地址，源地址不出现在 YAML 中。
  const paidSubscriptions = await attachWrapperUrls(env, paidSubRows.results, workerUrl);

  // 链式节点需要写入主 proxies，前置节点通过策略组引用，不依赖 provider 内名称解析。
  const chainRows = await env.DB.prepare(
    "SELECT * FROM proxies WHERE user_id = ? AND COALESCE(dialer_proxy, '') <> '' ORDER BY sort_order, id"
  ).bind(profile.user_id).all();
  const chainProxies = chainRows.results.map(p => ({
    ...p,
    config: JSON.parse(p.config),
  }));

  // 共享自定义规则只在模板勾选时注入，避免不勾选的档案被全局规则影响。
  const customRules = template.include_custom_rules
    ? await getUserCustomRules(env, profile.user_id)
    : [];

  const yaml = generateProfileConfig({
    template: {
      ...template,
      regions: JSON.parse(template.regions),
    },
    paidSubscriptions,
    userApiToken: user.api_token,
    workerUrl,
    includePrivateSub: profile.include_private_sub !== 0,
    customRules,
    chainProxies,
  });

  if (env.CACHE) {
    await env.CACHE.put(cacheKey, yaml, { expirationTtl: 300 });
  }

  return yamlResponse(yaml);
}

function yamlResponse(body, userinfo) {
  const headers = { 'Content-Type': 'text/yaml; charset=utf-8', ...corsHeaders() };
  if (userinfo) headers['subscription-userinfo'] = userinfo;
  return new Response(body, { headers });
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders() {
  return { 'Access-Control-Allow-Origin': '*' };
}
