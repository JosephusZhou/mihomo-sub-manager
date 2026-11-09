// Auth routes: login, refresh, me, regenerate-token
import {
  jsonResponse,
  requireAuth,
  signAccessToken,
  signRefreshToken,
  verifyToken,
} from '../auth.js';
import { generateToken, verifyPassword } from '../db.js';
import { deleteSubscriptionCache } from '../services/cache.js';

export async function handleAuth(request, env, path) {
  if (path === '/api/auth/login' && request.method === 'POST') {
    return login(request, env);
  }
  if (path === '/api/auth/refresh' && request.method === 'POST') {
    return refresh(request, env);
  }
  if (path === '/api/auth/me' && request.method === 'GET') {
    return me(request, env);
  }
  if (path === '/api/auth/regenerate-token' && request.method === 'POST') {
    return regenerateApiToken(request, env);
  }
  return jsonResponse({ error: 'Not found' }, 404);
}

async function login(request, env) {
  const { email, password } = await request.json();

  if (!email || !password) {
    return jsonResponse({ error: 'email and password required' }, 400);
  }

  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user) {
    return jsonResponse({ error: 'Invalid email or password' }, 401);
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return jsonResponse({ error: 'Invalid email or password' }, 401);
  }

  const accessToken = await signAccessToken(user.id, user.email, env);
  const refreshToken = await signRefreshToken(user.id, env);

  return jsonResponse({
    user: { id: user.id, email: user.email, api_token: user.api_token },
    access_token: accessToken,
    refresh_token: refreshToken,
  });
}

async function refresh(request, env) {
  const { refresh_token } = await request.json();

  if (!refresh_token) {
    return jsonResponse({ error: 'refresh_token required' }, 400);
  }

  try {
    const payload = await verifyToken(refresh_token, env);
    if (payload.type !== 'refresh') {
      return jsonResponse({ error: 'Invalid token type' }, 401);
    }

    const userId = Number(payload.sub);
    const user = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first();
    if (!user) {
      return jsonResponse({ error: 'User not found' }, 401);
    }

    const accessToken = await signAccessToken(user.id, user.email, env);
    const newRefreshToken = await signRefreshToken(user.id, env);

    return jsonResponse({
      access_token: accessToken,
      refresh_token: newRefreshToken,
    });
  } catch {
    return jsonResponse({ error: 'Invalid or expired refresh token' }, 401);
  }
}

async function me(request, env) {
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  const user = await env.DB.prepare(
    'SELECT id, email, api_token, created_at FROM users WHERE id = ?'
  ).bind(auth.userId).first();

  if (!user) {
    return jsonResponse({ error: 'User not found' }, 404);
  }

  return jsonResponse({ user });
}

async function regenerateApiToken(request, env) {
  const auth = await requireAuth(request, env);
  if (auth.error) return auth.error;

  const newToken = await generateToken();

  const oldUser = await env.DB.prepare('SELECT api_token FROM users WHERE id = ?').bind(auth.userId).first();

  // 先按旧 token 删除缓存，再更新数据库，避免更新后仍有旧订阅命中缓存。
  if (oldUser) await deleteSubscriptionCache(env, oldUser.api_token);

  await env.DB.prepare('UPDATE users SET api_token = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .bind(newToken, auth.userId).run();

  return jsonResponse({ api_token: newToken });
}
