<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import AdminShell from '@/components/AdminShell.vue';
import {
  fetchAdminMatches,
  fetchAdminCompanionSessions,
  type AdminMatch,
  type AdminCompanionSession,
} from '@/lib/admin-api';
import { formatTime } from '@/lib/format';
import { toErrorMessage } from '@/lib/api-error';
import { useAdminSessionStore } from '@/stores/admin-session';

const router = useRouter();
const adminStore = useAdminSessionStore();

const activeTab = ref<'active' | 'history'>('active');
const sessionType = ref<'match' | 'companion'>('match');
const searchQuery = ref('');
const searchInput = ref('');

const loading = ref(false);
const pageError = ref('');
const page = ref(1);
const limit = 20;
const total = ref(0);

const matches = ref<AdminMatch[]>([]);
const companionSessions = ref<AdminCompanionSession[]>([]);

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / limit)));

function userName(u: { username: string | null; anonymous_name: string | null; user_id: string }) {
  return u.anonymous_name || u.username || u.user_id.slice(0, 8);
}

function matchStatusText(status: string) {
  switch (status) {
    case 'pending': return '待确认';
    case 'active_sandbox': return '沙盒中';
    case 'wall_broken': return '已破壁';
    case 'rejected': return '已拒绝';
    case 'active': return '进行中';
    case 'active_chat': return '陪聊中';
    default: return status;
  }
}

function statusBadge(status: string) {
  if (status === 'wall_broken' || status === 'active') return 'badge-success';
  if (status === 'rejected') return 'badge-danger';
  if (status === 'active_sandbox' || status === 'pending' || status === 'active_chat') return 'badge-accent';
  return 'badge-muted';
}

async function load() {
  if (!adminStore.token) return;
  loading.value = true;
  pageError.value = '';
  try {
    if (sessionType.value === 'match') {
      const payload = await fetchAdminMatches(adminStore.token, page.value, limit, activeTab.value, searchQuery.value);
      matches.value = payload.matches;
      total.value = payload.total;
      companionSessions.value = [];
    } else {
      const payload = await fetchAdminCompanionSessions(adminStore.token, page.value, limit, activeTab.value, searchQuery.value);
      companionSessions.value = payload.sessions;
      total.value = payload.total;
      matches.value = [];
    }
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    loading.value = false;
  }
}

function doSearch() {
  searchQuery.value = searchInput.value.trim();
  page.value = 1;
  load();
}

function switchTab(tab: 'active' | 'history') {
  activeTab.value = tab;
  page.value = 1;
  load();
}

function switchType(type: 'match' | 'companion') {
  sessionType.value = type;
  page.value = 1;
  load();
}

function openMatchDetail(matchId: string) {
  router.push(`/admin/chats/match/${matchId}`);
}

function openCompanionDetail(sessionId: string) {
  router.push(`/admin/chats/companion/${sessionId}`);
}

watch(page, () => load());

onMounted(() => {
  load();
});
</script>

<template>
  <AdminShell title="会话管理" subtitle="查看所有匹配与聊天记录">
    <!-- 搜索栏 -->
    <section class="panel">
      <div class="panel-body column">
        <div class="row" style="justify-content: space-between; flex-wrap: wrap; gap: 8px">
          <div class="row-wrap">
            <button class="btn" :class="sessionType === 'match' ? 'btn-primary' : 'btn-ghost'" type="button" @click="switchType('match')">用户匹配</button>
            <button class="btn" :class="sessionType === 'companion' ? 'btn-primary' : 'btn-ghost'" type="button" @click="switchType('companion')">AI 会话</button>
          </div>
          <div class="row-wrap">
            <button class="btn" :class="activeTab === 'active' ? 'btn-secondary' : 'btn-ghost'" type="button" @click="switchTab('active')">进行中</button>
            <button class="btn" :class="activeTab === 'history' ? 'btn-secondary' : 'btn-ghost'" type="button" @click="switchTab('history')">历史</button>
          </div>
        </div>
        <div class="row" style="gap: 8px">
          <input v-model="searchInput" class="input" type="text" placeholder="搜索用户名 / 匿名名 / 用户 ID" style="flex: 1" @keyup.enter="doSearch" />
          <button class="btn btn-ghost" type="button" @click="doSearch">搜索</button>
          <button class="btn btn-ghost" type="button" :disabled="loading" @click="searchInput = ''; doSearch()">重置</button>
        </div>
        <span class="muted" style="font-size: 13px">共 {{ total }} 条记录</span>
      </div>
    </section>

    <section v-if="pageError" class="panel">
      <div class="panel-body"><span class="badge badge-danger">{{ pageError }}</span></div>
    </section>

    <!-- 匹配列表 -->
    <section v-if="sessionType === 'match'" class="panel">
      <div class="panel-body column">
        <div v-if="loading" class="empty-box">加载中...</div>
        <div v-else-if="matches.length === 0" class="empty-box">暂无匹配记录</div>

        <div v-else class="card-list">
          <article v-for="m in matches" :key="m.id" class="list-card">
            <div class="row" style="justify-content: space-between; align-items: flex-start">
              <div style="min-width: 0">
                <div style="font-weight: 700">{{ userName(m.user_a) }} ↔ {{ userName(m.user_b) }}</div>
                <div class="muted" style="font-size: 12px">
                  {{ m.id.slice(0, 8) }} · <span class="badge" :class="statusBadge(m.status)" style="font-size: 11px">{{ matchStatusText(m.status) }}</span> · 共鸣 {{ m.resonance_score }} · {{ m.message_count }} 条消息
                </div>
              </div>
              <span class="muted" style="font-size: 12px; white-space: nowrap">{{ formatTime(m.updated_at) }}</span>
            </div>

            <div class="row" style="justify-content: flex-end; gap: 8px">
              <button class="btn btn-ghost" type="button" @click="router.push(`/admin/users/${m.user_a.user_id}`)">
                查看 {{ userName(m.user_a) }}
              </button>
              <button class="btn btn-ghost" type="button" @click="router.push(`/admin/users/${m.user_b.user_id}`)">
                查看 {{ userName(m.user_b) }}
              </button>
              <button class="btn btn-primary" type="button" @click="openMatchDetail(m.id)">
                查看消息
              </button>
            </div>
          </article>
        </div>
      </div>
    </section>

    <!-- AI 会话列表 -->
    <section v-if="sessionType === 'companion'" class="panel">
      <div class="panel-body column">
        <div v-if="loading" class="empty-box">加载中...</div>
        <div v-else-if="companionSessions.length === 0" class="empty-box">暂无 AI 会话记录</div>

        <div v-else class="card-list">
          <article v-for="s in companionSessions" :key="s.id" class="list-card">
            <div class="row" style="justify-content: space-between; align-items: flex-start">
              <div style="min-width: 0">
                <div style="font-weight: 700">{{ userName(s.user) }} ↔ {{ s.persona_name }}</div>
                <div class="muted" style="font-size: 12px">
                  {{ s.id.slice(0, 8) }} · <span class="badge" :class="statusBadge(s.status)" style="font-size: 11px">{{ matchStatusText(s.status) }}</span> · {{ s.message_count }} 条消息 · 角色: {{ s.persona_id }}
                </div>
              </div>
              <span class="muted" style="font-size: 12px; white-space: nowrap">{{ formatTime(s.updated_at) }}</span>
            </div>

            <div class="row" style="justify-content: flex-end; gap: 8px">
              <button class="btn btn-ghost" type="button" @click="router.push(`/admin/users/${s.user_id}`)">
                查看用户
              </button>
              <button class="btn btn-primary" type="button" @click="openCompanionDetail(s.id)">
                查看消息
              </button>
            </div>
          </article>
        </div>
      </div>
    </section>

    <!-- 分页 -->
    <div v-if="totalPages > 1" class="row" style="justify-content: center; gap: 8px; margin-top: 8px">
      <button class="btn btn-ghost" type="button" :disabled="page <= 1" @click="page--">上一页</button>
      <span class="muted" style="font-size: 13px">{{ page }} / {{ totalPages }}</span>
      <button class="btn btn-ghost" type="button" :disabled="page >= totalPages" @click="page++">下一页</button>
    </div>
  </AdminShell>
</template>
