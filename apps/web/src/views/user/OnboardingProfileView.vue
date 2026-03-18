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

const showConfirm = ref(false);
const computedYear = ref(0);
const computedMonth = ref(0);

function previewSubmit() {
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
  
  const now = new Date();
  computedYear.value = now.getFullYear() - numericAge;
  computedMonth.value = now.getMonth() + 1;
  showConfirm.value = true;
}

async function submit() {
  pageError.value = '';
  
  const now = new Date();
  let finalAge = now.getFullYear() - computedYear.value;
  // If the user's birth month hasn't occurred this year, they are 1 year younger
  if (now.getMonth() + 1 < computedMonth.value) {
    finalAge -= 1;
  }

  if (!Number.isFinite(finalAge) || finalAge < 18 || finalAge > 99) {
    pageError.value = '计算出的年龄超出范围(18-99)。';
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
      age: Math.round(finalAge),
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
          <div class="muted" style="margin-top: 2px; margin-bottom: 8px; font-size: 13px;">请仔细填写，注册后性别与年龄将不可修改</div>
          <input v-model="age" class="input" type="number" min="18" max="99" placeholder="例如 24" />
        </label>

        <p v-if="pageError" class="badge badge-danger" style="justify-content: flex-start">{{ pageError }}</p>

        <button class="btn btn-primary btn-block" type="button" :disabled="loading" @click="previewSubmit">
          {{ loading ? '保存中...' : '下一步：进入访谈' }}
        </button>
      </div>
    </section>

    <!-- Age Verification Modal -->
    <div v-if="showConfirm" class="modal-overlay" style="position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000;">
      <div class="panel" style="width: 300px; padding: 20px;">
        <h3 style="margin-bottom: 16px;">请确认出生年月</h3>
        <p class="muted" style="margin-bottom: 16px; font-size: 14px;">一旦确认后，性别与年龄将不可修改。</p>
        
        <label class="field">
          <span class="field-label">出生年份</span>
          <input v-model.number="computedYear" type="number" class="input" />
        </label>
        <label class="field">
          <span class="field-label">出生月份</span>
          <input v-model.number="computedMonth" type="number" class="input" min="1" max="12" />
        </label>

        <div class="row" style="margin-top: 24px; gap: 12px; justify-content: flex-end;">
          <button class="btn btn-ghost" type="button" @click="showConfirm = false">取消</button>
          <button class="btn btn-primary" type="button" @click="() => { showConfirm = false; submit(); }" :disabled="loading">
            确认并继续
          </button>
        </div>
      </div>
    </div>
  </UserShell>
</template>
