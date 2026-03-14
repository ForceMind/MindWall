<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import UserShell from '@/components/UserShell.vue';
import { saveOnboardingCity } from '@/lib/user-api';
import { toErrorMessage } from '@/lib/api-error';
import { useNoticeStore } from '@/stores/notice';
import { useUserSessionStore } from '@/stores/user-session';

const router = useRouter();
const userStore = useUserSessionStore();
const noticeStore = useNoticeStore();

const city = ref(userStore.viewer?.profile?.city || '');
const loading = ref(false);
const pageError = ref('');

const cityOptions = ['北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '西安', '南京', '重庆'];

async function submit() {
  const value = city.value.trim();
  if (!value) {
    pageError.value = '请选择或输入城市。';
    return;
  }
  if (!userStore.token) {
    router.replace('/login');
    return;
  }

  loading.value = true;
  pageError.value = '';
  try {
    await saveOnboardingCity(userStore.token, value);
    await userStore.refreshViewer();
    noticeStore.show('城市已保存，开始匹配', 'success');
    router.replace('/matches');
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <UserShell title="新手引导" subtitle="第 3 步：城市匹配" compact>
    <section class="stepper">
      <div class="step is-done">1. 资料</div>
      <div class="step is-done">2. 访谈</div>
      <div class="step is-active">3. 城市</div>
    </section>

    <section class="panel">
      <div class="panel-body column">
        <h2 class="panel-title">选择你当前所在城市</h2>
        <p class="panel-subtitle">仅用于同城优先匹配，不会公开你的真实地址。</p>

        <div class="row-wrap">
          <button
            v-for="item in cityOptions"
            :key="item"
            class="btn"
            :class="city === item ? 'btn-primary' : 'btn-ghost'"
            type="button"
            @click="city = item"
          >
            {{ item }}
          </button>
        </div>

        <label class="field">
          <span class="field-label">或手动输入</span>
          <input v-model="city" class="input" placeholder="输入城市名" />
        </label>

        <p v-if="pageError" class="badge badge-danger" style="justify-content: flex-start">{{ pageError }}</p>

        <button class="btn btn-primary btn-block" type="button" :disabled="loading" @click="submit">
          {{ loading ? '保存中...' : '进入匹配大厅' }}
        </button>
      </div>
    </section>
  </UserShell>
</template>
