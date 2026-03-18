<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AdminShell from '@/components/AdminShell.vue';
import { fetchAdminUserDetail, updateAdminUserStatus, type UserStatus } from '@/lib/admin-api';
import { formatDateTime, formatTime, statusBadgeClass, statusText } from '@/lib/format';
import { toErrorMessage } from '@/lib/api-error';
import { useAdminSessionStore } from '@/stores/admin-session';
import { useNoticeStore } from '@/stores/notice';

const route = useRoute();
const router = useRouter();
const adminStore = useAdminSessionStore();
const noticeStore = useNoticeStore();

const loading = ref(false);
const pageError = ref('');
const detail = ref<Record<string, any> | null>(null);
const activeTab = ref<'timeline' | 'interview' | 'tags' | 'ai_records'>('timeline');
const PAGE_SIZE = 20;
const timelinePage = ref(1);
const aiRecordsPage = ref(1);

const userId = computed(() => String(route.params.userId || ''));
const user = computed(() => detail.value?.user || null);
const interviewRecords = computed(() => detail.value?.interview?.records || []);

const timelineItems = computed(() => detail.value?.timeline || []);
const timelineTotalPages = computed(() => Math.max(1, Math.ceil(timelineItems.value.length / PAGE_SIZE)));
const timelinePageItems = computed(() => {
  const start = (timelinePage.value - 1) * PAGE_SIZE;
  return timelineItems.value.slice(start, start + PAGE_SIZE);
});

const aiRecordItems = computed(() => detail.value?.recent?.ai_records || []);
const aiRecordsTotalPages = computed(() => Math.max(1, Math.ceil(aiRecordItems.value.length / PAGE_SIZE)));
const aiRecordsPageItems = computed(() => {
  const start = (aiRecordsPage.value - 1) * PAGE_SIZE;
  return aiRecordItems.value.slice(start, start + PAGE_SIZE);
});

function interviewRoleText(role: string) {
  if (role === 'assistant') {
    return '系统提问';
  }
  if (role === 'user') {
    return '用户回答';
  }
  return '记录';
}

async function load() {
  if (!adminStore.token || !userId.value) {
    return;
  }

  loading.value = true;
  pageError.value = '';
  try {
    const payload = await fetchAdminUserDetail(adminStore.token, userId.value);
    detail.value = payload;
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    loading.value = false;
  }
}

async function changeStatus(status: UserStatus) {
  if (!adminStore.token || !user.value) {
    return;
  }

  try {
    await updateAdminUserStatus(adminStore.token, user.value.id, status);
    noticeStore.show('状态已更新', 'success');
    await load();
  } catch (error) {
    noticeStore.show(toErrorMessage(error), 'error');
  }
}

onMounted(() => {
  load();
});
</script>

<template>
  <AdminShell title="用户详情" subtitle="行为轨迹与 AI 记录">
    <section class="panel">
      <div class="panel-body row" style="justify-content: space-between">
        <button class="btn btn-ghost" type="button" @click="router.push('/admin/users')">返回用户列表</button>
        <button class="btn btn-ghost" type="button" :disabled="loading" @click="load">刷新</button>
      </div>
    </section>

    <section v-if="pageError" class="panel">
      <div class="panel-body"><span class="badge badge-danger">{{ pageError }}</span></div>
    </section>

    <section v-if="detail && user" class="panel">
      <div class="panel-body column">
        <div class="row" style="justify-content: space-between; align-items: flex-start">
          <div>
            <h2 class="panel-title">{{ user.username || user.id }}</h2>
            <p class="panel-subtitle">用户ID：{{ user.id }}</p>
          </div>
          <span class="badge" :class="statusBadgeClass(user.status)">{{ statusText(user.status) }}</span>
        </div>

        <div class="row-wrap">
          <button class="btn btn-ghost" type="button" @click="changeStatus('onboarding')">设为引导中</button>
          <button class="btn btn-secondary" type="button" @click="changeStatus('active')">设为正常</button>
          <button class="btn btn-danger" type="button" @click="changeStatus('restricted')">设为受限</button>
        </div>

        <div class="stats-grid">
          <article class="stat-card">
            <div class="stat-value">{{ detail.stats?.total_matches || 0 }}</div>
            <div class="stat-label">匹配总数</div>
          </article>
          <article class="stat-card">
            <div class="stat-value">{{ detail.stats?.sent_messages || 0 }}</div>
            <div class="stat-label">发送消息</div>
          </article>
          <article class="stat-card">
            <div class="stat-value">{{ detail.stats?.blocked_messages || 0 }}</div>
            <div class="stat-label">被拦截</div>
          </article>
          <article class="stat-card">
            <div class="stat-value">{{ detail.stats?.total_tokens || 0 }}</div>
            <div class="stat-label">Token 总量</div>
          </article>
        </div>
      </div>
    </section>

    <section v-if="detail" class="panel">
      <div class="panel-body column">
        <div class="segment">
          <button class="segment-btn" :class="activeTab === 'timeline' ? 'is-active' : ''" type="button" @click="activeTab = 'timeline'">
            时间线 {{ timelineItems.length }}
          </button>
          <button class="segment-btn" :class="activeTab === 'interview' ? 'is-active' : ''" type="button" @click="activeTab = 'interview'">
            访谈 {{ interviewRecords.length }}
          </button>
          <button class="segment-btn" :class="activeTab === 'tags' ? 'is-active' : ''" type="button" @click="activeTab = 'tags'">
            标签
          </button>
          <button class="segment-btn" :class="activeTab === 'ai_records' ? 'is-active' : ''" type="button" @click="activeTab = 'ai_records'">
            AI 记录 {{ aiRecordItems.length }}
          </button>
        </div>

        <!-- 时间线 -->
        <div v-if="activeTab === 'timeline'" class="column">
          <div class="card-list">
            <article v-for="item in timelinePageItems" :key="`${item.type}-${item.ts}-${item.title}`" class="list-card">
              <div class="row" style="justify-content: space-between">
                <strong>{{ item.title || item.type }}</strong>
                <span class="muted" style="font-size: 12px">{{ formatDateTime(item.ts) }}</span>
              </div>
              <div class="muted">{{ item.detail || '-' }}</div>
            </article>
            <div v-if="timelineItems.length === 0" class="empty-box">暂无时间线记录</div>
          </div>
          <div v-if="timelineTotalPages > 1" class="row" style="justify-content: center; gap: 8px; margin-top: 8px">
            <button class="btn btn-ghost" type="button" :disabled="timelinePage <= 1" @click="timelinePage--">上一页</button>
            <span class="muted" style="font-size: 13px">{{ timelinePage }} / {{ timelineTotalPages }}</span>
            <button class="btn btn-ghost" type="button" :disabled="timelinePage >= timelineTotalPages" @click="timelinePage++">下一页</button>
          </div>
        </div>

        <!-- 访谈记录 -->
        <div v-if="activeTab === 'interview'" class="column">
          <div class="card-list">
            <article
              v-for="row in interviewRecords"
              :key="row.id"
              class="list-card"
              style="gap: 6px"
            >
              <div class="row" style="justify-content: space-between">
                <span class="badge badge-muted">{{ interviewRoleText(row.role) }} #{{ row.turn_index }}</span>
                <span class="muted" style="font-size: 12px">{{ formatDateTime(row.created_at) }}</span>
              </div>
              <div>{{ row.content }}</div>
            </article>
            <div v-if="interviewRecords.length === 0" class="empty-box">暂无访谈记录</div>
          </div>
        </div>

        <!-- 标签 -->
        <div v-if="activeTab === 'tags'" class="column">
          <h4 class="panel-title">公开标签</h4>
          <p class="muted" style="margin: 0; font-size: 12px">
            标签来源：{{ detail.tag_source?.strategy || '优先 AI 生成，失败时回退到内置规则算法' }}。
          </p>
          <div class="tag-list">
            <span v-for="tag in detail.tags?.public || []" :key="tag.tag_name" class="tag">
              {{ tag.tag_name }} ({{ tag.weight }})
            </span>
          </div>
          <h4 class="panel-title" style="margin-top: 6px">隐藏标签（仅后台可见）</h4>
          <div class="tag-list">
            <span v-for="tag in detail.tags?.hidden || []" :key="tag.tag_name" class="tag">
              {{ tag.tag_name }} ({{ tag.weight }})
            </span>
          </div>
        </div>

        <!-- AI 记录 -->
        <div v-if="activeTab === 'ai_records'" class="column">
          <div class="table-wrap">
            <table class="table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>功能</th>
                  <th>模型</th>
                  <th>Token</th>
                  <th>费用</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in aiRecordsPageItems" :key="row.id">
                  <td>{{ formatTime(row.created_at) }}</td>
                  <td>{{ row.feature }}</td>
                  <td>{{ row.model }}</td>
                  <td>{{ row.total_tokens }}</td>
                  <td>{{ row.estimated_cost_usd }}</td>
                </tr>
                <tr v-if="aiRecordItems.length === 0">
                  <td colspan="5" class="muted">暂无记录</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="aiRecordsTotalPages > 1" class="row" style="justify-content: center; gap: 8px; margin-top: 8px">
            <button class="btn btn-ghost" type="button" :disabled="aiRecordsPage <= 1" @click="aiRecordsPage--">上一页</button>
            <span class="muted" style="font-size: 13px">{{ aiRecordsPage }} / {{ aiRecordsTotalPages }}</span>
            <button class="btn btn-ghost" type="button" :disabled="aiRecordsPage >= aiRecordsTotalPages" @click="aiRecordsPage++">下一页</button>
          </div>
