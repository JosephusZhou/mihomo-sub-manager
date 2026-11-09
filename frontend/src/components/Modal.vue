<template>
  <Teleport to="body">
    <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="$emit('close')">
      <div class="absolute inset-0 bg-black/60"></div>
      <div class="relative bg-gray-800 rounded-lg border border-gray-700 w-full shadow-2xl flex flex-col max-h-[80vh]" :class="sizeClass">
        <div class="flex items-center justify-between p-4 border-b border-gray-700 shrink-0">
          <h3 class="font-semibold text-lg">{{ title }}</h3>
          <button @click="$emit('close')" class="text-gray-400 hover:text-gray-200 text-xl leading-none px-2">&times;</button>
        </div>
        <div class="flex-1 overflow-y-auto p-4">
          <slot />
        </div>
        <div v-if="$slots.footer" class="border-t border-gray-700 p-4 shrink-0">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  show: Boolean,
  title: String,
  size: { type: String, default: 'md' },
});

defineEmits(['close']);

const sizeClass = computed(() => ({
  sm: 'max-w-md',
  md: 'max-w-2xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
}[props.size] || 'max-w-2xl'));
</script>
