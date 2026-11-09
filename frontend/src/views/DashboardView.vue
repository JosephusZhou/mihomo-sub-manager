<template>
  <div>
    <h2 class="text-2xl font-bold mb-6">仪表盘</h2>

    <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
      <StatCard title="代理节点" :value="stats.proxies" icon="&#9654;" color="blue" to="/proxies" />
      <StatCard title="链式代理" :value="stats.chainedProxies" icon="&#8644;" color="cyan" to="/chained-proxies" />
      <StatCard title="付费订阅" :value="stats.paidSubs" icon="&#9733;" color="green" to="/paid-subs" />
      <StatCard title="配置模板" :value="stats.templates" icon="&#9881;" color="purple" to="/templates" />
      <StatCard title="自定义规则" :value="stats.customRules" icon="&#9776;" color="rose" to="/custom-rules" />
      <StatCard title="配置档案" :value="stats.profiles" icon="&#9998;" color="orange" to="/profiles" />
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue';
import { useProxyStore } from '@/stores/proxies';
import { useChainedProxyStore } from '@/stores/chainedProxies';
import { usePaidSubStore } from '@/stores/paidSubs';
import { useTemplateStore } from '@/stores/templates';
import { useProfileStore } from '@/stores/profiles';
import { useCustomRulesStore } from '@/stores/customRules';
import { isChainedProxy } from '@/utils/proxyConfig';
import StatCard from '@/components/layout/StatCard.vue';

const proxyStore = useProxyStore();
const chainedProxyStore = useChainedProxyStore();
const paidSubStore = usePaidSubStore();
const templateStore = useTemplateStore();
const profileStore = useProfileStore();
const customRulesStore = useCustomRulesStore();

// 计数直接由 store 派生：SWR 后台刷新回来或其它页面改动 store 时，卡片会自动更新。
// 「代理节点」只统计自定义节点，链式节点单独计入「链式代理」。
const stats = computed(() => ({
  proxies: proxyStore.proxies.filter(p => !isChainedProxy(p)).length,
  chainedProxies: chainedProxyStore.chainedProxies.length,
  paidSubs: paidSubStore.subscriptions.length,
  templates: templateStore.templates.length,
  profiles: profileStore.profiles.length,
  customRules: customRulesStore.rules.length,
}));

onMounted(() => {
  // 节点相关计数跳过 30 秒 SWR 缓存短路，确保链式标记来自真实接口数据。
  Promise.all([
    proxyStore.fetchAll({ revalidate: true }),
    chainedProxyStore.fetchAll({ revalidate: true }),
    paidSubStore.fetchAll(),
    templateStore.fetchAll(),
    profileStore.fetchAll(),
    customRulesStore.fetchAll(),
  ]);
});
</script>
