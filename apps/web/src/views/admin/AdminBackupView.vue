<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AdminShell from '@/components/AdminShell.vue';
import {
  fetchAdminBackupInfo,
  downloadAdminBackup,
  uploadAdminRestore,
  adminResetAllData,
} from '@/lib/admin-api';
import { toErrorMessage } from '@/lib/api-error';
import { useAdminSessionStore } from '@/stores/admin-session';
import { useNoticeStore } from '@/stores/notice';

const adminStore = useAdminSessionStore();
const noticeStore = useNoticeStore();

const loading = ref(false);
const downloading = ref(false);
const uploading = ref(false);
const resetting = ref(false);
const pageError = ref('');
const restoreResult = ref<Record<string, number> | null>(null);
const confirmReset = ref(false);
const confirmRestore = ref(false);
const selectedFile = ref<File | null>(null);

const info = ref<{
  users: number;
  profiles: number;
  tags: number;
  matches: number;
  sandbox_messages: number;
  companion_sessions: number;
  companion_messages: number;
  interview_records: number;
  ai_logs: number;
} | null>(null);

async function loadInfo() {
  if (!adminStore.token) return;
  loading.value = true;
  pageError.value = '';
  try {
    info.value = await fetchAdminBackupInfo(adminStore.token);
  } catch (err) {
    pageError.value = toErrorMessage(err);
  } finally {
    loading.value = false;
  }
}

async function handleDownload() {
  if (!adminStore.token) return;
  downloading.value = true;
  try {
    await downloadAdminBackup(adminStore.token);
    noticeStore.show('备份文件已开始下载', 'success');
  } catch (err) {
    noticeStore.show(toErrorMessage(err), 'error');
  } finally {
    downloading.value = false;
  }
}

function onFileSelected(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (!file) return;
  if (!file.name.endsWith('.json')) {
    noticeStore.show('请选择 .json 格式的备份文件', 'error');
    return;
  }
  selectedFile.value = file;
  confirmRestore.value = true;
}

async function handleRestore() {
  if (!adminStore.token || !selectedFile.value) return;
  uploading.value = true;
  confirmRestore.value = false;
  restoreResult.value = null;
  try {
    const result = await uploadAdminRestore(adminStore.token, selectedFile.value);
    restoreResult.value = result.restored;
    noticeStore.show('数据恢复成功', 'success');
    await loadInfo();
  } catch (err) {
    noticeStore.show(toErrorMessage(err), 'error');
  } finally {
    uploading.value = false;
    selectedFile.value = null;
  }
}

async function handleReset() {
  if (!adminStore.token) return;
  resetting.value = true;
  confirmReset.value = false;
  try {
    await adminResetAllData(adminStore.token);
    noticeStore.show('所有用户数据已清空', 'success');
    await loadInfo();
  } catch (err) {
    noticeStore.show(toErrorMessage(err), 'error');
  } finally {
    resetting.value = false;
  }
}

onMounted(loadInfo);
</script>

<template>
  <AdminShell title="数据管理">
    <div class="column" style="gap: 16px; max-width: 680px">

      <!-- 数据概览 -->
      <div class="panel">
        <div class="panel-body">
          <h3 class="panel-title">数据概览</h3>
          <p v-if="loading" class="muted" style="font-size: 13px">加载中...</p>
          <p v-if="pageError" style="color: var(--danger); font-size: 13px">{{ pageError }}</p>
          <div v-if="info" class="backup-stats">
            <div class="stat-item"><span class="stat-label">用户</span><span class="stat-value">{{ info.users }}</span></div>
            <div class="stat-item"><span class="stat-label">画像</span><span class="stat-value">{{ info.profiles }}</span></div>
            <div class="stat-item"><span class="stat-label">标签</span><span class="stat-value">{{ info.tags }}</span></div>
            <div class="stat-item"><span class="stat-label">匹配</span><span class="stat-value">{{ info.matches }}</span></div>
            <div class="stat-item"><span class="stat-label">沙盒消息</span><span class="stat-value">{{ info.sandbox_messages }}</span></div>
            <div class="stat-item"><span class="stat-label">陪伴会话</span><span class="stat-value">{{ info.companion_sessions }}</span></div>
            <div class="stat-item"><span class="stat-label">陪伴消息</span><span class="stat-value">{{ info.companion_messages }}</span></div>
            <div class="stat-item"><span class="stat-label">访谈记录</span><span class="stat-value">{{ info.interview_records }}</span></div>
            <div class="stat-item"><span class="stat-label">AI日志</span><span class="stat-value">{{ info.ai_logs }}</span></div>
          </div>
        </div>
      </div>

      <!-- 备份下载 -->
      <div class="panel">
        <div class="panel-body">
          <h3 class="panel-title">备份下载</h3>
          <p class="panel-subtitle">导出所有数据库数据和运行时配置为 JSON 文件。可用于服务器迁移或数据存档。</p>
          <button
            class="btn btn-primary"
            type="button"
            :disabled="downloading || loading"
            style="margin-top: 12px"
            @click="handleDownload"
          >
            {{ downloading ? '正在打包...' : '下载备份' }}
          </button>
        </div>
      </div>

      <!-- 数据恢复 -->
      <div class="panel">
        <div class="panel-body">
          <h3 class="panel-title">数据恢复</h3>
          <p class="panel-subtitle">上传之前导出的 JSON 备份文件，将覆盖当前所有数据。</p>
          <label class="btn btn-ghost" style="margin-top: 12px; cursor: pointer; display: inline-block">
            {{ uploading ? '正在恢复...' : '选择备份文件' }}
            <input
              type="file"
              accept=".json"
              style="display: none"
              :disabled="uploading"
              @change="onFileSelected"
            />
          </label>

          <!-- 恢复确认弹窗 -->
          <div v-if="confirmRestore" class="confirm-overlay">
            <div class="confirm-dialog">
              <h4 style="margin: 0 0 8px">确认恢复数据？</h4>
              <p style="font-size: 13px; color: #666; margin: 0 0 16px">
                将删除当前所有数据并替换为备份文件中的数据。<br>
                文件：{{ selectedFile?.name }}（{{ ((selectedFile?.size || 0) / 1024).toFixed(1) }} KB）
              </p>
              <div class="row" style="gap: 8px; justify-content: flex-end">
                <button class="btn btn-ghost" type="button" @click="confirmRestore = false; selectedFile = null">取消</button>
                <button class="btn btn-primary" type="button" style="background: var(--danger)" @click="handleRestore">确认恢复</button>
              </div>
            </div>
          </div>

          <div v-if="restoreResult" class="restore-result">
            <strong>恢复完成：</strong>
            <span v-for="(count, key) in restoreResult" :key="key" class="tag" style="margin: 2px">
              {{ key }}: {{ count }}
            </span>
          </div>
        </div>
      </div>

      <!-- 清空数据 -->
      <div class="panel" style="border-color: rgba(239, 71, 111, 0.3)">
        <div class="panel-body">
          <h3 class="panel-title" style="color: var(--danger)">清空所有数据</h3>
          <p class="panel-subtitle">删除所有用户、消息、匹配、标签等数据，恢复为空白状态。此操作不可逆。</p>
          <button
            class="btn btn-ghost"
            type="button"
            :disabled="resetting"
            style="margin-top: 12px; color: var(--danger); border-color: var(--danger)"
            @click="confirmReset = true"
          >
            {{ resetting ? '清空中...' : '清空所有数据' }}
          </button>

          <!-- 清空确认弹窗 -->
          <div v-if="confirmReset" class="confirm-overlay">
            <div class="confirm-dialog">
              <h4 style="margin: 0 0 8px; color: var(--danger)">确认清空所有数据？</h4>
              <p style="font-size: 13px; color: #666; margin: 0 0 16px">
                此操作将永久删除所有用户和相关数据，运行时配置不会被清除。<br>
                <strong style="color: var(--danger)">此操作不可逆！</strong>
              </p>
              <div class="row" style="gap: 8px; justify-content: flex-end">
                <button class="btn btn-ghost" type="button" @click="confirmReset = false">取消</button>
                <button class="btn btn-primary" type="button" style="background: var(--danger)" @click="handleReset">确认清空</button>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  </AdminShell>
</template>

<style scoped>
.backup-stats {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: 10px;
  margin-top: 12px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 12px;
  border-radius: 10px;
  background: var(--surface-soft);
  border: 1px solid var(--border);
}

.stat-label {
  font-size: 12px;
  color: var(--text-muted);
}

.stat-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
}

.confirm-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.confirm-dialog {
  background: white;
  border-radius: 16px;
  padding: 24px;
  max-width: 400px;
  width: 100%;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.15);
}

.restore-result {
  margin-top: 12px;
  padding: 10px;
  border-radius: 10px;
  background: rgba(45, 200, 168, 0.08);
  border: 1px solid rgba(45, 200, 168, 0.2);
  font-size: 13px;
}
</style>
