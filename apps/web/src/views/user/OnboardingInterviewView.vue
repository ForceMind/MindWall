<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import UserShell from '@/components/UserShell.vue';
import { startOnboardingSession, sendOnboardingMessage, type PublicTag } from '@/lib/user-api';
import { toErrorMessage } from '@/lib/api-error';
import { useNoticeStore } from '@/stores/notice';
import { useUserSessionStore } from '@/stores/user-session';

interface Turn {
  role: 'assistant' | 'user';
  text: string;
}

const router = useRouter();
const userStore = useUserSessionStore();
const noticeStore = useNoticeStore();

const loading = ref(false);
const sending = ref(false);
const pageError = ref('');
const sessionId = ref('');
const turns = ref<Turn[]>([]);
const answer = ref('');
const done = ref(false);
const summary = ref('');
const tags = ref<PublicTag[]>([]);
const chatBoxRef = ref<HTMLElement | null>(null);
const inputWarning = ref('');

async function bootstrapSession() {
  if (!userStore.token) {
    router.replace('/login');
    return;
  }

  loading.value = true;
  pageError.value = '';
  inputWarning.value = '';
  try {
    const payload = await startOnboardingSession(userStore.token);
    sessionId.value = payload.session_id;
    // Restore turns from server (supports reconnection)
    if (payload.turns && payload.turns.length > 0) {
      turns.value = payload.turns.map((t: { role: string; content: string }) => ({
        role: t.role as 'assistant' | 'user',
        text: t.content,
      }));
    } else {
      turns.value = [{ role: 'assistant', text: payload.assistant_message }];
    }
    done.value = false;
    summary.value = '';
    tags.value = [];
    await nextTick();
    scrollToBottom();
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    loading.value = false;
  }
}

async function submitAnswer() {
  const message = answer.value.trim();
  if (!message || !sessionId.value || !userStore.token || sending.value) {
    return;
  }

  sending.value = true;
  pageError.value = '';
  inputWarning.value = '';
  turns.value.push({ role: 'user', text: message });
  answer.value = '';
  await nextTick();
  scrollToBottom();

  try {
    const payload = await sendOnboardingMessage(userStore.token, sessionId.value, message) as Record<string, unknown>;

    if (payload.status === 'invalid_input') {
      // Remove the last user message since it was rejected
      turns.value.pop();
      inputWarning.value = String(payload.warning || '请输入有效内容');
      if (Number(payload.remaining_before_ban || 99) <= 0) {
        await userStore.refreshViewer();
        router.replace('/restricted');
      }
      return;
    }

    if (payload.status === 'in_progress') {
      turns.value.push({ role: 'assistant', text: String(payload.assistant_message) });
      await nextTick();
      scrollToBottom();
      return;
    }

    done.value = true;
    summary.value = String(payload.onboarding_summary || '');
    tags.value = (payload.public_tags || []) as PublicTag[];
    await userStore.refreshViewer();
    noticeStore.show('访谈完成，已生成画像', 'success');
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    sending.value = false;
  }
}

function scrollToBottom() {
  if (!chatBoxRef.value) {
    return;
  }
  chatBoxRef.value.scrollTop = chatBoxRef.value.scrollHeight;
}

function handleViewportResize() {
  scrollToBottom();
}

function goCityStep() {
  router.push('/onboarding/city');
}

onMounted(() => {
  bootstrapSession();
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', handleViewportResize);
  }
});

onBeforeUnmount(() => {
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', handleViewportResize);
  }
});
</script>

<template>
  <UserShell title="新手引导" subtitle="第 2 步：灵魂访谈" compact>
    <section class="stepper">
      <div class="step is-done">1. 资料</div>
      <div class="step is-active">2. 访谈</div>
      <div class="step">3. 城市</div>
    </section>

    <section class="panel message-panel">
      <header class="panel-body" style="padding-bottom: 8px">
        <h2 class="panel-title">请认真回答 4 个问题</h2>
        <p class="panel-subtitle">回答越真实，匹配越准确。系统会根据你的表达生成公开标签与隐藏画像。</p>
      </header>

      <div ref="chatBoxRef" class="message-list" style="padding: 0 16px 10px">
        <div v-for="(item, index) in turns" :key="index" class="bubble" :class="item.role === 'user' ? 'me' : ''">
          <div>{{ item.text }}</div>
        </div>

        <div v-if="loading" class="bubble system">正在初始化访谈...</div>
        <div v-if="pageError" class="bubble system" style="color: #a13553">{{ pageError }}</div>
        <div v-if="inputWarning" class="bubble system" style="color: #c44d1a; border-color: rgba(240, 160, 48, 0.4); background: rgba(240, 160, 48, 0.12)">
          ⚠ {{ inputWarning }}
        </div>
      </div>

      <footer class="panel-body" style="padding-top: 8px">
        <div v-if="!done" class="composer">
          <textarea
            v-model="answer"
            class="textarea"
            placeholder="输入你的回答..."
            :disabled="loading || sending"
            @keydown.enter.exact.prevent="submitAnswer"
          />
          <button class="btn btn-primary" type="button" :disabled="loading || sending || !answer.trim()" @click="submitAnswer">
            {{ sending ? '发送中' : '发送' }}
          </button>
        </div>

        <div v-else class="column">
          <div class="panel" style="box-shadow: none">
            <div class="panel-body" style="padding: 12px">
              <strong>访谈摘要</strong>
              <p class="panel-subtitle" style="margin-top: 8px">{{ summary }}</p>
              <div class="tag-list" style="margin-top: 10px">
                <span v-for="tag in tags" :key="tag.tag_name" class="tag">{{ tag.tag_name }}</span>
              </div>
            </div>
          </div>

          <div class="row-wrap">
            <button class="btn btn-ghost" type="button" @click="bootstrapSession">重新访谈</button>
            <button class="btn btn-primary" type="button" @click="goCityStep">下一步：选择城市</button>
          </div>
        </div>
      </footer>
    </section>
  </UserShell>
</template>
