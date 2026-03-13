/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3100';
const WS_BASE_URL = process.env.WS_BASE_URL || 'ws://localhost:3100';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

class WsClient {
  constructor(name, url) {
    this.name = name;
    this.url = url;
    this.ws = null;
    this.events = [];
    this.waiters = [];
  }

  async connect() {
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('message', (event) => {
      let payload = {};
      try {
        payload = JSON.parse(String(event.data || '{}'));
      } catch {
        payload = { type: 'invalid_json', raw: String(event.data || '') };
      }
      this.events.push(payload);
      this.resolveWaiters(payload);
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`[${this.name}] websocket open timeout`));
      }, 10000);

      this.ws.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );

      this.ws.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error(`[${this.name}] websocket open error`));
        },
        { once: true },
      );
    });
  }

  send(payload) {
    assert(this.ws && this.ws.readyState === WebSocket.OPEN, `[${this.name}] websocket not open`);
    this.ws.send(JSON.stringify(payload));
  }

  waitFor(predicate, timeoutMs = 10000) {
    const existing = this.events.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`[${this.name}] waitFor timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      this.waiters.push({
        predicate,
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  }

  resolveWaiters(payload) {
    const remaining = [];
    for (const waiter of this.waiters) {
      if (waiter.predicate(payload)) {
        waiter.resolve(payload);
      } else {
        remaining.push(waiter);
      }
    }
    this.waiters = remaining;
  }

  close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
    this.ws = null;
  }
}

function loadSeed() {
  if (
    process.env.DEMO_USER_A_ID &&
    process.env.DEMO_USER_B_ID &&
    process.env.DEMO_MATCH_ID
  ) {
    return {
      user_a_id: process.env.DEMO_USER_A_ID,
      user_b_id: process.env.DEMO_USER_B_ID,
      match_id: process.env.DEMO_MATCH_ID,
    };
  }

  const seedFile = path.join(__dirname, '.demo-seed.json');
  if (!fs.existsSync(seedFile)) {
    throw new Error(
      `Seed file not found: ${seedFile}. Run "npm run seed:demo" first, or provide DEMO_USER_A_ID/DEMO_USER_B_ID/DEMO_MATCH_ID.`,
    );
  }

  const text = fs.readFileSync(seedFile, 'utf8');
  const parsed = JSON.parse(text);
  assert(parsed.user_a_id, 'seed user_a_id missing');
  assert(parsed.user_b_id, 'seed user_b_id missing');
  assert(parsed.match_id, 'seed match_id missing');
  return parsed;
}

async function fetchWallState(matchId, userId) {
  const url = `${API_BASE_URL}/sandbox/matches/${matchId}/wall-state?user_id=${encodeURIComponent(userId)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`wall-state request failed: ${response.status}`);
  }
  return response.json();
}

async function main() {
  const seed = loadSeed();
  const wsUrl = `${WS_BASE_URL}/ws/sandbox`;

  const alice = new WsClient('alice', wsUrl);
  const bob = new WsClient('bob', wsUrl);

  await alice.connect();
  await bob.connect();

  await Promise.all([
    alice.waitFor((event) => event.type === 'connected'),
    bob.waitFor((event) => event.type === 'connected'),
  ]);

  alice.send({ type: 'auth', user_id: seed.user_a_id });
  bob.send({ type: 'auth', user_id: seed.user_b_id });
  await Promise.all([
    alice.waitFor((event) => event.type === 'auth_ok'),
    bob.waitFor((event) => event.type === 'auth_ok'),
  ]);

  alice.send({ type: 'join_match', match_id: seed.match_id });
  bob.send({ type: 'join_match', match_id: seed.match_id });
  const [aliceJoin, bobJoin] = await Promise.all([
    alice.waitFor((event) => event.type === 'join_ok'),
    bob.waitFor((event) => event.type === 'join_ok'),
  ]);
  console.log('[join_ok]', {
    alice_status: aliceJoin.status,
    bob_status: bobJoin.status,
    alice_score: aliceJoin.resonance_score,
    bob_score: bobJoin.resonance_score,
  });

  alice.send({
    type: 'sandbox_message',
    match_id: seed.match_id,
    text: '你好，很高兴认识你，我们可以聊聊最近的兴趣吗？',
  });

  await Promise.all([
    alice.waitFor(
      (event) => event.type === 'message_delivered' && event.mode === 'sandbox',
      15000,
    ),
    bob.waitFor(
      (event) => event.type === 'sandbox_message' && event.mode === 'sandbox',
      15000,
    ),
  ]);

  await Promise.all([
    alice.waitFor((event) => event.type === 'wall_ready', 15000),
    bob.waitFor((event) => event.type === 'wall_ready', 15000),
  ]);
  console.log('[wall_ready] received by both clients');

  alice.send({
    type: 'wall_break_decision',
    match_id: seed.match_id,
    accept: true,
  });
  await alice.waitFor((event) => event.type === 'wall_break_update', 15000);
  await bob.waitFor((event) => event.type === 'wall_break_update', 15000);
  console.log('[wall_break_update] first consent synced');

  bob.send({
    type: 'wall_break_decision',
    match_id: seed.match_id,
    accept: true,
  });
  await Promise.all([
    alice.waitFor((event) => event.type === 'wall_broken', 15000),
    bob.waitFor((event) => event.type === 'wall_broken', 15000),
  ]);
  console.log('[wall_broken] both clients unlocked');

  alice.send({
    type: 'direct_message',
    match_id: seed.match_id,
    text: '现在已经破墙了，我们可以直接交流。',
  });
  await Promise.all([
    alice.waitFor(
      (event) => event.type === 'message_delivered' && event.mode === 'direct',
      15000,
    ),
    bob.waitFor((event) => event.type === 'direct_message', 15000),
  ]);
  console.log('[direct_message] delivery verified');

  const wallStateAlice = await fetchWallState(seed.match_id, seed.user_a_id);
  const wallStateBob = await fetchWallState(seed.match_id, seed.user_b_id);
  assert(wallStateAlice.wallBroken === true, 'alice wallBroken should be true');
  assert(wallStateBob.wallBroken === true, 'bob wallBroken should be true');
  console.log('[wall_state] API verification passed');

  alice.close();
  bob.close();

  await sleep(300);
  console.log('Smoke test completed successfully.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
