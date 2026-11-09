import { defineStore } from 'pinia';
import { ref } from 'vue';
import api from '@/api/client';
import { swrFetch, invalidateCache } from '@/utils/cache';

export const useTemplateStore = defineStore('templates', () => {
  const templates = ref([]);
  const loading = ref(false);

  async function fetchAll() {
    return swrFetch('templates', async () => {
      const { data } = await api.get('/templates');
      return data.templates;
    }, {
      onUpdate: (data) => { templates.value = data; },
      onLoading: (v) => { loading.value = v; },
    });
  }

  async function create(template) {
    const { data } = await api.post('/templates', template);
    templates.value.push(data.template);
    invalidateCache('templates');
    return data.template;
  }

  async function update(id, template) {
    const { data } = await api.put(`/templates/${id}`, template);
    const idx = templates.value.findIndex(t => t.id === id);
    if (idx !== -1) templates.value[idx] = data.template;
    invalidateCache('templates');
    invalidateCache('profiles');
    return data.template;
  }

  // 预览只取真实生成的 rule-providers + rules 段（后端复用 config-generator）。
  async function previewRules(id) {
    const { data } = await api.get(`/templates/${id}/preview-rules`);
    return data.yaml;
  }

  async function remove(id) {
    await api.delete(`/templates/${id}`);
    templates.value = templates.value.filter(t => t.id !== id);
    invalidateCache('templates');
    invalidateCache('profiles');
  }

  return { templates, loading, fetchAll, create, update, previewRules, remove };
});
