<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import UserShell from '@/components/UserShell.vue';
import {
  connectCandidate,
  fetchCandidates,
  fetchContacts,
  type CandidateContact,
  type ContactSession,
} from '@/lib/user-api';
import { formatTime, statusBadgeClass, statusText } from '@/lib/format';
import { toErrorMessage } from '@/lib/api-error';
import { useNoticeStore } from '@/stores/notice';
import { useUserSessionStore } from '@/stores/user-session';

const router = useRouter();
const userStore = useUserSessionStore();
const noticeStore = useNoticeStore();

const loading = ref(false);
const refreshing = ref(false);
const pageError = ref('');
const cityScope = ref<string | null>(null);
const contacts = ref<ContactSession[]>([]);
const candidates = ref<CandidateContact[]>([]);
const linkingCandidateId = ref('');
const activePane = ref<'sessions' | 'discover'>('sessions');

const profileName = computed(
  () =>
    userStore.viewer?.profile?.anonymous_name ||
    userStore.viewer?.user.username ||
    '匿名用户',
);
const profileAvatar = computed(() => userStore.viewer?.profile?.anonymous_avatar || '');

const AI_PERSONAS: Record<string, { name: string; disclosure: string }> = {
  ai_psychologist: { name: '心灵访谈师', disclosure: 'AI 心灵陪伴' },
  ai_reflective: { name: '夏雾来信', disclosure: '匹配对象' },
  ai_boundary: { name: '林间坐标', disclosure: '匹配对象' },
  ai_warm: { name: '夜航电台', disclosure: '匹配对象' },
};

function getAiSessionsFromLocal(): ContactSession[] {
  const sessions: ContactSession[] = [];
  for (const key of Object.keys(AI_PERSONAS)) {
    const storageKey = `mindwall.ai.chat.${key}`;
    const raw = localStorage.getItem(storageKey);
    if (!raw) continue;
    try {
      const msgs = JSON.parse(raw);
      if (!Array.isArray(msgs) || msgs.length === 0) continue;
      const last = msgs[msgs.length - 1];
      const info = AI_PERSONAS[key];
      sessions.push({
        match_id: key,
        counterpart_user_id: key,
        candidate_type: 'ai',
        disclosure: info.disclosure,
        name: info.name,
        avatar: null,
        city: null,
        status: 'wall_broken',
        resonance_score: 0,
        ai_match_reason: null,
        updated_at: last.time || new Date().toISOString(),
        public_tags: [],
      });
    } catch {
      // skip corrupt data
    }
  }
  return sessions;
}

async function loadData(isRefresh = false) {
  if (!userStore.token) {
    router.replace('/login');
    return;
  }

  pageError.value = '';
  if (isRefresh) {
    refreshing.value = true;
  } else {
    loading.value = true;
  }

  try {
    const [contactPayload, candidatePayload] = await Promise.all([
      fetchContacts(userStore.token),
      fetchCandidates(userStore.token),
    ]);

    contacts.value = [...getAiSessionsFromLocal(), ...contactPayload.contacts];
    candidates.value = candidatePayload.candidates;
    cityScope.value = candidatePayload.city_scope;

    if (contacts.value.length === 0 && candidates.value.length > 0) {
      activePane.value = 'discover';
    }
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    loading.value = false;
    refreshing.value = false;
  }
}

function openMatch(matchId: string) {
  // AI companion sessions use their persona id as match_id
  if (AI_PERSONAS[matchId]) {
    router.push(`/chat/ai/${matchId}`);
    return;
  }
  router.push(`/chat/match/${matchId}`);
}

async function openCandidate(candidate: CandidateContact) {
  if (!userStore.token) {
    router.replace('/login');
    return;
  }

  if (candidate.match_id) {
    openMatch(candidate.match_id);
    return;
  }

  if (candidate.candidate_type === 'ai') {
    router.push(`/chat/ai/${candidate.candidate_id}`);
    return;
  }

  linkingCandidateId.value = candidate.candidate_id;
  try {
    const result = await connectCandidate(userStore.token, candidate.candidate_id);
    noticeStore.show(
      result.existed ? '已存在会话，正在进入' : '连接成功，开始聊天',
      'success',
    );
    await loadData(true);
    openMatch(result.match_id);
  } catch (error) {
    noticeStore.show(toErrorMessage(error), 'error');
  } finally {
    linkingCandidateId.value = '';
  }
}

onMounted(() => {
  loadData();
});
</script>

<template>
  <UserShell title="匹配大厅" subtitle="流光匿名社交空间">
    <section class="panel">
      <div class="panel-body row" style="justify-content: space-between; align-items: flex-start">
        <div class="row" style="min-width: 0">
          <img v-if="profileAvatar" :src="profileAvatar" alt="avatar" class="avatar" />
          <div style="min-width: 0">
            <div style="font-weight: 700">{{ profileName }}</div>
            <div class="muted" style="font-size: 12px">
              城市：{{ cityScope || userStore.viewer?.profile?.city || '未设置' }}
            </div>
          </div>
        </div>

        <button
          class="btn btn-ghost"
          type="button"
          :disabled="refreshing"
          @click="loadData(true)"
        >
          {{ refreshing ? '刷新中...' : '刷新' }}
        </button>
      </div>
    </section>

    <section class="panel">
      <div class="panel-body column">
        <div class="segment">
          <button
            class="segment-btn"
            :class="activePane === 'sessions' ? 'is-active' : ''"
            type="button"
            @click="activePane = 'sessions'"
          >
            我的会话 {{ contacts.length }}
          </button>
          <button
            class="segment-btn"
            :class="activePane === 'discover' ? 'is-active' : ''"
            type="button"
            @click="activePane = 'discover'"
          >
            发现匹配 {{ candidates.length }}
          </button>
        </div>

        <div v-if="pageError" class="badge badge-danger" style="justify-content: flex-start">
          {{ pageError }}
        </div>

        <div v-if="activePane === 'sessions'" class="column">
          <div v-if="loading" class="empty-box">正在加载会话...</div>

          <div v-else-if="contacts.length === 0" class="empty-box">
            你还没有会话，切换到“发现匹配”开始第一段匿名对话。
          </div>

          <div v-else class="card-list">
            <article v-for="item in contacts" :key="item.match_id" class="list-card">
              <div class="row" style="justify-content: space-between; align-items: flex-start">
                <div class="row" style="min-width: 0">
                  <img v-if="item.avatar" :src="item.avatar" alt="avatar" class="avatar" />
                  <div style="min-width: 0">
                    <div style="font-weight: 700">{{ item.name }}</div>
                    <div class="muted" style="font-size: 12px">
                      {{ item.city || '同频匿名场' }} · {{ formatTime(item.updated_at) }}
                    </div>
                  </div>
                </div>
                <span class="badge" :class="item.candidate_type === 'ai' ? 'badge-muted' : statusBadgeClass(item.status)">{{
                  item.candidate_type === 'ai' ? item.disclosure : statusText(item.status)
                }}</span>
              </div>

              <p class="muted" style="margin: 0">
                {{ item.ai_match_reason || '系统建议先在沙盒中建立连接。' }}
              </p>

              <div class="row-wrap">
                <span
                  v-for="tag in item.public_tags"
                  :key="`${item.match_id}-${tag.tag_name}`"
                  class="tag"
                >
                  {{ tag.tag_name }}
                </span>
              </div>

              <div class="row" style="justify-content: space-between">
                <span class="badge badge-accent">共鸣值 {{ item.resonance_score }}</span>
                <button class="btn btn-primary" type="button" @click="openMatch(item.match_id)">
                  进入会话
                </button>
              </div>
            </article>
          </div>
        </div>

        <div v-else class="column">
          <div v-if="!loading && candidates.length === 0" class="empty-box">
            当前没有可展示的潜在匹配。
          </div>

          <div class="card-list">
            <article v-for="candidate in candidates" :key="candidate.candidate_id" class="list-card">
              <div class="row" style="justify-content: space-between; align-items: flex-start">
                <div class="row" style="min-width: 0">
                  <img v-if="candidate.avatar" :src="candidate.avatar" alt="avatar" class="avatar" />
                  <div style="min-width: 0">
                    <div style="font-weight: 700">{{ candidate.name }}</div>
                    <div class="muted" style="font-size: 12px">
                      {{ candidate.city || '匿名空间' }} · {{ candidate.disclosure }}
                    </div>
                  </div>
                </div>
                <span class="badge badge-accent">匹配 {{ candidate.score }}</span>
              </div>

              <div class="row-wrap">
                <span
                  v-for="tag in candidate.public_tags"
                  :key="`${candidate.candidate_id}-${tag.tag_name}`"
                  class="tag"
                >
                  {{ tag.tag_name }}
                </span>
              </div>

              <div class="row" style="justify-content: flex-end">
                <button
                  class="btn btn-primary"
                  type="button"
                  :disabled="linkingCandidateId === candidate.candidate_id"
                  @click="openCandidate(candidate)"
                >
                  {{
                    candidate.match_id
                      ? '继续聊天'
                      : linkingCandidateId === candidate.candidate_id
                        ? '连接中...'
                        : '开始聊天'
                  }}
                </button>
              </div>
            </article>
          </div>
        </div>
      </div>
    </section>
  </UserShell>
</template>
