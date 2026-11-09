<template>
  <aside class="fixed left-0 top-0 h-full w-64 bg-gray-800 border-r border-gray-700 flex flex-col">
    <div class="h-16 flex items-center px-6 border-b border-gray-700">
      <h1 class="text-xl font-bold text-primary-400">Mihomo</h1>
    </div>
    <nav class="flex-1 py-4 overflow-y-auto">
      <router-link
        v-for="item in menuItems"
        :key="item.to"
        :to="item.to"
        class="flex items-center gap-3 px-6 py-3 text-sm transition-colors"
        :class="isActive(item.to) ? 'bg-gray-700 text-primary-400' : 'text-gray-400 hover:bg-gray-750 hover:text-gray-200'"
      >
        <span
          class="inline-flex items-center justify-center w-5 h-5 shrink-0 text-base leading-none"
          v-html="item.icon"
        ></span>
        <span class="leading-5">{{ item.label }}</span>
      </router-link>
    </nav>
    <div class="p-4 border-t border-gray-700">
      <div class="text-xs text-gray-500">v1.0.0</div>
    </div>
  </aside>
</template>

<script setup>
import { useRoute } from 'vue-router';

const route = useRoute();

const menuItems = [
  { to: '/', label: '仪表盘', icon: '&#9632;' },
  { to: '/proxies', label: '代理节点', icon: '&#9654;' },
  { to: '/chained-proxies', label: '链式代理', icon: '&#8644;' },
  { to: '/paid-subs', label: '付费订阅', icon: '&#9733;' },
  { to: '/templates', label: '配置模板', icon: '&#9881;' },
  { to: '/custom-rules', label: '自定义规则', icon: '&#9776;' },
  { to: '/profiles', label: '配置档案', icon: '&#9998;' },
];

function isActive(path) {
  if (path === '/') return route.path === '/';
  return route.path.startsWith(path);
}
</script>
