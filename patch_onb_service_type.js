const fs = require('fs');
let p='apps/api/src/onboarding/onboarding.service.ts';
let content = fs.readFileSync(p, 'utf8');

content = content.replace(/total_questions: type === 'deep' \? 8 : 4,/g, "total_questions: type === 'deep' ? 8 : (type === 'refresh' ? 3 : 4),");
content = content.replace(/const firstQuestion = await this\.generateQuestion\(\[\], 0, type === 'deep' \? 8 : 4, userId\);/g, "const firstQuestion = await this.generateQuestion([], 0, type === 'deep' ? 8 : (type === 'refresh' ? 3 : 4), userId);");
content = content.replace(/totalQuestions: type === 'deep' \? 8 : 4,/g, "totalQuestions: type === 'deep' ? 8 : (type === 'refresh' ? 3 : 4),");
content = content.replace(/remaining_questions: type === 'deep' \? 8 : 4,/g, "remaining_questions: type === 'deep' ? 8 : (type === 'refresh' ? 3 : 4),");

fs.writeFileSync(p, content, 'utf8');
