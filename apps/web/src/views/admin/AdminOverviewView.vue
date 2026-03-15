<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AdminShell from '@/components/AdminShell.vue';
import { fetchAdminOverview } from '@/lib/admin-api';
import { formatUsd } from '@/lib/format';
import { toErrorMessage } from '@/lib/api-error';
import { useAdminSessionStore } from '@/stores/admin-session';

const adminStore = useAdminSessionStore();

const loading = ref(false);
const pageError = ref('');
const refreshedAt = ref('');
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

const statusRows = computed(() => {
  if (!data.value) {
    return [];
  }
  return [
    { label: '引导中', value: data.value.user_status.onboarding },
    { label: '正常', value: data.value.user_status.active },
    { label: '受限', value: data.value.user_status.restricted },
  ];
});

async function load() {
  if (!adminStore.token) {
    return;
  }

  loading.value = true;
  pageError.value = '';
  try {
    const payload = await fetchAdminOverview(adminStore.token);
    data.value = payload;
    refreshedAt.value = new Date().toLocaleString('zh-CN');
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
  <AdminShell title="后台总览" subtitle="运营驾驶舱">
    <section class="panel">
      <div class="panel-body row" style="justify-content: space-between; align-items: flex-start">
        <div>
          <h2 class="panel-title">系统总览</h2>
          <p class="panel-subtitle">
            一屏查看用户状态、会话活跃、AI 消耗与成本。最近刷新：{{ refreshedAt || '-' }}
          </p>
        </div>
        <button class="btn btn-ghost" type="button" :disabled="loading" @click="load">
          {{ loading ? '刷新中...' : '立即刷新' }}
        </button>
      </div>
    </section>

    <section v-if="pageError" class="panel">
      <div class="panel-body"><span class="badge badge-danger">{{ pageError }}</span></div>
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
        <div class="stat-value">{{ formatUsd(data.ai_usage.today_estimated_cost_usd) }}</div>
        <div class="stat-label">今日估算费用</div>
      </article>
    </section>

    <section v-if="data" class="panel">
      <div class="panel-body column">
        <h3 class="panel-title">账号状态分布</h3>
        <div class="row-wrap">
          <span v-for="row in statusRows" :key="row.label" class="tag">{{ row.label }}：{{ row.value }}</span>
        </div>
      </div>
    </section>

    <section v-if="data" class="panel">
      <div class="panel-body column">
        <h3 class="panel-title">AI 成本概览</h3>
        <div class="row-wrap">
          <span class="tag">累计调用：{{ data.ai_usage.total_calls }}</span>
          <span class="tag">累计 Token：{{ data.ai_usage.total_tokens }}</span>
          <span class="tag">累计费用：{{ formatUsd(data.ai_usage.total_estimated_cost_usd) }}</span>
          <span class="tag">今日调用：{{ data.ai_usage.today_calls }}</span>
          <span class="tag">今日 Token：{{ data.ai_usage.today_tokens }}</span>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-body column">
        <h3 class="panel-title">快捷入口</h3>
        <div class="row-wrap">
          <router-link class="btn btn-ghost" to="/admin/users">用户管理</router-link>
          <router-link class="btn btn-ghost" to="/admin/online">在线监控</router-link>
          <router-link class="btn btn-ghost" to="/admin/ai-records">AI记录</router-link>
          <router-link class="btn btn-ghost" to="/admin/prompts">提示词管理</router-link>
          <router-link class="btn btn-ghost" to="/admin/config">系统配置</router-link>
          <router-link class="btn btn-ghost" to="/admin/logs">服务器日志</router-link>
        </div>
      </div>
    </section>

    <section v-if="loading && !data" class="panel">
      <div class="panel-body">加载中...</div>
    </section>
  </AdminShell>
</template>
