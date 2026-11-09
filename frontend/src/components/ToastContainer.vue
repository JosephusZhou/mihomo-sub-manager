<template>
  <Teleport to="body">
    <div class="fixed top-4 right-4 z-[100] flex flex-col gap-2 w-full max-w-xs pointer-events-none">
      <div
        v-for="item in toastState.items"
        :key="item.id"
        class="pointer-events-auto rounded-lg border px-4 py-3 text-sm shadow-lg flex items-start gap-2"
        :class="styles[item.type]"
      >
        <span class="flex-1 break-words">{{ item.message }}</span>
        <button class="text-current opacity-60 hover:opacity-100 transition-opacity" @click="dismissToast(item.id)">×</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { toastState, dismissToast } from '@/utils/toast';

const styles = {
  success: 'bg-green-900/90 border-green-700 text-green-200',
  error: 'bg-red-900/90 border-red-700 text-red-200',
  info: 'bg-gray-800/95 border-gray-600 text-gray-200',
};
</script>
