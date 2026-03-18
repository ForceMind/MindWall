<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import AdminShell from '@/components/AdminShell.vue';
import {
  fetchAdminMatches,
  fetchAdminMatchMessages,
  type AdminMatch,
  type AdminMatchMessage,
} from '@/lib/admin-api';
import { formatDateTime, formatTime } from '@/lib/format';
import { toErrorMessage } from '@/lib/api-error';
import { useAdminSessionStore } from '@/stores/admin-session';

const router = useRouter();
const adminStore = useAdminSessionStore();

const loading = ref(false);
const pageError = ref('');
const matchPage = ref(1);
const matchLimit = 20;
const matchTotal = ref(0);
const matches = ref<AdminMatch[]>([]);

const selectedMatchId = ref<string | null>(null);
const msgLoading = ref(false);
const msgPage = ref(1);
const msgLimit = 50;
const msgTotal = ref(0);
const messages = ref<AdminMatchMessage[]>([]);
const matchInfo = ref<{ id: string; user_a_id: string; user_b_id: string; status: string; resonance_score: number; wall_broken_at: string | null } | null>(null);

const matchTotalPages = computed(() => Math.max(1, Math.ceil(matchTotal.value / matchLimit)));
const msgTotalPages = computed(() => Math.max(1, Math.ceil(msgTotal.value / msgLimit)));

function userName(u: { username: string | null; anonymous_name: string | null; user_id: string }) {
  return u.anonymous_name || u.username || u.user_id.slice(0, 8);
}

function matchStatusText(status: string) {
  switch (status) {
    case 'pending': return '待确认';
    case 'active_sandbox': return '沙盒中';
    case 'wall_broken': return '已破壁';
    case 'rejected': return '已拒绝';
    default: return status;
  }
}

function aiActionText(action: string) {
  switch (action) {
    case 'passed': return '通过';
    case 'modified': return '改写';
    case 'blocked': return '拦截';
    default: return action;
  }
}

async function loadMatches() {
  if (!adminStore.token) return;
  loading.value = true;
  pageError.value = '';
  try {
    const payload = await fetchAdminMatches(adminStore.token, matchPage.value, matchLimit);
    matches.value = payload.matches;
    matchTotal.value = payload.total;
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    loading.value = false;
  }
}

async function loadMessages() {
  if (!adminStore.token || !selectedMatchId.value) return;
  msgLoading.value = true;
  try {
    const payload = await fetchAdminMatchMessages(adminStore.token, selectedMatchId.value, msgPage.value, msgLimit);
    messages.value = payload.messages;
    msgTotal.value = payload.total;
    matchInfo.value = payload.match;
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    msgLoading.value = false;
  }
}

function selectMatch(matchId: string) {
  selectedMatchId.value = matchId;
  msgPage.value = 1;
  loadMessages();
}

function closeMessages() {
  selectedMatchId.value = null;
  messages.value = [];
  matchInfo.value = null;
}

watch(matchPage, () => loadMatches());
watch(msgPage, () => loadMessages());

onMounted(() => {
  loadMatches();
});
</script>

<template>
  <AdminShell title="会话管理" subtitle="查看所有匹配与聊天记录">
    <section class="panel">
      <div class="panel-body row" style="justify-content: space-between">
        <span class="muted" style="font-size: 13px">共 {{ matchTotal }} 个匹配</span>
        <button class="btn btn-ghost" type="button" :disabled="loading" @click="loadMatches">刷新</button>
      </div>
    </section>

    <section v-if="pageError" class="panel">
      <div class="panel-body"><span class="badge badge-danger">{{ pageError }}</span></div>
    </section>

    <!-- 消息详情 -->
    <section v-if="selectedMatchId && matchInfo" class="panel">
      <div class="panel-body column">
        <div class="row" style="justify-content: space-between; align-items: flex-start">
          <div>
            <h3 class="panel-title">聊天记录</h3>
            <p class="panel-subtitle">
              匹配 {{ matchInfo.id.slice(0, 8) }} · {{ matchStatusText(matchInfo.status) }} · 共鸣值 {{ matchInfo.resonance_score }} · {{ msgTotal }} 条消息
            </p>
          </div>
          <button class="btn btn-ghost" type="button" @click="closeMessages">关闭</button>
        </div>

        <div v-if="msgLoading" class="empty-box">加载中...</div>
        <div v-else-if="messages.length === 0" class="empty-box">暂无消息</div>

        <div v-else class="card-list">
          <article v-for="msg in messages" :key="msg.id" class="list-card" style="gap: 4px">
            <div class="row" style="justify-content: space-between">
              <strong>{{ msg.sender_name }}</strong>
              <div class="row" style="gap: 6px">
                <span class="badge badge-muted">{{ aiActionText(msg.ai_action) }}</span>
                <span class="muted" style="font-size: 12px">{{ formatDateTime(msg.created_at) }}</span>
              </div>
            </div>
            <div>{{ msg.ai_rewritten_text }}</div>
            <div v-if="msg.ai_action === 'modified' && msg.original_text !== msg.ai_rewritten_text" class="muted" style="font-size: 12px">
              原文：{{ msg.original_text }}
            </div>
          </article>
        </div>

        <div v-if="msgTotalPages > 1" class="row" style="justify-content: center; gap: 8px; margin-top: 8px">
          <button class="btn btn-ghost" type="button" :disabled="msgPage <= 1" @click="msgPage--">上一页</button>
          <span class="muted" style="font-size: 13px">{{ msgPage }} / {{ msgTotalPages }}</span>
          <button class="btn btn-ghost" type="button" :disabled="msgPage >= msgTotalPages" @click="msgPage++">下一页</button>
        </div>
      </div>
    </section>

    <!-- 匹配列表 -->
    <section class="panel">
      <div class="panel-body column">
        <div v-if="loading" class="empty-box">加载中...</div>
        <div v-else-if="matches.length === 0" class="empty-box">暂无匹配记录</div>

        <div v-else class="card-list">
          <article v-for="m in matches" :key="m.id" class="list-card">
            <div class="row" style="justify-content: space-between; align-items: flex-start">
              <div style="min-width: 0">
                <div style="font-weight: 700">{{ userName(m.user_a) }} ↔ {{ userName(m.user_b) }}</div>
                <div class="muted" style="font-size: 12px">
                  {{ m.id.slice(0, 8) }} · {{ matchStatusText(m.status) }} · 共鸣 {{ m.resonance_score }} · {{ m.message_count }} 条消息
                </div>
              </div>
              <span class="muted" style="font-size: 12px; white-space: nowrap">{{ formatTime(m.updated_at) }}</span>
            </div>

            <p v-if="m.ai_match_reason" class="muted" style="margin: 0; font-size: 12px">{{ m.ai_match_reason }}</p>

            <div class="row" style="justify-content: flex-end; gap: 8px">
              <button class="btn btn-ghost" type="button" @click="router.push(`/admin/users/${m.user_a.user_id}`)">
                查看 {{ userName(m.user_a) }}
              </button>
              <button class="btn btn-ghost" type="button" @click="router.push(`/admin/users/${m.user_b.user_id}`)">
                查看 {{ userName(m.user_b) }}
              </button>
              <button class="btn btn-primary" type="button" @click="selectMatch(m.id)">
                查看消息
              </button>
            </div>
          </article>
        </div>

        <div v-if="matchTotalPages > 1" class="row" style="justify-content: center; gap: 8px; margin-top: 8px">
          <button class="btn btn-ghost" type="button" :disabled="matchPage <= 1" @click="matchPage--">上一页</button>
          <span class="muted" style="font-size: 13px">{{ matchPage }} / {{ matchTotalPages }}</span>
          <button class="btn btn-ghost" type="button" :disabled="matchPage >= matchTotalPages" @click="matchPage++">下一页</button>
        </div>
      </div>
    </section>
  </AdminShell>
</template>
