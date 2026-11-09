// JWT authentication utilities and middleware
import * as jose from 'jose';

let _secret;
function getSecret(env) {
  if (!_secret) {
    const configured = env && env.JWT_SECRET;
    if (typeof configured !== 'string' || configured.length === 0) {
      throw new Error('JWT_SECRET is not configured');
    }
    if (configured.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters');
    }
    _secret = new TextEncoder().encode(configured);
  }
  return _secret;
}

export async function signAccessToken(userId, email, env) {
  const secret = getSecret(env);
  const ttl = Number(env.ACCESS_TOKEN_TTL) || 900;
  return new jose.SignJWT({ sub: String(userId), email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .sign(secret);
}

export async function signRefreshToken(userId, env) {
  const secret = getSecret(env);
  const ttl = Number(env.REFRESH_TOKEN_TTL) || 2592000;
  return new jose.SignJWT({ sub: String(userId), type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttl)
    .sign(secret);
}

export async function verifyToken(token, env) {
  const secret = getSecret(env);
  const { payload } = await jose.jwtVerify(token, secret);
  return payload;
}

export function extractBearer(request) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7);
}

export async function requireAuth(request, env) {
  const token = extractBearer(request);
  if (!token) {
    return { error: jsonError('Unauthorized', 401) };
  }
  try {
    const payload = await verifyToken(token, env);
    if (payload.type === 'refresh') {
      return { error: jsonError('Access token required, not refresh token', 401) };
    }
    return { userId: Number(payload.sub), email: payload.email };
  } catch (e) {
    // 配置缺失/过短属于服务端错误，不能伪装成 401。
    if (e.message && e.message.startsWith('JWT_SECRET')) throw e;
    return { error: jsonError('Invalid or expired token', 401) };
  }
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
