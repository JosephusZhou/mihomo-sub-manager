<template>
  <div>
    <div class="flex items-center gap-4 mb-6">
      <router-link to="/profiles" class="text-gray-400 hover:text-gray-200">&larr; 返回</router-link>
      <h2 class="text-2xl font-bold">{{ isEdit ? '编辑档案' : '新建档案' }}</h2>
    </div>

    <div v-if="loading" class="text-center py-12 text-gray-400">加载中...</div>

    <form v-else @submit.prevent="handleSubmit" class="space-y-6">
      <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 class="text-lg font-semibold mb-4">基本信息</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">档案名称</label>
            <input v-model="form.name" required class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" placeholder="如 手机配置" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">选择模板</label>
            <select v-model="form.template_id" required class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500">
              <option value="" disabled>请选择模板</option>
              <option v-for="t in templates" :key="t.id" :value="t.id">
                {{ t.name }} ({{ t.dns_mode }}{{ t.ad_blocking ? ', 去广告' : '' }})
              </option>
            </select>
          </div>
        </div>
      </div>

      <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 class="text-lg font-semibold mb-4">私人代理订阅</h3>
        <label class="flex items-center gap-3 p-3 rounded hover:bg-gray-700/50 cursor-pointer">
          <input type="checkbox" v-model="form.include_private_sub" class="accent-primary-500 w-4 h-4" />
          <div>
            <div class="text-sm font-medium">包含私人代理订阅</div>
            <div class="text-xs text-gray-400 mt-0.5">勾选后将包含你的全部私人代理节点</div>
          </div>
        </label>
      </div>

      <div class="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <h3 class="text-lg font-semibold mb-4">选择付费订阅</h3>
        <div v-if="paidSubs.length === 0" class="text-sm text-gray-400">暂无付费订阅</div>
        <div v-else class="space-y-2 max-h-64 overflow-y-auto">
          <label
            v-for="sub in paidSubs"
            :key="sub.id"
            class="flex items-center gap-3 p-2 rounded hover:bg-gray-700/50 cursor-pointer"
          >
            <input type="checkbox" :value="sub.id" v-model="form.paid_sub_ids" class="accent-primary-500" />
            <span class="text-sm font-medium">{{ sub.name }}</span>
            <span class="text-xs text-gray-400 font-mono truncate">{{ sub.wrapper_url }}</span>
          </label>
        </div>
      </div>

      <div v-if="previewYaml" class="bg-gray-800 rounded-lg border border-gray-700 p-6">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-lg font-semibold">配置预览</h3>
          <button type="button" @click="copyPreview" class="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded">复制</button>
        </div>
        <pre class="bg-gray-900 rounded p-4 text-xs font-mono text-gray-300 overflow-auto max-h-96 leading-relaxed">{{ previewYaml }}</pre>
      </div>

      <div class="flex gap-3">
        <button type="submit" :disabled="saving" class="bg-primary-600 hover:bg-primary-700 px-6 py-2 rounded text-sm transition-colors disabled:opacity-50">
          {{ saving ? '保存中...' : (isEdit ? '保存' : '创建') }}
        </button>
        <button type="button" @click="fetchPreview" class="bg-gray-700 hover:bg-gray-600 px-6 py-2 rounded text-sm transition-colors">
          预览配置
        </button>
        <router-link to="/profiles" class="bg-gray-700 hover:bg-gray-600 px-6 py-2 rounded text-sm transition-colors">取消</router-link>
      </div>
    </form>

    <div v-if="isEdit && profileData" class="bg-gray-800 rounded-lg border border-gray-700 p-6 mt-6">
      <h3 class="text-lg font-semibold mb-4">订阅地址</h3>
      <div class="flex gap-2">
        <input :value="profileUrl" readonly class="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-300 font-mono" />
        <button @click="copyUrl" class="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors">复制</button>
        <button @click="regenerateToken" class="px-3 py-2 bg-red-700 hover:bg-red-600 rounded text-sm transition-colors">重置Token</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useProfileStore } from '@/stores/profiles';
import { usePaidSubStore } from '@/stores/paidSubs';
import { useTemplateStore } from '@/stores/templates';
import { API_BASE_URL } from '@/config';
import { toast, copyText, errorMessage } from '@/utils/toast';

const route = useRoute();
const router = useRouter();
const profileStore = useProfileStore();
const paidSubStore = usePaidSubStore();
const templateStore = useTemplateStore();

const isEdit = computed(() => !!route.params.id);
const loading = ref(false);
const saving = ref(false);
const previewYaml = ref('');
const profileData = ref(null);

const form = reactive({
  name: '',
  template_id: '',
  include_private_sub: true,
  paid_sub_ids: [],
});

const paidSubs = computed(() => paidSubStore.subscriptions);
const templates = computed(() => templateStore.templates);

const profileUrl = computed(() => {
  if (!profileData.value) return '';
  return `${API_BASE_URL}/profiles?token=${profileData.value.profile_token}`;
});

onMounted(async () => {
  loading.value = true;
  try {
    await Promise.all([
      paidSubStore.fetchAll(),
      templateStore.fetchAll(),
    ]);

    if (isEdit.value) {
      const p = await profileStore.get(Number(route.params.id));
      profileData.value = p;
      form.name = p.name;
      form.template_id = p.template_id;
      form.include_private_sub = p.include_private_sub !== 0;
      form.paid_sub_ids = p.paid_subscriptions?.map(x => x.id) || [];
    }
  } catch (e) {
    toast.error(errorMessage(e, '加载档案失败'));
  } finally {
    loading.value = false;
  }
});

async function fetchPreview() {
  if (isEdit.value) {
    try {
      previewYaml.value = await profileStore.previewConfig(Number(route.params.id));
    } catch (e) {
      previewYaml.value = '# 预览失败: ' + errorMessage(e);
      toast.error(errorMessage(e, '预览失败'));
    }
  } else {
    previewYaml.value = '# 请先保存档案后再预览配置';
    toast.info('请先保存档案后再预览配置');
  }
}

function copyPreview() {
  copyText(previewYaml.value, '配置已复制');
}

function copyUrl() {
  copyText(profileUrl.value, '订阅地址已复制');
}

async function regenerateToken() {
  if (!confirm('确定要重新生成 Token 吗？')) return;
  try {
    const newToken = await profileStore.regenerateToken(profileData.value.id);
    profileData.value.profile_token = newToken;
    toast.success('Token 已重置，旧订阅地址立即失效');
  } catch (e) {
    toast.error(errorMessage(e, '重置 Token 失败'));
  }
}

async function handleSubmit() {
  saving.value = true;
  try {
    const payload = {
      name: form.name,
      template_id: Number(form.template_id),
      include_private_sub: form.include_private_sub,
      paid_sub_ids: form.paid_sub_ids,
    };

    if (isEdit.value) {
      const result = await profileStore.update(Number(route.params.id), payload);
      profileData.value = result;
      toast.success('档案已保存');
    } else {
      await profileStore.create(payload);
      toast.success('档案已创建');
      router.push('/profiles');
    }
  } catch (e) {
    toast.error(errorMessage(e, '保存失败'));
  } finally {
    saving.value = false;
  }
}
</script>
