<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AdminShell from '@/components/AdminShell.vue';
import { fetchAdminOverview } from '@/lib/admin-api';
import { formatUsd } from '@/lib/format';
import { toErrorMessage } from '@/lib/api-error';
import { useAdminSessionStore } from '@/stores/admin-session';

const adminStore = useAdminSessionStore();

const loading = ref(false);
const pageError = ref('');
const data = ref<{
  registered_users: number;
  active_sessions: number;
  online_users: number;
  user_status: Record<'onboarding' | 'active' | 'restricted', number>;
  ai_usage: {
    total_calls: number;
    total_tokens: number;
    total_estimated_cost_usd: number;
    today_calls: number;
    today_tokens: number;
    today_estimated_cost_usd: number;
  };
} | null>(null);

async function load() {
  if (!adminStore.token) {
    return;
  }

  loading.value = true;
  pageError.value = '';
  try {
    const payload = await fetchAdminOverview(adminStore.token);
    data.value = payload;
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
  <AdminShell title="后台总览" subtitle="全局运行状态">
    <section class="panel">
      <div class="panel-body row" style="justify-content: space-between">
        <div>
          <h2 class="panel-title">系统概览</h2>
          <p class="panel-subtitle">注册用户、在线会话、AI 资源消耗与费用估算。</p>
        </div>
        <button class="btn btn-ghost" type="button" :disabled="loading" @click="load">
          {{ loading ? '刷新中...' : '刷新数据' }}
        </button>
      </div>
    </section>

    <section v-if="pageError" class="panel">
      <div class="panel-body">
        <span class="badge badge-danger">{{ pageError }}</span>
      </div>
    </section>

    <section v-if="data" class="stats-grid">
      <article class="stat-card">
        <div class="stat-value">{{ data.registered_users }}</div>
        <div class="stat-label">注册用户</div>
      </article>
      <article class="stat-card">
        <div class="stat-value">{{ data.online_users }}</div>
        <div class="stat-label">当前在线</div>
      </article>
      <article class="stat-card">
        <div class="stat-value">{{ data.active_sessions }}</div>
        <div class="stat-label">有效会话</div>
      </article>
      <article class="stat-card">
        <div class="stat-value">{{ data.user_status.restricted }}</div>
        <div class="stat-label">受限账号</div>
      </article>
    </section>

    <section class="panel" v-if="data">
      <div class="panel-body column">
        <h3 class="panel-title">AI 资源统计</h3>
        <div class="stats-grid">
          <article class="stat-card">
            <div class="stat-value">{{ data.ai_usage.total_calls }}</div>
            <div class="stat-label">累计调用次数</div>
          </article>
          <article class="stat-card">
            <div class="stat-value">{{ data.ai_usage.total_tokens }}</div>
            <div class="stat-label">累计 Token</div>
          </article>
          <article class="stat-card">
            <div class="stat-value">{{ formatUsd(data.ai_usage.total_estimated_cost_usd) }}</div>
            <div class="stat-label">累计估算费用</div>
          </article>
          <article class="stat-card">
            <div class="stat-value">{{ formatUsd(data.ai_usage.today_estimated_cost_usd) }}</div>
            <div class="stat-label">今日估算费用</div>
          </article>
        </div>
      </div>
    </section>

    <section v-if="loading && !data" class="panel">
      <div class="panel-body">加载中...</div>
    </section>
  </AdminShell>
</template>
