import { ref } from 'vue';
import { defineStore } from 'pinia';

export type NoticeType = 'success' | 'error' | 'info';

export const useNoticeStore = defineStore('notice', () => {
  const text = ref('');
  const type = ref<NoticeType>('info');
  let timer: number | null = null;

  function show(nextText: string, nextType: NoticeType = 'info', durationMs = 2600) {
    text.value = nextText;
    type.value = nextType;
    if (timer) {
      window.clearTimeout(timer);
      timer = null;
    }
    if (durationMs > 0) {
      timer = window.setTimeout(() => {
        clear();
      }, durationMs);
    }
  }

  function clear() {
    text.value = '';
    if (timer) {
      window.clearTimeout(timer);
      timer = null;
    }
  }

  return {
    text,
    type,
    show,
    clear,
  };
});
