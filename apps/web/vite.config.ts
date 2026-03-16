import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';

function resolveAllowedHosts(): 'all' | string[] {
  const raw = (process.env.VITE_ALLOWED_HOSTS || '').trim();
  if (!raw) {
    return 'all';
  }
  const hosts = raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return hosts.length > 0 ? hosts : 'all';
}

const allowedHosts = resolveAllowedHosts();

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 3001,
    allowedHosts,
  },
  preview: {
    host: '0.0.0.0',
    port: 3001,
    allowedHosts,
  },
});
