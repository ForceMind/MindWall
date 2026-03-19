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

const activeTab = ref<'timeline' | 'ai' | 'interview'>('timeline');
const timelinePage = ref(1);
const aiPage = ref(1);
const activeInterviewSession = ref('');
const PAGE_SIZE = 15;

const paginatedTimeline = computed(() => {
  const all = detail.value?.timeline || [];
  const start = (timelinePage.value - 1) * PAGE_SIZE;
  return all.slice(start, start + PAGE_SIZE);
});
const timelineTotalPages = computed(() => Math.max(1, Math.ceil((detail.value?.timeline?.length || 0) / PAGE_SIZE)));

const paginatedAiRecords = computed(() => {
  const all = detail.value?.recent?.ai_records || [];
  const start = (aiPage.value - 1) * PAGE_SIZE;
  return all.slice(start, start + PAGE_SIZE);
});
const aiTotalPages = computed(() => Math.max(1, Math.ceil((detail.value?.recent?.ai_records?.length || 0) / PAGE_SIZE)));

const interviewSessionList = computed(() => detail.value?.interview?.sessions || []);
const activeSessionMeta = computed(() => interviewSessionList.value.find((s: any) => s.id === activeInterviewSession.value));
const activeInterviewRecords = computed(() => {
  const all = detail.value?.interview?.records || [];
  if (!activeInterviewSession.value) return all;
  return all.filter((r: any) => r.session_id === activeInterviewSession.value);
});

function sessionTypeLabel(type?: string) {
  if (type === 'deep') return '深度访谈';
  if (type === 'refresh') return '标签刷新';
  return '初次访谈';
}

const userId = computed(() => String(route.params.userId || ''));
const user = computed(() => detail.value?.user || null);

async function load() {
  if (!adminStore.token || !userId.value) {
    return;
  }

  loading.value = true;
  pageError.value = '';
  try {
    const payload = await fetchAdminUserDetail(adminStore.token, userId.value);
    detail.value = payload;
    const sessions = payload?.interview?.sessions || [];
    if (sessions.length > 0 && !activeInterviewSession.value) {
      activeInterviewSession.value = sessions[0].id;
    }
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
        <h3 class="panel-title">公开标签</h3>
        <div class="tag-list">
          <span v-for="tag in detail.tags?.public || []" :key="tag.tag_name" class="tag">
            {{ tag.tag_name }} ({{ tag.weight }})
          </span>
        </div>

        <h3 class="panel-title" style="margin-top: 6px">隐藏标签（仅后台可见）</h3>
        <div class="tag-list">
          <span v-for="tag in detail.tags?.hidden || []" :key="tag.tag_name" class="tag">
            {{ tag.tag_name }} ({{ tag.weight }})
          </span>
        </div>
      </div>
    </section>

    <section v-if="detail" class="panel">
      <div class="panel-body column">
        <div class="tabs" style="display: flex; gap: 8px; margin-bottom: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">
          <button 
            :class="['btn', activeTab === 'timeline' ? 'btn-primary' : 'btn-ghost']" 
            @click="activeTab = 'timeline'"
          >
            时间线
          </button>
          <button 
            :class="['btn', activeTab === 'ai' ? 'btn-primary' : 'btn-ghost']" 
            @click="activeTab = 'ai'"
          >
            最近 AI 记录
          </button>
          <button 
            :class="['btn', activeTab === 'interview' ? 'btn-primary' : 'btn-ghost']" 
            @click="activeTab = 'interview'"
          >
            访谈记录 ({{ detail?.interview?.total_turns || 0 }})
          </button>
        </div>

        <div v-if="activeTab === 'timeline'">
          <div class="card-list">
            <article v-for="item in paginatedTimeline" :key="`${item.type}-${item.ts}-${item.title}`" class="list-card">
              <div class="row" style="justify-content: space-between">
                <strong>{{ item.title || item.type }}</strong>
                <span class="muted" style="font-size: 12px">{{ formatDateTime(item.ts) }}</span>
              </div>
              <div class="muted">{{ item.detail || '-' }}</div>
            </article>

            <div v-if="paginatedTimeline.length === 0" class="empty-box">暂无时间线记录</div>
          </div>
          
          <div class="pager" v-if="timelineTotalPages > 1" style="margin-top: 16px;">
            <button class="btn btn-ghost" type="button" :disabled="timelinePage <= 1" @click="timelinePage -= 1">上一页</button>
            <span class="muted">第 {{ timelinePage }} / {{ timelineTotalPages }} 页 (共 {{ detail.timeline?.length || 0 }} 条)</span>
            <button class="btn btn-ghost" type="button" :disabled="timelinePage >= timelineTotalPages" @click="timelinePage += 1">下一页</button>
          </div>
        </div>

        <div v-if="activeTab === 'ai'">
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
                <tr v-for="row in paginatedAiRecords" :key="row.id">
                  <td>{{ formatTime(row.created_at) }}</td>
                  <td>{{ row.feature }}</td>
                  <td>{{ row.model }}</td>
                  <td>{{ row.total_tokens }}</td>
                  <td>{{ row.estimated_cost_usd }}</td>
                </tr>
                <tr v-if="paginatedAiRecords.length === 0">
                  <td colspan="5" class="muted">暂无记录</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div class="pager" v-if="aiTotalPages > 1" style="margin-top: 16px;">
            <button class="btn btn-ghost" type="button" :disabled="aiPage <= 1" @click="aiPage -= 1">上一页</button>
            <span class="muted">第 {{ aiPage }} / {{ aiTotalPages }} 页 (共 {{ detail.recent?.ai_records?.length || 0 }} 条)</span>
            <button class="btn btn-ghost" type="button" :disabled="aiPage >= aiTotalPages" @click="aiPage += 1">下一页</button>
          </div>
        </div>

        <div v-if="activeTab === 'interview'">
          <div v-if="interviewSessionList.length > 0" class="tabs" style="display: flex; gap: 6px; margin-bottom: 12px; flex-wrap: wrap;">
            <button
              v-for="(sess, idx) in interviewSessionList"
              :key="sess.id"
              :class="['btn', activeInterviewSession === sess.id ? 'btn-secondary' : 'btn-ghost']"
              style="font-size: 13px"
              @click="activeInterviewSession = sess.id"
            >
              {{ sessionTypeLabel(sess.type) }} #{{ idx + 1 }}
              <span v-if="sess.status !== 'completed'" class="badge badge-warning" style="margin-left: 4px; font-size: 10px">进行中</span>
            </button>
          </div>

          <div v-if="activeInterviewSession" style="margin-bottom: 10px">
            <span class="muted" style="font-size: 12px">
              {{ sessionTypeLabel(activeSessionMeta?.type) }}
              · 共 {{ activeSessionMeta?.total_questions }} 题
              · 已答 {{ activeSessionMeta?.answer_count }} 题
              · {{ formatDateTime(activeSessionMeta?.created_at) }}
            </span>
          </div>

          <div class="card-list">
            <article
              v-for="record in activeInterviewRecords"
              :key="record.id"
              class="list-card"
              :style="{ borderLeft: record.role === 'assistant' ? '3px solid var(--accent-cool, #3baa85)' : '3px solid var(--border-color)' }"
            >
              <div class="row" style="justify-content: space-between; margin-bottom: 4px">
                <strong>{{ record.role === 'assistant' ? '🤖 AI 提问' : '👤 用户回答' }}</strong>
                <span class="muted" style="font-size: 12px">{{ formatDateTime(record.created_at) }}</span>
              </div>
              <div style="white-space: pre-wrap; line-height: 1.6">{{ record.content }}</div>
              <div class="muted" style="font-size: 11px; margin-top: 4px">轮次 {{ record.turn_index + 1 }}</div>
            </article>

            <div v-if="activeInterviewRecords.length === 0" class="empty-box">
              {{ interviewSessionList.length === 0 ? '暂无访谈记录' : '该会话暂无记录' }}
            </div>
          </div>
        </div>
      </div>
    </section>
  </AdminShell>
</template>
