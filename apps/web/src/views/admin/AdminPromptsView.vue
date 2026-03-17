<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import AdminShell from '@/components/AdminShell.vue';
import { fetchAdminPrompts, updateAdminPrompt } from '@/lib/admin-api';
import { formatTime } from '@/lib/format';
import { toErrorMessage } from '@/lib/api-error';
import { useAdminSessionStore } from '@/stores/admin-session';
import { useNoticeStore } from '@/stores/notice';

const adminStore = useAdminSessionStore();
const noticeStore = useNoticeStore();

const loading = ref(false);
const saving = ref(false);
const pageError = ref('');
const prompts = ref<Array<{
  key: string;
  name: string;
  category: string;
  content: string;
  is_active: boolean;
  updated_at: string;
}>>([]);
const selectedKey = ref('');

const form = reactive({
  name: '',
  category: '',
  content: '',
  is_active: true,
});

const selectedPrompt = computed(() => prompts.value.find((item) => item.key === selectedKey.value) || null);

function fillForm() {
  const item = selectedPrompt.value;
  if (!item) {
    form.name = '';
    form.category = '';
    form.content = '';
    form.is_active = true;
    return;
  }
  form.name = item.name;
  form.category = item.category;
  form.content = item.content;
  form.is_active = item.is_active;
}

async function load() {
  if (!adminStore.token) {
    return;
  }

  loading.value = true;
  pageError.value = '';
  try {
    const payload = await fetchAdminPrompts(adminStore.token);
    prompts.value = payload;
    if (!selectedKey.value && payload.length > 0) {
      selectedKey.value = payload[0].key;
    }
    fillForm();
  } catch (error) {
    pageError.value = toErrorMessage(error);
  } finally {
    loading.value = false;
  }
}

async function save() {
  if (!adminStore.token || !selectedPrompt.value) {
    return;
  }

  saving.value = true;
  try {
    await updateAdminPrompt(adminStore.token, selectedPrompt.value.key, {
      name: form.name.trim(),
      category: form.category.trim(),
      content: form.content,
      is_active: form.is_active,
    });
    noticeStore.show('提示词已保存', 'success');
    await load();
  } catch (error) {
    noticeStore.show(toErrorMessage(error), 'error');
  } finally {
    saving.value = false;
  }
}

onMounted(() => {
  load();
});
</script>

<template>
  <AdminShell title="提示词管理" subtitle="访谈、陪练、匹配、中间层模板">
    <section class="panel">
      <div class="panel-body row" style="justify-content: space-between">
        <div>
          <h2 class="panel-title">Prompt 模板</h2>
          <p class="panel-subtitle">用于控制访谈问题生成、消息改写、AI 模拟人格等行为。</p>
        </div>
        <button class="btn btn-ghost" type="button" :disabled="loading" @click="load">刷新</button>
      </div>
    </section>

    <section v-if="pageError" class="panel">
      <div class="panel-body"><span class="badge badge-danger">{{ pageError }}</span></div>
    </section>

    <section class="panel">
      <div class="panel-body column">
        <label class="field">
          <span class="field-label">选择模板</span>
          <select
            v-model="selectedKey"
            class="select"
            @change="fillForm"
          >
            <option v-for="item in prompts" :key="item.key" :value="item.key">
              {{ item.category }} / {{ item.name }} ({{ item.key }})
            </option>
          </select>
        </label>

        <div v-if="selectedPrompt" class="column">
          <div class="muted" style="font-size: 12px">最近更新：{{ formatTime(selectedPrompt.updated_at) }}</div>

          <label class="field">
            <span class="field-label">模板名称</span>
            <input v-model="form.name" class="input" />
          </label>

          <label class="field">
            <span class="field-label">分类</span>
            <input v-model="form.category" class="input" />
          </label>

          <label class="field">
            <span class="field-label">模板内容</span>
            <textarea v-model="form.content" class="textarea" style="min-height: 300px" />
          </label>

          <label class="row-wrap" style="font-size: 13px">
            <input v-model="form.is_active" type="checkbox" />
            启用该模板
          </label>

          <div class="row-wrap">
            <button class="btn btn-primary" type="button" :disabled="saving" @click="save">
              {{ saving ? '保存中...' : '保存模板' }}
            </button>
          </div>
        </div>

        <div v-else class="empty-box">暂无可编辑模板</div>
      </div>
    </section>
  </AdminShell>
</template>
