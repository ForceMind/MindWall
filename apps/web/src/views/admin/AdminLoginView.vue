<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { adminLogin } from '@/lib/admin-api';
import { toErrorMessage } from '@/lib/api-error';
import { useAdminSessionStore } from '@/stores/admin-session';
import { useNoticeStore } from '@/stores/notice';

const router = useRouter();
const adminStore = useAdminSessionStore();
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
    pageError.value = '请输入管理员账号和密码。';
    return;
  }

  loading.value = true;
  try {
    const payload = await adminLogin(form.username.trim(), form.password.trim());
    adminStore.setSession(payload.session_token, {
      username: payload.username,
      expires_at: payload.expires_at,
      auth_mode: 'session',
    });
    noticeStore.show('管理员登录成功', 'success');
    router.replace('/admin/overview');
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <main class="auth-screen" style="max-width: 560px">
    <section class="auth-hero">
      <h1 class="auth-title">MindWall 管理后台</h1>
      <p class="auth-desc">统一查看用户状态、在线情况、AI 调用与系统配置。</p>
    </section>

    <section class="auth-card">
      <h2 style="margin: 0; font-size: 18px">管理员登录</h2>

      <label class="field">
        <span class="field-label">管理员账号</span>
        <input v-model="form.username" class="input" placeholder="默认 admin，可在服务端配置" />
      </label>

      <label class="field">
        <span class="field-label">管理员密码</span>
        <input v-model="form.password" class="input" type="password" placeholder="请输入管理员密码" />
      </label>

      <p v-if="pageError" class="badge badge-danger" style="justify-content: flex-start">{{ pageError }}</p>

      <button class="btn btn-primary btn-block" type="button" :disabled="loading" @click="submit">
        {{ loading ? '登录中...' : '进入后台' }}
      </button>
    </section>
  </main>
</template>
