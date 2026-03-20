<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import AdminShell from '@/components/AdminShell.vue';
import { fetchAdminConfig, saveAdminConfig, testAdminConfig } from '@/lib/admin-api';
import { toErrorMessage } from '@/lib/api-error';
import { useAdminSessionStore } from '@/stores/admin-session';
import { useNoticeStore } from '@/stores/notice';

const adminStore = useAdminSessionStore();
const noticeStore = useNoticeStore();

const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const pageError = ref('');
const configSource = ref<Record<string, string>>({});
const configPath = ref('');
const keyPreview = ref('');
const embeddingKeyPreview = ref('');

const keepExistingKey = ref(true);
const keepExistingEmbeddingKey = ref(true);

const form = reactive({
  openai_base_url: '',
  openai_api_key: '',
  openai_embedding_api_key: '',
  openai_model: '',
  openai_embedding_model: '',
  openai_input_price: 0,
  openai_output_price: 0,
  web_origin: '',
  maintenance_mode: false,
});

const testResult = ref<null | {
  ok: boolean;
  message: string;
  base_url: string;
  chat_model: string;
  embedding_model: string;
  chat: {
    ok: boolean;
    status: number | null;
    latency_ms: number | null;
    preview: string;
    error: string | null;
  };
  embedding: {
    ok: boolean;
    status: number | null;
    latency_ms: number | null;
    vector_size: number | null;
    error: string | null;
  };
}>(null);

async function load() {
  if (!adminStore.token) {
    return;
  }

  loading.value = true;
  pageError.value = '';

  try {
    const payload = await fetchAdminConfig(adminStore.token);
    form.openai_base_url = payload.openai_base_url || '';
    form.openai_model = payload.openai_model || '';
    form.openai_embedding_model = payload.openai_embedding_model || '';
    form.openai_input_price = payload.openai_input_price || 0;
    form.openai_output_price = payload.openai_output_price || 0;
    form.web_origin = payload.web_origin || '';
    form.maintenance_mode = payload.maintenance_mode === true;
    form.openai_api_key = '';
    form.openai_embedding_api_key = '';

    configSource.value = payload.source || {};
    configPath.value = payload.config_file || '';
    keyPreview.value = payload.openai_api_key_preview || '';
    embeddingKeyPreview.value = payload.openai_embedding_api_key_preview || '';
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    loading.value = false;
  }
}

function buildPayload(includeWebOrigin: boolean) {
  const payload: Record<string, any> = {
    openai_base_url: form.openai_base_url.trim(),
    openai_model: form.openai_model.trim(),
    openai_embedding_model: form.openai_embedding_model.trim(),
    openai_input_price: Number(form.openai_input_price) || 0,
    openai_output_price: Number(form.openai_output_price) || 0,
  };

  if (includeWebOrigin) {
    payload.web_origin = form.web_origin.trim();
    payload.maintenance_mode = form.maintenance_mode;
  }

  if (!keepExistingKey.value || form.openai_api_key.trim()) {
    payload.openai_api_key = form.openai_api_key.trim();
  }
  if (!keepExistingEmbeddingKey.value || form.openai_embedding_api_key.trim()) {
    payload.openai_embedding_api_key = form.openai_embedding_api_key.trim();
  }

  return payload;
}

async function save() {
  if (!adminStore.token) {
    return;
  }

  saving.value = true;
  try {
    await saveAdminConfig(adminStore.token, buildPayload(true));
    noticeStore.show('配置已保存', 'success');
    keepExistingKey.value = true;
    keepExistingEmbeddingKey.value = true;
    await load();
  } catch (error) {
    noticeStore.show(toErrorMessage(error), 'error');
  } finally {
    saving.value = false;
  }
}

async function testConnectivity() {
  if (!adminStore.token) {
    return;
  }

  testing.value = true;
  testResult.value = null;
  try {
    const payload = await testAdminConfig(adminStore.token, buildPayload(false));
    testResult.value = payload;
    noticeStore.show(payload.ok ? '连接测试成功' : '连接测试失败', payload.ok ? 'success' : 'error');
  } catch (error) {
    noticeStore.show(toErrorMessage(error), 'error');
  } finally {
    testing.value = false;
  }
}

onMounted(() => {
  load();
});
</script>

<template>
  <AdminShell title="系统配置" subtitle="AI 接口、模型、回调域名">
    <section class="panel">
      <div class="panel-body row" style="justify-content: space-between">
        <div>
          <h2 class="panel-title">AI 接入配置</h2>
          <p class="panel-subtitle">
            在这里填写 API 地址、API Key、聊天模型。Embedding 模型可选，用于更高质量相似度匹配；留空时系统会自动降级为本地向量。
          </p>
        </div>
        <button class="btn btn-ghost" type="button" :disabled="loading" @click="load">刷新</button>
      </div>
    </section>

    <section v-if="pageError" class="panel">
      <div class="panel-body"><span class="badge badge-danger">{{ pageError }}</span></div>
    </section>

    <section class="panel">
      <div class="panel-body column">
        <div class="row" style="justify-content: space-between; align-items: center">
          <div>
            <h2 class="panel-title">维护模式</h2>
            <p class="panel-subtitle">开启后前端将显示维护提示，用户无法正常使用。</p>
          </div>
          <label class="row-wrap" style="gap: 8px; cursor: pointer; font-size: 14px; font-weight: 600;">
            <input v-model="form.maintenance_mode" type="checkbox" style="width: 18px; height: 18px;" />
            {{ form.maintenance_mode ? '维护中' : '正常运行' }}
          </label>
        </div>
        <div v-if="form.maintenance_mode" class="badge badge-danger" style="align-self: flex-start;">
          ⚠ 维护模式已开启，前端用户将看到维护提示
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-body column">
        <label class="field">
          <span class="field-label">OpenAI Base URL</span>
          <input
            v-model="form.openai_base_url"
            class="input"
            placeholder="例如 https://api.openai.com/v1（系统会自动识别 /chat/completions 与 /embeddings）"
          />
        </label>

        <label class="field">
          <span class="field-label">聊天模型名称</span>
          <input v-model="form.openai_model" class="input" placeholder="例如 gpt-4.1-mini" />
        </label>

        <label class="field">
          <span class="field-label">输入价格 / 1M tokens</span>
          <input v-model="form.openai_input_price" type="number" step="0.01" class="input" placeholder="0.15" />
        </label>

        <label class="field">
          <span class="field-label">输出价格 / 1M tokens</span>
          <input v-model="form.openai_output_price" type="number" step="0.01" class="input" placeholder="0.6" />
        </label>

        <label class="field">
          <span class="field-label">Embedding 模型名称（可选）</span>
          <input
            v-model="form.openai_embedding_model"
            class="input"
            placeholder="例如 text-embedding-3-small；留空则启用本地降级向量"
          />
        </label>

        <label class="field">
          <span class="field-label">聊天 API Key</span>
          <input
            v-model="form.openai_api_key"
            class="input"
            type="password"
            :placeholder="keyPreview ? `当前已配置：${keyPreview}` : '输入新的 API Key'"
          />
          <label class="row-wrap" style="font-size: 12px; color: var(--text-muted)">
            <input v-model="keepExistingKey" type="checkbox" />
            保留服务器已保存的 Key（不勾选时，将使用上方输入覆盖）
          </label>
        </label>

        <label class="field">
          <span class="field-label">Embedding API Key（独立）</span>
          <input
            v-model="form.openai_embedding_api_key"
            class="input"
            type="password"
            :placeholder="embeddingKeyPreview ? `当前已配置：${embeddingKeyPreview}` : '可选；留空时向量接口将回退本地向量'"
          />
          <label class="row-wrap" style="font-size: 12px; color: var(--text-muted)">
            <input v-model="keepExistingEmbeddingKey" type="checkbox" />
            保留服务器已保存的 Embedding Key（不勾选时，将使用上方输入覆盖）
          </label>
        </label>

        <label class="field">
          <span class="field-label">前端来源域名（CORS）</span>
          <input v-model="form.web_origin" class="input" placeholder="例如 http://localhost:3001" />
        </label>

        <div class="row-wrap">
          <button class="btn btn-secondary" type="button" :disabled="testing" @click="testConnectivity">
            {{ testing ? '测试中...' : '测试接口连通性' }}
          </button>
          <button class="btn btn-primary" type="button" :disabled="saving" @click="save">
            {{ saving ? '保存中...' : '保存配置' }}
          </button>
        </div>

        <div class="muted" style="font-size: 12px">
          配置文件：{{ configPath || '-' }}
        </div>
      </div>
    </section>

    <section v-if="Object.keys(configSource).length > 0" class="panel">
      <div class="panel-body column">
        <h3 class="panel-title">配置来源</h3>
        <div class="tag-list">
          <span class="tag">BaseURL：{{ configSource.openai_base_url || '-' }}</span>
          <span class="tag">聊天 Key：{{ configSource.openai_api_key || '-' }}</span>
          <span class="tag">Embedding Key：{{ configSource.openai_embedding_api_key || '-' }}</span>
          <span class="tag">聊天模型：{{ configSource.openai_model || '-' }}</span>
          <span class="tag">输入价格：{{ configSource.openai_input_price || '-' }}</span>
          <span class="tag">输出价格：{{ configSource.openai_output_price || '-' }}</span>
          <span class="tag">Embedding：{{ configSource.openai_embedding_model || '-' }}</span>
          <span class="tag">Web Origin：{{ configSource.web_origin || '-' }}</span>
        </div>
      </div>
    </section>

    <section v-if="testResult" class="panel">
      <div class="panel-body column">
        <h3 class="panel-title">连通性测试结果</h3>
        <span class="badge" :class="testResult.ok ? 'badge-success' : 'badge-danger'">
          {{ testResult.ok ? '测试通过' : '测试失败' }}
        </span>
        <p class="panel-subtitle" style="margin: 0">{{ testResult.message }}</p>

        <div class="table-wrap">
          <table class="table" style="min-width: 560px">
            <thead>
              <tr>
                <th>项目</th>
                <th>状态</th>
                <th>HTTP</th>
                <th>延迟(ms)</th>
                <th>细节</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>聊天接口</td>
                <td>{{ testResult.chat.ok ? '成功' : '失败' }}</td>
                <td>{{ testResult.chat.status || '-' }}</td>
                <td>{{ testResult.chat.latency_ms || '-' }}</td>
                <td>{{ testResult.chat.error || testResult.chat.preview || '-' }}</td>
              </tr>
              <tr>
                <td>向量接口</td>
                <td>{{ testResult.embedding.ok ? '成功' : '失败' }}</td>
                <td>{{ testResult.embedding.status || '-' }}</td>
                <td>{{ testResult.embedding.latency_ms || '-' }}</td>
                <td>{{ testResult.embedding.error || `维度：${testResult.embedding.vector_size || '-'}` }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  </AdminShell>
</template>
