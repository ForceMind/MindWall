const fs = require('fs');
let p = 'e:/Privy/MindWall/apps/api/src/companion/companion.service.ts';
let content = fs.readFileSync(p, 'utf8');

const regex = /const chatMessages: Array<\{ role: string; content: string \}> = \[\s*\{\s*role: 'system',\s*content: systemPrompt,\s*\},\s*\];\s*\/\/ Add conversation history as separate(.*?)content: lastUserMessage,\s*\}\);/s;

const replacement = \const chatMessages: Array<{ role: string; content: string }> = [
      {
        role: 'system',
        content: systemPrompt,
      },
    ];

    let historyText = '【历史对话记录】\\n';
    if (history.length > 1) {
      for (const turn of history.slice(0, -1)) {
        const speaker = turn.role === 'assistant' ? persona.name : '用户';
        historyText += \\: \\\n\;
      }
    } else {
      historyText += '(无)\\n';
    }

    const finalPrompt = [
      historyText,
      '\\n【当前用户最新回复】',
      lastUserMessage,
      '\\n请根据以上上下文，直接输出你(\)的下一句回复（纯文本，不要带有前缀）。'
    ].join('\\n');

    chatMessages.push({
      role: 'user',
      content: finalPrompt,
    });\;

content = content.replace(regex, replacement);
fs.writeFileSync(p, content, 'utf8');
