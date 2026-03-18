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
    metadata?: any;
  }>>([]);

  const isModalOpen = ref(false);
  const selectedRecord = ref<any>(null);

  function viewDetail(row: any) {
    selectedRecord.value = row;
    isModalOpen.value = true;
  }

  function closeModal() {
    isModalOpen.value = false;
    selectedRecord.value = null;
  }
    async function load() {
    loading.value = true;
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
                <th>操作</th>
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
                <td>
                  <button class="btn btn-ghost" style="padding: 2px 8px; font-size: 12px" type="button" @click="viewDetail(row)">详情</button>
                </td>
              </tr>
              <tr v-if="records.length === 0 && !loading">
                <td colspan="7" class="muted">暂无记录</td>
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

    <!-- 详情模态框 -->
    <div v-if="isModalOpen" class="modal-overlay" @click.self="closeModal">
      <div class="modal" style="max-width: 800px; width: 90vw;">
        <div class="modal-header">
          <h3 class="modal-title">AI 生成详情 <span class="badge badge-primary">{{ selectedRecord?.model }}</span></h3>
          <button class="btn btn-ghost" @click="closeModal">&times;</button>
        </div>
        <div class="modal-body" style="max-height: 70vh; overflow-y: auto;">
          <div v-if="selectedRecord?.metadata?.prompt">
            <h4>Prompt 发送内容</h4>
            <pre class="code-block" style="white-space: pre-wrap; word-break: break-all; font-size: 13px; padding: 12px; background: var(--bg-alt); border-radius: 8px;">{{ JSON.stringify(selectedRecord.metadata.prompt, null, 2) }}</pre>
          </div>
          <div v-else>
            <p class="muted">未记录 Prompt</p>
          </div>
          
          <div v-if="selectedRecord?.metadata?.response" style="margin-top: 24px;">
            <h4>AI 返回内容</h4>
            <pre class="code-block" style="white-space: pre-wrap; word-break: break-all; font-size: 13px; padding: 12px; background: var(--bg-alt); border-radius: 8px;">{{ JSON.stringify(selectedRecord.metadata.response, null, 2) }}</pre>
          </div>
          <div v-else style="margin-top: 24px;">
            <p class="muted">未记录 Response</p>
          </div>
        </div>
        <div class="modal-footer" style="display: flex; justify-content: flex-end; padding-top: 16px;">
          <button class="btn btn-primary" @click="closeModal">关闭</button>
        </div>
      </div>
    </div>
  </AdminShell>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: var(--bg-card, #fff);
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.2);
}
.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.modal-title { margin: 0; font-size: 18px; }
.code-block {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}
</style>
