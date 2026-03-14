<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useAdminSessionStore } from '@/stores/admin-session';

const props = withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
  }>(),
  {
    subtitle: '',
  },
);

const router = useRouter();
const adminStore = useAdminSessionStore();

const navItems = [
  { to: '/admin/overview', label: '总览' },
  { to: '/admin/users', label: '用户' },
  { to: '/admin/online', label: '在线' },
  { to: '/admin/ai-records', label: 'AI记录' },
  { to: '/admin/prompts', label: '提示词' },
  { to: '/admin/config', label: '系统配置' },
  { to: '/admin/logs', label: '服务器日志' },
];

async function handleLogout() {
  await adminStore.logout();
  router.replace('/admin/login');
}
</script>

<template>
  <div class="admin-layout">
    <header class="screen" style="padding-bottom: 0">
      <section class="app-header">
        <div class="brand">
          <strong class="brand-title">{{ title }}</strong>
          <span class="brand-subtitle">{{ subtitle || 'MindWall 管理后台' }}</span>
        </div>
        <button class="btn btn-ghost" type="button" style="padding: 6px 10px" @click="handleLogout">
          退出后台
        </button>
      </section>
    </header>

    <section class="admin-main">
      <nav class="admin-nav panel" style="padding: 8px">
        <router-link
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="admin-nav-link"
        >
          {{ item.label }}
        </router-link>
      </nav>

      <div class="column">
        <slot />
      </div>
    </section>
  </div>
</template>
