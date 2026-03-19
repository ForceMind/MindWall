<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
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
  const sessionTab = ref<'active'|'history'>('active');
  const contactsPage = ref(1);
  const contactsTotal = ref(0);
  const contactsLoading = ref(false);
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

function getCachedPersonaName(personaId: string): string {
  const uid = userStore.viewer?.user.id || 'guest';
  return localStorage.getItem(`youjian.ai.persona.${uid}.${personaId}.name`) || '匿名用户';
}

function cachePersonaNames(candidateList: CandidateContact[]) {
  const uid = userStore.viewer?.user.id || 'guest';
  for (const c of candidateList) {
    if (c.candidate_type === 'ai' && c.name) {
      localStorage.setItem(`youjian.ai.persona.${uid}.${c.candidate_id}.name`, c.name);
    }
  }
}

  async function loadSessions() {
    if (!userStore.token) return;
    contactsLoading.value = true;
    try {
      const payload = await fetchContacts(userStore.token, sessionTab.value, contactsPage.value);
      contacts.value = payload.contacts;
      contactsTotal.value = payload.total || 0;
    } catch (e) {
      console.error(e);
      // fallback
    } finally {
      contactsLoading.value = false;
    }
  }

  watch(sessionTab, () => {
    contactsPage.value = 1;
    loadSessions();
  });

// Module-level cache to persist across component remounts (e.g. back navigation)
let cachedCandidateList: CandidateContact[] | null = null;
let cachedCityScopeValue: string | null = null;

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
    // Use cached candidates on back navigation; only re-fetch on explicit refresh
    if (!isRefresh && cachedCandidateList) {
      candidates.value = cachedCandidateList;
      cityScope.value = cachedCityScopeValue;
    } else {
      const candidatePayload = await fetchCandidates(userStore.token);
      candidates.value = candidatePayload.candidates;
      cityScope.value = candidatePayload.city_scope;
      cachedCandidateList = candidatePayload.candidates;
      cachedCityScopeValue = candidatePayload.city_scope;
      cachePersonaNames(candidatePayload.candidates);
    }
    await loadSessions();

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

function openMatch(matchId: string, isAi?: boolean) {
  if (isAi || matchId.startsWith('ai_')) {
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
    openMatch(candidate.match_id, candidate.candidate_type === 'ai');
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
    openMatch(result.match_id, false);
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
  <UserShell title="匹配大厅" subtitle="流光匿名社交空间" :hide-header="true">
    <section class="panel">
      <div class="panel-body row" style="justify-content: space-between; align-items: flex-start">
        <div class="row" style="min-width: 0; cursor: pointer;" @click="router.push('/profile')" title="查看主页">
          <img v-if="profileAvatar" :src="profileAvatar" alt="avatar" class="avatar" />
          <div style="min-width: 0">
            <div style="font-weight: 700">{{ profileName }}</div>
            <div class="muted" style="font-size: 12px">
              城市：{{ cityScope || userStore.viewer?.profile?.city || '未设置' }}
            </div>
          </div>
        </div>

        <div class="row" style="gap: 8px">
          <button
            v-if="!userStore.viewer?.has_deep_interview"
            class="btn btn-secondary"
            type="button"
            style="font-size: 13px"
            @click="router.push('/onboarding/deep')"
          >
            深度访谈
          </button>
          <button
            class="btn btn-ghost"
            type="button"
            :disabled="refreshing"
            @click="loadData(true)"
          >
            {{ refreshing ? '刷新中...' : '刷新' }}
          </button>
        </div>
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
                <span class="badge" :class="statusBadgeClass(item.status)">{{
                  statusText(item.status)
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
                <button class="btn btn-primary" type="button" @click="openMatch(item.match_id, item.is_ai)">
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
