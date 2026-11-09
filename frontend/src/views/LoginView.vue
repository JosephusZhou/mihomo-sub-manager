<template>
  <div class="min-h-screen flex items-center justify-center">
    <div class="w-full max-w-md">
      <div class="bg-gray-800 rounded-lg shadow-xl p-8 border border-gray-700">
        <h1 class="text-2xl font-bold text-center mb-2 text-primary-400">Mihomo 管理平台</h1>
        <p class="text-center text-gray-400 text-sm mb-8">登录您的账户</p>

        <div v-if="error" class="mb-4 p-3 bg-red-900/50 border border-red-700 rounded text-red-300 text-sm">
          {{ error }}
        </div>

        <form @submit.prevent="handleLogin">
          <div class="mb-4">
            <label class="block text-sm text-gray-400 mb-2">邮箱</label>
            <input
              v-model="form.email"
              type="email"
              required
              class="w-full bg-gray-900 border border-gray-600 rounded px-4 py-2 text-gray-100 focus:outline-none focus:border-primary-500"
              placeholder="your@email.com"
            />
          </div>
          <div class="mb-6">
            <label class="block text-sm text-gray-400 mb-2">密码</label>
            <input
              v-model="form.password"
              type="password"
              required
              class="w-full bg-gray-900 border border-gray-600 rounded px-4 py-2 text-gray-100 focus:outline-none focus:border-primary-500"
              placeholder="输入密码"
            />
          </div>
          <button
            type="submit"
            :disabled="loading"
            class="w-full bg-primary-600 hover:bg-primary-700 text-white font-medium py-2 px-4 rounded transition-colors disabled:opacity-50"
          >
            {{ loading ? '登录中...' : '登录' }}
          </button>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const auth = useAuthStore();

const form = reactive({ email: '', password: '' });
const loading = ref(false);
const error = ref('');

async function handleLogin() {
  loading.value = true;
  error.value = '';
  try {
    await auth.login(form.email, form.password);
    router.push('/');
  } catch (e) {
    error.value = e.response?.data?.error || '登录失败';
  } finally {
    loading.value = false;
  }
}
</script>
