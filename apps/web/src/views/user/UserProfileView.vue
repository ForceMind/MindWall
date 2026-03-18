<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import UserShell from '@/components/UserShell.vue';
import { useUserSessionStore } from '@/stores/user-session';

const router = useRouter();
const userStore = useUserSessionStore();

const profileName = computed(
  () =>
    userStore.viewer?.profile?.anonymous_name ||
    userStore.viewer?.user.username ||
    '匿名用户',
);
const profileAvatar = computed(() => userStore.viewer?.profile?.anonymous_avatar || '');
const city = computed(() => userStore.viewer?.profile?.city || '未设置');
const gender = computed(() => userStore.viewer?.profile?.gender || '未知');
const age = computed(() => userStore.viewer?.profile?.age || 0);

async function handleLogout() {
  await userStore.logout();
  router.replace('/login');
}
</script>

<template>
  <UserShell title="个人主页" show-back back-to="/matches" compact>
    <section class="panel" style="margin-top: 24px;">
      <div class="panel-body column" style="align-items: center; padding: 32px 16px;">
        <img v-if="profileAvatar" :src="profileAvatar" alt="avatar" class="avatar" style="width: 80px; height: 80px;" />
        <div style="font-weight: 700; font-size: 20px; margin-top: 12px;">{{ profileName }}</div>
        <div class="muted" style="margin-top: 4px;">{{ city }} · {{ gender === 'male' ? '男' : gender === 'female' ? '女' : '未知' }} · {{ age }}岁</div>
      </div>
    </section>

    <section class="panel" style="margin-top: 24px;">
      <div class="panel-body">
        <button class="btn btn-primary" type="button" style="width: 100%; border-radius: 8px;" @click="router.push('/onboarding/interview')">
          深度灵魂访谈
        </button>
        <button class="btn btn-secondary" type="button" style="width: 100%; border-radius: 8px; margin-top: 12px;" @click="handleLogout">
          退出登录
        </button>
      </div>
    </section>
  </UserShell>
</template>
