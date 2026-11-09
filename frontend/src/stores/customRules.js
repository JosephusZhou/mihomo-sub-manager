import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '@/api/client';
import { swrFetch, invalidateCache } from '@/utils/cache';

export const useCustomRulesStore = defineStore('customRules', () => {
  const rules = ref([]);
  const loading = ref(false);

  async function fetchAll() {
    return swrFetch('customRules', async () => {
      const { data } = await api.get('/custom-rules');
      return data.rules;
    }, {
      onUpdate: (data) => { rules.value = data; },
      onLoading: (v) => { loading.value = v; },
    });
  }

  async function save(nextRules) {
    const { data } = await api.put('/custom-rules', { rules: nextRules });
    rules.value = data.rules;
    invalidateCache('customRules');
    return data.rules;
  }

  return { rules, loading, fetchAll, save };
});
