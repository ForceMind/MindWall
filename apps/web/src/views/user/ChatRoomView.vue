<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import UserShell from '@/components/UserShell.vue';
import { askCompanion, fetchCompanionMessages, fetchMatchMessages, fetchWallState, type SandboxMessage } from '@/lib/user-api';
import { formatTime } from '@/lib/format';
import { toErrorMessage } from '@/lib/api-error';
import { SandboxSocket, type SandboxInbound } from '@/lib/sandbox-socket';
import { useNoticeStore } from '@/stores/notice';
import { useUserSessionStore } from '@/stores/user-session';

interface UiMessage {
  id: string;
  text: string;
  originalText?: string;
  mine: boolean;
  kind: 'text' | 'system' | 'ai-relay';
  time: string;
  aiAction?: string;
}

interface WallStatus {
  status: string;
  resonanceScore: number;
  wallReady: boolean;
  wallBroken: boolean;
  requesterAccepted: boolean;
  counterpartAccepted: boolean;
}

const route = useRoute();
const router = useRouter();
const userStore = useUserSessionStore();
const noticeStore = useNoticeStore();

const loading = ref(false);
const sending = ref(false);
const pageError = ref('');
const isPeerOffline = ref(false);
const inputText = ref('');
const title = ref('会话');
const messages = ref<UiMessage[]>([]);
  const aiSessionId = ref('');
  const actualPersonaId = ref('');
const listRef = ref<HTMLElement | null>(null);
const userScrolledUp = ref(false);
const wall = ref<WallStatus>({
  status: 'pending',
  resonanceScore: 0,
  wallReady: false,
  wallBroken: false,
  requesterAccepted: false,
  counterpartAccepted: false,
});

const socketRef = ref<SandboxSocket | null>(null);
const unregisterSocket = ref<(() => void) | null>(null);
const messageIdSet = new Set<string>();

const kind = computed(() => String(route.params.kind || 'match'));
const id = computed(() => String(route.params.id || ''));
const isMatchChat = computed(() => kind.value === 'match');
const canBreakWall = computed(() => wall.value.wallReady && !wall.value.wallBroken);

function aiHistoryKey() { return `youjian.ai.chat.${id.value}`; }

function localizeRealtimeError(input: unknown) {
  const message = String(input || '').trim();
  if (!message) {
    return '聊天连接异常，请稍后重试。';
  }

  const lower = message.toLowerCase();
  if (
    lower.includes('authenticate first') ||
    lower.includes('请先完成登录鉴权') ||
    lower.includes('auth') ||
    lower.includes('鉴权')
  ) {
    return '当前聊天会话鉴权异常，请返回会话列表后重新进入。';
  }
  if (lower.includes('match_id is required') || lower.includes('缺少会话 id')) {
    return '会话参数异常，请返回列表后重试。';
  }
  if (lower.includes('connection') || lower.includes('连接')) {
    return '聊天连接状态异常，请稍后重试。';
  }
  return message;
}

function resetState() {
  pageError.value = '';
  inputText.value = '';
  messages.value = [];
  messageIdSet.clear();
  wall.value = {
    status: 'pending',
    resonanceScore: 0,
    wallReady: false,
    wallBroken: false,
    requesterAccepted: false,
    counterpartAccepted: false,
  };
}

function isNearBottom() {
  if (!listRef.value) return true;
  const el = listRef.value;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 60;
}

function scrollToBottomIfNeeded() {
  if (!listRef.value || userScrolledUp.value) return;
  listRef.value.scrollTop = listRef.value.scrollHeight;
}

function pushMessage(item: UiMessage) {
  if (messageIdSet.has(item.id)) {
    return;
  }
  messageIdSet.add(item.id);
  messages.value.push(item);
  nextTick(() => {
    scrollToBottomIfNeeded();
  });
}

function addSystemMessage(text: string, idPrefix = 'sys') {
  pushMessage({
    id: `${idPrefix}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
    text,
    mine: false,
    kind: 'system',
    time: new Date().toISOString(),
  });
}

function stopSocket() {
  if (unregisterSocket.value) {
    unregisterSocket.value();
    unregisterSocket.value = null;
  }
  if (socketRef.value) {
    socketRef.value.close();
    socketRef.value = null;
  }
}

function mapHistoryMessage(item: SandboxMessage, myUserId: string): UiMessage {
    const isSandbox = !wall.value?.wallBroken;
  if (item.ai_action === 'blocked') {
    const isMine = item.sender_id === myUserId;
    return {
      id: item.message_id,
      text: isMine ? '你的一条消息被安全中间层拦截。' : '',
      mine: isMine,
      kind: 'system',
      time: item.created_at,
    };
  }

  const isMine = item.sender_id === myUserId;
  const isRewritten = item.ai_action === 'modified' || (item.ai_rewritten_text !== item.original_text);

  if (isMine) {
    return {
      id: item.message_id,
      text: (isSandbox && item.sender_rewritten_text) ? item.sender_rewritten_text : item.ai_rewritten_text,
      originalText: isRewritten ? item.original_text : undefined,
      mine: true,
      kind: (isRewritten || isSandbox) ? 'ai-relay' : 'text',
      time: item.created_at,
      aiAction: item.ai_action,
    };
  }

  return {
    id: item.message_id,
    text: item.ai_rewritten_text,
    mine: false,
    kind: (isRewritten || isSandbox) ? 'ai-relay' : 'text',
    time: item.created_at,
    aiAction: item.ai_action,
  };
}

function buildCompanionHistory() {
  return messages.value
    .filter((item) => item.kind === 'text')
    .map((item) => ({
      role: item.mine ? 'user' : 'assistant',
      text: item.text,
    }))
    .slice(-18);
}

function handleSocketEvent(event: SandboxInbound) {
  const type = String(event.type || '');

  if (type === 'connected') {
    return;
  }

  if (type === 'auth_ok') {
    if (socketRef.value && id.value) {
      socketRef.value.joinMatch(id.value);
      // On reconnect, re-fetch history to catch messages missed during WS downtime.
      // pushMessage deduplicates by ID so no duplicates will appear.
      if (messages.value.length > 0) {
        socketRef.value.fetchHistory(id.value);
      }
      socketRef.value.fetchWallState(id.value);
    }
    return;
  }

  if (type === 'history' && Array.isArray(event.messages)) {
    const myUserId = userStore.viewer?.user.id || '';
    for (const row of event.messages as SandboxMessage[]) {
      pushMessage(mapHistoryMessage(row, myUserId));
    }
    return;
  }

  if (type === 'message_delivered') {
    sending.value = false;
    const originalText = String(event.original_text || '');
    const rewrittenText = String(event.text || '');
    const senderSummary = String(event.sender_summary || '');
    const aiAction = String(event.ai_action || 'passed');
    const isRewritten = aiAction === 'modified' || (originalText && rewrittenText !== originalText);
      const isSandbox = !wall.value?.wallBroken;
    const displayText = (isSandbox && senderSummary) ? senderSummary : rewrittenText;

    const pendingIndex = messages.value.findLastIndex(m => m.mine && m.id.startsWith('pending-') && m.text === originalText);
    
    if (pendingIndex !== -1) {
      const existing = messages.value[pendingIndex];
      existing.id = String(event.message_id || existing.id);
      existing.text = displayText;
      existing.originalText = isRewritten ? originalText : undefined;
      existing.kind = (isRewritten || isSandbox) ? 'ai-relay' : 'text';
      existing.aiAction = aiAction;
      existing.time = String(event.created_at || new Date().toISOString());
    } else {
      pushMessage({
        id: String(event.message_id || `mine-${Date.now()}`),
        text: displayText,
        originalText: isRewritten ? originalText : undefined,
        mine: true,
        kind: (isRewritten || isSandbox) ? 'ai-relay' : 'text',
        time: String(event.created_at || new Date().toISOString()),
        aiAction,
      });
    }
    return;
  }

  if (type === 'sandbox_message' || type === 'direct_message') {
    const aiAction = String(event.ai_action || 'passed');
    const isAiRelay = type === 'sandbox_message' && (aiAction === 'modified' || aiAction === 'passed');
    pushMessage({
      id: String(event.message_id || `peer-${Date.now()}`),
      text: String(event.text || ''),
      mine: false,
      kind: (type === 'sandbox_message') ? 'ai-relay' : 'text',
      time: String(event.created_at || new Date().toISOString()),
      aiAction: isAiRelay ? aiAction : undefined,
    });
    return;
  }

  if (type === 'message_blocked') {
    sending.value = false;
    addSystemMessage('你的这条消息被安全层拦截，未送达对方。', 'blocked');
    return;
  }

  if (type === 'resonance_update') {
    wall.value.resonanceScore = Number(event.resonance_score || wall.value.resonanceScore || 0);
    return;
  }

  if (type === 'wall_ready') {
    wall.value.wallReady = true;
    wall.value.resonanceScore = Number(event.resonance_score || wall.value.resonanceScore || 100);
    addSystemMessage('你们已达到破壁阈值，可以发起“破壁”确认。', 'wall-ready');
    return;
  }

  if (type === 'wall_state' || type === 'wall_break_update' || type === 'wall_broken' || type === 'join_ok') {
    wall.value.status = String(event.status || wall.value.status || 'pending');
    wall.value.resonanceScore = Number(event.resonance_score || wall.value.resonanceScore || 0);
    wall.value.wallReady = Boolean(event.wall_ready);
    wall.value.wallBroken = Boolean(event.wall_broken);
    wall.value.requesterAccepted = Boolean(event.requester_accepted);
    wall.value.counterpartAccepted = Boolean(event.counterpart_accepted);

    if (type === 'wall_broken') {
      addSystemMessage('破壁已完成，后续消息不再改写。', 'wall-broken');
    }
    return;
  }

  if (type === 'error') {
    sending.value = false;
    pageError.value = localizeRealtimeError(event.message);
    return;
  }

  if (type === 'peer_offline') {
    isPeerOffline.value = true;
    return;
  }

  if (type === 'peer_online') {
    isPeerOffline.value = false;
    if (pageError.value === '对方不在线') {
      pageError.value = '';
    }
    return;
  }
}

async function initMatchChat() {
  if (!userStore.token || !userStore.viewer) {
    router.replace('/login');
    return;
  }

  loading.value = true;
  pageError.value = '';
  title.value = '匹配会话';

  try {
    const [wallState, history] = await Promise.all([
      fetchWallState(userStore.token, id.value),
      fetchMatchMessages(userStore.token, id.value, 100),
    ]);

    wall.value = {
      status: wallState.status,
      resonanceScore: wallState.resonanceScore,
      wallReady: wallState.wallReady,
      wallBroken: wallState.wallBroken,
      requesterAccepted: wallState.requesterAccepted,
      counterpartAccepted: wallState.counterpartAccepted,
    };

    title.value = wallState.counterpartProfile.anonymousName || '匹配会话';

    const myUserId = userStore.viewer.user.id;
    for (const row of history.messages) {
      pushMessage(mapHistoryMessage(row, myUserId));
    }

    const socket = new SandboxSocket();
    socketRef.value = socket;
    unregisterSocket.value = socket.onEvent(handleSocketEvent);
    socket.connect(myUserId);

    if (history.messages.length === 0) {
      addSystemMessage('你已进入沙盒会话，发送第一句话吧。', 'enter');
    }
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    loading.value = false;
  }
}

async function initAiChat() {
    title.value = '匿名会话';
    try {
      if (id.value && !id.value.startsWith('ai_')) {
         aiSessionId.value = id.value;
         const res = await fetchCompanionMessages(userStore.token!, id.value);
         title.value = res.name || 'AI Companion';
         actualPersonaId.value = res.companion_id;
         messages.value = res.messages.map((m: any) => ({
           id: m.id,
           text: m.text,
           mine: m.role === 'user',
           kind: (m.role === "user" || wall.value?.wallBroken) ? "text" : "ai-relay",
           time: m.created_at,
         }));
         for (const item of messages.value) {
           messageIdSet.add(item.id);
         }
      } else {
         // Persona ID (e.g., ai_psychologist) - new session, no history yet
         actualPersonaId.value = id.value;
         aiSessionId.value = '';
         title.value = '匹配对象';
      }
    } catch (err) {
      console.error(err);
      pageError.value = '加载会话失败';
    }

    const hasWallBroken = messages.value.some(m => m.kind === 'system' && (m as any).systemType === 'wall-broken');
    if (hasWallBroken) {
      wall.value.wallBroken = true;
      wall.value.status = 'wall_broken';
    } else {
      wall.value.wallBroken = false;
      wall.value.status = 'active_sandbox';

      const myMsgs = messages.value.filter(m => m.mine).length;
      const hasWallReady = messages.value.some(m => m.kind === 'system' && (m as any).systemType === 'wall-ready');
      if (myMsgs >= 3 && !hasWallReady) {
         wall.value.wallReady = true;
         addSystemMessage('你们已达到破壁阈值，可以发起“破壁”确认。', 'wall-ready');
      } else if (hasWallReady && !hasWallBroken) {
         wall.value.wallReady = true;
      }
    }

    if (messages.value.length === 0) {
      addSystemMessage('你们已建立匿名连接，为了安全初始将在沙盒中交流，内容可能由AI转述。', 'init');
    }
  }

  async function initialize() {
  stopSocket();
  resetState();

  if (!id.value) {
    pageError.value = '会话参数缺失。';
    return;
  }

  if (isMatchChat.value) {
    await initMatchChat();
  } else {
    await initAiChat();
  }
}

async function sendMessage() {
  const content = inputText.value.trim();
  if (!content || sending.value) {
    return;
  }
  if (!userStore.token) {
    router.replace('/login');
    return;
  }

  pageError.value = '';

  if (isMatchChat.value) {
    if (!socketRef.value) {
      pageError.value = '聊天连接尚未建立，请稍后再试。';
      return;
    }

    const text = content;
    inputText.value = '';
    
    pushMessage({
      id: `pending-${Date.now()}`,
      text: text,
      mine: true,
      kind: 'text',
      time: new Date().toISOString()
    });

    if (wall.value.wallBroken) {
      socketRef.value.sendDirectMessage(id.value, text);
    } else {
      socketRef.value.sendSandboxMessage(id.value, text);
    }
    return;
  }

  sending.value = true;
  inputText.value = '';
  pushMessage({
    id: `u-${Date.now()}`,
    text: content,
    mine: true,
    kind: 'text',
    time: new Date().toISOString(),
  });

  try {
    const history = buildCompanionHistory();
    
      const payload = await askCompanion(userStore.token, actualPersonaId.value, history, aiSessionId.value);
      // Fake thinking and typing delay for human-like realism
      const delay = Math.min(1500 + (payload.reply.length * 50), 6000);
      await new Promise(r => setTimeout(r, delay));
      if (payload.session_id) {
        aiSessionId.value = payload.session_id;
        // Silently update URL so future navigation loads the correct session
        if (id.value.startsWith('ai_')) {
          window.history.replaceState({}, '', `/chat/ai/${payload.session_id}`);
        }
      }
      pushMessage({
        id: `a-${Date.now()}`,
        text: payload.reply,
        mine: false,
        kind: 'text',
        time: new Date().toISOString(),
      });
    
    // Evaluate if AI sandbox chat can be broken
    const myMsgs = messages.value.filter(m => m.mine).length;
    const hasWallReady = messages.value.some(m => m.kind === 'system' && m.systemType === 'wall-ready');
    if (!wall.value.wallBroken && myMsgs >= 3 && !hasWallReady) {
      wall.value.wallReady = true;
      addSystemMessage('你们已达到破壁阈值，可以发起“破壁”确认。', 'wall-ready');
    }
        // saveAiHistory removed
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    sending.value = false;
  }
}

async function submitWallDecision(accept: boolean) {
  if (!isMatchChat.value) {
    if (accept) {
      wall.value.wallBroken = true;
      wall.value.status = 'wall_broken';
      wall.value.wallReady = false;
      addSystemMessage('破壁已完成，后续消息不再改写。', 'wall-broken');
      // saveAiHistory removed
      noticeStore.show('已同意破壁，对方也已同意。', 'success');
    } else {
      noticeStore.show('已提交暂不破壁', 'info');
    }
    return;
  }
  if (!socketRef.value) {
    return;
  }
  socketRef.value.sendWallDecision(id.value, accept);
  noticeStore.show(accept ? '已提交同意破壁' : '已提交暂不破壁', 'info');
}

function handleListScroll() {
  userScrolledUp.value = !isNearBottom();
}

function handleViewportResize() {
  if (!userScrolledUp.value) {
    nextTick(() => {
      if (listRef.value) {
        listRef.value.scrollTop = listRef.value.scrollHeight;
      }
    });
  }
}

onMounted(() => {
  initialize();
  // Listen to scroll to detect if user manually scrolled up
  nextTick(() => {
    if (listRef.value) {
      listRef.value.addEventListener('scroll', handleListScroll, { passive: true });
    }
  });
  // Mobile keyboard auto-scroll via visualViewport API
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleViewportResize);
  }
});

watch(
  () => [route.params.kind, route.params.id],
  () => {
    initialize();
  },
);

onBeforeUnmount(() => {
  stopSocket();
  if (!isMatchChat.value) {
    // saveAiHistory removed
  }
  if (listRef.value) {
    listRef.value.removeEventListener('scroll', handleListScroll);
  }
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', handleViewportResize);
  }
});
</script>

<template>
  <UserShell :title="title" subtitle="单会话详情" show-back back-to="/matches" compact>
    <section class="panel message-panel">
      <header class="panel-body" style="padding-bottom: 8px">
        <div class="row" style="justify-content: space-between">
          <div>
            <span class="badge badge-muted">共鸣值 {{ wall.resonanceScore }}</span>
            <span v-if="isPeerOffline" class="badge" style="margin-left: 8px; background: rgba(255, 255, 255, 0.1); color: #f5a623">离线中</span>
          </div>
          <span class="badge" :class="wall.wallBroken ? 'badge-success' : 'badge-accent'">
             {{ wall.wallBroken ? '已破壁直聊' : '匿名交流中' }}
          </span>
        </div>

        <div v-if="canBreakWall" class="row-wrap" style="margin-top: 8px">
          <button class="btn btn-primary" type="button" @click="submitWallDecision(true)">同意破壁</button>
          <button class="btn btn-ghost" type="button" @click="submitWallDecision(false)">暂不破壁</button>
          <span class="muted" style="font-size: 12px">你：{{ wall.requesterAccepted ? '已同意' : '未同意' }} / 对方：{{ wall.counterpartAccepted ? '已同意' : '未同意' }}</span>
        </div>
      </header>

      <div ref="listRef" class="message-list" style="padding: 0 16px 10px">
        <div v-if="loading" class="bubble system">正在加载会话...</div>
        <div v-if="pageError" class="bubble system" style="color: #a13553">{{ pageError }}</div>

        <div
          v-for="item in messages"
          :key="item.id"
          class="bubble"
          :class="[item.mine ? 'me' : '', item.kind === 'system' ? 'system' : '', item.kind === 'ai-relay' ? 'ai-relay' : '']"
        >
          <div>{{ item.text }}</div>
          <div v-if="item.kind === 'ai-relay' && item.mine && item.originalText" class="original-text">
            <span class="original-label">原文：</span>{{ item.originalText }}
          </div>
          <div v-if="item.kind === 'ai-relay' && !item.mine" class="original-text"><span class="original-label">来自 AI 转述</span></div>
          <div class="bubble-meta">{{ formatTime(item.time) }}</div>
        </div>

        <div v-if="sending" class="bubble system" style="opacity: 0.7; font-size: 12px; margin-top: 8px;">
          <span class="loading-dots">正在发送...</span>
        </div>
      </div>

      <footer class="panel-body" style="padding-top: 8px">
        <div class="composer">
          <textarea
            v-model="inputText"
            class="textarea chat-input"
            rows="1"
            placeholder="输入消息，回车发送"
            :disabled="loading || sending"
            @keydown.enter.exact.prevent="sendMessage"
          />
          <button class="btn btn-primary" type="button" :disabled="loading || sending || !inputText.trim()" @click="sendMessage">
            {{ sending ? '发送中' : '发送' }}
          </button>
        </div>
      </footer>
    </section>
  </UserShell>
</template>
