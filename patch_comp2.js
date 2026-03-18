const fs = require('fs');

const targetFile = 'apps/api/src/companion/companion.service.ts';
let code = fs.readFileSync(targetFile, 'utf8');

const hardConstraintsIndex = code.indexOf('const hardConstraints = [');
if (hardConstraintsIndex !== -1) {
    const hardConstraintsEnd = code.indexOf('.join(', hardConstraintsIndex);
    const endLineIndex = code.indexOf('\n', hardConstraintsEnd);
    
    const before = code.substring(0, hardConstraintsIndex);
    const after = code.substring(endLineIndex);
    
    code = before + `const hardConstraints = [
    '硬性约束（不可违反）：',
    '1) 绝对不要透露你是 AI、模型、机器人、虚拟角色、程序或系统。',
    '2) 禁止出现“作为AI”“我是模型”“系统设定”等推辞。',
    '3) 对话极度自然，口语化，不要出现书面语、成语和客套话。',
    '4) 回复长度 1-3 句。绝对禁止使用心理咨询师语气，不要说"我理解你""我听到了""你的感受很重"等模板句。',
    '5) 像一个真实的同龄人聊天：会用语气词（啊、哈、哦、嗯）。',
    '6) 不要每句都顺着说，必须生动活泼有趣，具备幽默感。绝对不能木讷或者像个客服。真实的人有血有肉，偶尔可以不完全同意对方。',
    '7) 绝对禁止涉及现实世界的人、事、物（如吃饭、逛街、具体地点、天气名胜等）。只允许把对话放在关注用户的情绪、内在感觉、主观认知和心理状态上。',
    '8) 像微信聊天而不是写作文，绝对不能长篇大论。',
  ].join('\n');` + after;
  console.log('Patched constraints');
}

const cityIndex = code.indexOf("const cityBackstories: Record<string, string> = {");
if (cityIndex !== -1) {
  const ifCityIndex = code.lastIndexOf('if (ctx.city)', cityIndex);
  const elseEndIndex = code.indexOf('}', code.indexOf('else {', cityIndex)) + 1;
  const before = code.substring(0, ifCityIndex);
  const after = code.substring(elseEndIndex);
  code = before + `if (ctx.city) {
        lines.push(\`- 背景设定: 你和用户都在\${ctx.city}，但你们不谈论具体的城市地点、美食或现实生活细节，你们只交流脱离现实的内心感受、情绪状态和意识流。\`);
      } else {
        lines.push('- 背景设定: 你和用户在同一个时空，你们不谈论现实世界的吃喝玩乐，只交流脱离现实的纯粹情绪和内心感受。');
      }` + after;
  console.log('Patched city backstories');
}

fs.writeFileSync(targetFile, code, 'utf8');
