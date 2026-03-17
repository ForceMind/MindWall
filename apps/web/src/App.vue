<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useNoticeStore } from '@/stores/notice';

const noticeStore = useNoticeStore();
const { text, type } = storeToRefs(noticeStore);
</script>

<template>
  <div class="app-root">
    <router-view />

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
