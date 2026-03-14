<script setup lang="ts">
import { useRouter } from 'vue-router';
import UserShell from '@/components/UserShell.vue';
import { useUserSessionStore } from '@/stores/user-session';

const router = useRouter();
const userStore = useUserSessionStore();

async function logout() {
  await userStore.logout();
  router.replace('/login');
}
</script>

<template>
  <UserShell title="账号受限" subtitle="请联系管理员处理">
    <section class="panel">
      <div class="panel-body column">
        <h2 class="panel-title">当前账号暂不可使用</h2>
        <p class="panel-subtitle">
          系统检测到你的账号处于受限状态。你仍可联系管理员审核解除。
        </p>
        <button class="btn btn-danger" type="button" @click="logout">退出当前账号</button>
      </div>
    </section>
  </UserShell>
</template>
