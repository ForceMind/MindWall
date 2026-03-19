<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import AdminShell from '@/components/AdminShell.vue';
import { fetchAdminLogs } from '@/lib/admin-api';
import { toErrorMessage } from '@/lib/api-error';
import { useAdminSessionStore } from '@/stores/admin-session';

const adminStore = useAdminSessionStore();

const loading = ref(false);
const pageError = ref('');
const lines = ref(200);
const filePath = ref('');
const totalLines = ref(0);
const category = ref('');
const level = ref('');

interface ParsedLog {
  ts: string;
  level: string;
  event: string;
  message: string;
  metadata: Record<string, unknown> | null;
  raw?: string;
}

const logs = ref<ParsedLog[]>([]);

const categoryOptions = [
  { value: '', label: '全部分类' },
  { value: 'ai', label: 'AI 调用' },
  { value: 'sandbox', label: '沙盒' },
  { value: 'companion', label: '伴侣/陪聊' },
  { value: 'onboarding', label: '访谈' },
  { value: 'auth', label: '鉴权' },
];
const levelOptions = [
  { value: '', label: '全部级别' },
  { value: 'INFO', label: 'INFO' },
  { value: 'WARN', label: 'WARN' },
  { value: 'ERROR', label: 'ERROR' },
];

const EVENT_LABELS: Record<string, string> = {
  'auth.login': '用户登录',
  'auth.logout': '用户登出',
  'auth.register': '用户注册',
  'auth.session.created': '会话创建',
  'auth.session.expired': '会话过期',
  'sandbox.openai.failed': 'AI沙盒调用失败',
  'sandbox.openai.error': 'AI沙盒调用异常',
  'sandbox.rewrite': '沙盒消息改写',
  'sandbox.blocked': '沙盒消息拦截',
  'companion.openai.failed': 'AI陪聊调用失败',
  'companion.openai.error': 'AI陪聊调用异常',
  'onboarding.session.start': '访谈会话开始',
  'onboarding.session.complete': '访谈会话完成',
  'onboarding.openai.failed': 'AI访谈调用失败',
  'onboarding.openai.error': 'AI访谈调用异常',
  'onboarding.tags.generated': '标签生成完成',
  'onboarding.tags.fallback': '标签回退生成',
  'ai.generation': 'AI生成',
  'ai.openai.failed': 'AI调用失败',
  'ai.openai.error': 'AI调用异常',
};

function eventLabel(event: string) {
  if (EVENT_LABELS[event]) return EVENT_LABELS[event];
  // Partial match: try prefix
  for (const [key, label] of Object.entries(EVENT_LABELS)) {
    if (event.startsWith(key)) return label;
  }
  return event;
}

function levelColor(lv: string) {
  switch (lv) {
    case 'ERROR': return '#ef476f';
    case 'WARN': return '#f0a030';
    case 'INFO': return '#3baa85';
    default: return '#6b7a94';
  }
}

function levelBadge(lv: string) {
  switch (lv) {
    case 'ERROR': return 'badge-danger';
    case 'WARN': return 'badge-accent';
    case 'INFO': return 'badge-success';
    default: return 'badge-muted';
  }
}

function formatTs(ts: string) {
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return ts;
    return new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).format(d);
  } catch { return ts; }
}

const METADATA_LABELS: Record<string, string> = {
  user_id: '用户ID',
  session_id: '会话ID',
  match_id: '匹配ID',
  status: '状态',
  detail: '详情',
  error: '错误',
  model: '模型',
  latency_ms: '延迟(ms)',
  provider: '提供商',
  feature: '功能',
  prompt_key: '提示词',
  input_tokens: '输入Token',
  output_tokens: '输出Token',
  total_tokens: '总Token',
  username: '用户名',
  ip: 'IP地址',
  reason: '原因',
  tag_count: '标签数',
  strategy: '策略',
};

function metadataLabel(key: string) {
  return METADATA_LABELS[key] || key;
}

function parseLine(line: string): ParsedLog {
  try {
    const obj = JSON.parse(line);
    return {
      ts: obj.ts || '',
      level: obj.level || 'INFO',
      event: obj.event || '',
      message: obj.message || '',
      metadata: obj.metadata || null,
    };
  } catch {
    return { ts: '', level: 'INFO', event: '', message: line, metadata: null, raw: line };
  }
}

const expandedIndex = ref<number | null>(null);
function toggleExpand(idx: number) {
  expandedIndex.value = expandedIndex.value === idx ? null : idx;
}

async function load() {
  if (!adminStore.token) return;
  loading.value = true;
  pageError.value = '';
  try {
    const payload = await fetchAdminLogs(adminStore.token, lines.value, category.value, level.value);
    filePath.value = payload.file;
    totalLines.value = payload.total_lines;
    logs.value = payload.lines.map(parseLine).reverse(); // newest first
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  load();
});
</script>

<template>
  <AdminShell title="服务器日志" subtitle="排障与行为审计">
    <section class="panel">
      <div class="panel-body row" style="justify-content: space-between; flex-wrap: wrap">
        <div>
          <h2 class="panel-title">日志查看</h2>
          <p class="panel-subtitle">日志文件：{{ filePath || '-' }}（共 {{ totalLines }} 条）</p>
        </div>

        <div class="row-wrap">
          <select v-model="category" class="input" style="width: 130px" @change="load">
            <option v-for="opt in categoryOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
          <select v-model="level" class="input" style="width: 110px" @change="load">
            <option v-for="opt in levelOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </select>
          <input v-model.number="lines" class="input" type="number" min="20" max="3000" style="width: 130px" />
          <button class="btn btn-ghost" type="button" :disabled="loading" @click="load">刷新</button>
        </div>
      </div>
    </section>

    <section v-if="pageError" class="panel">
      <div class="panel-body"><span class="badge badge-danger">{{ pageError }}</span></div>
    </section>

    <section class="panel">
      <div class="panel-body" style="padding: 0">
        <div style="max-height: 68dvh; overflow: auto">
          <div v-if="logs.length === 0 && !loading" class="empty-box" style="margin: 12px">暂无日志内容</div>

          <div
            v-for="(log, idx) in logs"
            :key="idx"
            style="border-bottom: 1px solid #eef1f6; cursor: pointer; transition: background 0.15s"
            :style="{ background: expandedIndex === idx ? 'rgba(59, 170, 133, 0.04)' : 'transparent' }"
            @click="toggleExpand(idx)"
          >
            <!-- 主行 -->
            <div style="padding: 10px 14px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap">
              <span class="badge" :class="levelBadge(log.level)" style="min-width: 50px; text-align: center; font-size: 11px">{{ log.level }}</span>
              <span style="font-size: 12px; color: #8896aa; min-width: 100px">{{ formatTs(log.ts) }}</span>
              <span style="font-size: 13px; font-weight: 700; color: var(--text)">{{ eventLabel(log.event) }}</span>
              <span style="font-size: 13px; color: var(--text-muted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ log.message }}</span>
            </div>

            <!-- 展开详情 -->
            <div v-if="expandedIndex === idx" style="padding: 0 14px 12px; margin-left: 60px">
              <div v-if="log.raw" style="font-family: Consolas, monospace; font-size: 12px; white-space: pre-wrap; word-break: break-all; color: var(--text-muted)">{{ log.raw }}</div>
              <template v-else>
                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px">
                  <strong>事件：</strong>{{ log.event }}<br/>
                  <strong>消息：</strong>{{ log.message }}
                </div>
                <div v-if="log.metadata && Object.keys(log.metadata).length > 0" style="display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 12px">
                  <template v-for="(val, key) in log.metadata" :key="key">
                    <span style="color: var(--accent-cool); font-weight: 600">{{ metadataLabel(String(key)) }}</span>
                    <span style="color: var(--text); word-break: break-all">{{ typeof val === 'object' ? JSON.stringify(val) : String(val) }}</span>
                  </template>
                </div>
                <div v-else class="muted" style="font-size: 12px">无附加数据</div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </section>
  </AdminShell>
</template>
