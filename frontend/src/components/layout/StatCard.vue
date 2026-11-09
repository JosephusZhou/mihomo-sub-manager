<template>
  <component
    :is="to ? RouterLink : 'div'"
    :to="to || undefined"
    class="block bg-gray-800 rounded-lg border border-gray-700 p-4 transition-colors"
    :class="to ? 'hover:bg-gray-700 hover:border-gray-600' : ''"
  >
    <div class="flex items-center gap-3">
      <span class="text-2xl" :class="colorClass">{{ icon }}</span>
      <div>
        <div class="text-sm text-gray-400">{{ title }}</div>
        <div class="text-2xl font-bold">{{ value }}</div>
      </div>
    </div>
  </component>
</template>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';

const props = defineProps({
  title: String,
  value: [Number, String],
  icon: String,
  color: { type: String, default: 'blue' },
  to: { type: String, default: '' },
});

const colorClass = computed(() => ({
  blue: 'text-blue-400',
  green: 'text-green-400',
  purple: 'text-purple-400',
  orange: 'text-orange-400',
  cyan: 'text-cyan-400',
  rose: 'text-rose-400',
}[props.color] || 'text-blue-400'));
</script>
