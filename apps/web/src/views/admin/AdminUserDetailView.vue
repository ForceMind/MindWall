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
        <h3 class="panel-title">时间线（最近）</h3>
        <div class="card-list">
          <article v-for="item in detail.timeline || []" :key="`${item.type}-${item.ts}-${item.title}`" class="list-card">
            <div class="row" style="justify-content: space-between">
              <strong>{{ item.title || item.type }}</strong>
              <span class="muted" style="font-size: 12px">{{ formatDateTime(item.ts) }}</span>
            </div>
            <div class="muted">{{ item.detail || '-' }}</div>
          </article>

          <div v-if="(detail.timeline || []).length === 0" class="empty-box">暂无时间线记录</div>
        </div>
      </div>
    </section>

    <section v-if="detail" class="panel">
      <div class="panel-body column">
        <h3 class="panel-title">最近 AI 记录</h3>
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
              <tr v-for="row in detail.recent?.ai_records || []" :key="row.id">
                <td>{{ formatTime(row.created_at) }}</td>
                <td>{{ row.feature }}</td>
                <td>{{ row.model }}</td>
                <td>{{ row.total_tokens }}</td>
                <td>{{ row.estimated_cost_usd }}</td>
              </tr>
              <tr v-if="(detail.recent?.ai_records || []).length === 0">
                <td colspan="5" class="muted">暂无记录</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </AdminShell>
</template>
