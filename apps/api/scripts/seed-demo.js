/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { PrismaClient, MatchStatus, UserTagType } = require('@prisma/client');

const prisma = new PrismaClient();

function pickCanonicalPair(a, b) {
  return a < b ? [a, b] : [b, a];
}

async function upsertUser(authProviderId, profile) {
  const user = await prisma.user.upsert({
    where: { auth_provider_id: authProviderId },
    create: {
      auth_provider_id: authProviderId,
      status: 'active',
    },
    update: {
      status: 'active',
    },
    select: { id: true },
  });

  await prisma.userProfile.upsert({
    where: { user_id: user.id },
    create: {
      user_id: user.id,
      real_name: profile.real_name,
      real_avatar: profile.real_avatar,
      city: profile.city,
      is_wall_broken: false,
    },
    update: {
      real_name: profile.real_name,
      real_avatar: profile.real_avatar,
      city: profile.city,
      is_wall_broken: false,
    },
  });

  return user.id;
}

async function resetTags(userId, publicTags, hiddenTags) {
  await prisma.userTag.deleteMany({
    where: { user_id: userId },
  });

  for (const item of publicTags) {
    await prisma.userTag.create({
      data: {
        user_id: userId,
        type: UserTagType.PUBLIC_VISIBLE,
        tag_name: item.tag_name,
        weight: item.weight,
        ai_justification: item.ai_justification,
      },
    });
  }

  for (const item of hiddenTags) {
    await prisma.userTag.create({
      data: {
        user_id: userId,
        type: UserTagType.HIDDEN_SYSTEM,
        tag_name: item.tag_name,
        weight: item.weight,
        ai_justification: item.ai_justification,
      },
    });
  }
}

async function ensureMatch(userAId, userBId) {
  const [first, second] = pickCanonicalPair(userAId, userBId);
  const existing = await prisma.match.findFirst({
    where: {
      OR: [
        { user_a_id: first, user_b_id: second },
        { user_a_id: second, user_b_id: first },
      ],
    },
    select: { id: true },
  });

  const payload = {
    user_a_id: first,
    user_b_id: second,
    status: MatchStatus.active_sandbox,
    resonance_score: 95,
    ai_match_reason: 'Demo match for sandbox-to-wall-break flow.',
    wall_break_consents: {},
    wall_broken_at: null,
  };

  let matchId = '';
  if (!existing) {
    const created = await prisma.match.create({
      data: payload,
      select: { id: true },
    });
    matchId = created.id;
  } else {
    await prisma.match.update({
      where: { id: existing.id },
      data: payload,
    });
    matchId = existing.id;
  }

  await prisma.sandboxMessage.deleteMany({
    where: { match_id: matchId },
  });

  return matchId;
}

async function main() {
  const city = process.env.DEMO_CITY || 'Shanghai';
  const userAAuth = process.env.DEMO_USER_A_AUTH || 'mindwall_demo_a';
  const userBAuth = process.env.DEMO_USER_B_AUTH || 'mindwall_demo_b';

  const userAId = await upsertUser(userAAuth, {
    real_name: 'Alice Demo',
    real_avatar: 'https://picsum.photos/seed/mindwall-a/160/160',
    city,
  });
  const userBId = await upsertUser(userBAuth, {
    real_name: 'Bob Demo',
    real_avatar: 'https://picsum.photos/seed/mindwall-b/160/160',
    city,
  });

  await resetTags(
    userAId,
    [
      {
        tag_name: '温和沟通',
        weight: 0.86,
        ai_justification: '表达友好并愿意倾听。',
      },
      {
        tag_name: '技术探索者',
        weight: 0.79,
        ai_justification: '对技术和创意议题投入较高。',
      },
    ],
    [
      {
        tag_name: '骚扰倾向',
        weight: 1,
        ai_justification: '初始低风险。',
      },
      {
        tag_name: '共情能力',
        weight: 7.6,
        ai_justification: '具备较高同理心。',
      },
    ],
  );

  await resetTags(
    userBId,
    [
      {
        tag_name: '内省型',
        weight: 0.82,
        ai_justification: '偏好深入交流。',
      },
      {
        tag_name: '边界清晰',
        weight: 0.77,
        ai_justification: '重视尊重与边界。',
      },
    ],
    [
      {
        tag_name: '骚扰倾向',
        weight: 1,
        ai_justification: '初始低风险。',
      },
      {
        tag_name: '情绪稳定',
        weight: 7.4,
        ai_justification: '情绪表达稳定。',
      },
    ],
  );

  const matchId = await ensureMatch(userAId, userBId);

  const result = {
    city,
    user_a_id: userAId,
    user_b_id: userBId,
    match_id: matchId,
  };

  const outFile = path.join(__dirname, '.demo-seed.json');
  fs.writeFileSync(outFile, JSON.stringify(result, null, 2), 'utf8');

  console.log('Demo seed created.');
  console.log(JSON.stringify(result, null, 2));
  console.log(`Saved: ${outFile}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
