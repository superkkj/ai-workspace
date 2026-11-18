/** End-to-end API check against the local D1 preview. Never targets a hosted Site. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:4173');
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password) {
  throw new Error('This test only accepts an HTTP loopback preview URL.');
}
// CI uses an isolated patched runtime for both the server and local D1 cleanup.
const wranglerCli = process.env.YEOREOJWO_WRANGLER_CLI ?? './node_modules/wrangler/bin/wrangler.js';
const suffix = randomUUID();
const actors = ['owner', 'provider', 'one', 'two', 'three'].map((role) => `smoke-${role}-${suffix}`);
const [owner, provider, ...participants] = actors;
const requestIds = [];
let passed = 0;

async function call(actor, command, override = {}) {
  const headers = { ...actor ? {
    'oai-authenticated-user-id': actor,
    'oai-authenticated-user-email': `${actor}@example.invalid`,
  } : {}, ...command ? { 'Content-Type': 'application/json', Origin: base.origin } : {}, ...override };
  const response = await fetch(new URL('/api/platform', base), {
    method: command ? 'POST' : 'GET', headers,
    body: command ? JSON.stringify(command) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const action = command?.action ?? 'snapshot';
    throw new Error(`HTTP ${response.status} (${action}) returned a non-JSON response: ${raw.slice(0, 240)}`);
  }
  return { status: response.status, data };
}
async function success(actor, command) {
  const response = await call(actor, command);
  assert.equal(response.status, 200, response.data.error ?? response.data.code);
  return response.data;
}
async function state(actor, id) {
  const value = await success(actor);
  assert.equal(JSON.stringify(value).includes('@example.invalid'), false, 'No test emails in DTO');
  for (const identity of actors) assert.equal(JSON.stringify(value).includes(identity), false, 'No raw identities in DTO');
  return value.requests.find((request) => request.id === id);
}
function pass(name) { passed++; console.log(`PASS ${name}`); }
const quote = (value) => `'${value.replaceAll("'", "''")}'`;

try {
  assert.equal((await call(null, { action: 'profile', nickname: '로그인필요' })).status, 401);
  pass('anonymous writes rejected');
  assert.equal((await call(owner, { action: 'profile', nickname: '요청자테스트' }, { Origin: 'https://wrong.example' })).status, 403);
  pass('cross-origin writes rejected');
  for (let i = 0; i < actors.length; i++) await success(actors[i], { action: 'profile', nickname: `동작검증${i + 1}` });
  const created = await success(owner, { action: 'createRequest', input: {
    title: '동작 검증용 도자기 모임', description: 'HTTP와 실제 로컬 데이터베이스의 연결을 확인하는 합성 테스트입니다.',
    category: 'craft', region: '테스트 동네', preferredTime: '주말 오후', budget: 45000, targetPeople: 3,
    deadline: new Date(Date.now() + 86_400_000).toISOString(),
  } });
  const requestId = created.requestId;
  assert.ok(requestId); requestIds.push(requestId);
  assert.equal((await state(owner, requestId)).interestCount, 1);
  pass('request persisted with one owner interest');
  await success(participants[0], { action: 'interest', requestId, interested: true });
  await success(participants[0], { action: 'interest', requestId, interested: true });
  assert.equal((await state(owner, requestId)).interestCount, 2);
  pass('interest retry does not double count');

  const proposal = { action: 'createProposal', requestId, input: {
    providerName: '테스트 공방', title: '함께 만드는 도자기 체험', description: '합성 운영자 제안입니다. 실제 수업이나 예약은 진행하지 않습니다.',
    price: 40000, startsAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), durationMinutes: 90,
    location: '테스트 공간', minParticipants: 2, capacity: 2, bookingUrl: '',
  } };
  assert.equal((await call(owner, proposal)).status, 403);
  await success(provider, proposal);
  const proposalId = (await state(owner, requestId)).proposals[0].id;
  assert.equal((await call(participants[0], { action: 'chooseProposal', requestId, proposalId })).status, 403);
  await success(owner, { action: 'chooseProposal', requestId, proposalId });
  assert.equal((await state(owner, requestId)).confirmedCount, 0);
  pass('proposal ownership and explicit confirmation enforced');

  assert.equal((await call(provider, { action: 'confirm', requestId })).status, 403);
  const attempts = await Promise.all(participants.map((actor) => call(actor, { action: 'confirm', requestId })));
  assert.equal(attempts.filter((result) => result.status === 200).length, 2);
  assert.equal(attempts.filter((result) => result.status === 409).length, 1);
  assert.equal((await state(owner, requestId)).confirmedCount, 2);
  pass('concurrent HTTP confirmations never exceed capacity');

  const winner = participants[attempts.findIndex((result) => result.status === 200)];
  const waiting = participants[attempts.findIndex((result) => result.status === 409)];
  await success(winner, { action: 'confirm', requestId });
  assert.equal((await state(owner, requestId)).confirmedCount, 2);
  await success(winner, { action: 'unconfirm', requestId });
  await success(waiting, { action: 'confirm', requestId });
  assert.equal((await state(waiting, requestId)).isConfirmed, true);
  assert.equal((await state(owner, requestId)).confirmedCount, 2);
  pass('duplicate confirmation and released seats handled');

  assert.equal((await call(owner, { action: 'complete', requestId })).status, 409);
  assert.equal((await call(participants[0], { action: 'cancel', requestId, reason: '권한 없는 취소' })).status, 403);
  await success(provider, { action: 'cancel', requestId, reason: '테스트가 끝나 취소합니다.' });
  assert.equal((await state(owner, requestId)).status, 'cancelled');
  assert.equal((await call(waiting, { action: 'confirm', requestId })).status, 409);
  pass('completion timing, cancellation ownership and terminal state enforced');

  const anonymous = await state(null, requestId);
  assert.equal(anonymous.isMine, false);
  assert.equal(anonymous.isConfirmed, false);
  assert.equal(anonymous.isInterested, false);
  pass('public responses exclude identity and ownership of others');
  console.log(`HTTP smoke checks: ${passed} passed against local D1.`);
} finally {
  // Remove only this run's synthetic rows. Existing preview data is preserved.
  const ids = requestIds.map(quote).join(',') || "''";
  const people = actors.map(quote).join(',');
  const cleanup = `DELETE FROM registrations WHERE request_id IN (${ids});
    DELETE FROM interests WHERE request_id IN (${ids});
    DELETE FROM proposals WHERE request_id IN (${ids});
    DELETE FROM requests WHERE id IN (${ids});
    DELETE FROM profiles WHERE user_id IN (${people});`;
  execFileSync(process.execPath, ['--import', './scripts/sites-env.mjs', wranglerCli,
    'd1', 'execute', 'DB', '--local', '--config', 'dist/server/wrangler.json', '--persist-to', '.wrangler/state', '--command', cleanup],
    { cwd: process.cwd(), stdio: 'pipe', timeout: 30_000 });
  console.log('Removed this run’s synthetic local records.');
}
