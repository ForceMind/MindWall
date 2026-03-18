const fs = require('fs');
let code = fs.readFileSync('apps/api/src/companion/companion.service.ts', 'utf-8');

code = code.replace(/import \{ BadRequestException, Injectable, Logger \} from '@nestjs\/common';/, 
  'import { BadRequestException, Injectable, Logger } from \'@nestjs/common\';\nimport { PRESET_PERSONAS } from \'./personas\';');

const pattern = /private readonly personaArchetypes: Persona\[\] = \[[\s\S]*?\];/;
code = code.replace(pattern, 'private readonly personaArchetypes = PRESET_PERSONAS;');

fs.writeFileSync('apps/api/src/companion/companion.service.ts', code);
console.log('patched companion');
