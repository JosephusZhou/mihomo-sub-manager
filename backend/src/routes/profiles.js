// Profiles CRUD routes
import { jsonResponse, requireAuth } from '../auth.js';
import { generateToken } from '../db.js';
import { deleteProfileCache } from '../services/cache.js';
import { generateProfileConfig } from '../services/config-generator.js';
import { getUserCustomRules } from '../services/custom-rules.js';
import { attachWrapperUrls } from '../services/paid-sub-wrapper.js';

export async function handleProfiles(request, env, path) {
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  const workerUrl = env.WORKER_URL || new URL(request.url).origin;
  const idMatch = path.match(/^\/api\/profiles\/(\d+)$/);
  const id = idMatch ? Number(idMatch[1]) : null;

  const configMatch = path.match(/^\/api\/profiles\/(\d+)\/config$/);
  const regenMatch = path.match(/^\/api\/profiles\/(\d+)\/regenerate-token$/);

  if (path === '/api/profiles' && request.method === 'GET') {
    return listProfiles(env, auth.userId, workerUrl);
  }
  if (path === '/api/profiles' && request.method === 'POST') {
    return createProfile(request, env, auth.userId, workerUrl);
  }
  if (id && request.method === 'GET') {
    return getProfile(env, auth.userId, id, workerUrl);
  }
  if (id && request.method === 'PUT') {
    return updateProfile(request, env, auth.userId, id, workerUrl);
  }
  if (id && request.method === 'DELETE') {
    return deleteProfile(env, auth.userId, id);
  }
  if (configMatch && request.method === 'GET') {
    return previewConfig(env, auth.userId, Number(configMatch[1]), workerUrl);
  }
  if (regenMatch && request.method === 'POST') {
    return regenerateProfileToken(env, auth.userId, Number(regenMatch[1]));
  }
  return jsonResponse({ error: 'Not found' }, 404);
}

async function listProfiles(env, userId, workerUrl) {
  const profiles = await env.DB.prepare(
    'SELECT * FROM profiles WHERE user_id = ? ORDER BY id DESC'
  ).bind(userId).all();

  const result = [];
  for (const p of profiles.results) {
    const template = await env.DB.prepare('SELECT * FROM templates WHERE id = ?').bind(p.template_id).first();
    const paidSubs = await getProfilePaidSubs(env, p.id, workerUrl);

    result.push({
      ...p,
      include_private_sub: p.include_private_sub !== 0,
      template: template ? {
        ...template,
        regions: JSON.parse(template.regions),
      } : null,
      paid_subscriptions: paidSubs,
    });
  }

  return jsonResponse({ profiles: result });
}

async function getProfile(env, userId, id, workerUrl) {
  const profile = await env.DB.prepare(
    'SELECT * FROM profiles WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();

  if (!profile) return jsonResponse({ error: 'Not found' }, 404);

  const template = await env.DB.prepare('SELECT * FROM templates WHERE id = ?').bind(profile.template_id).first();
  const paidSubs = await getProfilePaidSubs(env, profile.id, workerUrl);

  return jsonResponse({
    profile: {
      ...profile,
      include_private_sub: profile.include_private_sub !== 0,
      template: template ? {
        ...template,
        regions: JSON.parse(template.regions),
      } : null,
      paid_subscriptions: paidSubs,
    },
  });
}

async function createProfile(request, env, userId, workerUrl) {
  const body = await request.json();

  if (!body.name || typeof body.name !== 'string' || body.name.length > 128) {
    return jsonResponse({ error: 'name: required, max 128 chars' }, 400);
  }
  if (!body.template_id) {
    return jsonResponse({ error: 'template_id: required' }, 400);
  }

  const template = await env.DB.prepare(
    'SELECT * FROM templates WHERE id = ? AND (user_id = ? OR user_id = 0)'
  ).bind(body.template_id, userId).first();
  if (!template) return jsonResponse({ error: 'Template not found' }, 404);

  const token = await generateToken();
  const includePrivateSub = body.include_private_sub !== false ? 1 : 0;

  const result = await env.DB.prepare(
    'INSERT INTO profiles (user_id, name, profile_token, template_id, include_private_sub) VALUES (?, ?, ?, ?, ?)'
  ).bind(userId, body.name, token, body.template_id, includePrivateSub).run();

  const profileId = result.meta.last_row_id;

  if (body.paid_sub_ids && Array.isArray(body.paid_sub_ids)) {
    for (const subId of body.paid_sub_ids) {
      const sub = await env.DB.prepare(
        'SELECT id FROM paid_subscriptions WHERE id = ? AND user_id = ?'
      ).bind(subId, userId).first();
      if (sub) {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO profile_paid_subs (profile_id, paid_subscription_id) VALUES (?, ?)'
        ).bind(profileId, subId).run();
      }
    }
  }

  const profile = await env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind(profileId).first();
  const paidSubs = await getProfilePaidSubs(env, profileId, workerUrl);

  return jsonResponse({
    profile: {
      ...profile,
      include_private_sub: profile.include_private_sub !== 0,
      template: {
        ...template,
        regions: JSON.parse(template.regions),
      },
      paid_subscriptions: paidSubs,
    },
  }, 201);
}

async function updateProfile(request, env, userId, id, workerUrl) {
  const existing = await env.DB.prepare(
    'SELECT * FROM profiles WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();
  if (!existing) return jsonResponse({ error: 'Not found' }, 404);

  const body = await request.json();
  const nextName = body.name ?? existing.name;

  if (!nextName || typeof nextName !== 'string' || nextName.length > 128) {
    return jsonResponse({ error: 'name: required, max 128 chars' }, 400);
  }

  if (body.template_id) {
    const template = await env.DB.prepare(
      'SELECT * FROM templates WHERE id = ? AND (user_id = ? OR user_id = 0)'
    ).bind(body.template_id, userId).first();
    if (!template) return jsonResponse({ error: 'Template not found' }, 404);
  }

  const includePrivateSub = body.include_private_sub !== undefined ? (body.include_private_sub ? 1 : 0) : existing.include_private_sub;

  await env.DB.prepare(`
    UPDATE profiles SET
      name = ?, template_id = ?, enabled = ?, include_private_sub = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).bind(
    nextName,
    body.template_id ?? existing.template_id,
    body.enabled !== undefined ? (body.enabled ? 1 : 0) : existing.enabled,
    includePrivateSub,
    id, userId,
  ).run();

  if (body.paid_sub_ids && Array.isArray(body.paid_sub_ids)) {
    await env.DB.prepare('DELETE FROM profile_paid_subs WHERE profile_id = ?').bind(id).run();
    for (const subId of body.paid_sub_ids) {
      const sub = await env.DB.prepare(
        'SELECT id FROM paid_subscriptions WHERE id = ? AND user_id = ?'
      ).bind(subId, userId).first();
      if (sub) {
        await env.DB.prepare(
          'INSERT OR IGNORE INTO profile_paid_subs (profile_id, paid_subscription_id) VALUES (?, ?)'
        ).bind(id, subId).run();
      }
    }
  }

  await deleteProfileCache(env, existing.profile_token);

  const profile = await env.DB.prepare('SELECT * FROM profiles WHERE id = ?').bind(id).first();
  const template = await env.DB.prepare('SELECT * FROM templates WHERE id = ?').bind(profile.template_id).first();
  const paidSubs = await getProfilePaidSubs(env, id, workerUrl);

  return jsonResponse({
    profile: {
      ...profile,
      include_private_sub: profile.include_private_sub !== 0,
      template: template ? {
        ...template,
        regions: JSON.parse(template.regions),
      } : null,
      paid_subscriptions: paidSubs,
    },
  });
}

async function deleteProfile(env, userId, id) {
  const existing = await env.DB.prepare(
    'SELECT * FROM profiles WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();
  if (!existing) return jsonResponse({ error: 'Not found' }, 404);

  await env.DB.prepare('DELETE FROM profile_paid_subs WHERE profile_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM profiles WHERE id = ? AND user_id = ?').bind(id, userId).run();

  await deleteProfileCache(env, existing.profile_token);

  return jsonResponse({ message: 'Deleted' });
}

async function previewConfig(env, userId, id, workerUrl) {
  const profile = await env.DB.prepare(
    'SELECT * FROM profiles WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();
  if (!profile) return jsonResponse({ error: 'Not found' }, 404);

  const template = await env.DB.prepare('SELECT * FROM templates WHERE id = ?').bind(profile.template_id).first();
  if (!template) return jsonResponse({ error: 'Template not found' }, 404);

  const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();

  const paidSubs = await getProfilePaidSubs(env, id, workerUrl);
  // 与公开档案一致：模板未勾选时完全不读取、不注入共享规则。
  const customRules = template.include_custom_rules
    ? await getUserCustomRules(env, userId)
    : [];
  const chainProxies = await getChainProxies(env, userId);

  const config = generateProfileConfig({
    template: {
      ...template,
      regions: JSON.parse(template.regions),
    },
    paidSubscriptions: paidSubs,
    userApiToken: user.api_token,
    workerUrl,
    includePrivateSub: profile.include_private_sub !== 0,
    customRules,
    chainProxies,
  });

  return new Response(config, {
    headers: {
      'Content-Type': 'text/yaml; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function regenerateProfileToken(env, userId, id) {
  const existing = await env.DB.prepare(
    'SELECT * FROM profiles WHERE id = ? AND user_id = ?'
  ).bind(id, userId).first();
  if (!existing) return jsonResponse({ error: 'Not found' }, 404);

  await deleteProfileCache(env, existing.profile_token);

  const newToken = await generateToken();
  await env.DB.prepare(
    'UPDATE profiles SET profile_token = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).bind(newToken, id).run();

  return jsonResponse({ profile_token: newToken });
}

async function getChainProxies(env, userId) {
  const rows = await env.DB.prepare(
    "SELECT * FROM proxies WHERE user_id = ? AND COALESCE(dialer_proxy, '') <> '' ORDER BY sort_order, id"
  ).bind(userId).all();

  return rows.results.map(p => ({
    ...p,
    config: JSON.parse(p.config),
  }));
}

async function getProfilePaidSubs(env, profileId, workerUrl) {
  const rows = await env.DB.prepare(`
    SELECT ps.* FROM paid_subscriptions ps
    JOIN profile_paid_subs pps ON pps.paid_subscription_id = ps.id
    WHERE pps.profile_id = ?
    ORDER BY ps.sort_order, ps.id
  `).bind(profileId).all();

  // 只返回包装地址，源地址不出现在档案接口。
  return attachWrapperUrls(env, rows.results, workerUrl);
}


