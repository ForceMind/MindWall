const fs = require('fs');
let p = 'e:/Privy/MindWall/apps/web/src/views/user/ChatRoomView.vue';
let content = fs.readFileSync(p, 'utf8');

// fix saveAiHistory
content = content.replace(/saveAiHistory\(\);/g, '// saveAiHistory removed');

// fix AI 转述中 (Sandbox text)
content = content.replace(/\{\{\s*wall\.wallBroken \? '已破壁直聊' : '匿名交流中'\s*\}\}/g, "{{ wall.wallBroken ? '已破壁直聊' : 'AI 转述中' }}");

fs.writeFileSync(p, content, 'utf8');
