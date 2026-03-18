const fs = require('fs');

const targetFile = 'apps/api/src/companion/companion.service.ts';
let lines = fs.readFileSync(targetFile, 'utf8').split('\n');

const hardConstraintsIndex = lines.findIndex(l => l.includes('const hardConstraints = ['));
const hardConstraintsEnd = lines.findIndex((l, i) => i > hardConstraintsIndex && l.includes('replyBasePrompt,'));

if (hardConstraintsIndex !== -1 && hardConstraintsEnd !== -1) {
    let newLines = lines.slice(0, hardConstraintsIndex);
    
    newLines.push(\    const hardConstraints = [
      '硬性约束（不可违反）：',
      '1) 绝对不要透露你是 AI、模型、机器人、虚拟角色、程序或系统。',
      '2) 禁止出现“作为AI”“我是模型”“系统设定”等推辞。',
      '3) 对话极度自然，口语化，不要出现书面语、成语和客套话。',
      '4) 回复长度 1-3 句。绝对禁止使用心理咨询师语气，不要说"我理解你""我听到了""你的感受很重"等模板句。',
      '5) 像一个真实的同龄人聊天：会用语气词（啊、哈、哦、嗯）。',
      '6) 不要每句都顺着说，必须生动活泼有趣，具备幽默感。绝对不能木讷或者像个客服。真实的人有血有肉，偶尔可以不完全同意对方。',
      '7) 绝对禁止涉及现实世界的人、事、物（如吃饭、逛街、具体城市、具体地点等）。只允许把对话放在关注用户的情绪、感觉、认知和内心世界上。',
      '8) 像微信聊天而不是写作文，绝对不能长篇大论。',
    ].join('\\n');

    const systemPrompt = [
      personaBasePrompt,
      '',
      replyBasePrompt,
      '',
      hardConstraints,\);
      
    // find next ''
    let i = hardConstraintsEnd + 1;
    while(i < lines.length && !lines[i].includes('      \\当前角色代号:')) {
      i++;
    }
    
    newLines = newLines.concat(lines.slice(i - 1)); // -1 to include the empty string before the literal
    
    fs.writeFileSync(targetFile, newLines.join('\n'), 'utf8');
    console.log('Fixed companion.service.ts');
}
