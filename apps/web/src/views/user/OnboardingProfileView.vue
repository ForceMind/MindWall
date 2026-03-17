<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import UserShell from '@/components/UserShell.vue';
import { saveOnboardingProfile } from '@/lib/user-api';
import { toErrorMessage } from '@/lib/api-error';
import { useNoticeStore } from '@/stores/notice';
import { useUserSessionStore } from '@/stores/user-session';

const router = useRouter();
const userStore = useUserSessionStore();
const noticeStore = useNoticeStore();

const genders = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'nonbinary', label: '非二元' },
  { value: 'other', label: '其他' },
];

const selectedGender = ref(userStore.viewer?.profile?.gender || '');
const age = ref(userStore.viewer?.profile?.age ? String(userStore.viewer.profile.age) : '');
const loading = ref(false);
const pageError = ref('');

async function submit() {
  pageError.value = '';
  if (!selectedGender.value) {
    pageError.value = '请选择性别。';
    return;
  }
  const numericAge = Number(age.value);
  if (!Number.isFinite(numericAge) || numericAge < 18 || numericAge > 99) {
    pageError.value = '年龄需要在 18 到 99 之间。';
    return;
  }

  if (!userStore.token) {
    router.replace('/login');
    return;
  }

  loading.value = true;
  try {
    await saveOnboardingProfile(userStore.token, {
      gender: selectedGender.value,
      age: Math.round(numericAge),
    });
    await userStore.refreshViewer();
    noticeStore.show('基础资料已保存', 'success');
    router.push('/onboarding/interview');
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <UserShell title="新手引导" subtitle="第 1 步：基础资料" compact>
    <section class="stepper">
      <div class="step is-active">1. 资料</div>
      <div class="step">2. 访谈</div>
      <div class="step">3. 城市</div>
    </section>

    <section class="panel">
      <div class="panel-body column">
        <h2 class="panel-title">我们先创建你的匿名底色</h2>
        <p class="panel-subtitle">
          这里不会展示真实身份，只用于生成更贴合你的匿名昵称与头像。
        </p>

        <div class="field">
          <span class="field-label">你的性别</span>
          <div class="row-wrap">
            <button
              v-for="item in genders"
              :key="item.value"
              class="btn"
              :class="selectedGender === item.value ? 'btn-primary' : 'btn-ghost'"
              type="button"
              @click="selectedGender = item.value"
            >
              {{ item.label }}
            </button>
          </div>
        </div>

        <label class="field">
          <span class="field-label">你的年龄</span>
          <input v-model="age" class="input" type="number" min="18" max="99" placeholder="例如 24" />
        </label>

        <p v-if="pageError" class="badge badge-danger" style="justify-content: flex-start">{{ pageError }}</p>

        <button class="btn btn-primary btn-block" type="button" :disabled="loading" @click="submit">
          {{ loading ? '保存中...' : '下一步：进入访谈' }}
        </button>
      </div>
    </section>
  </UserShell>
</template>
