<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold">配置档案</h2>
      <router-link to="/profiles/new" class="bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded text-sm transition-colors">
        + 新建档案
      </router-link>
    </div>

    <div v-if="store.loading" class="text-center py-12 text-gray-400">加载中...</div>
    <div v-else-if="store.profiles.length === 0" class="text-center py-12 text-gray-400">
      暂无配置档案，点击上方按钮创建
    </div>
    <div v-else class="space-y-4">
      <div
        v-for="p in store.profiles"
        :key="p.id"
        class="bg-gray-800 rounded-lg border border-gray-700 p-5"
      >
        <div class="flex items-start justify-between mb-3">
          <div>
            <h3 class="font-semibold text-lg">{{ p.name }}</h3>
            <div class="flex gap-2 mt-1 flex-wrap">
              <span class="text-xs px-2 py-0.5 rounded bg-gray-700 text-gray-300">
                {{ p.template?.name || '未知模板' }}
              </span>
              <span class="text-xs px-2 py-0.5 rounded" :class="p.enabled ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'">
                {{ p.enabled ? '启用' : '禁用' }}
              </span>
            </div>
          </div>
          <div class="flex gap-1">
            <button @click="previewConfig(p.id)" class="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors">预览</button>
            <router-link :to="`/profiles/${p.id}/edit`" class="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors">编辑</router-link>
            <button @click="copyProfileUrl(p)" class="px-2 py-1 text-xs bg-primary-700 hover:bg-primary-600 rounded transition-colors">复制URL</button>
            <div class="relative">
              <button @click="toggleQr(p)" class="px-2 py-1 text-xs bg-primary-700 hover:bg-primary-600 rounded transition-colors">二维码</button>
              <template v-if="qrProfileId === p.id">
                <div class="fixed inset-0 z-40" @click="qrProfileId = null"></div>
                <div class="absolute right-0 top-full mt-2 z-50 bg-gray-800 border border-gray-600 rounded-lg p-3 shadow-xl">
                  <div class="bg-white rounded p-2 w-40 h-40 [&>svg]:w-full [&>svg]:h-full" v-html="qrSvg"></div>
                  <p class="text-[10px] text-gray-400 mt-2 max-w-[160px] break-all">{{ getProfileUrl(p) }}</p>
                </div>
              </template>
            </div>
            <button @click="handleDelete(p.id)" class="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 rounded transition-colors">删除</button>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span class="text-gray-400">私人订阅:</span>
            <span class="ml-2" :class="p.include_private_sub ? 'text-green-400' : 'text-gray-500'">
              {{ p.include_private_sub ? '已包含' : '未包含' }}
            </span>
          </div>
          <div>
            <span class="text-gray-400">付费订阅:</span>
            <span class="ml-2">{{ p.paid_subscriptions?.length || 0 }} 个</span>
          </div>
        </div>

        <div class="mt-3 pt-3 border-t border-gray-700">
          <div class="text-xs text-gray-400 font-mono break-all">
            {{ getProfileUrl(p) }}
          </div>
        </div>
      </div>
    </div>

    <div v-if="previewYaml !== null" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" @click.self="previewYaml = null">
      <div class="bg-gray-800 rounded-lg border border-gray-700 w-full max-w-4xl max-h-[80vh] flex flex-col">
        <div class="flex items-center justify-between p-4 border-b border-gray-700">
          <h3 class="font-semibold">配置预览</h3>
          <div class="flex gap-2">
            <button @click="copyPreview" class="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded">复制</button>
            <button @click="previewYaml = null" class="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded">关闭</button>
          </div>
        </div>
        <pre class="flex-1 overflow-auto p-4 text-xs font-mono text-gray-300 leading-relaxed">{{ previewYaml }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { renderSVG } from 'uqr';
import { useProfileStore } from '@/stores/profiles';
import { API_BASE_URL } from '@/config';
import { toast, copyText, errorMessage } from '@/utils/toast';

const store = useProfileStore();
const previewYaml = ref(null);
const qrProfileId = ref(null);

const qrSvg = computed(() => {
  const profile = store.profiles.find(p => p.id === qrProfileId.value);
  if (!profile) return '';
  return renderSVG(getProfileUrl(profile), { border: 2, ecc: 'M' });
});

onMounted(() => {
  store.fetchAll().catch(e => toast.error(errorMessage(e, '加载档案失败')));
});

function getProfileUrl(profile) {
  return `${API_BASE_URL}/profiles?token=${profile.profile_token}`;
}

function copyProfileUrl(profile) {
  copyText(getProfileUrl(profile), '订阅地址已复制');
}

function toggleQr(profile) {
  qrProfileId.value = qrProfileId.value === profile.id ? null : profile.id;
}

async function previewConfig(id) {
  try {
    previewYaml.value = await store.previewConfig(id);
  } catch (e) {
    toast.error(errorMessage(e, '预览失败'));
  }
}

function copyPreview() {
  copyText(previewYaml.value, '配置已复制');
}

async function handleDelete(id) {
  if (!confirm('确定删除此档案？')) return;
  try {
    await store.remove(id);
    if (qrProfileId.value === id) qrProfileId.value = null;
    toast.success('档案已删除');
  } catch (e) {
    toast.error(errorMessage(e, '删除档案失败'));
  }
}
</script>
