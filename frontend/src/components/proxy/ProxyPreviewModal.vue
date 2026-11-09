<template>
  <Modal :show="!!proxy" title="节点配置预览" size="md" @close="$emit('close')">
    <pre v-if="proxy" class="bg-gray-900 rounded p-4 text-sm font-mono text-gray-300 overflow-auto leading-relaxed whitespace-pre-wrap">{{ previewYaml }}</pre>
    <template #footer>
      <button @click="copyPreview" class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm transition-colors">
        复制 YAML
      </button>
    </template>
  </Modal>
</template>

<script setup>
import { computed } from 'vue';
import yaml from 'js-yaml';
import Modal from '@/components/Modal.vue';
import { copyText } from '@/utils/toast';
import { normalizeProxyConfig } from '@/utils/proxyConfig';

const props = defineProps({
  proxy: { type: Object, default: null },
});
defineEmits(['close']);

// 与表单提交共用同一套归一化：预览不出现表单改不了的字段。
const previewYaml = computed(() => {
  if (!props.proxy) return '';
  const p = props.proxy;
  const config = normalizeProxyConfig(p.type, p.config || {});

  // Convert underscores back to Clash keys; vmess 的 alterId 不是连字符键。
  const keyMap = { alter_id: 'alterId' };
  const clashConfig = {};
  for (const key in config) {
    clashConfig[keyMap[key] || key.replace(/_/g, '-')] = config[key];
  }

  const entry = {
    name: p.name,
    type: p.type,
    server: p.server,
    port: p.port,
    ...(p.dialer_proxy ? { 'dialer-proxy': p.dialer_proxy } : {}),
    ...clashConfig,
  };
  return yaml.dump({ proxies: [entry] }, { lineWidth: -1, noRefs: true, flowLevel: -1 });
});

function copyPreview() {
  copyText(previewYaml.value, 'YAML 已复制');
}
</script>
