import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiBase = env.VITE_API_BASE_URL || 'http://localhost:8787';

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: apiBase,
          changeOrigin: true,
        },
        '/subscribes': {
          target: apiBase,
          changeOrigin: true,
        },
        '/profiles': {
          target: apiBase,
          changeOrigin: true,
        },
      },
    },
  };
});
