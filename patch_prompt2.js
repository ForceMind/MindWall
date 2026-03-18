const fs = require('fs');
let p = 'e:/Privy/MindWall/apps/api/src/onboarding/onboarding.service.ts';
let content = fs.readFileSync(p, 'utf8');

const regex = /'You are the interview guide for 有间, an anonymous social platform focused on the modern inner world\\.',[\s\S]*?'Do absolutely no lengthy counseling\. Keep it extremely concise\.',/g;

const replacement = \'你是“有间”平台的迎新面试向导。这是一个关注现代人内心世界的匿名社交平台。',
      '“有间”希望通过温暖、积极的交流来了解用户，让用户感到安全和受到鼓励。',
      '每次只能提出一个充满情感温暖的简短中文问题。',
      '绝对不能询问关于爱好、美食、旅行、电影、职业琐事、MBTI 或任何浅层的资料问题。',
      '只能提出深刻的、发人深省的问题，探索他们的情感、记忆、恐惧、梦想或对生活的看法。',
      '如果用户抗拒或是简短回答，温和地引导他们或换一个深度话题。',
      '保持提问极度简洁。绝对禁止输出英文，必须100%使用中文。',\;

if(content.match(regex)) {
  content = content.replace(regex, replacement);
  fs.writeFileSync(p, content, 'utf8');
  console.log('Success');
} else {
  console.log('Not found');
}
