// Chained proxy text parser: lines like host:port, user:pass@host:port,
// host:port:user:pass, socks5://user:pass@host:port, http://host:port ...
export const MAX_IMPORT = 200;
export const MAX_INPUT_LINES = 2000;
export const MAX_TEXT_LENGTH = 256 * 1024;

const SCHEMES = {
  http: { type: 'http', tls: false },
  https: { type: 'http', tls: true },
  socks5: { type: 'socks5', tls: false },
  socks5h: { type: 'socks5', tls: false },
};

const DEFAULT_TYPES = ['http', 'socks5'];

export function parseChainedProxyText(text, options = {}) {
  const defaultType = options.defaultType || 'http';
  if (!DEFAULT_TYPES.includes(defaultType)) {
    return {
      fatal: `default_type must be one of: ${DEFAULT_TYPES.join(', ')}`,
      valid: [], invalid: [], duplicates: [], totalLines: 0,
    };
  }
  if (typeof text !== 'string') {
    return { fatal: 'text is required', valid: [], invalid: [], duplicates: [], totalLines: 0 };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return {
      fatal: `输入内容过大，单次最多 ${MAX_TEXT_LENGTH / 1024} KB`,
      valid: [], invalid: [], duplicates: [], totalLines: 0,
    };
  }

  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length > MAX_INPUT_LINES) {
    return {
      fatal: `输入行数过多，单次最多 ${MAX_INPUT_LINES} 行`,
      valid: [], invalid: [], duplicates: [], totalLines: lines.length,
    };
  }

  const valid = [];
  const invalid = [];
  const duplicates = [];
  const seen = new Map();

  lines.forEach((raw, index) => {
    const line = index + 1;
    const source = raw.trim();
    if (!source || source.startsWith('#')) return;

    const parsed = parseLine(source, defaultType);
    if (parsed.error) {
      invalid.push({ line, raw: source, reason: parsed.error });
      return;
    }

    const key = [
      parsed.type,
      parsed.server.toLowerCase(),
      parsed.port,
      parsed.username || '',
      parsed.password || '',
    ].join('|');

    if (seen.has(key)) {
      duplicates.push({ line, raw: source, reason: `与第 ${seen.get(key)} 行重复` });
      return;
    }
    seen.set(key, line);
    valid.push({ ...parsed, line, raw: source });
  });

  return { valid, invalid, duplicates, totalLines: lines.length };
}

function parseLine(source, defaultType) {
  let rest = source;
  let scheme = null;

  const schemeMatch = rest.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//);
  if (schemeMatch) {
    const name = schemeMatch[1].toLowerCase();
    const spec = SCHEMES[name];
    if (!spec) return { error: `不支持的协议前缀 "${schemeMatch[1]}"` };
    scheme = spec;
    rest = rest.slice(schemeMatch[0].length);
  }

  const slash = rest.indexOf('/');
  if (slash !== -1) {
    if (slash === rest.length - 1) {
      rest = rest.slice(0, -1);
    } else {
      return { error: '不支持路径或查询参数' };
    }
  }
  if (rest.includes('?')) return { error: '不支持路径或查询参数' };

  const type = scheme ? scheme.type : defaultType;
  const tls = scheme ? scheme.tls : false;

  const at = rest.lastIndexOf('@');
  let hostPort = rest;
  let username;
  let password;

  if (at !== -1) {
    const userinfo = rest.slice(0, at);
    hostPort = rest.slice(at + 1);
    const colon = userinfo.indexOf(':');
    if (colon === -1) return { error: '认证信息格式应为 user:pass' };
    username = userinfo.slice(0, colon);
    password = userinfo.slice(colon + 1);
    if (!username) return { error: '用户名不能为空' };
  }

  let server;
  let portText;

  if (hostPort.startsWith('[')) {
    const close = hostPort.indexOf(']');
    if (close === -1) return { error: 'IPv6 地址缺少 "]"' };
    server = hostPort.slice(1, close);
    const remain = hostPort.slice(close + 1);
    if (!remain.startsWith(':')) return { error: 'IPv6 地址后应为 :port' };
    portText = remain.slice(1);
  } else {
    const parts = hostPort.split(':');
    if (username !== undefined) {
      if (parts.length !== 2) return { error: '带认证信息时主机端口格式应为 host:port' };
      [server, portText] = parts;
    } else if (parts.length === 2) {
      [server, portText] = parts;
    } else if (parts.length === 4) {
      [server, portText, username, password] = parts;
    } else {
      return { error: '格式应为 host:port、host:port:user:pass 或 user:pass@host:port' };
    }
  }

  if (!server || /\s/.test(server)) return { error: '主机地址为空或包含空白字符' };
  if (server.length > 253) return { error: '主机地址过长' };
  if (!/^\d+$/.test(portText)) return { error: '端口必须为数字' };
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: '端口超出范围 1-65535' };
  }

  if (username !== undefined) {
    if (username.length > 128 || /[\u0000-\u001f]/.test(username)) {
      return { error: '用户名过长或包含控制字符' };
    }
    if (password.length > 128 || /[\u0000-\u001f]/.test(password)) {
      return { error: '密码过长或包含控制字符' };
    }
  }

  return {
    type,
    server,
    port,
    tls,
    username,
    password,
  };
}
