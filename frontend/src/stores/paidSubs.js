import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '@/api/client';
import { swrFetch, invalidateCache } from '@/utils/cache';

export const usePaidSubStore = defineStore('paidSubs', () => {
  const subscriptions = ref([]);
  const loading = ref(false);

  async function fetchAll() {
    return swrFetch('paidSubs', async () => {
      const { data } = await api.get('/paid-subs');
      return data.paid_subscriptions;
    }, {
      onUpdate: (data) => { subscriptions.value = data; },
      onLoading: (v) => { loading.value = v; },
    });
  }

  async function get(id) {
    const { data } = await api.get(`/paid-subs/${id}`);
    return data.paid_subscription;
  }

  async function create(sub) {
    const { data } = await api.post('/paid-subs', sub);
    subscriptions.value.push(data.paid_subscription);
    invalidateCache('paidSubs');
    return data.paid_subscription;
  }

  async function update(id, sub) {
    const { data } = await api.put(`/paid-subs/${id}`, sub);
    const idx = subscriptions.value.findIndex(s => s.id === id);
    if (idx !== -1) subscriptions.value[idx] = data.paid_subscription;
    invalidateCache('paidSubs');
    invalidateCache('profiles');
    return data.paid_subscription;
  }

  async function remove(id) {
    await api.delete(`/paid-subs/${id}`);
    subscriptions.value = subscriptions.value.filter(s => s.id !== id);
    invalidateCache('paidSubs');
    invalidateCache('profiles');
  }

  return { subscriptions, loading, fetchAll, get, create, update, remove };
});
