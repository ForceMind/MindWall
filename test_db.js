const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  const sessions = await prisma.companionSession.findMany({
    orderBy: { created_at: 'desc' },
    take: 1
  });
  if (sessions.length > 0) {
     const msgs = await prisma.companionMessage.findMany({
       where: { session_id: sessions[0].id },
       orderBy: { created_at: 'asc' }
     });
     console.dir(msgs.map(m => m.sender_type + ": " + m.ai_rewritten_text), { depth: null });
  }
}
run();
