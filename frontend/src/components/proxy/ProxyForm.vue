<template>
  <div class="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6">
    <div class="flex items-center justify-between mb-4">
      <h3 class="text-lg font-semibold">{{ isEdit ? '编辑节点' : '添加节点' }}</h3>
      <div v-if="!isEdit" class="flex gap-2">
        <button
          type="button"
          @click="mode = 'yaml'"
          class="px-3 py-1 text-xs rounded transition-colors"
          :class="mode === 'yaml' ? 'bg-primary-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'"
        >
          YAML 粘贴
        </button>
        <button
          type="button"
          @click="mode = 'ui'"
          class="px-3 py-1 text-xs rounded transition-colors"
          :class="mode === 'ui' ? 'bg-primary-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'"
        >
          UI 表单
        </button>
      </div>
    </div>

    <!-- YAML 粘贴模式 -->
    <form v-if="mode === 'yaml' && !isEdit" @submit.prevent="handleYamlParse">
      <div class="mb-4">
        <label class="block text-sm text-gray-400 mb-1">粘贴 Clash YAML 配置</label>
        <textarea
          v-model="yamlInput"
          rows="10"
          class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary-500"
          placeholder="- name: hk&#10;  type: ss&#10;  server: 192.0.2.1&#10;  port: 443&#10;  cipher: chacha20-ietf-poly1305&#10;  password: your-password"
        ></textarea>
        <p class="text-xs text-gray-500 mt-1">支持单个或多个节点（用 - 开头的列表格式）</p>
      </div>
      <div v-if="parseError" class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded text-red-300 text-sm">
        {{ parseError }}
      </div>
      <div class="flex gap-3">
        <button type="submit" class="bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded text-sm transition-colors">
          解析并添加
        </button>
        <button type="button" @click="$emit('cancel')" class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm transition-colors">
          取消
        </button>
      </div>
    </form>

    <!-- UI 表单模式 -->
    <form v-else @submit.prevent="handleSubmit">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label class="block text-sm text-gray-400 mb-1">节点名称</label>
          <input v-model="form.name" required class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" placeholder="如 hk, ko-ss" />
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">协议类型</label>
          <select v-model="form.type" required class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500">
            <option value="ss">Shadowsocks</option>
            <option value="trojan">Trojan</option>
            <option value="hysteria2">Hysteria2</option>
            <option value="vmess">VMess</option>
            <option value="vless">VLESS</option>
            <option value="tuic">Tuic</option>
          </select>
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">服务器地址</label>
          <input v-model="form.server" required class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" placeholder="IP 或域名" />
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">端口</label>
          <input v-model.number="form.port" type="number" required min="1" max="65535" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
        </div>
      </div>

      <!-- SS 配置 -->
      <template v-if="form.type === 'ss'">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">加密方式</label>
            <select v-model="form.config.cipher" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500">
              <option value="chacha20-ietf-poly1305">chacha20-ietf-poly1305</option>
              <option value="aes-256-gcm">aes-256-gcm</option>
              <option value="aes-128-gcm">aes-128-gcm</option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">密码</label>
            <input v-model="form.config.password" required class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
          </div>
        </div>
        <div class="mb-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.config.udp" type="checkbox" class="accent-primary-500" />
            <span class="text-sm">启用 UDP</span>
          </label>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">插件（可选）</label>
            <select v-model="form.config.plugin" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500">
              <option value="">无</option>
              <option value="obfs">simple-obfs</option>
              <option value="v2ray-plugin">v2ray-plugin</option>
            </select>
          </div>
        </div>
        <template v-if="form.config.plugin === 'obfs'">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label class="block text-sm text-gray-400 mb-1">obfs 模式</label>
              <select v-model="form.config.plugin_opts.mode" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500">
                <option value="tls">tls</option>
                <option value="http">http</option>
              </select>
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">obfs host</label>
              <input v-model="form.config.plugin_opts.host" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" placeholder="如 amazon.com" />
            </div>
          </div>
        </template>
        <template v-if="form.config.plugin === 'v2ray-plugin'">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label class="block text-sm text-gray-400 mb-1">插件模式</label>
              <select v-model="form.config.plugin_opts.mode" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500">
                <option value="websocket">websocket</option>
                <option value="quic">quic</option>
              </select>
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">WebSocket Path</label>
              <input v-model="form.config.plugin_opts.path" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" placeholder="/" />
            </div>
            <div>
              <label class="block text-sm text-gray-400 mb-1">伪装域名 (Host)</label>
              <input v-model="form.config.plugin_opts.host" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
            </div>
          </div>
          <div class="mb-4">
            <label class="flex items-center gap-2 cursor-pointer">
              <input v-model="form.config.plugin_opts.tls" type="checkbox" class="accent-primary-500" />
              <span class="text-sm">启用 TLS</span>
            </label>
          </div>
        </template>
      </template>

      <!-- Trojan 配置 -->
      <template v-if="form.type === 'trojan'">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">密码</label>
            <input v-model="form.config.password" required class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">SNI</label>
            <input v-model="form.config.sni" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" :placeholder="form.server" />
          </div>
        </div>
        <div class="flex gap-4 mb-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.config.udp" type="checkbox" class="accent-primary-500" />
            <span class="text-sm">启用 UDP</span>
          </label>
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.config.skip_cert_verify" type="checkbox" class="accent-primary-500" />
            <span class="text-sm">跳过证书验证</span>
          </label>
        </div>
      </template>

      <!-- Hysteria2 配置 -->
      <template v-if="form.type === 'hysteria2'">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">密码</label>
            <input v-model="form.config.password" required class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">SNI</label>
            <input v-model="form.config.sni" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" :placeholder="form.server" />
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">混淆方式（可选）</label>
            <select v-model="form.config.obfs" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500">
              <option value="">无</option>
              <option value="salamander">salamander</option>
            </select>
          </div>
          <div v-if="form.config.obfs">
            <label class="block text-sm text-gray-400 mb-1">混淆密码</label>
            <input v-model="form.config.obfs_password" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
          </div>
        </div>
        <div class="mb-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.config.skip_cert_verify" type="checkbox" class="accent-primary-500" />
            <span class="text-sm">跳过证书验证</span>
          </label>
        </div>
      </template>

      <!-- VMess 配置 -->
      <template v-if="form.type === 'vmess'">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">UUID</label>
            <input v-model="form.config.uuid" required class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">加密方式</label>
            <select v-model="form.config.cipher" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500">
              <option value="auto">auto</option>
              <option value="aes-128-gcm">aes-128-gcm</option>
              <option value="chacha20-ietf-poly1305">chacha20-ietf-poly1305</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">AlterID</label>
            <input v-model.number="form.config.alter_id" type="number" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">传输协议</label>
            <select v-model="form.config.network" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500">
              <option value="tcp">tcp</option>
              <option value="ws">ws</option>
              <option value="grpc">grpc</option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">ServerName</label>
            <input v-model="form.config.servername" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
          </div>
        </div>
        <div class="mb-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.config.tls" type="checkbox" class="accent-primary-500" />
            <span class="text-sm">启用 TLS</span>
          </label>
        </div>
        <div class="mb-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.config.skip_cert_verify" type="checkbox" class="accent-primary-500" />
            <span class="text-sm">跳过证书验证</span>
          </label>
        </div>
        <div v-if="form.config.network === 'ws'" class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">WebSocket Path</label>
            <input v-model="form.config.ws_opts.path" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" placeholder="/" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">伪装域名 (Host)</label>
            <input v-model="form.config.ws_opts.headers.Host" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
          </div>
        </div>
      </template>

      <!-- VLESS 配置 -->
      <template v-if="form.type === 'vless'">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">UUID</label>
            <input v-model="form.config.uuid" required class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">Flow（可选）</label>
            <select v-model="form.config.flow" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500">
              <option value="">无</option>
              <option value="xtls-rprx-vision">xtls-rprx-vision</option>
            </select>
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">传输协议</label>
            <select v-model="form.config.network" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500">
              <option value="tcp">tcp</option>
              <option value="ws">ws</option>
              <option value="grpc">grpc</option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">ServerName</label>
            <input v-model="form.config.servername" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
          </div>
        </div>
        <div class="mb-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.config.tls" type="checkbox" class="accent-primary-500" />
            <span class="text-sm">启用 TLS</span>
          </label>
        </div>
        <div class="mb-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.config.skip_cert_verify" type="checkbox" class="accent-primary-500" />
            <span class="text-sm">跳过证书验证</span>
          </label>
        </div>
        <div v-if="form.config.network === 'ws'" class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">WebSocket Path</label>
            <input v-model="form.config.ws_opts.path" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" placeholder="/" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">伪装域名 (Host)</label>
            <input v-model="form.config.ws_opts.headers.Host" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
          </div>
        </div>
      </template>

      <!-- Tuic 配置 -->
      <template v-if="form.type === 'tuic'">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">UUID</label>
            <input v-model="form.config.uuid" required class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">密码</label>
            <input v-model="form.config.password" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
          </div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">拥塞控制</label>
            <select v-model="form.config.congestion_control" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500">
              <option value="bbr">bbr</option>
              <option value="cubic">cubic</option>
              <option value="new_reno">new_reno</option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">SNI</label>
            <input v-model="form.config.sni" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" :placeholder="form.server" />
          </div>
        </div>
        <div class="mb-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.config.skip_cert_verify" type="checkbox" class="accent-primary-500" />
            <span class="text-sm">跳过证书验证</span>
          </label>
        </div>
      </template>

      <div class="flex gap-3">
        <button type="submit" class="bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded text-sm transition-colors">
          {{ isEdit ? '保存' : '添加' }}
        </button>
        <button type="button" @click="$emit('cancel')" class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm transition-colors">
          取消
        </button>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue';
import yaml from 'js-yaml';
import { normalizeProxyConfig } from '@/utils/proxyConfig';

const props = defineProps({ proxy: Object });
const emit = defineEmits(['save', 'cancel', 'saveMultiple']);

const isEdit = computed(() => !!props.proxy);
const mode = ref('ui');
const yamlInput = ref('');
const parseError = ref('');

const defaultConfig = {
  ss: { cipher: 'chacha20-ietf-poly1305', password: '', udp: true, plugin: '', plugin_opts: { mode: '', host: '', path: '', tls: false } },
  trojan: { password: '', sni: '', udp: true, skip_cert_verify: false },
  hysteria2: { password: '', sni: '', obfs: '', obfs_password: '', skip_cert_verify: false },
  vmess: { uuid: '', cipher: 'auto', alter_id: 0, network: 'tcp', tls: false, servername: '', skip_cert_verify: false, ws_opts: { path: '/', headers: {} } },
  vless: { uuid: '', network: 'tcp', tls: false, flow: '', servername: '', skip_cert_verify: false, ws_opts: { path: '/', headers: {} } },
  tuic: { uuid: '', password: '', congestion_control: 'bbr', sni: '', skip_cert_verify: false },
};

const form = reactive({
  name: '',
  type: 'ss',
  server: '',
  port: 443,
  config: { ...defaultConfig.ss },
});

if (props.proxy) {
  form.name = props.proxy.name;
  form.type = props.proxy.type;
  form.server = props.proxy.server;
  form.port = props.proxy.port;

  // 合并默认配置，确保所有嵌套对象都存在
  const defaults = defaultConfig[props.proxy.type] || {};
  form.config = JSON.parse(JSON.stringify(defaults));

  // 先做键名归一化（连字符 → 下划线），再按类型归一化，与提交/预览共用同一套规则
  const rawConfig = {};
  for (const key in props.proxy.config || {}) {
    if (props.proxy.config[key] !== undefined) {
      rawConfig[key.replace(/-/g, '_')] = props.proxy.config[key];
    }
  }
  const normalizedConfig = normalizeProxyConfig(props.proxy.type, rawConfig);

  for (const key in normalizedConfig) {
    if (typeof normalizedConfig[key] === 'object' && normalizedConfig[key] !== null && !Array.isArray(normalizedConfig[key])) {
      form.config[key] = { ...(form.config[key] || {}), ...normalizedConfig[key] };
    } else {
      form.config[key] = normalizedConfig[key];
    }
  }

  // 确保 plugin_opts 存在（SS 插件需要）
  if (form.type === 'ss' && !form.config.plugin_opts) {
    form.config.plugin_opts = { mode: '', host: '', path: '', tls: false };
  }
}

watch(() => form.type, (newType) => {
  if (!props.proxy) {
    form.config = JSON.parse(JSON.stringify(defaultConfig[newType] || {}));
  }
});

// 切换 SS 插件时给出合法默认值，避免提交空 mode
watch(() => form.config.plugin, (plugin) => {
  const opts = form.config.plugin_opts || (form.config.plugin_opts = {});
  if (plugin === 'v2ray-plugin' && !['websocket', 'quic'].includes(opts.mode)) {
    opts.mode = 'websocket';
  }
  if (plugin === 'obfs' && !['tls', 'http'].includes(opts.mode)) {
    opts.mode = 'tls';
  }
});

function handleYamlParse() {
  parseError.value = '';
  try {
    const parsed = yaml.load(yamlInput.value);
    let proxies = [];

    if (Array.isArray(parsed)) {
      proxies = parsed;
    } else if (parsed && parsed.proxies && Array.isArray(parsed.proxies)) {
      proxies = parsed.proxies;
    } else if (parsed && parsed.name) {
      proxies = [parsed];
    } else {
      parseError.value = '无法解析 YAML，请检查格式';
      return;
    }

    if (proxies.length === 0) {
      parseError.value = '未找到有效的代理节点';
      return;
    }

    const results = proxies.map(p => {
      const config = { ...p };
      delete config.name;
      delete config.type;
      delete config.server;
      delete config.port;

      // Normalize hyphen keys to underscores (plugin-opts → plugin_opts, skip-cert-verify → skip_cert_verify)
      const normalizedConfig = {};
      for (const key in config) {
        const normalizedKey = key.replace(/-/g, '_');
        normalizedConfig[normalizedKey] = config[key];
      }

      return {
        name: p.name,
        type: p.type,
        server: p.server,
        port: p.port,
        config: normalizeProxyConfig(p.type, normalizedConfig),
      };
    });

    if (results.length === 1) {
      emit('save', results[0]);
    } else {
      emit('saveMultiple', results);
    }
  } catch (e) {
    parseError.value = 'YAML 解析失败: ' + e.message;
  }
}

function handleSubmit() {
  const config = normalizeProxyConfig(form.type, { ...form.config });

  emit('save', {
    name: form.name,
    type: form.type,
    server: form.server,
    port: form.port,
    config,
  });
}
</script>
