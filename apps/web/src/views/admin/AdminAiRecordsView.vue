<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AdminShell from '@/components/AdminShell.vue';
import { fetchAdminAiRecords } from '@/lib/admin-api';
import { formatTime, formatUsd } from '@/lib/format';
import { toErrorMessage } from '@/lib/api-error';
import { useAdminSessionStore } from '@/stores/admin-session';

const adminStore = useAdminSessionStore();

function createEmptySummary() {
  return {
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_tokens: 0,
    total_estimated_cost_usd: 0,
    unique_user_count: 0,
  };
}

const page = ref(1);
const limit = ref(20);
const total = ref(0);
const loading = ref(false);
const pageError = ref('');
const summary = ref(createEmptySummary());

const records = ref<Array<{
  id: string;
  user_id: string | null;
  feature: string;
  prompt_key: string | null;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  created_at: string;
}>>([]);

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit.value)));

async function load() {
  if (!adminStore.token) {
    return;
  }

  loading.value = true;
  pageError.value = '';
  try {
    const payload = await fetchAdminAiRecords(adminStore.token, page.value, limit.value);
    total.value = Number(payload?.total || 0);
    summary.value = {
      ...createEmptySummary(),
      ...(payload?.summary || {}),
    };
    records.value = Array.isArray(payload?.records) ? payload.records : [];
  } catch (error) {
    pageError.value = toErrorMessage(error);
    summary.value = createEmptySummary();
    records.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
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
  <AdminShell title="AI 生成记录" subtitle="Token 与费用审计">
    <section class="panel">
      <div class="panel-body row" style="justify-content: space-between">
        <div>
          <h2 class="panel-title">调用汇总</h2>
          <p class="panel-subtitle">覆盖访谈、匹配理由、聊天改写、模拟陪练等能力。</p>
        </div>
        <button class="btn btn-ghost" type="button" :disabled="loading" @click="load">刷新</button>
      </div>
    </section>

    <section v-if="pageError" class="panel">
      <div class="panel-body"><span class="badge badge-danger">{{ pageError }}</span></div>
    </section>

    <section class="stats-grid">
      <article class="stat-card">
        <div class="stat-value">{{ summary.total_tokens }}</div>
        <div class="stat-label">总 Token</div>
      </article>
      <article class="stat-card">
        <div class="stat-value">{{ summary.total_input_tokens }}</div>
        <div class="stat-label">输入 Token</div>
      </article>
      <article class="stat-card">
        <div class="stat-value">{{ summary.total_output_tokens }}</div>
        <div class="stat-label">输出 Token</div>
      </article>
      <article class="stat-card">
        <div class="stat-value">{{ formatUsd(summary.total_estimated_cost_usd) }}</div>
        <div class="stat-label">估算费用</div>
      </article>
    </section>

    <section class="panel">
      <div class="panel-body column">
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>时间</th>
                <th>用户ID</th>
                <th>功能</th>
                <th>模型</th>
                <th>总Token</th>
                <th>估算费用</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in records" :key="row.id">
                <td>{{ formatTime(row.created_at) }}</td>
                <td>{{ row.user_id || '-' }}</td>
                <td>{{ row.feature }}</td>
                <td>{{ row.model }}</td>
                <td>{{ row.total_tokens }}</td>
                <td>{{ formatUsd(row.estimated_cost_usd) }}</td>
              </tr>
              <tr v-if="records.length === 0 && !loading">
                <td colspan="6" class="muted">暂无记录</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="pager">
          <button class="btn btn-ghost" type="button" :disabled="page <= 1" @click="prevPage">上一页</button>
          <span class="muted">第 {{ page }} / {{ totalPages }} 页，共 {{ total }} 条</span>
          <button class="btn btn-ghost" type="button" :disabled="page >= totalPages" @click="nextPage">下一页</button>
        </div>
      </div>
    </section>
  </AdminShell>
</template>
