<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { registerUser } from '@/lib/user-api';
import { toErrorMessage } from '@/lib/api-error';
import { resolvePostAuthRoute } from '@/lib/user-flow';
import { useUserSessionStore } from '@/stores/user-session';
import { useNoticeStore } from '@/stores/notice';

const router = useRouter();
const userStore = useUserSessionStore();
const noticeStore = useNoticeStore();

const form = reactive({
  username: '',
  password: '',
  confirmPassword: '',
});
const loading = ref(false);
const pageError = ref('');

async function submit() {
  pageError.value = '';

  const username = form.username.trim();
  const password = form.password.trim();
  if (!username || !password) {
    pageError.value = '请完整填写用户名和密码。';
    return;
  }
  if (password.length < 6) {
    pageError.value = '密码至少需要 6 位。';
    return;
  }
  if (password !== form.confirmPassword.trim()) {
    pageError.value = '两次输入的密码不一致。';
    return;
  }

  loading.value = true;
  try {
    const payload = await registerUser(username, password);
    userStore.setSession(payload);
    noticeStore.show('注册成功，开始新手引导', 'success');
    router.replace(resolvePostAuthRoute(userStore.viewer));
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="auth-screen">
    <section class="auth-hero">
      <h1 class="auth-title">创建你的匿名身份</h1>
      <p class="auth-desc">
        只需用户名和密码即可注册。我们会在新手流程中根据你的回答生成匿名昵称与头像。
      </p>
    </section>

    <section class="auth-card">
      <h2 style="margin: 0; font-size: 18px">注册</h2>

      <label class="field">
        <span class="field-label">用户名</span>
        <input v-model="form.username" class="input" placeholder="2-24 位，支持字母数字下划线" autocomplete="username" />
      </label>

      <label class="field">
        <span class="field-label">密码</span>
        <input
          v-model="form.password"
          class="input"
          type="password"
          placeholder="至少 6 位"
          autocomplete="new-password"
        />
      </label>

      <label class="field">
        <span class="field-label">确认密码</span>
        <input
          v-model="form.confirmPassword"
          class="input"
          type="password"
          placeholder="再次输入密码"
          autocomplete="new-password"
        />
      </label>

      <p v-if="pageError" class="badge badge-danger" style="justify-content: flex-start">{{ pageError }}</p>

      <button class="btn btn-primary btn-block" type="button" :disabled="loading" @click="submit">
        {{ loading ? '注册中...' : '注册并继续' }}
      </button>

      <router-link to="/login" class="btn btn-ghost" style="text-align: center">
        已有账号？去登录
      </router-link>
    </section>
  </main>
</template>
