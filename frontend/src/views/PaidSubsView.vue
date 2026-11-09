<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold">付费订阅</h2>
      <button @click="showForm = !showForm" class="bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded text-sm transition-colors">
        + 添加订阅
      </button>
    </div>

    <div v-if="showForm" class="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6">
      <h3 class="text-lg font-semibold mb-4">添加付费订阅</h3>
      <form @submit.prevent="handleCreate">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">名称</label>
            <input v-model="form.name" required class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" placeholder="如 机场A" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">源订阅地址</label>
            <input v-model="form.url" type="url" required class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" placeholder="https://..." />
            <p class="text-xs text-gray-500 mt-1">仅保存在后端，对外只展示包装后的地址。</p>
          </div>
        </div>
        <div class="flex gap-3">
          <button type="submit" :disabled="saving" class="bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded text-sm transition-colors disabled:opacity-50">
            {{ saving ? '添加中...' : '添加' }}
          </button>
          <button type="button" @click="showForm = false" class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm transition-colors">取消</button>
        </div>
      </form>
    </div>

    <div v-if="store.loading" class="text-center py-12 text-gray-400">加载中...</div>
    <div v-else-if="store.subscriptions.length === 0" class="text-center py-12 text-gray-400">
      暂无付费订阅
    </div>
    <div v-else class="space-y-3">
      <div
        v-for="sub in store.subscriptions"
        :key="sub.id"
        class="bg-gray-800 rounded-lg border border-gray-700 p-4 flex items-start justify-between gap-4"
      >
        <div class="flex items-start gap-4 min-w-0">
          <div class="min-w-0">
            <div class="font-medium">{{ sub.name }}</div>
            <div class="text-sm text-gray-400 font-mono break-all">{{ sub.wrapper_url }}</div>
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button @click="copyWrapper(sub)" class="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors">复制地址</button>
          <button @click="startEdit(sub)" class="px-3 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors">编辑</button>
          <button @click="handleDelete(sub.id)" class="px-3 py-1 text-xs bg-red-700 hover:bg-red-600 rounded transition-colors">删除</button>
        </div>
      </div>
    </div>

    <div v-if="editingSub" class="bg-gray-800 rounded-lg border border-gray-700 p-6 mt-6">
      <h3 class="text-lg font-semibold mb-4">编辑订阅</h3>
      <form @submit.prevent="handleUpdate">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label class="block text-sm text-gray-400 mb-1">名称</label>
            <input v-model="editingSub.name" required class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
          </div>
          <div>
            <label class="block text-sm text-gray-400 mb-1">源订阅地址</label>
            <input v-model="editingSub.url" type="url" required class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500" />
            <p class="text-xs text-gray-500 mt-1">仅保存在后端，对外只展示包装后的地址。</p>
          </div>
        </div>
        <div class="mb-4">
          <label class="block text-sm text-gray-400 mb-1">包装地址</label>
          <div class="flex items-center gap-2">
            <input :value="editingSub.wrapper_url" readonly class="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-400 font-mono" />
            <button type="button" @click="copyWrapper(editingSub)" class="px-3 py-2 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors">复制</button>
          </div>
        </div>
        <div class="flex gap-3">
          <button type="submit" :disabled="saving" class="bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded text-sm transition-colors disabled:opacity-50">
            {{ saving ? '保存中...' : '保存' }}
          </button>
          <button type="button" @click="editingSub = null" class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm transition-colors">取消</button>
        </div>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue';
import { usePaidSubStore } from '@/stores/paidSubs';
import { toast, copyText, errorMessage } from '@/utils/toast';

const store = usePaidSubStore();
const showForm = ref(false);
const editingSub = ref(null);
const saving = ref(false);
const form = reactive({ name: '', url: '' });

onMounted(() => {
  store.fetchAll().catch(e => toast.error(errorMessage(e, '加载订阅失败')));
});

async function startEdit(sub) {
  showForm.value = false;
  try {
    editingSub.value = await store.get(sub.id);
  } catch (e) {
    toast.error(errorMessage(e, '读取订阅失败'));
  }
}

function copyWrapper(sub) {
  copyText(sub.wrapper_url, '包装地址已复制');
}

async function handleCreate() {
  saving.value = true;
  try {
    await store.create({ ...form });
    form.name = '';
    form.url = '';
    showForm.value = false;
    toast.success('订阅已添加，包装地址已生成');
  } catch (e) {
    toast.error(errorMessage(e, '添加订阅失败'));
  } finally {
    saving.value = false;
  }
}

async function handleUpdate() {
  saving.value = true;
  try {
    const updated = await store.update(editingSub.value.id, {
      name: editingSub.value.name,
      url: editingSub.value.url,
    });
    editingSub.value = null;
    toast.success('订阅已保存');
    return updated;
  } catch (e) {
    toast.error(errorMessage(e, '保存订阅失败'));
  } finally {
    saving.value = false;
  }
}

async function handleDelete(id) {
  if (!confirm('确定删除此订阅？删除后包装地址会同步失效。')) return;
  try {
    await store.remove(id);
    if (editingSub.value && editingSub.value.id === id) editingSub.value = null;
    toast.success('订阅已删除');
  } catch (e) {
    toast.error(errorMessage(e, '删除订阅失败'));
  }
}
</script>
