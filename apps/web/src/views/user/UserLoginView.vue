<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { loginUser } from '@/lib/user-api';
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
});
const loading = ref(false);
const pageError = ref('');

async function submit() {
  pageError.value = '';
  if (!form.username.trim() || !form.password.trim()) {
    pageError.value = '请先填写用户名和密码。';
    return;
  }

  loading.value = true;
  try {
    const payload = await loginUser(form.username.trim(), form.password.trim());
    userStore.setSession(payload);
    noticeStore.show('登录成功', 'success');
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
      <h1 class="auth-title">心垣 MindWall</h1>
      <p class="auth-desc">
        这是一个匿名社交沙盒。初期消息会经过安全中间层重写，先建立心理连接，再决定是否破壁见面。
      </p>
    </section>

    <section class="auth-card">
      <h2 style="margin: 0; font-size: 18px">登录</h2>

      <label class="field">
        <span class="field-label">用户名</span>
        <input v-model="form.username" class="input" placeholder="请输入用户名" autocomplete="username" />
      </label>

      <label class="field">
        <span class="field-label">密码</span>
        <input
          v-model="form.password"
          class="input"
          type="password"
          placeholder="请输入密码"
          autocomplete="current-password"
        />
      </label>

      <p v-if="pageError" class="badge badge-danger" style="justify-content: flex-start">{{ pageError }}</p>

      <button class="btn btn-primary btn-block" type="button" :disabled="loading" @click="submit">
        {{ loading ? '登录中...' : '登录并进入' }}
      </button>

      <router-link to="/register" class="btn btn-ghost" style="text-align: center">
        没有账号？去注册
      </router-link>
    </section>
  </main>
</template>
