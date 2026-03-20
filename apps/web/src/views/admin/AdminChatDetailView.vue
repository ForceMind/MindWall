<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AdminShell from '@/components/AdminShell.vue';
import {
  fetchAdminMatchMessages,
  fetchAdminCompanionSessionMessages,
  type AdminMatchMessage,
  type AdminCompanionMessage,
} from '@/lib/admin-api';
import { formatTime } from '@/lib/format';
import { toErrorMessage } from '@/lib/api-error';
import { useAdminSessionStore } from '@/stores/admin-session';

const route = useRoute();
const router = useRouter();
const adminStore = useAdminSessionStore();

const chatType = computed(() => String(route.params.type || 'match'));
const sessionId = computed(() => String(route.params.id || ''));

const loading = ref(false);
const pageError = ref('');

// Match data
const matchMessages = ref<AdminMatchMessage[]>([]);
const matchInfo = ref<{
  id: string;
  user_a_id: string;
  user_b_id: string;
  user_a_name: string;
  user_b_name: string;
  status: string;
  resonance_score: number;
  wall_broken_at: string | null;
} | null>(null);
const matchPage = ref(1);
const matchLimit = 100;
const matchTotal = ref(0);

// Companion data
const companionMessages = ref<AdminCompanionMessage[]>([]);
const companionInfo = ref<{
  id: string;
  user_id: string;
  user_name: string;
  persona_id: string;
  persona_name: string;
  status: string;
} | null>(null);

// Perspective switching (for match: 'a' or 'b'; for companion: 'user' or 'ai')
const perspective = ref<'a' | 'b' | 'user' | 'ai'>('a');

const matchTotalPages = computed(() => Math.max(1, Math.ceil(matchTotal.value / matchLimit)));

const title = computed(() => {
  if (chatType.value === 'match' && matchInfo.value) {
    return `${matchInfo.value.user_a_name} ↔ ${matchInfo.value.user_b_name}`;
  }
  if (chatType.value === 'companion' && companionInfo.value) {
    return `${companionInfo.value.user_name} ↔ ${companionInfo.value.persona_name}`;
  }
  return '会话详情';
});

interface BubbleMessage {
  id: string;
  text: string;
  originalText?: string;
  mine: boolean;
  kind: 'text' | 'ai-relay';
  senderName: string;
  aiAction?: string;
  time: string;
}

const bubbleMessages = computed<BubbleMessage[]>(() => {
  if (chatType.value === 'match') {
    return matchMessages.value.map((m) => {
      const isWallBroken = matchInfo.value?.status === 'wall_broken';
      const viewAsA = perspective.value === 'a';
      const isMySender = viewAsA
        ? m.sender_id === matchInfo.value?.user_a_id
        : m.sender_id === matchInfo.value?.user_b_id;

      if (m.ai_action === 'blocked') {
        return {
          id: m.id,
          text: isMySender ? '你的消息被安全层拦截' : '对方的消息被安全层拦截',
          mine: isMySender,
          kind: 'text' as const,
          senderName: m.sender_name,
          aiAction: m.ai_action,
          time: m.created_at,
        };
      }

      const isModified = m.ai_action === 'modified' || m.original_text !== m.ai_rewritten_text;

      if (isWallBroken) {
        return {
          id: m.id,
          text: m.ai_rewritten_text,
          mine: isMySender,
          kind: 'text' as const,
          senderName: m.sender_name,
          time: m.created_at,
        };
      }

      if (isMySender) {
        // Sender sees their original text and the AI rewrite note
        return {
          id: m.id,
          text: m.ai_rewritten_text,
          originalText: isModified ? m.original_text : undefined,
          mine: true,
          kind: isModified ? 'ai-relay' as const : 'text' as const,
          senderName: m.sender_name,
          aiAction: m.ai_action,
          time: m.created_at,
        };
      }

      // Receiver sees the AI-rewritten version
      return {
        id: m.id,
        text: m.ai_rewritten_text,
        mine: false,
        kind: isModified ? 'ai-relay' as const : 'text' as const,
        senderName: m.sender_name,
        aiAction: m.ai_action,
        time: m.created_at,
      };
    });
  }

  // Companion messages
  return companionMessages.value.map((m) => {
    const viewAsUser = perspective.value === 'user';
    const isUserMsg = m.sender_type === 'user';
    const isMine = viewAsUser ? isUserMsg : !isUserMsg;
    const hasRelay = !!m.relay_text;
    return {
      id: m.id,
      text: hasRelay ? m.relay_text! : m.ai_rewritten_text,
      originalText: hasRelay ? m.ai_rewritten_text : undefined,
      mine: isMine,
      kind: hasRelay ? 'ai-relay' as const : 'text' as const,
      senderName: m.sender_name,
      time: m.created_at,
    };
  });
});

function statusText(status: string) {
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
  return 'badge-accent';
}

async function loadMatchMessages() {
  if (!adminStore.token) return;
  loading.value = true;
  pageError.value = '';
  try {
    const payload = await fetchAdminMatchMessages(adminStore.token, sessionId.value, matchPage.value, matchLimit);
    matchMessages.value = payload.messages;
    matchTotal.value = payload.total;

    // Resolve user names from messages
    const namesA = new Set<string>();
    const namesB = new Set<string>();
    for (const m of payload.messages) {
      if (m.sender_id === payload.match.user_a_id) namesA.add(m.sender_name);
      else namesB.add(m.sender_name);
    }

    matchInfo.value = {
      ...payload.match,
      user_a_name: [...namesA][0] || payload.match.user_a_id.slice(0, 8),
      user_b_name: [...namesB][0] || payload.match.user_b_id.slice(0, 8),
    };
    perspective.value = 'a';
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    loading.value = false;
  }
}

async function loadCompanionMessages() {
  if (!adminStore.token) return;
  loading.value = true;
  pageError.value = '';
  try {
    const payload = await fetchAdminCompanionSessionMessages(adminStore.token, sessionId.value);
    companionMessages.value = payload.messages;
    companionInfo.value = payload.session;
    perspective.value = 'user';
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    loading.value = false;
  }
}

let refreshTimer: ReturnType<typeof setInterval> | null = null;

async function silentRefreshCompanion() {
  if (!adminStore.token) return;
  try {
    const payload = await fetchAdminCompanionSessionMessages(adminStore.token, sessionId.value);
    if (payload.messages.length !== companionMessages.value.length) {
      companionMessages.value = payload.messages;
      companionInfo.value = payload.session;
    }
  } catch { /* silent */ }
}

async function silentRefreshMatch() {
  if (!adminStore.token) return;
  try {
    const payload = await fetchAdminMatchMessages(adminStore.token, sessionId.value, matchPage.value, matchLimit);
    if (payload.messages.length !== matchMessages.value.length) {
      matchMessages.value = payload.messages;
      matchTotal.value = payload.total;
    }
  } catch { /* silent */ }
}

onMounted(() => {
  if (chatType.value === 'match') {
    loadMatchMessages();
    refreshTimer = setInterval(silentRefreshMatch, 8000);
  } else {
    loadCompanionMessages();
    refreshTimer = setInterval(silentRefreshCompanion, 8000);
  }
});

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
});
</script>

<template>
  <AdminShell :title="title" subtitle="会话详情 · 管理后台">
    <!-- 头部信息 -->
    <section class="panel">
      <div class="panel-body column">
        <div class="row" style="justify-content: space-between; flex-wrap: wrap; gap: 8px">
          <button class="btn btn-ghost" type="button" @click="router.push('/admin/chats')">← 返回列表</button>
          <div v-if="chatType === 'match' && matchInfo" class="row-wrap">
            <span class="badge" :class="statusBadge(matchInfo.status)">{{ statusText(matchInfo.status) }}</span>
            <span class="badge badge-muted">共鸣 {{ matchInfo.resonance_score }}</span>
            <span class="badge badge-muted">{{ matchTotal }} 条消息</span>
          </div>
          <div v-if="chatType === 'companion' && companionInfo" class="row-wrap">
            <span class="badge" :class="statusBadge(companionInfo.status)">{{ statusText(companionInfo.status) }}</span>
            <span class="badge badge-muted">角色: {{ companionInfo.persona_id }}</span>
            <span class="badge badge-muted">{{ companionMessages.length }} 条消息</span>
          </div>
        </div>

        <!-- 视角切换 -->
        <div class="row-wrap" style="margin-top: 6px">
          <span class="muted" style="font-size: 13px">观察视角：</span>
          <template v-if="chatType === 'match' && matchInfo">
            <button class="btn" :class="perspective === 'a' ? 'btn-primary' : 'btn-ghost'" type="button" style="padding: 6px 12px; font-size: 13px" @click="perspective = 'a'">
              {{ matchInfo.user_a_name }}
            </button>
            <button class="btn" :class="perspective === 'b' ? 'btn-primary' : 'btn-ghost'" type="button" style="padding: 6px 12px; font-size: 13px" @click="perspective = 'b'">
              {{ matchInfo.user_b_name }}
            </button>
          </template>
          <template v-if="chatType === 'companion' && companionInfo">
            <button class="btn" :class="perspective === 'user' ? 'btn-primary' : 'btn-ghost'" type="button" style="padding: 6px 12px; font-size: 13px" @click="perspective = 'user'">
              {{ companionInfo.user_name }}（用户）
            </button>
            <button class="btn" :class="perspective === 'ai' ? 'btn-primary' : 'btn-ghost'" type="button" style="padding: 6px 12px; font-size: 13px" @click="perspective = 'ai'">
              {{ companionInfo.persona_name }}（AI）
            </button>
          </template>
        </div>
      </div>
    </section>

    <section v-if="pageError" class="panel">
      <div class="panel-body"><span class="badge badge-danger">{{ pageError }}</span></div>
    </section>

    <!-- 聊天气泡区域 -->
    <section class="panel message-panel">
      <div class="message-list" style="padding: 12px 16px; max-height: calc(100dvh - 320px)">
        <div v-if="loading" class="bubble system">正在加载会话...</div>
        <div v-else-if="bubbleMessages.length === 0" class="bubble system">暂无消息</div>

        <div
          v-for="item in bubbleMessages"
          :key="item.id"
          class="bubble"
          :class="[item.mine ? 'me' : '', item.kind === 'ai-relay' ? 'ai-relay' : '']"
        >
          <div style="font-size: 11px; font-weight: 700; margin-bottom: 4px; opacity: 0.6">{{ item.senderName }}</div>
          <div>{{ item.text }}</div>
          <div v-if="item.kind === 'ai-relay' && item.originalText" class="original-text">
            <span class="original-label">原文：</span>{{ item.originalText }}
          </div>
          <div v-if="item.aiAction" style="font-size: 10px; color: var(--accent-cool); margin-top: 2px">AI: {{ item.aiAction === 'passed' ? '通过' : item.aiAction === 'modified' ? '改写' : item.aiAction === 'blocked' ? '拦截' : item.aiAction }}</div>
          <div class="bubble-meta">{{ formatTime(item.time) }}</div>
        </div>
      </div>

      <!-- Match pagination -->
      <div v-if="chatType === 'match' && matchTotalPages > 1" class="row" style="justify-content: center; gap: 8px; padding: 8px 16px">
        <button class="btn btn-ghost" type="button" :disabled="matchPage <= 1" @click="matchPage--; loadMatchMessages()">上一页</button>
        <span class="muted" style="font-size: 13px">{{ matchPage }} / {{ matchTotalPages }}</span>
        <button class="btn btn-ghost" type="button" :disabled="matchPage >= matchTotalPages" @click="matchPage++; loadMatchMessages()">下一页</button>
      </div>
    </section>
  </AdminShell>
</template>
