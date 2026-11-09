<template>
  <header class="h-16 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-6">
    <h2 class="text-lg font-semibold text-gray-200">{{ pageTitle }}</h2>
    <div class="flex items-center gap-4">
      <span class="text-sm text-gray-400">{{ auth.email }}</span>
      <button
        @click="auth.logout(); $router.push('/login')"
        class="text-sm text-red-400 hover:text-red-300 transition-colors"
      >
        退出
      </button>
    </div>
  </header>
</template>

<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const route = useRoute();
const auth = useAuthStore();

const pageTitle = computed(() => {
  const titles = {
    Dashboard: '仪表盘',
    Proxies: '代理节点',
    ChainedProxies: '链式代理',
    PaidSubs: '付费订阅',
    Templates: '配置模板',
    TemplateNew: '新建模板',
    TemplateEdit: '编辑模板',
    Profiles: '配置档案',
    ProfileNew: '新建档案',
    ProfileEdit: '编辑档案',
    CustomRules: '自定义规则',
  };
  return titles[route.name] || 'Mihomo 管理平台';
});
</script>
