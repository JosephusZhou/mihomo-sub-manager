// 节点配置归一化：保证「编辑表单能改的字段」与「存储/预览输出的字段」严格一致。
// 提交、YAML 粘贴导入、预览三个出口都必须走 normalizeProxyConfig。

// 链式代理判定唯一来源：proxies.dialer_proxy 列（顶层字段）。
export function isChainedProxy(proxy) {
  return Boolean(proxy && proxy.dialer_proxy);
}

export function normalizeSsConfig(config = {}) {
  const next = { ...config };

  if (!next.plugin) {
    delete next.plugin;
    delete next.plugin_opts;
    return next;
  }

  const opts = next.plugin_opts || {};

  if (next.plugin === 'obfs') {
    // simple-obfs 只支持 mode/host；path/tls 属于 v2ray-plugin。
    next.plugin_opts = {
      mode: ['tls', 'http'].includes(opts.mode) ? opts.mode : 'tls',
      host: opts.host || '',
    };
  } else if (next.plugin === 'v2ray-plugin') {
    // v2ray-plugin 必须有 mode，空值会导致节点不可用；默认 websocket。
    next.plugin_opts = {
      ...opts,
      mode: opts.mode || 'websocket',
    };
  }

  return next;
}

export function normalizeHysteria2Config(config = {}) {
  const next = { ...config };

  if (!next.obfs) {
    // obfs 为空时表单不显示混淆密码，存储/预览也不应保留。
    delete next.obfs;
    delete next.obfs_password;
    delete next['obfs-password'];
  }

  return next;
}

export function normalizeTransportConfig(config = {}) {
  const next = { ...config };

  if ((next.network || 'tcp') !== 'ws') {
    // 非 ws 传输时 ws_opts 不参与生成，表单也不展示，直接剔除。
    delete next.ws_opts;
    delete next['ws-opts'];
    return next;
  }

  const opts = { ...(next.ws_opts || next['ws-opts'] || {}) };
  if (!opts.path) opts.path = '/';
  if (opts.headers && typeof opts.headers === 'object' && Object.keys(opts.headers).length === 0) {
    delete opts.headers;
  }
  next.ws_opts = opts;
  delete next['ws-opts'];

  return next;
}

// 粘贴的 Clash YAML 使用 alterId / skip-cert-verify，所有类型内部统一为下划线键。
export function normalizeCommonKeys(config = {}) {
  const next = { ...config };
  if (next.alterId !== undefined) {
    if (next.alter_id === undefined) next.alter_id = next.alterId;
    delete next.alterId;
  }
  if (next['skip-cert-verify'] !== undefined) {
    if (next.skip_cert_verify === undefined) next.skip_cert_verify = next['skip-cert-verify'];
    delete next['skip-cert-verify'];
  }
  return next;
}

// 按节点类型分发给对应归一化函数；未涉及的类型只做公共键归一化。
export function normalizeProxyConfig(type, config = {}) {
  const next = normalizeCommonKeys(config);
  switch (type) {
    case 'ss':
      return normalizeSsConfig(next);
    case 'hysteria2':
      return normalizeHysteria2Config(next);
    case 'vmess':
    case 'vless':
      return normalizeTransportConfig(next);
    default:
      return next;
  }
}
