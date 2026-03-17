<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AdminShell from '@/components/AdminShell.vue';
import { fetchAdminOnlineUsers } from '@/lib/admin-api';
import { formatTime, statusBadgeClass, statusText } from '@/lib/format';
import { toErrorMessage } from '@/lib/api-error';
import { useAdminSessionStore } from '@/stores/admin-session';

const adminStore = useAdminSessionStore();

const loading = ref(false);
const pageError = ref('');
const minutes = ref(10);
const totalOnline = ref(0);
const rows = ref<Array<{
  user_id: string;
  username: string | null;
  status: string;
  last_seen_at: string;
  profile: {
    anonymous_name: string | null;
    city: string | null;
  } | null;
}>>([]);

async function load() {
  if (!adminStore.token) {
    return;
  }

  loading.value = true;
  pageError.value = '';
  try {
    const payload = await fetchAdminOnlineUsers(adminStore.token, minutes.value);
    totalOnline.value = payload.total_online;
    rows.value = payload.users;
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
});
</script>

<template>
  <AdminShell title="在线监控" subtitle="实时在线与最近活跃">
    <section class="panel">
      <div class="panel-body row" style="justify-content: space-between; flex-wrap: wrap">
        <div>
          <h2 class="panel-title">在线用户窗口</h2>
          <p class="panel-subtitle">当前窗口：最近 {{ minutes }} 分钟活跃</p>
        </div>

        <div class="row-wrap">
          <input v-model.number="minutes" class="input" type="number" min="1" max="120" style="width: 120px" />
          <button class="btn btn-ghost" type="button" :disabled="loading" @click="load">刷新</button>
        </div>
      </div>
    </section>

    <section v-if="pageError" class="panel">
      <div class="panel-body"><span class="badge badge-danger">{{ pageError }}</span></div>
    </section>

    <section class="panel">
      <div class="panel-body column">
        <div class="row" style="justify-content: space-between">
          <h3 class="panel-title">在线人数</h3>
          <span class="badge badge-success">{{ totalOnline }}</span>
        </div>

        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>匿名名</th>
                <th>城市</th>
                <th>状态</th>
                <th>最近活跃</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in rows" :key="row.user_id">
                <td>{{ row.username || '-' }}</td>
                <td>{{ row.profile?.anonymous_name || '-' }}</td>
                <td>{{ row.profile?.city || '-' }}</td>
                <td><span class="badge" :class="statusBadgeClass(row.status)">{{ statusText(row.status) }}</span></td>
                <td>{{ formatTime(row.last_seen_at) }}</td>
              </tr>
              <tr v-if="rows.length === 0 && !loading">
                <td colspan="5" class="muted">当前窗口内无在线用户</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </AdminShell>
</template>
