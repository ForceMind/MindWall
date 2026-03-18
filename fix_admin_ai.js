const fs = require('fs');
let p = 'e:/Privy/MindWall/apps/web/src/views/admin/AdminAiRecordsView.vue';
let content = fs.readFileSync(p, 'utf8');

const regex = /  function closeModal\(\) \{\n    isModalOpen\.value = false;\n    selectedRecord\.value = null;\n  \}\n    total\.value = Number/;

const replacement = `  function closeModal() {
    isModalOpen.value = false;
    selectedRecord.value = null;
  }

  async function loadData() {
    loading.value = true;
    pageError.value = '';
    try {
      const payload = await fetchAdminAiRecords(adminStore.token, page.value, limit.value);
      total.value = Number`;

content = content.replace(regex, replacement);
fs.writeFileSync(p, content, 'utf8');
console.log('Fixed admin ai records view');
