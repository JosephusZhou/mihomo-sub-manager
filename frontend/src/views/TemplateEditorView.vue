<template>
  <div>
    <div class="flex items-center gap-4 mb-6">
      <router-link to="/templates" class="text-gray-400 hover:text-gray-200">&larr; 返回</router-link>
      <h2 class="text-2xl font-bold">{{ isEdit ? '编辑模板' : '新建模板' }}</h2>
    </div>

    <div v-if="loading" class="text-center py-12 text-gray-400">加载中...</div>

    <form v-else @submit.prevent="handleSubmit" class="space-y-6">
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 class="text-lg font-semibold mb-4">基本信息</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">模板名称</label>
            <input v-model="form.name" required class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" placeholder="如 My Fake-IP Template" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">DNS 模式</label>
            <select v-model="form.dns_mode" class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500">
              <option value="fake-ip">Fake-IP</option>
              <option value="real-ip">Real-IP (redir-host)</option>
            </select>
          </div>
        </div>
        <div class="mt-4">
          <label class="flex items-center gap-2 cursor-pointer">
            <input v-model="form.ad_blocking" type="checkbox" class="accent-primary-500" />
            <span class="text-sm">启用广告过滤</span>
          </label>
        </div>
      </div>

      <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 class="text-lg font-semibold mb-4">地区选择</h3>
        <p class="text-sm text-gray-400 mb-3">不选则包含全部 10 个地区分类</p>
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
          <label
            v-for="region in allRegions"
            :key="region"
            class="flex items-center gap-2 p-2 rounded cursor-pointer hover:bg-gray-700/50"
          >
            <input
              type="checkbox"
              :value="region"
              v-model="form.regions"
              class="accent-primary-500"
            />
            <span class="text-sm">{{ region }}</span>
          </label>
        </div>
      </div>

      <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 class="text-lg font-semibold mb-4">自定义规则</h3>
        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="form.include_custom_rules" type="checkbox" class="accent-primary-500" />
          <span class="text-sm">加入自定义规则</span>
        </label>
        <p class="text-sm text-gray-400 mt-2">规则在「自定义规则」页面统一维护，勾选后应用到该模板生成的配置。</p>
      </div>

      <div class="flex gap-3">
        <button type="submit" :disabled="saving" class="bg-primary-600 hover:bg-primary-700 px-6 py-2 rounded text-sm transition-colors disabled:opacity-50">
          {{ saving ? '保存中...' : (isEdit ? '保存' : '创建') }}
        </button>
        <router-link to="/templates" class="bg-gray-700 hover:bg-gray-600 px-6 py-2 rounded text-sm transition-colors">取消</router-link>
      </div>
    </form>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useTemplateStore } from '@/stores/templates';
import api from '@/api/client';
import { toast, errorMessage } from '@/utils/toast';

const route = useRoute();
const router = useRouter();
const store = useTemplateStore();

const isEdit = computed(() => !!route.params.id);
const loading = ref(false);
const saving = ref(false);

const allRegions = [
  '香港', '台湾', '韩国', '日本', '新加坡',
  '美国', '亚洲其他', '美洲其他', '欧洲', '其他',
];

const form = reactive({
  name: '',
  dns_mode: 'fake-ip',
  ad_blocking: true,
  regions: [],
  include_custom_rules: true,
});

onMounted(async () => {
  if (isEdit.value) {
    loading.value = true;
    try {
      const { data } = await api.get(`/templates/${route.params.id}`);
      const t = data.template;
      form.name = t.name;
      form.dns_mode = t.dns_mode;
      form.ad_blocking = !!t.ad_blocking;
      form.regions = [...t.regions];
      form.include_custom_rules = t.include_custom_rules !== 0;
    } catch (e) {
      toast.error(errorMessage(e, '加载模板失败'));
    } finally {
      loading.value = false;
    }
  }
});

async function handleSubmit() {
  saving.value = true;
  try {
    const payload = {
      name: form.name,
      dns_mode: form.dns_mode,
      ad_blocking: form.ad_blocking,
      regions: form.regions,
      include_custom_rules: form.include_custom_rules,
    };

    if (isEdit.value) {
      await store.update(Number(route.params.id), payload);
      toast.success('模板已保存');
    } else {
      await store.create(payload);
      toast.success('模板已创建');
    }
    router.push('/templates');
  } catch (e) {
    toast.error(errorMessage(e, '保存失败'));
  } finally {
    saving.value = false;
  }
}
</script>
