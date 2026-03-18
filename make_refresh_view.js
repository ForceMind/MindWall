const fs = require('fs');
let content = fs.readFileSync('apps/web/src/views/user/DeepInterviewView.vue', 'utf8');
content = content.replace(/'deep'/g, "'refresh'");
content = content.replace(/DeepInterviewView/g, "RefreshInterviewView");
content = content.replace(/深度访谈/g, "更新状态");
content = content.replace(/重新生成你的画像/g, "重新了解你的最新状态");
fs.writeFileSync('apps/web/src/views/user/RefreshInterviewView.vue', content, 'utf8');
