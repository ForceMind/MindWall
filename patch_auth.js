const fs = require('fs');
let p = 'e:/Privy/MindWall/apps/api/src/auth/auth.service.ts';
let content = fs.readFileSync(p, 'utf8');

content = content.replace(/public_tags: user\.tags,\s*\};/, \public_tags: user.tags,
          has_deep_interview: user.interview_sessions.length > 0,
        };\);
content = content.replace(/tags: \{\s*where: \{\s*type: 'PUBLIC_VISIBLE',\s*\},\s*orderBy: \{\s*weight: 'desc',\s*\},\s*take: 8,\s*select: \{\s*tag_name: true,\s*weight: true,\s*ai_justification: true,\s*\},\s*\},\s*\},/,
\	ags: {
              where: {
                type: 'PUBLIC_VISIBLE',
              },
              orderBy: {
                weight: 'desc',
              },
              take: 8,
              select: {
                tag_name: true,
                weight: true,
                ai_justification: true,
              },
            },
            interview_sessions: {
              where: {
                total_questions: { gte: 8 },
                status: 'completed'
              },
              select: { id: true },
              take: 1
            },
          },\
);

fs.writeFileSync(p, content, 'utf8');
