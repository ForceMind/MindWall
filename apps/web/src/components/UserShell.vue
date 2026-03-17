<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useUserSessionStore } from '@/stores/user-session';

const props = withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    showBack?: boolean;
    backTo?: string;
    compact?: boolean;
  }>(),
  {
    subtitle: '',
    showBack: false,
    backTo: '',
    compact: false,
  },
);

const router = useRouter();
const userStore = useUserSessionStore();

const canLogout = computed(() => userStore.isAuthenticated);
const userName = computed(
  () => userStore.viewer?.profile?.anonymous_name || userStore.viewer?.user.username || '匿名用户',
);

function goBack() {
  if (props.backTo) {
    router.push(props.backTo);
    return;
  }
  router.back();
}

async function handleLogout() {
  await userStore.logout();
  router.replace('/login');
}
</script>

<template>
  <main class="screen" :style="compact ? 'max-width:780px;' : ''">
    <header class="app-header">
      <div class="row" style="min-width: 0">
        <button
          v-if="showBack"
          class="btn btn-ghost"
          type="button"
          style="padding: 6px 10px; border-radius: 10px"
          @click="goBack"
        >
          返回
        </button>
        <div class="brand" style="min-width: 0">
          <strong class="brand-title">{{ title }}</strong>
          <span v-if="subtitle" class="brand-subtitle">{{ subtitle }}</span>
        </div>
      </div>

      <div class="row-wrap" style="justify-content: flex-end">
        <span class="badge badge-muted" v-if="canLogout">{{ userName }}</span>
        <button
          v-if="canLogout"
          class="btn btn-ghost"
          type="button"
          style="padding: 6px 10px; border-radius: 10px"
          @click="handleLogout"
        >
          退出
        </button>
      </div>
    </header>

    <slot />
  </main>
</template>
