<script setup lang="ts">
import { onMounted, ref } from 'vue';
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
const content = ref<string[]>([]);

async function load() {
  if (!adminStore.token) {
    return;
  }

  loading.value = true;
  pageError.value = '';
  try {
    const payload = await fetchAdminLogs(adminStore.token, lines.value);
    filePath.value = payload.file;
    totalLines.value = payload.total_lines;
    content.value = payload.lines;
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
          <p class="panel-subtitle">日志文件：{{ filePath || '-' }}（总行数 {{ totalLines }}）</p>
        </div>

        <div class="row-wrap">
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
        <div style="max-height: 68dvh; overflow: auto; font-family: Consolas, monospace; font-size: 12px; line-height: 1.45">
          <div
            v-for="(line, idx) in content"
            :key="`${idx}-${line.slice(0, 12)}`"
            style="padding: 6px 10px; border-bottom: 1px solid #223457; white-space: pre-wrap; word-break: break-all"
          >
            <span style="color: #7f92b8; margin-right: 8px">{{ idx + 1 }}</span>
            {{ line }}
          </div>

          <div v-if="content.length === 0 && !loading" class="empty-box" style="margin: 12px">暂无日志内容</div>
        </div>
      </div>
    </section>
  </AdminShell>
</template>
