<script setup lang="ts">
import { computed, ref } from 'vue';
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
const userId = computed(() => userStore.viewer?.user.id || '');
const displayId = computed(() => {
  const raw = userId.value.replace(/-/g, '').toUpperCase();
  return raw ? `MW-${raw.slice(0, 8)}` : '';
});

const idCopied = ref(false);
function copyId() {
  if (!displayId.value) return;
  navigator.clipboard.writeText(displayId.value).then(() => {
    idCopied.value = true;
    setTimeout(() => { idCopied.value = false; }, 1500);
  });
}

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
        <div v-if="displayId" class="muted" style="margin-top: 6px; font-size: 12px; cursor: pointer; user-select: all" @click="copyId">
          ID: {{ displayId }}
          <span v-if="idCopied" style="color: var(--success); margin-left: 4px">已复制</span>
          <span v-else style="opacity: 0.5; margin-left: 4px">点击复制</span>
        </div>
        <div class="muted" style="margin-top: 4px; font-size: 13px;">(完成深度访谈可让AI自动生成新的专属昵称和头像)</div>
        <div class="muted" style="margin-top: 8px;">{{ city }} · {{ gender === 'male' ? '男' : gender === 'female' ? '女' : '未知' }} · {{ age }}岁</div>
      </div>
    </section>

    <section class="panel" style="margin-top: 24px;">
      <div class="panel-body">
        <button v-if="userStore.viewer?.has_deep_interview" class="btn btn-primary" type="button" style="width: 100%; border-radius: 8px;" @click="router.push('/onboarding/refresh')">
          更新我的状态
        </button>
        <button class="btn btn-ghost" type="button" style="width: 100%; border-radius: 8px; margin-top: 12px; background: #f0f0f0;" @click="router.push('/onboarding/city')">
          修改城市
        </button>
        <button class="btn btn-secondary" type="button" style="width: 100%; border-radius: 8px; margin-top: 12px;" @click="handleLogout">
          退出登录
        </button>
      </div>
    </section>
  </UserShell>
</template>
