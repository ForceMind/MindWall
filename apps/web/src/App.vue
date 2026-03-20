<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { storeToRefs } from 'pinia';
import { useRoute } from 'vue-router';
import { useNoticeStore } from '@/stores/notice';
import { appConfig } from '@/lib/config';

const route = useRoute();
const noticeStore = useNoticeStore();
const { text, type } = storeToRefs(noticeStore);

const isMaintenance = ref(false);
let maintenanceTimer: ReturnType<typeof setInterval> | null = null;

const isAdminRoute = computed(() => route.path.startsWith('/admin'));
const showMaintenance = computed(() => isMaintenance.value && !isAdminRoute.value);

async function checkMaintenance() {
  try {
    const res = await fetch(`${appConfig.apiBaseUrl}/maintenance-status`);
    if (res.ok) {
      const data = await res.json();
      isMaintenance.value = data?.maintenance === true;
    }
  } catch {
    // Ignore network errors
  }
}

onMounted(() => {
  checkMaintenance();
  maintenanceTimer = setInterval(checkMaintenance, 30_000);
});

onUnmounted(() => {
  if (maintenanceTimer) clearInterval(maintenanceTimer);
});
</script>

<template>
  <div class="app-root">
    <div v-if="showMaintenance" class="maintenance-overlay">
      <div class="maintenance-card">
        <div style="font-size: 48px; margin-bottom: 16px;">🔧</div>
        <h1 style="margin: 0 0 8px; font-size: 22px;">系统维护中</h1>
        <p style="margin: 0; color: var(--text-muted, #888); font-size: 14px;">
          平台正在进行维护升级，请稍后再试。
        </p>
      </div>
    </div>
    <template v-if="!showMaintenance">
      <router-view />
    </template>

    <transition name="toast-pop">
      <aside
        v-if="text"
        class="app-toast"
        :class="`is-${type}`"
        role="status"
        aria-live="polite"
      >
        {{ text }}
      </aside>
    </transition>
  </div>
</template>

<style scoped>
.maintenance-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-base, #f5f5f5);
  z-index: 9999;
}
.maintenance-card {
  text-align: center;
  padding: 40px 32px;
  max-width: 360px;
}
</style>
