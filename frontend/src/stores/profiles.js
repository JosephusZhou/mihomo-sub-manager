import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '@/api/client';
import { swrFetch, invalidateCache } from '@/utils/cache';

export const useProfileStore = defineStore('profiles', () => {
  const profiles = ref([]);
  const loading = ref(false);

  async function fetchAll() {
    return swrFetch('profiles', async () => {
      const { data } = await api.get('/profiles');
      return data.profiles;
    }, {
      onUpdate: (data) => { profiles.value = data; },
      onLoading: (v) => { loading.value = v; },
    });
  }

  async function get(id) {
    const { data } = await api.get(`/profiles/${id}`);
    return data.profile;
  }

  async function create(profile) {
    const { data } = await api.post('/profiles', profile);
    profiles.value.unshift(data.profile);
    invalidateCache('profiles');
    return data.profile;
  }

  async function update(id, profile) {
    const { data } = await api.put(`/profiles/${id}`, profile);
    const idx = profiles.value.findIndex(p => p.id === id);
    if (idx !== -1) profiles.value[idx] = data.profile;
    invalidateCache('profiles');
    return data.profile;
  }

  async function remove(id) {
    await api.delete(`/profiles/${id}`);
    profiles.value = profiles.value.filter(p => p.id !== id);
    invalidateCache('profiles');
  }

  async function previewConfig(id) {
    const response = await api.get(`/profiles/${id}/config`, { responseType: 'text' });
    return response.data;
  }

  async function regenerateToken(id) {
    const { data } = await api.post(`/profiles/${id}/regenerate-token`);
    const idx = profiles.value.findIndex(p => p.id === id);
    if (idx !== -1) profiles.value[idx].profile_token = data.profile_token;
    invalidateCache('profiles');
    return data.profile_token;
  }

  return { profiles, loading, fetchAll, get, create, update, remove, previewConfig, regenerateToken };
});
