<template>
  <div>
    <div class="flex justify-between items-center mb-6">
      <h2 class="text-2xl font-bold">代理节点</h2>
      <button @click="showAddModal = true" class="bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded text-sm transition-colors">
        + 添加节点
      </button>
    </div>

    <div class="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6">
      <h3 class="text-lg font-semibold mb-4">订阅地址</h3>
      <div class="space-y-4">
        <div>
          <label class="text-sm text-gray-400 block mb-1">私人代理订阅</label>
          <div class="flex gap-2">
            <input
              :value="subscribeUrl"
              readonly
              class="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-300 font-mono"
            />
            <button @click="copy(subscribeUrl)" class="px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm transition-colors">
              复制
            </button>
          </div>
        </div>
        <div v-if="auth.apiToken">
          <label class="text-sm text-gray-400 block mb-1">Token</label>
          <div class="flex gap-2">
            <input
              :value="auth.apiToken"
              readonly
              class="flex-1 bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm text-gray-300 font-mono"
            />
            <button @click="regenerateToken" class="px-3 py-2 bg-red-700 hover:bg-red-600 rounded text-sm transition-colors">
              重置
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="store.loading" class="text-center py-12 text-gray-400">加载中...</div>
    <div v-else-if="customProxies.length === 0" class="text-center py-12 text-gray-400">
      暂无自定义节点，点击上方按钮添加
    </div>
    <div v-else class="space-y-3">
      <ProxyCard
        v-for="proxy in customProxies"
        :key="proxy.id"
        :proxy="proxy"
        @edit="startEdit(proxy)"
        @delete="handleDelete"
        @preview="openPreview(proxy)"
      />
    </div>

    <!-- 添加节点 Modal -->
    <Modal :show="showAddModal" title="添加节点" size="lg" @close="showAddModal = false">
      <ProxyForm @save="handleCreate" @save-multiple="handleCreateMultiple" @cancel="showAddModal = false" />
    </Modal>

    <!-- 编辑节点 Modal -->
    <Modal :show="!!editingProxy" title="编辑节点" size="lg" @close="editingProxy = null">
      <ProxyForm
        v-if="editingProxy"
        :proxy="editingProxy"
        @save="handleUpdate"
        @cancel="editingProxy = null"
      />
    </Modal>

    <!-- 预览节点 Modal（与「链式代理」页共用） -->
    <ProxyPreviewModal :proxy="previewProxy" @close="previewProxy = null" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useProxyStore } from '@/stores/proxies';
import ProxyForm from '@/components/proxy/ProxyForm.vue';
import ProxyCard from '@/components/proxy/ProxyCard.vue';
import ProxyPreviewModal from '@/components/proxy/ProxyPreviewModal.vue';
import Modal from '@/components/Modal.vue';
import { toast, copyText, errorMessage } from '@/utils/toast';
import { API_BASE_URL } from '@/config';
import { isChainedProxy } from '@/utils/proxyConfig';

const auth = useAuthStore();
const store = useProxyStore();
const showAddModal = ref(false);
const editingProxy = ref(null);
const previewProxy = ref(null);

const subscribeUrl = computed(() => `${API_BASE_URL}/subscribes?token=${auth.apiToken}`);

// 本页只展示自定义节点；链式节点由「链式代理」页管理。
const customProxies = computed(() => store.proxies.filter(p => !isChainedProxy(p)));

function copy(text) {
  copyText(text, '订阅地址已复制');
}

async function regenerateToken() {
  if (!confirm('确定要重新生成 Token 吗？旧的订阅地址将失效。')) return;
  try {
    await auth.regenerateApiToken();
    toast.success('Token 已重置，请更新已使用的订阅地址');
  } catch (e) {
    toast.error(errorMessage(e, '重置 Token 失败'));
  }
}

function startEdit(proxy) {
  editingProxy.value = JSON.parse(JSON.stringify(proxy));
  showAddModal.value = false;
}

function openPreview(proxy) {
  previewProxy.value = proxy;
}

async function handleCreate(data) {
  try {
    await store.create(data);
    showAddModal.value = false;
    toast.success('节点已添加');
  } catch (e) {
    toast.error(errorMessage(e, '添加节点失败'));
  }
}

async function handleCreateMultiple(dataArray) {
  let success = 0;
  let failed = 0;
  for (const data of dataArray) {
    try {
      await store.create(data);
      success += 1;
    } catch (e) {
      failed += 1;
      console.error('Failed to create proxy:', data.name, e);
    }
  }
  showAddModal.value = false;
  await store.fetchAll();
  if (failed === 0) {
    toast.success(`已添加 ${success} 个节点`);
  } else {
    toast.error(`添加完成：成功 ${success} 个，失败 ${failed} 个`);
  }
}

async function handleUpdate(data) {
  try {
    await store.update(editingProxy.value.id, data);
    editingProxy.value = null;
    toast.success('节点已保存');
  } catch (e) {
    toast.error(errorMessage(e, '保存节点失败'));
  }
}

async function handleDelete(id) {
  if (!confirm('确定删除此节点？')) return;
  try {
    await store.remove(id);
    toast.success('节点已删除');
  } catch (e) {
    toast.error(errorMessage(e, '删除节点失败'));
  }
}

// 直接访问/刷新 /proxies 时 store 是空的，必须自行拉取；
// 失败时提示而不是静默显示「暂无自定义节点」。
onMounted(() => {
  store.fetchAll().catch(e => toast.error(errorMessage(e, '加载节点失败')));
});
</script>
