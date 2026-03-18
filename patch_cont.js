const fs = require('fs');
let code = fs.readFileSync('apps/api/src/contacts/contacts.service.ts', 'utf-8');

code = code.replace(/import \{ Injectable, NotFoundException \} from '@nestjs\/common';/,
  'import { Injectable, NotFoundException } from \'@nestjs/common\';\nimport { PRESET_PERSONAS } from \'../companion/personas\';');

const match = code.match(/const personas = \[([\s\S]*?)\];\s*return personas\.map/);
if (match) {
  code = code.replace(match[0], 
\const shuffled = [...PRESET_PERSONAS].sort(() => 0.5 - Math.random());
    const aiCandidates = shuffled.slice(0, 6);

    const personas = aiCandidates.map(p => {
      const isPsych = p.id === 'ai_psychologist';
      return {
        id: p.id,
        name: isPsych ? p.name : this.generateDynamicName(userId || '', p.id, city || null),
        tags: [...p.tags, ...seedTags].slice(0, 4),
        summary: p.summary,
        disclosure: '∆•≈‰∂‘œÛ',
      };
    });

    return personas.map\);
  fs.writeFileSync('apps/api/src/contacts/contacts.service.ts', code);
  console.log('patched contacts 3!');
} else {
  console.log('regex mismatch');
}
