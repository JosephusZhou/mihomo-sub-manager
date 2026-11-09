<template>
  <div>
    <div class="flex justify-between items-start mb-6">
      <div>
        <h2 class="text-2xl font-bold">自定义规则</h2>
        <p class="text-sm text-gray-400 mt-1">规则为当前账号共享，仅被勾选「加入自定义规则」的配置模板注入。</p>
      </div>
      <div class="flex gap-2">
        <button
          @click="resetText"
          :disabled="saving"
          class="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded text-sm transition-colors disabled:opacity-50"
        >
          恢复已保存
        </button>
        <button
          @click="handleSave"
          :disabled="saving"
          class="bg-primary-600 hover:bg-primary-700 px-6 py-2 rounded text-sm transition-colors disabled:opacity-50"
        >
          {{ saving ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>

    <div v-if="store.loading" class="text-center py-12 text-gray-400">加载中...</div>

    <div v-else class="bg-gray-800 rounded-lg border border-gray-700 p-6">
      <p class="text-xs text-gray-500 mb-3">
        每行一条，格式: TYPE,VALUE,GROUP（如 DOMAIN-SUFFIX,example.com,直连域名）。
        规则会插入到所有内置规则之前；自定义规则之间重复的条目会自动跳过，与内置规则重复时以自定义规则为准。
      </p>
      <textarea
        v-model="rulesText"
        rows="18"
        spellcheck="false"
        class="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-primary-500"
        placeholder="DOMAIN-SUFFIX,example.com,直连域名&#10;IP-CIDR,1.2.3.0/24,全球直连,no-resolve"
      ></textarea>
      <p class="text-xs text-gray-500 mt-2">共 {{ ruleCount }} 条</p>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useCustomRulesStore } from '@/stores/customRules';
import { toast, errorMessage } from '@/utils/toast';

const store = useCustomRulesStore();
const rulesText = ref('');
const saving = ref(false);

const ruleCount = computed(() => rulesText.value.split('\n').filter(line => line.trim()).length);

function fillText(rules) {
  rulesText.value = (rules || []).join('\n');
}

onMounted(async () => {
  try {
    const rules = await store.fetchAll();
    fillText(rules);
  } catch (e) {
    toast.error(errorMessage(e, '加载自定义规则失败'));
  }
});

function resetText() {
  fillText(store.rules);
  toast.info('已恢复为已保存内容');
}

async function handleSave() {
  const rules = rulesText.value.split('\n').map(s => s.trim()).filter(Boolean);
  saving.value = true;
  try {
    const saved = await store.save(rules);
    fillText(saved);
    toast.success('自定义规则已保存');
  } catch (e) {
    toast.error(errorMessage(e, '保存失败'));
  } finally {
    saving.value = false;
  }
}
</script>
