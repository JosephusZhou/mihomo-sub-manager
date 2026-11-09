<template>
  <div>
    <div class="flex justify-between items-start mb-6">
      <div>
        <h2 class="text-2xl font-bold">链式代理</h2>
        <p class="text-sm text-gray-400 mt-1">
          本机 → 前置私人节点 → HTTP/SOCKS5 代理。导入后参与配置档案与订阅，统一在本页管理。
        </p>
      </div>
      <div class="text-xs text-gray-500 text-right leading-relaxed">
        <div>单次上限 {{ LIMIT }} 条</div>
        <div>每行一个代理</div>
      </div>
    </div>

    <div class="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6">
      <h3 class="text-lg font-semibold mb-1">批量导入</h3>
      <p class="text-xs text-gray-500 mb-4">
        前置节点必须是普通私人节点，链式代理本身不能再作为前置。
      </p>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div>
          <label class="block text-sm text-gray-400 mb-1">前置节点</label>
          <select
            v-model="preProxyId"
            class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500"
          >
            <option :value="0" disabled>请选择普通私人节点</option>
            <option v-for="p in preNodeOptions" :key="p.id" :value="p.id">
              {{ p.name }} · {{ p.type.toUpperCase() }} {{ p.server }}:{{ p.port }}
            </option>
          </select>
          <p v-if="proxyStore.loading" class="text-xs text-gray-500 mt-1">节点加载中...</p>
          <p v-else-if="preNodeOptions.length === 0" class="text-xs text-red-400 mt-1">
            暂无可用节点，请先到「代理节点」添加。
          </p>
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">未指定协议时的类型</label>
          <select
            v-model="defaultType"
            class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500"
          >
            <option value="http">HTTP</option>
            <option value="socks5">SOCKS5</option>
          </select>
        </div>
        <div>
          <label class="block text-sm text-gray-400 mb-1">名称前缀（可选）</label>
          <input
            v-model="label"
            maxlength="16"
            class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:border-primary-500"
            placeholder="链式"
          />
        </div>
      </div>

      <div class="flex items-center justify-between mb-2">
        <label class="block text-sm text-gray-400">代理列表</label>
        <div class="flex gap-2">
          <button
            type="button"
            @click="triggerFile"
            class="bg-gray-700 hover:bg-gray-600 px-3 py-1 text-xs rounded transition-colors"
          >
            上传 txt
          </button>
          <button
            type="button"
            @click="clearText"
            :disabled="!text"
            class="bg-gray-700 hover:bg-gray-600 px-3 py-1 text-xs rounded transition-colors disabled:opacity-50"
          >
            清空
          </button>
          <input
            ref="fileInput"
            type="file"
            accept=".txt,text/plain"
            class="hidden"
            @change="handleFile"
          />
        </div>
      </div>
      <textarea
        v-model="text"
        rows="10"
        spellcheck="false"
        class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary-500"
        placeholder="host:port&#10;user:pass@host:port&#10;host:port:user:pass&#10;socks5://user:pass@host:port"
      ></textarea>
      <p class="text-xs text-gray-500 mt-2">
        支持 host:port、user:pass@host:port、host:port:user:pass，以及 http://、https://、socks5://、socks5h:// 前缀；带前缀时以前缀为准。
        空行与 # 开头的行会被忽略。
      </p>

      <div class="flex gap-3 mt-4">
        <button
          type="button"
          @click="handlePreview"
          :disabled="previewing || !canPreview"
          class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm transition-colors disabled:opacity-50"
        >
          {{ previewing ? '解析中...' : '解析预览' }}
        </button>
        <button
          type="button"
          @click="handleImport"
          :disabled="importing || !canImport"
          class="bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded text-sm transition-colors disabled:opacity-50"
        >
          {{ importing ? '导入中...' : `确认导入${preview ? ` (${preview.valid_count})` : ''}` }}
        </button>
      </div>

      <div v-if="previewError" class="mt-4 p-3 bg-red-900/50 border border-red-700 rounded text-red-300 text-sm">
        {{ previewError }}
      </div>
    </div>

    <div v-if="preview" class="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4">
        <h3 class="text-lg font-semibold">解析结果</h3>
        <span class="text-xs text-gray-400">共 {{ preview.total_lines }} 行</span>
        <span class="text-xs text-green-400">有效 {{ preview.valid_count }}</span>
        <span class="text-xs text-red-400">无效 {{ preview.invalid.length }}</span>
        <span class="text-xs text-yellow-400">重复 {{ preview.duplicates.length }}</span>
        <span class="text-xs text-gray-500">上限 {{ preview.limit }}</span>
      </div>

      <div v-if="preview.valid.length" class="overflow-auto max-h-80 border border-gray-700 rounded">
        <table class="w-full text-sm">
          <thead class="bg-gray-900 text-gray-400">
            <tr>
              <th class="text-left px-3 py-2 font-normal">行号</th>
              <th class="text-left px-3 py-2 font-normal">名称</th>
              <th class="text-left px-3 py-2 font-normal">类型</th>
              <th class="text-left px-3 py-2 font-normal">地址</th>
              <th class="text-left px-3 py-2 font-normal">认证</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in preview.valid" :key="`${item.line}-${item.server}-${item.port}`" class="border-t border-gray-700">
              <td class="px-3 py-2 text-gray-500">{{ item.line }}</td>
              <td class="px-3 py-2">{{ item.name }}</td>
              <td class="px-3 py-2">{{ item.type.toUpperCase() }}{{ item.tls ? ' (TLS)' : '' }}</td>
              <td class="px-3 py-2 font-mono">{{ item.server }}:{{ item.port }}</td>
              <td class="px-3 py-2 text-gray-400">
                {{ item.username ? `${item.username}:${item.password || ''}` : '无' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="preview.invalid.length" class="mt-4">
        <h4 class="text-sm font-semibold text-red-400 mb-2">无效行</h4>
        <div class="space-y-1 max-h-48 overflow-auto">
          <div
            v-for="item in preview.invalid"
            :key="`invalid-${item.line}`"
            class="text-xs bg-red-900/30 border border-red-800 rounded px-3 py-2"
          >
            <span class="text-red-300">第 {{ item.line }} 行</span>
            <span class="text-gray-400 ml-2 font-mono break-all">{{ item.raw }}</span>
            <span class="text-red-300 ml-2">{{ item.reason }}</span>
          </div>
        </div>
      </div>

      <div v-if="preview.duplicates.length" class="mt-4">
        <h4 class="text-sm font-semibold text-yellow-400 mb-2">重复行（不会导入）</h4>
        <div class="space-y-1 max-h-48 overflow-auto">
          <div
            v-for="item in preview.duplicates"
            :key="`duplicate-${item.line}`"
            class="text-xs bg-yellow-900/20 border border-yellow-800 rounded px-3 py-2"
          >
            <span class="text-yellow-300">第 {{ item.line }} 行</span>
            <span class="text-gray-400 ml-2 font-mono break-all">{{ item.raw }}</span>
            <span class="text-yellow-300 ml-2">{{ item.reason }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="flex justify-between items-center mb-3">
      <h3 class="text-lg font-semibold">已有链式代理</h3>
      <span class="text-xs text-gray-500">{{ chainedStore.chainedProxies.length }} 条</span>
    </div>

    <div v-if="chainedStore.chainedProxies.length" class="flex flex-wrap items-center gap-3 mb-4">
      <label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
        <input
          type="checkbox"
          class="accent-primary-500"
          :checked="allSelected"
          :indeterminate="someSelected"
          @change="toggleAll"
        />
        全选
      </label>
      <span class="text-xs text-gray-500">已选 {{ selectedIds.length }} 项</span>
      <button
        type="button"
        @click="handleBatchDelete"
        :disabled="!selectedIds.length || deleting"
        class="px-3 py-1 text-xs bg-red-700 hover:bg-red-600 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {{ deleting ? '删除中...' : `批量删除 (${selectedIds.length})` }}
      </button>
    </div>

    <div v-if="chainedStore.loading" class="text-center py-12 text-gray-400">加载中...</div>
    <div v-else-if="chainedStore.chainedProxies.length === 0" class="text-center py-12 text-gray-400">
      暂无链式代理，先在上方导入
    </div>
    <div v-else class="space-y-3">
      <div
        v-for="item in chainedStore.chainedProxies"
        :key="item.id"
        class="bg-gray-800 rounded-lg border border-gray-700 p-4 flex items-center justify-between"
      >
        <div class="flex items-center gap-3">
          <input
            type="checkbox"
            class="accent-primary-500"
            :checked="selectedIds.includes(item.id)"
            @change="toggleOne(item.id)"
          />
          <div>
            <div class="font-medium">{{ item.name }}</div>
            <div class="text-sm text-gray-400">
              {{ item.type.toUpperCase() }} &middot; {{ item.server }}:{{ item.port }}
            </div>
            <div class="text-xs text-gray-500 mt-1">前置节点：{{ item.dialer_proxy }}</div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="openPreview(item)"
            class="px-3 py-1 text-xs bg-blue-700 hover:bg-blue-600 rounded transition-colors"
          >
            预览
          </button>
          <button
            @click="handleDelete(item)"
            :disabled="deleting"
            class="px-3 py-1 text-xs bg-red-700 hover:bg-red-600 rounded transition-colors disabled:opacity-50"
          >
            删除
          </button>
        </div>
      </div>
    </div>

    <!-- 预览节点 Modal（与「代理节点」页共用） -->
    <ProxyPreviewModal :proxy="previewProxy" @close="previewProxy = null" />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useChainedProxyStore } from '@/stores/chainedProxies';
import { useProxyStore } from '@/stores/proxies';
import ProxyPreviewModal from '@/components/proxy/ProxyPreviewModal.vue';
import { toast, errorMessage } from '@/utils/toast';

const LIMIT = 200;
const MAX_FILE_BYTES = 256 * 1024;

const chainedStore = useChainedProxyStore();
const proxyStore = useProxyStore();

const preProxyId = ref(0);
const defaultType = ref('http');
const label = ref('');
const text = ref('');
const fileInput = ref(null);

const preview = ref(null);
const previewError = ref('');
const previewProxy = ref(null);
const previewing = ref(false);
const importing = ref(false);
const deleting = ref(false);
const selectedIds = ref([]);

const allSelected = computed(() => {
  const total = chainedStore.chainedProxies.length;
  return total > 0 && selectedIds.value.length === total;
});
const someSelected = computed(() => selectedIds.value.length > 0 && !allSelected.value);

function toggleAll() {
  selectedIds.value = allSelected.value ? [] : chainedStore.chainedProxies.map(p => p.id);
}

function toggleOne(id) {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter(x => x !== id)
    : [...selectedIds.value, id];
}

function openPreview(item) {
  previewProxy.value = item;
}

// 列表刷新后剔除已经不存在的选中项，避免计数与实际不一致。
watch(() => chainedStore.chainedProxies, (list) => {
  const valid = new Set(list.map(p => p.id));
  selectedIds.value = selectedIds.value.filter(id => valid.has(id));
});

// 链式代理自身也可以出现在节点列表中，但不能再作为前置节点。
const preNodeOptions = computed(() => {
  return (proxyStore.proxies || []).filter(p => !p.dialer_proxy);
});

const canPreview = computed(() => preProxyId.value > 0 && text.value.trim().length > 0);
const canImport = computed(() => !!preview.value && preview.value.valid_count > 0 && !importing.value);

// 输入变化后旧预览不再可信，强制重新解析，避免导入与预览不一致。
watch([text, preProxyId, defaultType, label], () => {
  preview.value = null;
  previewError.value = '';
});

function buildPayload() {
  return {
    pre_proxy_id: preProxyId.value,
    text: text.value,
    default_type: defaultType.value,
    label: label.value.trim(),
  };
}

function triggerFile() {
  fileInput.value?.click();
}

async function handleFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    toast.error(`文件过大，单次最多 ${MAX_FILE_BYTES / 1024} KB`);
    return;
  }
  try {
    text.value = await file.text();
    toast.success(`已读取 ${file.name}`);
  } catch {
    toast.error('读取文件失败');
  }
}

function clearText() {
  text.value = '';
  preview.value = null;
  previewError.value = '';
}

async function handlePreview() {
  previewError.value = '';
  previewing.value = true;
  try {
    const data = await chainedStore.preview(buildPayload());
    preview.value = data;
    if (!data.valid_count) {
      toast.info('没有可导入的有效代理');
    } else if (data.invalid.length || data.duplicates.length) {
      toast.info(`解析完成：有效 ${data.valid_count} 条，无效 ${data.invalid.length} 条，重复 ${data.duplicates.length} 条`);
    } else {
      toast.success(`解析完成：${data.valid_count} 条可导入`);
    }
  } catch (e) {
    preview.value = null;
    previewError.value = errorMessage(e, '解析失败');
    toast.error(previewError.value);
  } finally {
    previewing.value = false;
  }
}

async function handleImport() {
  previewError.value = '';
  importing.value = true;
  try {
    const data = await chainedStore.importBatch(buildPayload());
    text.value = '';
    preview.value = null;
    toast.success(`已导入 ${data.created_count} 条链式代理`);
    if ((data.invalid && data.invalid.length) || (data.duplicates && data.duplicates.length)) {
      toast.info(`已跳过无效 ${data.invalid?.length || 0} 条、重复 ${data.duplicates?.length || 0} 条`);
    }
  } catch (e) {
    previewError.value = errorMessage(e, '导入失败');
    toast.error(previewError.value);
  } finally {
    importing.value = false;
  }
}

async function handleDelete(item) {
  if (!confirm(`确定删除链式代理「${item.name}」？`)) return;
  try {
    await chainedStore.remove(item.id);
    selectedIds.value = selectedIds.value.filter(id => id !== item.id);
    toast.success('链式代理已删除');
  } catch (e) {
    toast.error(errorMessage(e, '删除失败'));
  }
}

async function handleBatchDelete() {
  if (!selectedIds.value.length) return;
  if (!confirm(`确定删除选中的 ${selectedIds.value.length} 个链式代理？`)) return;

  deleting.value = true;
  const ids = [...selectedIds.value];
  try {
    const results = await chainedStore.removeMany(ids);
    const ok = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.length - ok;
    if (failed) {
      toast.error(`批量删除完成：成功 ${ok} 项，失败 ${failed} 项`);
    } else {
      toast.success(`已删除 ${ok} 项链式代理`);
    }
    selectedIds.value = [];
  } catch (e) {
    toast.error(errorMessage(e, '批量删除失败'));
  } finally {
    deleting.value = false;
  }
}

onMounted(() => {
  proxyStore.fetchAll().catch(e => toast.error(errorMessage(e, '加载节点失败')));
  chainedStore.fetchAll().catch(e => toast.error(errorMessage(e, '加载链式代理失败')));
});
</script>
