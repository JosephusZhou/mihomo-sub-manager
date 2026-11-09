// Subscription builder: converts proxy DB rows to Clash YAML
// Used by /subscribes endpoint to generate user's private proxy subscription

export function buildSubscriptionYaml(proxies) {
  const list = (proxies || []).map(p => proxyToClashEntry(p));

  if (list.length === 0) return 'proxies: []\n';

  const body = list.map(entryToYaml).join('\n');
  return `proxies:\n${body}\n`;
}

// Read a field accepting both underscore and hyphen key styles (DB may store either).
function pick(obj, ...keys) {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function proxyToClashEntry(proxy) {
  const config = typeof proxy.config === 'string' ? JSON.parse(proxy.config) : proxy.config;
  const base = {
    name: proxy.name,
    type: proxy.type,
    server: proxy.server,
    port: proxy.port,
  };

  const entry = buildEntry(proxy, config, base);

  // 链式代理的前置节点统一由 dialer_proxy 列指定（普通节点为空）。
  const dialer = proxy.dialer_proxy;
  if (dialer) entry['dialer-proxy'] = dialer;

  return entry;
}

function buildEntry(proxy, config, base) {
  switch (proxy.type) {
    case 'ss': {
      const plugin = pick(config, 'plugin');
      const pluginOpts = pick(config, 'plugin_opts', 'plugin-opts');
      return {
        ...base,
        cipher: pick(config, 'cipher') || 'chacha20-ietf-poly1305',
        password: pick(config, 'password') || '',
        udp: config.udp !== false,
        ...(plugin ? { plugin, 'plugin-opts': pluginOpts || {} } : {}),
      };
    }

    case 'trojan':
      return {
        ...base,
        password: pick(config, 'password') || '',
        sni: pick(config, 'sni') || proxy.server,
        udp: config.udp !== false,
        ...(pick(config, 'skip_cert_verify', 'skip-cert-verify') ? { 'skip-cert-verify': true } : {}),
      };

    case 'hysteria2': {
      const obfs = pick(config, 'obfs');
      const obfsPassword = pick(config, 'obfs_password', 'obfs-password');
      return {
        ...base,
        password: pick(config, 'password') || '',
        ...(obfs ? { obfs } : {}),
        ...(obfsPassword ? { 'obfs-password': obfsPassword } : {}),
        sni: pick(config, 'sni') || proxy.server,
        ...(pick(config, 'skip_cert_verify', 'skip-cert-verify') ? { 'skip-cert-verify': true } : {}),
      };
    }

    case 'vmess': {
      const wsOpts = pick(config, 'ws_opts', 'ws-opts');
      return {
        ...base,
        uuid: pick(config, 'uuid') || '',
        cipher: pick(config, 'cipher') || 'auto',
        alterId: pick(config, 'alter_id', 'alter-id') || 0,
        network: pick(config, 'network') || 'tcp',
        ...(config.tls ? { tls: true } : {}),
        ...(pick(config, 'servername') ? { servername: pick(config, 'servername') } : {}),
        ...(pick(config, 'skip_cert_verify', 'skip-cert-verify') ? { 'skip-cert-verify': true } : {}),
        ...(wsOpts ? { 'ws-opts': wsOpts } : {}),
      };
    }

    case 'vless': {
      const wsOpts = pick(config, 'ws_opts', 'ws-opts');
      return {
        ...base,
        uuid: pick(config, 'uuid') || '',
        network: pick(config, 'network') || 'tcp',
        ...(config.tls ? { tls: true } : {}),
        ...(pick(config, 'servername') ? { servername: pick(config, 'servername') } : {}),
        ...(pick(config, 'flow') ? { flow: pick(config, 'flow') } : {}),
        ...(pick(config, 'skip_cert_verify', 'skip-cert-verify') ? { 'skip-cert-verify': true } : {}),
        ...(wsOpts ? { 'ws-opts': wsOpts } : {}),
      };
    }

    case 'http': {
      return {
        ...base,
        ...(pick(config, 'username') !== undefined ? { username: pick(config, 'username') } : {}),
        ...(pick(config, 'password') !== undefined ? { password: pick(config, 'password') } : {}),
        ...(config.tls ? { tls: true } : {}),
        ...(pick(config, 'skip_cert_verify', 'skip-cert-verify') ? { 'skip-cert-verify': true } : {}),
      };
    }

    case 'socks5': {
      return {
        ...base,
        ...(pick(config, 'username') !== undefined ? { username: pick(config, 'username') } : {}),
        ...(pick(config, 'password') !== undefined ? { password: pick(config, 'password') } : {}),
        ...(config.tls ? { tls: true } : {}),
        ...(pick(config, 'skip_cert_verify', 'skip-cert-verify') ? { 'skip-cert-verify': true } : {}),
        udp: config.udp !== false,
      };
    }

    case 'tuic': {
      const cc = pick(config, 'congestion_control', 'congestion-control');
      return {
        ...base,
        uuid: pick(config, 'uuid') || '',
        password: pick(config, 'password') || '',
        ...(cc ? { 'congestion-control': cc } : {}),
        ...(pick(config, 'alpn') ? { alpn: pick(config, 'alpn') } : {}),
        ...(pick(config, 'sni') ? { sni: pick(config, 'sni') } : {}),
        ...(pick(config, 'skip_cert_verify', 'skip-cert-verify') ? { 'skip-cert-verify': true } : {}),
      };
    }

    default:
      return base;
  }
}

const INDENT = (n) => ' '.repeat(n);
const isMap = (v) => v && typeof v === 'object' && !Array.isArray(v);
const isEmptyMap = (v) => isMap(v) && Object.keys(v).length === 0;

// Emit a mapping's lines. `baseIndent` is the column for continuation keys.
// `firstPrefix` (optional) replaces the indentation of the first line, e.g. "  - ".
function emitMap(obj, baseIndent, firstPrefix = null) {
  const lines = [];
  let first = true;

  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (isEmptyMap(value)) continue;

    const lead = first && firstPrefix !== null ? firstPrefix : INDENT(baseIndent);
    first = false;

    if (isMap(value)) {
      lines.push(`${lead}${key}:`);
      lines.push(...emitMap(value, baseIndent + 2));
    } else if (Array.isArray(value)) {
      lines.push(`${lead}${key}:`);
      for (const item of value) {
        if (isMap(item)) {
          lines.push(...emitMap(item, baseIndent + 4, INDENT(baseIndent + 2) + '- '));
        } else {
          lines.push(`${INDENT(baseIndent + 2)}- ${yamlValue(item)}`);
        }
      }
    } else {
      lines.push(`${lead}${key}: ${yamlValue(value)}`);
    }
  }

  return lines;
}

function entryToYaml(entry) {
  // Top-level list item: "  - key: val" with continuation keys at column 4.
  return emitMap(entry, 4, '  - ').join('\n');
}

function yamlValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (value === '' ||
        /[:#{}\[\],&*?|>!%@`]/.test(value) ||
        /^[\s\-]/.test(value) ||
        /^(true|false|null|yes|no|on|off|~)$/i.test(value)) {
      return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return value;
  }
  return String(value);
}
