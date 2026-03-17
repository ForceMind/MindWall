<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import AdminShell from '@/components/AdminShell.vue';
import { fetchAdminUsers, updateAdminUserStatus, type UserStatus } from '@/lib/admin-api';
import { formatTime, statusBadgeClass, statusText } from '@/lib/format';
import { toErrorMessage } from '@/lib/api-error';
import { useAdminSessionStore } from '@/stores/admin-session';
import { useNoticeStore } from '@/stores/notice';

const adminStore = useAdminSessionStore();
const noticeStore = useNoticeStore();
const router = useRouter();

const page = ref(1);
const limit = ref(20);
const total = ref(0);
const loading = ref(false);
const pageError = ref('');
const rows = ref<Array<{
  id: string;
  username: string | null;
  status: UserStatus;
  created_at: string;
  online: boolean;
  profile: {
    anonymous_name: string | null;
    city: string | null;
    gender: string | null;
    age: number | null;
  } | null;
}>>([]);

const statusOptions: Array<{ value: UserStatus; label: string }> = [
  { value: 'onboarding', label: '新手引导中' },
  { value: 'active', label: '正常' },
  { value: 'restricted', label: '受限' },
];

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)));

async function load() {
  if (!adminStore.token) {
    return;
  }

  loading.value = true;
  pageError.value = '';

  try {
    const payload = await fetchAdminUsers(adminStore.token, page.value, limit.value);
    rows.value = payload.users;
    total.value = payload.total;
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    loading.value = false;
  }
}

async function updateStatus(userId: string, status: UserStatus) {
  if (!adminStore.token) {
    return;
  }

  try {
    await updateAdminUserStatus(adminStore.token, userId, status);
    noticeStore.show('用户状态已更新', 'success');
    await load();
  } catch (error) {
    noticeStore.show(toErrorMessage(error), 'error');
  }
}

function openDetail(userId: string) {
  router.push(`/admin/users/${userId}`);
}

function nextPage() {
  if (page.value >= totalPages.value) {
    return;
  }
  page.value += 1;
  load();
}

function prevPage() {
  if (page.value <= 1) {
    return;
  }
  page.value -= 1;
  load();
}

onMounted(() => {
  load();
});
</script>

<template>
  <AdminShell title="用户管理" subtitle="查看注册、在线与账号状态">
    <section class="panel">
      <div class="panel-body row" style="justify-content: space-between">
        <div>
          <h2 class="panel-title">用户列表</h2>
          <p class="panel-subtitle">支持分页查看、状态调整和详情追踪。</p>
        </div>
        <button class="btn btn-ghost" type="button" :disabled="loading" @click="load">刷新</button>
      </div>
    </section>

    <section v-if="pageError" class="panel">
      <div class="panel-body"><span class="badge badge-danger">{{ pageError }}</span></div>
    </section>

    <section class="panel">
      <div class="panel-body">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>匿名名</th>
                <th>城市</th>
                <th>状态</th>
                <th>在线</th>
                <th>注册时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="user in rows" :key="user.id">
                <td>{{ user.username || '-' }}</td>
                <td>{{ user.profile?.anonymous_name || '-' }}</td>
                <td>{{ user.profile?.city || '-' }}</td>
                <td>
                  <span class="badge" :class="statusBadgeClass(user.status)">{{ statusText(user.status) }}</span>
                </td>
                <td>
                  <span class="badge" :class="user.online ? 'badge-success' : 'badge-muted'">
                    {{ user.online ? '在线' : '离线' }}
                  </span>
                </td>
                <td>{{ formatTime(user.created_at) }}</td>
                <td>
                  <div class="row-wrap">
                    <select class="select" style="min-width: 120px" :value="user.status" @change="updateStatus(user.id, ($event.target as HTMLSelectElement).value as UserStatus)">
                      <option v-for="opt in statusOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                    </select>
                    <button class="btn btn-ghost" type="button" @click="openDetail(user.id)">详情</button>
                  </div>
                </td>
              </tr>

              <tr v-if="rows.length === 0 && !loading">
                <td colspan="7" class="muted">暂无数据</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="pager" style="margin-top: 12px">
          <button class="btn btn-ghost" type="button" :disabled="page <= 1" @click="prevPage">上一页</button>
          <span class="muted">第 {{ page }} / {{ totalPages }} 页，共 {{ total }} 条</span>
          <button class="btn btn-ghost" type="button" :disabled="page >= totalPages" @click="nextPage">下一页</button>
        </div>
      </div>
    </section>
  </AdminShell>
</template>
