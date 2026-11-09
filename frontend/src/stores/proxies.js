import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '@/api/client';
import { swrFetch, invalidateCache } from '@/utils/cache';

export const useProxyStore = defineStore('proxies', () => {
  const proxies = ref([]);
  const loading = ref(false);

  async function fetchAll({ revalidate = false } = {}) {
    return swrFetch('proxies', async () => {
      const { data } = await api.get('/proxies');
      return data.proxies;
    }, {
      onUpdate: (data) => { proxies.value = data; },
      onLoading: (v) => { loading.value = v; },
      revalidate,
    });
  }

  async function create(proxy) {
    const { data } = await api.post('/proxies', proxy);
    proxies.value.push(data.proxy);
    invalidateCache('proxies');
    return data.proxy;
  }

  async function update(id, proxy) {
    const { data } = await api.put(`/proxies/${id}`, proxy);
    const idx = proxies.value.findIndex(p => p.id === id);
    if (idx !== -1) proxies.value[idx] = data.proxy;
    invalidateCache('proxies');
    // 改名会同步更新引用它的链式节点，删除会级联删除链式节点。
    invalidateCache('chainedProxies');
    return data.proxy;
  }

  async function remove(id) {
    await api.delete(`/proxies/${id}`);
    proxies.value = proxies.value.filter(p => p.id !== id);
    invalidateCache('proxies');
    invalidateCache('chainedProxies');
  }

  return { proxies, loading, fetchAll, create, update, remove };
});
