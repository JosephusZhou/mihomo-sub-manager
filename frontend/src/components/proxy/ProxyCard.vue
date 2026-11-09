<template>
  <div class="bg-gray-800 rounded-lg border border-gray-700 p-4 flex items-center justify-between">
    <div class="flex items-center gap-4">
      <div>
        <span class="font-medium">{{ proxy.name }}</span>
        <div class="text-sm text-gray-400">
          {{ proxy.type.toUpperCase() }} &middot; {{ proxy.server }}:{{ proxy.port }}
        </div>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <button @click="$emit('preview')" class="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 rounded transition-colors">
        预览
      </button>
      <button @click="$emit('edit')" class="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors">
        编辑
      </button>
      <button @click="$emit('delete', proxy.id)" class="px-3 py-1 text-xs bg-red-700 hover:bg-red-600 rounded transition-colors">
        删除
      </button>
    </div>
  </div>
</template>

<script setup>
defineProps({ proxy: Object });
defineEmits(['edit', 'delete', 'preview']);
</script>
