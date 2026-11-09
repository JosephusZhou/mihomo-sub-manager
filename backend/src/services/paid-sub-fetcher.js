// 付费订阅拉取：SSRF 防护 + 以 mihomo UA 请求上游。
// 源地址只保存在 D1，对外一律使用包装地址。

const MAX_REDIRECTS = 3;
const REQUEST_TIMEOUT_MS = 15000;
const USER_AGENT = 'mihomo/1.19.2';

// 缓存 TTL：默认 60 分钟，支持 `3600`（秒）、`3600s`、`60m`、`1h`。
export const DEFAULT_SUB_CACHE_TTL = 3600;
export const MIN_SUB_CACHE_TTL = 60;
export const MAX_SUB_CACHE_TTL = 86400;

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
]);
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal'];

export class PaidSubFetchError extends Error {
  // redirectable=true 表示失败发生在上游侧（超时、4xx/5xx、空内容、HTML 等），
  // 可安全地改为 302 重定向到源地址；源地址本身非法（SSRF）则不可重定向。
  constructor(message, status = 502, redirectable = false) {
    super(message);
    this.name = 'PaidSubFetchError';
    this.status = status;
    this.redirectable = redirectable;
  }
}

function normalizedHostname(url) {
  return url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
}

function isPrivateIpv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  if (parts.some(p => !/^\d{1,3}$/.test(p))) return false;
  // 前导零形式（如 0177.0.0.1）可能被底层解析成内网地址，直接拒绝。
  if (parts.some(p => p.length > 1 && p.startsWith('0'))) return true;

  const nums = parts.map(Number);
  if (nums.some(n => n > 255)) return true;
  const [a, b, c] = nums;

  if (a === 0 || a === 127 || a === 10) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;          // CGNAT
  if (a === 169 && b === 254) return true;                    // link-local / 云元数据
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a >= 224) return true;                                  // 组播与保留段
  return false;
}

function isPrivateIpv6(host) {
  if (!host.includes(':')) return false;
  const h = host.toLowerCase();
  if (h === '::' || h === '::1') return true;
  if (/^fe[89ab]/.test(h)) return true;                       // link-local
  if (/^f[cd]/.test(h)) return true;                          // unique local
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

// 返回 null 表示通过；返回字符串表示拒绝原因。
export function validateSourceUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return 'url 格式不合法';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return '只允许 http/https 地址';
  }

  const host = normalizedHostname(url);
  if (!host) return 'url 缺少主机名';
  if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some(suffix => host.endsWith(suffix))) {
    return '不允许 localhost 或内网主机';
  }
  if (isPrivateIpv4(host) || isPrivateIpv6(host)) {
    return '不允许私网、链路本地或云元数据地址';
  }
  return null;
}

// 手写重定向，逐跳重新做 SSRF 校验，避免跟随到内网地址。
export async function fetchPaidSubscription(sourceUrl) {
  let current = sourceUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const invalid = validateSourceUrl(current);
    if (invalid) throw new PaidSubFetchError(`上游地址不安全：${invalid}`, 502);

    let response;
    try {
      response = await fetch(current, {
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
      throw new PaidSubFetchError(
        timedOut ? '上游订阅请求超时' : '无法连接上游订阅地址',
        timedOut ? 504 : 502,
        true,
      );
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');
      if (!location) throw new PaidSubFetchError(`上游返回 ${response.status} 但没有跳转地址`, 502, true);
      try {
        current = new URL(location, current).toString();
      } catch {
        throw new PaidSubFetchError('上游跳转地址不合法', 502, true);
      }
      continue;
    }

    if (!response.ok) {
      throw new PaidSubFetchError(`上游订阅返回 ${response.status}`, 502, true);
    }

    const contentType = (response.headers.get('Content-Type') || '').toLowerCase();
    const body = await response.text();
    if (!body.trim()) throw new PaidSubFetchError('上游订阅内容为空', 502, true);
    if (contentType.includes('text/html')) {
      throw new PaidSubFetchError('上游返回了网页而不是订阅内容', 502, true);
    }

    return {
      body,
      userinfo: response.headers.get('subscription-userinfo') || '',
    };
  }

  throw new PaidSubFetchError('上游跳转次数过多', 502, true);
}

export function resolveSubCacheTtl(raw) {
  const value = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!value) return DEFAULT_SUB_CACHE_TTL;

  const match = value.match(/^(\d+)(s|m|h)?$/);
  if (!match) return DEFAULT_SUB_CACHE_TTL;

  let seconds = Number(match[1]);
  if (match[2] === 'm') seconds *= 60;
  if (match[2] === 'h') seconds *= 3600;

  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_SUB_CACHE_TTL;
  return Math.min(MAX_SUB_CACHE_TTL, Math.max(MIN_SUB_CACHE_TTL, seconds));
}
