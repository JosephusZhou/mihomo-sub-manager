// Config generator: produces full mihomo YAML from profile data

import { dump as dumpYaml } from 'js-yaml';
import { buildSubscriptionYaml } from './subscription-builder.js';

const ICONS_BASE = 'https://github.com/DustinWin/ruleset_geodata/releases/download/icons';
const RULESET_BASE = 'https://github.com/DustinWin/ruleset_geodata/releases/download/mihomo-ruleset';

// Region buckets: 10 aggregated categories.
// Each of the first 9 uses an include `filter`; "其他" is a catch-all via `exclude-filter`.
// 2-letter ISO country codes are matched WITH BOUNDARIES (adjacent chars must be non-letters),
// so city names / random suffixes (e.g. "Alkmaar" contains lk, "zzcz" contains cz, "zmyi" contains my)
// never false-match. Codes are expected as a standalone "CC-..." prefix, like real airport node names.
const cc = (c) => `(^|[^A-Za-z])${c}([^A-Za-z]|$)`;

const REGION_BUCKETS = [
  { name: '香港', icon: 'hongkong.png', tokens: ['🇭🇰', '香港', '港', cc('hk'), 'hongkong'] },
  { name: '台湾', icon: 'taiwan.png', tokens: ['🇹🇼', '台湾', '台', cc('tw'), 'taiwan'] },
  { name: '韩国', icon: 'korea.png', tokens: ['🇰🇷', '韩国', '韩', cc('kr'), cc('ko'), 'korea'] },
  { name: '日本', icon: 'japan.png', tokens: ['🇯🇵', '日本', '日', cc('jp'), 'japan'] },
  { name: '新加坡', icon: 'singapore.png', tokens: ['🇸🇬', '新加坡', cc('sg'), 'singapore'] },
  { name: '美国', icon: 'unitedstates.png', tokens: ['🇺🇸', '美国', '美', cc('us'), 'united states', 'america'] },
  {
    name: '亚洲其他',
    icon: 'global.png',
    tokens: [
      '🇵🇭', '🇻🇳', '🇲🇾', '🇹🇭', '🇮🇩', '🇮🇳', '🇰🇭', '🇱🇦', '🇲🇲', '🇧🇳', '🇲🇳', '🇰🇿', '🇵🇰', '🇧🇩', '🇱🇰', '🇳🇵', '🇺🇿', '🇦🇫', '🇲🇻', '🇧🇹',
      '菲律宾', '越南', '马来西亚', '马来', '泰国', '印尼', '印度尼西亚', '印度', '柬埔寨', '老挝', '缅甸', '文莱', '蒙古', '哈萨克', '巴基斯坦', '孟加拉', '斯里兰卡', '尼泊尔', '乌兹别克', '阿富汗', '马尔代夫', '不丹',
      'philippines', 'vietnam', 'malaysia', 'thailand', 'indonesia', 'india', 'cambodia', 'laos', 'myanmar', 'brunei', 'mongolia', 'kazakhstan', 'pakistan', 'bangladesh', 'sri lanka', 'nepal', 'uzbekistan', 'afghanistan', 'maldives', 'bhutan',
      ...['ph', 'vn', 'my', 'th', 'id', 'in', 'kh', 'la', 'mm', 'bn', 'mn', 'kz', 'pk', 'bd', 'lk', 'np', 'uz', 'af', 'mv', 'bt'].map(cc),
    ],
  },
  {
    name: '美洲其他',
    icon: 'global.png',
    tokens: [
      '🇨🇦', '🇧🇷', '🇲🇽', '🇦🇷', '🇨🇱', '🇨🇴', '🇵🇪', '🇻🇪', '🇪🇨', '🇺🇾', '🇵🇾', '🇧🇴', '🇨🇷', '🇵🇦', '🇵🇷', '🇩🇴', '🇬🇹',
      '加拿大', '巴西', '墨西哥', '阿根廷', '智利', '哥伦比亚', '秘鲁', '委内瑞拉', '厄瓜多尔', '乌拉圭', '巴拉圭', '玻利维亚', '哥斯达黎加', '巴拿马', '波多黎各', '多米尼加', '危地马拉',
      'canada', 'brazil', 'mexico', 'argentina', 'chile', 'colombia', 'peru', 'venezuela', 'ecuador', 'uruguay', 'paraguay', 'bolivia', 'costa rica', 'panama', 'puerto rico', 'dominican', 'guatemala',
      ...['ca', 'br', 'mx', 'ar', 'cl', 'co', 'pe', 've', 'ec', 'uy', 'py', 'bo', 'cr', 'pa', 'pr', 'do', 'gt'].map(cc),
    ],
  },
  {
    name: '欧洲',
    icon: 'global.png',
    tokens: [
      '🇬🇧', '🇩🇪', '🇫🇷', '🇮🇹', '🇳🇱', '🇷🇺', '🇪🇸', '🇨🇭', '🇸🇪', '🇳🇴', '🇫🇮', '🇩🇰', '🇵🇱', '🇦🇹', '🇧🇪', '🇮🇪', '🇵🇹', '🇨🇿', '🇷🇴', '🇭🇺', '🇬🇷', '🇺🇦', '🇧🇬', '🇭🇷', '🇷🇸', '🇮🇸', '🇱🇺', '🇱🇹', '🇱🇻', '🇪🇪', '🇸🇰', '🇸🇮', '🇹🇷',
      '英国', '德国', '法国', '意大利', '荷兰', '俄罗斯', '西班牙', '瑞士', '瑞典', '挪威', '芬兰', '丹麦', '波兰', '奥地利', '比利时', '爱尔兰', '葡萄牙', '捷克', '罗马尼亚', '匈牙利', '希腊', '乌克兰', '保加利亚', '克罗地亚', '塞尔维亚', '冰岛', '卢森堡', '立陶宛', '拉脱维亚', '爱沙尼亚', '斯洛伐克', '斯洛文尼亚', '土耳其', '摩尔多瓦', '白俄罗斯', '马耳他', '塞浦路斯',
      'united kingdom', 'britain', 'england', 'germany', 'france', 'italy', 'netherlands', 'holland', 'russia', 'spain', 'switzerland', 'sweden', 'norway', 'finland', 'denmark', 'poland', 'austria', 'belgium', 'ireland', 'portugal', 'czech', 'romania', 'hungary', 'greece', 'ukraine', 'bulgaria', 'croatia', 'serbia', 'iceland', 'luxembourg', 'lithuania', 'latvia', 'estonia', 'slovakia', 'slovenia', 'turkey', 'moldova', 'belarus', 'malta', 'cyprus',
      ...['uk', 'gb', 'de', 'fr', 'it', 'nl', 'es', 'ch', 'se', 'no', 'fi', 'dk', 'pl', 'at', 'be', 'ie', 'pt', 'cz', 'ro', 'hu', 'gr', 'ua', 'bg', 'hr', 'rs', 'is', 'lu', 'lt', 'lv', 'ee', 'sk', 'si', 'tr', 'ru', 'md', 'by', 'al', 'mt', 'cy'].map(cc),
    ],
  },
];

const OTHER_REGION_NAME = '其他';
const OTHER_REGION_ICON = 'other.png';

// 订阅里常见的信息伪节点（如「剩余流量」「套餐到期」「官网」「建议」），不是真实代理，统一排除。
const INFO_TOKENS = ['剩余', '到期', '官网', '建议', '距离', '重置', '套餐', '流量', '过期', 'expire', 'traffic', 'remaining', 'expiration'];

const ALL_REGIONS = [...REGION_BUCKETS, { name: OTHER_REGION_NAME, icon: OTHER_REGION_ICON, tokens: [] }];

// Union of all bucket tokens (+ info-node patterns): nodes matching any of these are NOT "其他".
const OTHER_EXCLUDE_FILTER = '(?i)(' +
  [...new Set([...REGION_BUCKETS.flatMap(r => r.tokens), ...INFO_TOKENS])].join('|') + ')';

function regionFilter(region) {
  return '(?i)(' + region.tokens.join('|') + ')';
}

const RULESET_DOMAIN = [
  'private', 'trackerslist', 'microsoft-cn', 'apple-cn', 'google-cn',
  'games-cn', 'ai', 'networktest', 'proxy', 'cn',
];
const RULESET_IPCIDR = ['privateip', 'cnip', 'telegramip'];

// 统一用块状多行输出：flowLevel: -1 禁止所有 flow 数组/对象，noRefs 避免锚点。
const YAML_BLOCK_OPTS = { lineWidth: -1, noRefs: true, flowLevel: -1 };

export function generateProfileConfig(options) {
  const {
    template, paidSubscriptions, userApiToken, workerUrl,
    includePrivateSub = true, customRules = [], chainProxies = [],
  } = options;

  const dnsMode = template.dns_mode || 'fake-ip';
  const adBlocking = template.ad_blocking === 1;
  const selectedRegions = template.regions || [];
  const enabledCustomRules = (template.include_custom_rules === 1 || template.include_custom_rules === true)
    ? customRules
    : [];

  // 链式节点的前置节点必须可解析：每个前置节点对应一个策略组，
  // 组通过 use: [自建节点] + filter 精确匹配节点名。
  const preNodeGroupMap = new Map();
  const preNodeGroups = [];
  for (const p of chainProxies) {
    if (!p.dialer_proxy || preNodeGroupMap.has(p.dialer_proxy)) continue;
    const groupName = `链式前置-${preNodeGroupMap.size + 1}`;
    preNodeGroupMap.set(p.dialer_proxy, groupName);
    preNodeGroups.push({ name: groupName, pre: p.dialer_proxy });
  }
  const preparedChainProxies = chainProxies
    .filter(p => preNodeGroupMap.has(p.dialer_proxy))
    .map(p => ({ ...p, dialer_proxy: preNodeGroupMap.get(p.dialer_proxy) }));

  const providerNames = [];
  if (includePrivateSub) {
    providerNames.push('自建节点');
  }
  const paidSubs = paidSubscriptions || [];
  paidSubs.forEach((sub, i) => {
    providerNames.push(sub.name || `机场订阅${i + 1}`);
  });

  const customSubUrl = `${workerUrl}/subscribes?token=${userApiToken}`;

  // 即使档案未勾选“包含私人节点”，链式代理也需要前置节点所在的 provider。
  const needsPrivateProvider = includePrivateSub || preparedChainProxies.length > 0;

  const sections = [
    genProxyProviders(paidSubs, customSubUrl, needsPrivateProvider),
    genBaseConfig(),
    genSniffer(dnsMode),
    genHosts(),
    genDNS(dnsMode, adBlocking),
    genChainProxies(preparedChainProxies),
    genProxyGroups(providerNames, selectedRegions, adBlocking, preparedChainProxies, preNodeGroups, needsPrivateProvider),
    genRuleProviders(adBlocking),
    genRules(adBlocking, enabledCustomRules),
  ];

  return sections.join('\n\n') + '\n';
}

function genProxyProviders(paidSubscriptions, customSubUrl, includePrivateSub = true) {
  const providers = {};

  if (includePrivateSub) {
    providers['自建节点'] = {
      type: 'http',
      url: customSubUrl,
      path: './proxies/custom.yaml',
      interval: 86400,
      'health-check': {
        enable: true,
        url: 'https://www.gstatic.com/generate_204',
        interval: 600,
      },
    };
  }

  paidSubscriptions.forEach((sub, i) => {
    const name = sub.name || `机场订阅${i + 1}`;
    providers[name] = {
      type: 'http',
      url: sub.wrapper_url,
      path: `./proxies/airport${i + 1}.yaml`,
      interval: 86400,
      'health-check': {
        enable: true,
        url: 'https://www.gstatic.com/generate_204',
        interval: 600,
      },
    };
  });

  return dumpYaml({ 'proxy-providers': providers }, YAML_BLOCK_OPTS).trimEnd();
}

function genBaseConfig() {
  return `log-level: info
ipv6: true
allow-lan: true
port: 1087
socks-port: 1080
mixed-port: 1081
unified-delay: true
tcp-concurrent: true
external-controller: 127.0.0.1:9090
external-ui: ui
external-ui-url: "https://github.com/Zephyruso/zashboard/archive/gh-pages.zip"
profile: { store-selected: true, store-fake-ip: true }`;
}

function genSniffer(dnsMode) {
  const overrideDest = dnsMode === 'fake-ip' ? 'true' : 'false';
  return `sniffer:
  enable: true
  parse-pure-ip: true
  sniff:
    {
      HTTP: { ports: [80, 8080-8880], override-destination: ${overrideDest} },
      TLS: { ports: [443, 8443] },
      QUIC: { ports: [443, 8443] },
    }
  skip-domain: ["Mijia Cloud"]`;
}

function genHosts() {
  // 之前是手拼字符串，dump 的 flowLevel 管不到这里，所以 hosts 仍是 flow 数组。
  return dumpYaml({
    hosts: {
      'dns.alidns.com': ['223.5.5.5', '223.6.6.6', '2400:3200::1', '2400:3200:baba::1'],
      'doh.pub': ['1.12.12.12', '1.12.12.21', '120.53.53.53'],
      'miwifi.com': ['192.168.31.1', '127.0.0.1'],
    },
  }, YAML_BLOCK_OPTS).trimEnd();
}

function genDNS(dnsMode, adBlocking) {
  const nameservers = [
    'https://dns.alidns.com/dns-query',
    'https://doh.pub/dns-query',
  ];

  if (dnsMode === 'fake-ip') {
    const dns = {
      enable: true,
      'prefer-h3': true,
      ipv6: true,
      'enhanced-mode': 'fake-ip',
      'fake-ip-range': '28.0.0.0/8',
      'fake-ip-range6': 'fc00::/16',
      'fake-ip-filter': ['rule-set:trackerslist,private,cn'],
      nameserver: nameservers,
    };

    if (adBlocking) {
      dns['nameserver-policy'] = { 'rule-set:ads': ['rcode://success'] };
    }

    return dumpYaml({ dns }, YAML_BLOCK_OPTS).trimEnd();
  }

  // 之前是手拼字符串（default-nameserver/direct-nameserver/nameserver-policy 都是 flow 数组），
  // dump 选项不生效，改为对象统一输出块状数组。
  const realIpDns = dumpYaml({
    dns: {
      enable: true,
      ipv6: false,
      'enhanced-mode': 'redir-host',
      'use-hosts': true,
      'use-system-hosts': false,
      'respect-rules': false,
      'default-nameserver': ['223.5.5.5', '119.29.29.29'],
      nameserver: nameservers,
      'proxy-server-nameserver': nameservers,
      'direct-nameserver': ['223.5.5.5', '119.29.29.29'],
      'nameserver-policy': {
        '+.example.com': ['223.5.5.5', '119.29.29.29'],
        '+.example.net': ['223.5.5.5'],
        '+.example.org': ['223.5.5.5'],
        '+.example.test': ['223.5.5.5'],
        '+.example.invalid': ['223.5.5.5'],
        '+.example.example': ['223.5.5.5', '119.29.29.29'],
      },
    },
  }, YAML_BLOCK_OPTS).trimEnd();

  // js-yaml 不支持注释，按固定缩进在 nameserver-policy 前插入说明行。
  return realIpDns.replace(
    '\n  nameserver-policy:',
    '\n  # 示例域名占位，可替换为实际需要直连解析的域名\n  nameserver-policy:'
  );
}

function genChainProxies(chainProxies) {
  if (!chainProxies.length) return 'proxies: []';
  return buildSubscriptionYaml(chainProxies).trimEnd();
}

function genProxyGroups(providerNames, selectedRegions, adBlocking, chainProxies = [], preNodeGroups = [], needsPrivateProvider = false) {
  // 没有付费订阅且排除私人节点时，链式场景下仍只有“自建节点”可用，保证 use 不为空。
  const useList = providerNames.length
    ? [...providerNames]
    : (needsPrivateProvider ? ['自建节点'] : []);
  const groups = [];

  const regionNames = getRegionNames(selectedRegions);
  const chainNames = chainProxies.map(p => p.name);
  const chainGroupName = '链式代理';
  // 分流组末尾追加链式代理组；没有链式节点时不产生空的组引用。
  const withChain = (list) => (chainNames.length ? [...list, chainGroupName] : [...list]);

  const mainProxies = withChain(regionNames);
  groups.push({ name: '节点选择', type: 'select', proxies: [...mainProxies], icon: `${ICONS_BASE}/proxy.png` });
  groups.push({ name: '指定专用', type: 'select', proxies: [...mainProxies], icon: `${ICONS_BASE}/proxy.png` });

  for (const region of getFilteredRegions(selectedRegions)) {
    const group = {
      name: region.name,
      type: 'select',
      use: [...useList],
    };
    if (region.name === OTHER_REGION_NAME) {
      group['exclude-filter'] = OTHER_EXCLUDE_FILTER;
    } else {
      group.filter = regionFilter(region);
    }
    group.icon = `${ICONS_BASE}/${region.icon}`;
    groups.push(group);
  }

  // 前置节点策略组：只筛选出用户选定的私人节点。
  for (const group of preNodeGroups) {
    groups.push({
      name: group.name,
      type: 'select',
      use: ['自建节点'],
      filter: `^${escapeRegex(group.pre)}$`,
      icon: `${ICONS_BASE}/proxy.png`,
    });
  }

  if (chainNames.length) {
    groups.push({ name: chainGroupName, type: 'select', proxies: [...chainNames], icon: `${ICONS_BASE}/proxy.png` });
  }

  const aiProxies = regionNames.filter(n => n !== '香港');
  const aiGroupProxies = withChain(aiProxies.length > 0 ? aiProxies : ['节点选择']);
  groups.push({ name: 'AI平台', type: 'select', proxies: aiGroupProxies, icon: `${ICONS_BASE}/ai.png` });

  // 节点选择 + 全球直连 + 全部地区组（+ 链式代理组）
  const selFirst = withChain(['节点选择', '全球直连', ...regionNames]);
  // 全球直连 + 节点选择 + 全部地区组（+ 链式代理组）
  const directFirst = withChain(['全球直连', '节点选择', ...regionNames]);
  const icon = (name) => `${ICONS_BASE}/${name}`;

  groups.push({ name: '网络测试', type: 'select', proxies: [...selFirst], icon: icon('networktest.png') });
  groups.push({ name: 'Trackerslist', type: 'select', proxies: [...selFirst], icon: icon('trackerslist.png') });
  groups.push({ name: '游戏服务', type: 'select', proxies: [...directFirst], icon: icon('games-cn.png') });
  groups.push({ name: '微软服务', type: 'select', proxies: [...selFirst], icon: icon('microsoft-cn.png') });
  groups.push({ name: '谷歌服务', type: 'select', proxies: [...selFirst], icon: icon('google-cn.png') });
  groups.push({ name: '苹果服务', type: 'select', proxies: [...selFirst], icon: icon('apple-cn.png') });
  groups.push({ name: '直连域名', type: 'select', proxies: [...directFirst], icon: icon('cn.png') });
  groups.push({ name: '直连 IP', type: 'select', proxies: [...directFirst], icon: icon('cnip.png') });
  groups.push({ name: '代理域名', type: 'select', proxies: [...selFirst], icon: icon('global.png') });
  groups.push({ name: '电报消息', type: 'select', proxies: [...selFirst], icon: icon('telegram.png') });

  groups.push({ name: '直连软件', type: 'select', proxies: ['全球直连'], hidden: true, icon: icon('applications.png') });
  groups.push({ name: '私有网络', type: 'select', proxies: ['全球直连'], hidden: true, icon: icon('private.png') });

  groups.push({ name: '漏网之鱼', type: 'select', proxies: [...selFirst], icon: icon('match.png') });

  if (adBlocking) {
    groups.push({ name: '广告域名', type: 'select', proxies: ['全球拦截', '全球绕过'], icon: icon('ads.png') });
    groups.push({ name: '全球拦截', type: 'select', proxies: ['REJECT'], hidden: true, icon: icon('reject.png') });
    groups.push({ name: '全球绕过', type: 'select', proxies: ['PASS'], hidden: true, icon: icon('pass.png') });
  }

  groups.push({ name: '全球直连', type: 'select', proxies: ['DIRECT'], hidden: true, icon: icon('direct.png') });

  const body = dumpYaml(groups, YAML_BLOCK_OPTS);
  const indented = body.trimEnd().split('\n').map(line => `  ${line}`).join('\n');
  return `proxy-groups:\n${indented}`;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function genRuleProviders(adBlocking) {
  const providers = [];

  if (adBlocking) {
    providers.push(`  ads:
    type: http
    behavior: domain
    format: mrs
    path: ./ruleset/ads.mrs
    url: "${RULESET_BASE}/ads.mrs"
    interval: 86400`);
  }

  for (const name of RULESET_DOMAIN) {
    providers.push(`  ${name}:
    type: http
    behavior: domain
    format: mrs
    path: ./ruleset/${name}.mrs
    url: "${RULESET_BASE}/${name}.mrs"
    interval: 86400`);
  }

  providers.push(`  applications:
    type: http
    behavior: classical
    format: text
    path: ./ruleset/applications.list
    url: "${RULESET_BASE}/applications.list"
    interval: 86400`);

  for (const name of RULESET_IPCIDR) {
    providers.push(`  ${name}:
    type: http
    behavior: ipcidr
    format: mrs
    path: ./ruleset/${name}.mrs
    url: "${RULESET_BASE}/${name}.mrs"
    interval: 86400`);
  }

  return `rule-providers:\n${providers.join('\n')}`;
}

function genRules(adBlocking, customRules) {
  const rules = [];
  const seen = new Set();

  // 自定义规则放在 rules 最前面，优先命中；与内置规则重复时保留自定义那条（内置的会被去重跳过）。
  const add = (rule) => {
    const value = String(rule).trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    rules.push(`  - ${value}`);
  };

  for (const rule of customRules || []) {
    add(rule);
  }

  add('RULE-SET,private,私有网络');

  if (adBlocking) {
    add('RULE-SET,ads,广告域名');
  }

  add('RULE-SET,trackerslist,Trackerslist');
  add('RULE-SET,applications,直连软件');
  add('RULE-SET,microsoft-cn,微软服务');
  add('RULE-SET,apple-cn,苹果服务');
  add('RULE-SET,google-cn,谷歌服务');
  add('RULE-SET,games-cn,游戏服务');
  add('RULE-SET,ai,AI平台');
  add('RULE-SET,networktest,网络测试');
  add('RULE-SET,proxy,代理域名');
  add('RULE-SET,cn,直连域名');
  add('RULE-SET,privateip,私有网络,no-resolve');
  add('RULE-SET,cnip,直连 IP');
  add('RULE-SET,telegramip,电报消息,no-resolve');

  add('MATCH,漏网之鱼');

  return `rules:\n${rules.join('\n')}`;
}

// 模板预览专用：只组装与真实生成完全一致的 rule-providers + rules 段。
// 其余段（proxies/proxy-groups 等）依赖节点与档案上下文，模板预览仍只展示示意结构。
export function generateRulesPreview({ adBlocking = false, customRules = [] } = {}) {
  return `${genRuleProviders(adBlocking)}\n\n${genRules(adBlocking, customRules)}`;
}

function normalizeSelected(selectedRegions) {
  if (!selectedRegions || selectedRegions.length === 0) return [];
  const set = new Set();
  for (const s of selectedRegions) set.add(s);
  return [...set];
}

function getRegionNames(selectedRegions) {
  const sel = normalizeSelected(selectedRegions);
  if (sel.length === 0) return ALL_REGIONS.map(r => r.name);
  return ALL_REGIONS.filter(r => sel.includes(r.name)).map(r => r.name);
}

function getFilteredRegions(selectedRegions) {
  const sel = normalizeSelected(selectedRegions);
  if (sel.length === 0) return ALL_REGIONS;
  return ALL_REGIONS.filter(r => sel.includes(r.name));
}
