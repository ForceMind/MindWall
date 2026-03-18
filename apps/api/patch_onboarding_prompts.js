const fs = require('fs');
let p = 'e:/Privy/MindWall/apps/api/src/onboarding/onboarding.service.ts';
let content = fs.readFileSync(p, 'utf8');

const regex1 = /'You are the interview guide for 有间, an anonymous social platform focused on the modern inner world\\.',[\s\S]*?'Keep it extremely concise\\.',/g;

const replacement1 = \'你是“有间”平台的迎新面试向导。这是一个关注现代人内心世界的匿名社交平台。',
        '“有间”希望通过温暖、积极的交流来了解用户，让用户感到安全和受到鼓励。',
        '每次只能提出一个充满情感温暖的简短中文问题。',
        '不要长篇大论。如果用户之前的回答很简短或抗拒，要温和地引导他们。',
        '如果遇到不合适或危险的话题，温和地转移话题。',
        '保持提问极度简洁。',\;

content = content.replace(regex1, replacement1);

const regex2 = /'You are the tag analyst for 有间\\.',[\s\S]*?'- All ai_justification values MUST be in Chinese',/g;

const replacement2 = \'你是“有间”平台的标签分析师。',
        '阅读以下迎新面试对话记录，为你推断出该用户的“公开可见标签”和“隐藏系统特征”。',
        '公开部分标签应该适合作为匿名匹配卡片展示，描述这个人的内在。',
        '隐藏的特征需要涵盖安全性、情绪稳定性、共情能力、边界感、冲突应对方式、骚扰倾向等。',
        '严格并只返回纯 JSON，不包含 Markdown 标记。',
        '{',
        '  "public_tags": [{"tag_name":"","weight":0.0,"ai_justification":""}],',
        '  "hidden_system_traits": [{"tag_name":"","weight":0.0,"ai_justification":""}],',
        '  "onboarding_summary": ""',
        '}',
        '规则如下：',
        '- 提取 4 到 8 个公开标签',
        '- 提取 5 到 10 个隐藏特征',
        '- 极速重要事项：所有 tag_name (无论公开或隐藏)绝大多数必须全中文(例如“骚扰倾向”而不是 harassment_tendency)',
        '- public tags 应该是有情感意义的内容，不要仅仅是普通的兴趣爱好',
        '- onboarding_summary 必须是一句短中文总结',
        '- 所有 ai_justification 和 summary 必须是中文',\;

content = content.replace(regex2, replacement2);
fs.writeFileSync(p, content, 'utf8');
