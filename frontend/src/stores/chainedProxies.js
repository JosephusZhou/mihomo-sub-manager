import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '@/api/client';
import { swrFetch, invalidateCache } from '@/utils/cache';

export const useChainedProxyStore = defineStore('chainedProxies', () => {
  const chainedProxies = ref([]);
  const loading = ref(false);

  async function fetchAll({ revalidate = false } = {}) {
    return swrFetch('chainedProxies', async () => {
      const { data } = await api.get('/chained-proxies');
      return data.chained_proxies;
    }, {
      onUpdate: (data) => { chainedProxies.value = data; },
      onLoading: (v) => { loading.value = v; },
      revalidate,
    });
  }

  async function preview(payload) {
    const { data } = await api.post('/chained-proxies/preview', payload);
    return data;
  }

  async function importBatch(payload) {
    const { data } = await api.post('/chained-proxies/import', payload);
    invalidateCache('chainedProxies');
    invalidateCache('proxies');
    invalidateCache('profiles');
    await fetchAll();
    return data;
  }

  async function remove(id) {
    await api.delete(`/chained-proxies/${id}`);
    chainedProxies.value = chainedProxies.value.filter(p => p.id !== id);
    invalidateCache('chainedProxies');
    invalidateCache('proxies');
    invalidateCache('profiles');
  }

  // 批量删除复用单条 DELETE 接口（并发请求），只在全部结束后统一失效缓存并刷新列表。
  async function removeMany(ids) {
    const results = await Promise.allSettled(ids.map(id => api.delete(`/chained-proxies/${id}`)));
    chainedProxies.value = chainedProxies.value.filter(p => !ids.includes(p.id));
    invalidateCache('chainedProxies');
    invalidateCache('proxies');
    invalidateCache('profiles');
    await fetchAll();
    return results;
  }

  return { chainedProxies, loading, fetchAll, preview, importBatch, remove, removeMany };
});
