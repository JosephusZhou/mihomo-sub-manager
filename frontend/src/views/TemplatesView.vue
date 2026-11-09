<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold">配置模板</h2>
      <router-link to="/templates/new" class="bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded text-sm transition-colors">
        + 新建模板
      </router-link>
    </div>

    <div v-if="store.loading" class="text-center py-12 text-gray-400">加载中...</div>
    <div v-else-if="store.templates.length === 0" class="text-center py-12 text-gray-400">暂无模板</div>
    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div
        v-for="t in store.templates"
        :key="t.id"
        class="bg-gray-800 rounded-lg border border-gray-700 p-5"
      >
        <div class="flex items-start justify-between mb-3">
          <div>
            <h3 class="font-semibold text-lg">{{ t.name }}</h3>
            <div class="flex gap-2 mt-1">
              <span class="text-xs px-2 py-0.5 rounded" :class="t.dns_mode === 'fake-ip' ? 'bg-blue-900 text-blue-300' : 'bg-green-900 text-green-300'">
                {{ t.dns_mode }}
              </span>
              <span class="text-xs px-2 py-0.5 rounded" :class="t.ad_blocking ? 'bg-red-900 text-red-300' : 'bg-gray-700 text-gray-300'">
                {{ t.ad_blocking ? '去广告' : '不去广告' }}
              </span>
              <span v-if="isSystemTemplate(t)" class="text-xs px-2 py-0.5 bg-yellow-900 text-yellow-300 rounded">系统</span>
            </div>
          </div>
          <div class="flex gap-1">
            <button @click="openPreview(t)" class="px-2 py-1 text-xs bg-blue-700 hover:bg-blue-600 rounded transition-colors">预览</button>
            <router-link v-if="!isSystemTemplate(t)" :to="`/templates/${t.id}/edit`" class="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors">编辑</router-link>
            <button v-if="!isSystemTemplate(t)" @click="handleDelete(t)" class="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 rounded transition-colors">删除</button>
          </div>
        </div>
        <div class="text-sm text-gray-400">
          地区: {{ t.regions.length === 0 ? '全部 10 个' : `${t.regions.length} 个` }}
          <span v-if="t.include_custom_rules"> &middot; 加入自定义规则</span>
        </div>
      </div>
    </div>

    <!-- 预览模板 Modal：rules / rule-providers 来自后端真实生成，其余段为示意结构 -->
    <Modal :show="!!previewTemplate" title="模板配置预览" size="lg" @close="previewTemplate = null">
      <pre v-if="previewTemplate" class="bg-gray-900 rounded p-4 text-sm font-mono text-gray-300 overflow-auto leading-relaxed whitespace-pre-wrap">{{ previewYaml }}</pre>
      <template #footer>
        <button @click="copyPreview" class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm transition-colors">
          复制 YAML
        </button>
      </template>
    </Modal>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import yaml from 'js-yaml';
import { useTemplateStore } from '@/stores/templates';
import Modal from '@/components/Modal.vue';
import { toast, copyText, errorMessage } from '@/utils/toast';

const store = useTemplateStore();
const previewTemplate = ref(null);
const previewYaml = ref('');

onMounted(() => {
  store.fetchAll().catch(e => toast.error(errorMessage(e, '加载模板失败')));
});

// 系统模板由 user_id = 0 判定（与后端只读规则一致），不展示编辑/删除入口。
function isSystemTemplate(t) {
  return Number(t.user_id) === 0;
}

// 示意结构：proxies / proxy-groups 依赖节点与档案上下文，保持精简示例；
// rules 与 rule-providers 由后端 config-generator 真实生成后拼接。
function buildTemplatePreview(t) {
  const sampleConfig = {
    'log-level': 'info',
    'ipv6': true,
    'allow-lan': true,
    'port': 1087,
    'socks-port': 1080,
    'mixed-port': 1081,
    'unified-delay': true,
    'tcp-concurrent': true,
    'external-controller': '127.0.0.1:9090',
  };

  const dns = {
    enable: true,
    'prefer-h3': true,
    ipv6: true,
  };

  if (t.dns_mode === 'fake-ip') {
    dns['enhanced-mode'] = 'fake-ip';
    dns['fake-ip-range'] = '28.0.0.0/8';
    dns['fake-ip-filter'] = ['rule-set:trackerslist,private,cn'];
    dns.nameserver = ['https://dns.alidns.com/dns-query', 'https://doh.pub/dns-query'];
    if (t.ad_blocking) {
      dns['nameserver-policy'] = { 'rule-set:ads': ['rcode://success'] };
    }
  } else {
    dns['enhanced-mode'] = 'redir-host';
    dns['use-hosts'] = true;
    dns['use-system-hosts'] = false;
    dns.nameserver = ['https://dns.alidns.com/dns-query', 'https://doh.pub/dns-query'];
  }

  sampleConfig.dns = dns;

  const regions = t.regions.length === 0
    ? ['香港', '台湾', '韩国', '日本', '新加坡', '美国', '亚洲其他', '美洲其他', '欧洲', '其他']
    : t.regions.slice(0, 6);

  sampleConfig['proxy-groups'] = [
    { name: '节点选择', type: 'select', proxies: ['...自动填充'] },
    ...regions.map(r => ({ name: r, type: 'select', use: ['自建节点', '...'], filter: '...' })),
    { name: '漏网之鱼', type: 'select', proxies: ['节点选择', '全球直连'] },
  ];

  if (t.ad_blocking) {
    sampleConfig['proxy-groups'].push({ name: '广告域名', type: 'select', proxies: ['全球拦截', '全球绕过'] });
    sampleConfig['proxy-groups'].push({ name: '全球拦截', type: 'select', proxies: ['REJECT'], hidden: true });
  }

  return `# 模板: ${t.name}\n# DNS模式: ${t.dns_mode} | 广告过滤: ${t.ad_blocking ? '启用' : '禁用'} | 地区: ${t.regions.length === 0 ? '全部 10 个' : `${t.regions.length} 个`}\n`
    + '# 说明: rules / rule-providers 为真实生成结果；proxies / proxy-groups 为示意结构，实际生成会包含你的节点与付费订阅。\n'
    + '# 说明: DNS 的 nameserver-policy 域名为示例占位，可按需替换为自己的域名。\n\n'
    + yaml.dump(sampleConfig, { lineWidth: -1, noRefs: true, flowLevel: -1 }) + '\n\n';
}

async function openPreview(template) {
  previewTemplate.value = template;
  previewYaml.value = '# 正在生成规则预览...';
  try {
    const rulesYaml = await store.previewRules(template.id);
    previewYaml.value = buildTemplatePreview(template) + rulesYaml;
  } catch (e) {
    previewYaml.value = buildTemplatePreview(template) + `# 规则预览加载失败: ${errorMessage(e)}\n`;
  }
}

function copyPreview() {
  copyText(previewYaml.value, 'YAML 已复制');
}

async function handleDelete(template) {
  if (!confirm(`确定删除模板「${template.name}」？`)) return;
  try {
    await store.remove(template.id);
    toast.success('模板已删除');
  } catch (e) {
    const data = e && e.response && e.response.data;
    if (data && data.conflict) {
      const count = (String(data.error).match(/used by (\d+)/) || [])[1];
      toast.error(`该模板正被 ${count ?? '若干'} 个档案使用，请先删除或改用其它模板后再删除模板`);
    } else {
      toast.error(errorMessage(e, '删除失败'));
    }
  }
}
</script>
