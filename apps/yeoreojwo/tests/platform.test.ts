import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlatformService } from '../lib/platform-service.ts';
import { SqliteD1 } from './sqlite-d1.ts';

const START = Date.parse('2026-11-18T03:00:00Z');
const operationId = '8f2b5bd9-a17c-4c4e-af63-29c523b1a639';
const anotherOperationId = 'a5465968-0c9f-4579-85f2-925a9ea1c301';
const requestInput = () => ({
  title: '저장 결과를 확인할 도자기 모임', description: '응답을 받지 못해 다시 저장해도 한 번만 생성되는 요청입니다.',
  category: 'craft', region: '서울 마포구', preferredTime: '주말 오후', budget: 35000, targetPeople: 4,
  deadline: new Date(START + 5 * 86400000).toISOString(),
});

async function fixture(path = ':memory:') {
  const database = new SqliteD1(path);
  database.migrate();
  let now = START;
  let id = 0;
  const service = new PlatformService(database.asD1(), { now: () => now, id: () => `fixture-${++id}`, maxDailyRequests: 1_000_000 });
  for (const [user, nickname] of [['owner-private-id', '요청이웃'], ['provider-private-id', '공방지기'], ['friend-private-id', '참여이웃'], ['other-private-id', '다른이웃']]) {
    await service.execute(user, { action: 'profile', nickname });
  }
  const request = await service.execute('owner-private-id', {
    action: 'createRequest', input: { title: '초보 도자기 수업을 열어주세요', description: '퇴근 후 이웃들과 함께 첫 도자기 컵을 만들고 싶어요.', category: 'craft', region: '서울 마포구', preferredTime: '평일 저녁', budget: 45000, targetPeople: 6, deadline: new Date(START + 5 * 86400000).toISOString() },
  });
  const requestId = request.requestId!;
  const input = { providerName: '예시 공방', title: '첫 번째 도자기 컵 만들기', description: '초보자도 쉽게 참여할 수 있는 도자기 컵 수업이에요.', price: 40000, startsAt: new Date(START + 7 * 86400000).toISOString(), durationMinutes: 120, location: '서울 마포구 공개 수업 공간', minParticipants: 2, capacity: 2, bookingUrl: 'https://example.com/booking' };
  const choose = async () => {
    await service.execute('provider-private-id', { action: 'createProposal', requestId, input });
    const proposalId = (await service.snapshot('owner-private-id')).requests[0].proposals[0].id;
    await service.execute('owner-private-id', { action: 'chooseProposal', requestId, proposalId });
    return proposalId;
  };
  return { database, service, requestId, input, choose, setTime: (value: number) => { now = value; } };
}

test('실제 SQL 저장·재조회와 공개 DTO 개인정보 경계', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  const snapshot = await f.service.snapshot('owner-private-id');
  assert.equal(snapshot.requests[0].title, '초보 도자기 수업을 열어주세요');
  assert.equal(snapshot.requests[0].interestCount, 1);
  assert.equal(snapshot.requests[0].confirmedCount, 0);
  assert.equal(snapshot.requests[0].isMine, true);
  assert.equal(JSON.stringify(snapshot).includes('owner-private-id'), false);
  const anonymous = await f.service.snapshot(null);
  assert.equal(anonymous.viewer.signedIn, false);
  assert.equal(anonymous.requests[0].isMine, false);
  assert.equal(anonymous.requests[0].isInterested, false);
  assert.equal(anonymous.viewer.draftScope, null);
});

test('초안 저장 범위는 계정별로 고정되며 공개 기록에 사용자 ID나 키를 노출하지 않는다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  const first = await f.service.snapshot('owner-private-id');
  const again = await f.service.snapshot('owner-private-id');
  const other = await f.service.snapshot('friend-private-id');
  assert.match(first.viewer.draftScope!, /^[0-9a-f]{64}$/u);
  assert.equal(first.viewer.draftScope, again.viewer.draftScope);
  assert.notEqual(first.viewer.draftScope, other.viewer.draftScope);
  assert.equal(JSON.stringify(first.requests).includes(first.viewer.draftScope!), false);
  assert.equal(JSON.stringify(first).includes('owner-private-id'), false);
});

test('생성 응답이 유실된 뒤 재전송해도 요청과 작성자의 관심은 한 번만 저장한다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  const command = { action: 'createRequest', operationId, input: requestInput() };
  await assert.rejects(async () => {
    await f.service.execute('owner-private-id', command);
    // Server committed; the caller did not receive the response.
    throw new TypeError('simulated response lost after commit');
  }, /response lost/u);
  const saved = (await f.service.snapshot('owner-private-id')).requests.find((r) => r.title === command.input.title)!;
  const recovered = await f.service.execute('owner-private-id', command);
  assert.equal(recovered.requestId, saved.id);
  const current = await f.service.snapshot('owner-private-id');
  assert.equal(current.requests.length, 2);
  assert.equal(current.requests.find((r) => r.id === saved.id)!.interestCount, 1);
  assert.equal(JSON.stringify(current).includes(operationId), false);
});

test('동시에 같은 생성 키가 도착해도 고유 제약과 원자적 배치가 한 요청만 만든다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  const results = await Promise.all(Array.from({ length: 8 }, () => f.service.execute('owner-private-id', {
    action: 'createRequest', operationId, input: requestInput(),
  })));
  assert.equal(new Set(results.map((r) => r.requestId)).size, 1);
  const current = await f.service.snapshot('owner-private-id');
  assert.equal(current.requests.length, 2);
  assert.equal(current.requests.find((r) => r.id === results[0].requestId)!.interestCount, 1);
});

test('같은 키에 다른 내용은 충돌로 알리고 명시적으로 새 키를 쓰면 별도 요청을 만든다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  const first = await f.service.execute('owner-private-id', { action: 'createRequest', operationId, input: requestInput() });
  await assert.rejects(f.service.execute('owner-private-id', { action: 'createRequest', operationId, input: { ...requestInput(), budget: 20000 } }), { code: 'OPERATION_CONFLICT', status: 409 });
  const next = await f.service.execute('owner-private-id', { action: 'createRequest', operationId: anotherOperationId, input: requestInput() });
  assert.notEqual(first.requestId, next.requestId);
  assert.equal((await f.service.snapshot('owner-private-id')).requests.length, 3);
  assert.equal((await f.service.snapshot('owner-private-id')).requests.find((r) => r.id === first.requestId)!.budget, 35000);
});

test('생성 키는 사용자별로 분리하고 마감·취소 뒤 재전송은 원래 결과만 반환한다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  const command = { action: 'createRequest', operationId, input: requestInput() };
  const own = await f.service.execute('owner-private-id', command);
  const other = await f.service.execute('friend-private-id', command);
  assert.notEqual(own.requestId, other.requestId);
  await f.service.execute('owner-private-id', { action: 'cancel', requestId: own.requestId, reason: '일정이 바뀌어 취소해요.' });
  f.setTime(START + 6 * 86400000);
  assert.deepEqual(await f.service.execute('owner-private-id', command), own);
  assert.deepEqual(await f.service.execute('friend-private-id', command), other);
  const records = (await f.service.snapshot('owner-private-id')).requests;
  assert.equal(records.find((r) => r.id === own.requestId)!.status, 'cancelled');
  assert.equal(records.find((r) => r.id === other.requestId)!.status, 'expired');
  assert.equal(records.find((r) => r.id === other.requestId)!.isMine, false);
  await assert.rejects(f.service.execute('owner-private-id', { ...command, operationId: anotherOperationId }), { code: 'INVALID_DATE' });
});

test('생성 키 마이그레이션은 기존 요청과 상태를 보존한다', async (t) => {
  const database = new SqliteD1(); t.after(() => database.close());
  database.sqlite.exec(readFileSync(new URL('../drizzle/0000_famous_toro.sql', import.meta.url), 'utf8'));
  database.sqlite.exec(`INSERT INTO profiles VALUES ('legacy-owner', '기존이웃', ${START});
    INSERT INTO requests (id, owner_id, title, description, category, region, preferred_time, budget, target_people, deadline, status, created_at, updated_at)
    VALUES ('legacy-request', 'legacy-owner', '기존 도자기 요청', '이전 버전에서 저장한 요청입니다.', 'craft', '서울 마포구', '주말', 30000, 4, ${START + 86400000}, 'open', ${START}, ${START});
    INSERT INTO interests VALUES ('legacy-request', 'legacy-owner', ${START});`);
  database.sqlite.exec(readFileSync(new URL('../drizzle/0001_request_operation.sql', import.meta.url), 'utf8'));
  const service = new PlatformService(database.asD1(), { now: () => START });
  const legacy = (await service.snapshot('legacy-owner')).requests[0];
  assert.equal(legacy.id, 'legacy-request');
  assert.equal(legacy.title, '기존 도자기 요청');
  assert.equal(legacy.interestCount, 1);
  assert.equal(legacy.status, 'open');
  const created = await service.execute('legacy-owner', { action: 'createRequest', operationId, input: requestInput() });
  assert.ok(created.requestId);
  assert.equal((await service.snapshot('legacy-owner')).requests.length, 2);
});

test('비로그인과 공개 닉네임 미설정 사용자의 쓰기를 거절한다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  await assert.rejects(f.service.execute(null, { action: 'interest', requestId: f.requestId, interested: true }), { code: 'SIGN_IN_REQUIRED' });
  await assert.rejects(f.service.execute('new-private-id', { action: 'interest', requestId: f.requestId, interested: true }), { code: 'PROFILE_REQUIRED' });
});

test('첫 로그인 사용자는 닉네임이 없어도 공유 요청을 조회하고 설정 뒤 관심으로 이어간다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  const newcomer = 'newcomer-without-profile';
  for (const focusedId of [undefined, f.requestId]) {
    const snapshot = await f.service.snapshot(newcomer, focusedId);
    assert.equal(snapshot.viewer.signedIn, true);
    assert.equal(snapshot.viewer.profileReady, false);
    assert.equal(snapshot.viewer.nickname, '새로운 이웃');
    assert.match(snapshot.viewer.draftScope!, /^[a-f0-9]{64}$/u);
    const request = snapshot.requests.find((row) => row.id === f.requestId)!;
    assert.equal(request.isMine, false);
    assert.equal(request.isInterested, false);
    assert.equal(request.isConfirmed, false);
    assert.equal(JSON.stringify(snapshot).includes(newcomer), false);
  }
  await assert.rejects(f.service.execute(newcomer, { action: 'interest', requestId: f.requestId, interested: true }), { code: 'PROFILE_REQUIRED' });
  await f.service.execute(newcomer, { action: 'profile', nickname: '처음온이웃' });
  await f.service.execute(newcomer, { action: 'interest', requestId: f.requestId, interested: true });
  const resumed = await f.service.snapshot(newcomer, f.requestId);
  assert.equal(resumed.viewer.profileReady, true);
  assert.equal(resumed.viewer.nickname, '처음온이웃');
  assert.equal(resumed.requests.find((row) => row.id === f.requestId)!.isInterested, true);
});

test('중복 관심은 한 번만 집계하고 작성자의 최초 관심은 유지한다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  await Promise.all(Array.from({ length: 5 }, () => f.service.execute('friend-private-id', { action: 'interest', requestId: f.requestId, interested: true })));
  assert.equal((await f.service.snapshot(null)).requests[0].interestCount, 2);
  await f.service.execute('friend-private-id', { action: 'interest', requestId: f.requestId, interested: false });
  assert.equal((await f.service.snapshot(null)).requests[0].interestCount, 1);
  await assert.rejects(f.service.execute('owner-private-id', { action: 'interest', requestId: f.requestId, interested: false }), { code: 'OWNER_INTEREST' });
});

test('제안은 요청자와 다른 사람만 보내고 작성자만 선택한다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  await assert.rejects(f.service.execute('owner-private-id', { action: 'createProposal', requestId: f.requestId, input: f.input }), { code: 'SELF_PROPOSAL' });
  await f.service.execute('provider-private-id', { action: 'createProposal', requestId: f.requestId, input: f.input });
  const proposalId = (await f.service.snapshot(null)).requests[0].proposals[0].id;
  await assert.rejects(f.service.execute('friend-private-id', { action: 'chooseProposal', requestId: f.requestId, proposalId }), { code: 'FORBIDDEN' });
  await assert.rejects(f.service.execute('other-private-id', { action: 'withdrawProposal', requestId: f.requestId, proposalId }), { code: 'FORBIDDEN' });
  await assert.rejects(f.service.execute('provider-private-id', { action: 'createProposal', requestId: f.requestId, input: f.input }), { code: 'STATE_CONFLICT' });
  await f.service.execute('owner-private-id', { action: 'chooseProposal', requestId: f.requestId, proposalId });
  assert.equal((await f.service.snapshot(null)).requests[0].confirmedCount, 0);
});

test('제안을 선택한 뒤 조건을 바꿀 다른 제안 선택·철회를 막는다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  await f.service.execute('other-private-id', { action: 'createProposal', requestId: f.requestId, input: f.input });
  const otherId = (await f.service.snapshot(null)).requests[0].proposals[0].id;
  // choose() must select the newly created provider proposal, not the older one.
  await f.service.execute('provider-private-id', { action: 'createProposal', requestId: f.requestId, input: f.input });
  const providerId = (await f.service.snapshot('provider-private-id')).requests[0].proposals.find((p) => p.isMine)!.id;
  await f.service.execute('owner-private-id', { action: 'chooseProposal', requestId: f.requestId, proposalId: providerId });
  await assert.rejects(f.service.execute('owner-private-id', { action: 'chooseProposal', requestId: f.requestId, proposalId: otherId }), { code: 'STATE_CONFLICT' });
  await assert.rejects(f.service.execute('provider-private-id', { action: 'withdrawProposal', requestId: f.requestId, proposalId: providerId }), { code: 'STATE_CONFLICT' });
});

test('선택 전 제안을 철회하고 새 조건으로 다시 제안해 참가까지 이어 간다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  await f.service.execute('provider-private-id', { action: 'createProposal', requestId: f.requestId, input: f.input });
  const withdrawnId = (await f.service.snapshot(null)).requests[0].proposals[0].id;
  await f.service.execute('provider-private-id', { action: 'withdrawProposal', requestId: f.requestId, proposalId: withdrawnId });
  const withdrawn = (await f.service.snapshot(null)).requests[0];
  assert.equal(withdrawn.status, 'open');
  assert.equal(withdrawn.selectedProposalId, null);
  assert.equal(withdrawn.proposals.length, 0);

  const revisedTerms = {
    price: 35000,
    startsAt: new Date(START + 8 * 86400000).toISOString(),
    durationMinutes: 90,
    location: '서울 마포구 새 공개 수업 공간',
    minParticipants: 1,
    capacity: 3,
  };
  await f.service.execute('provider-private-id', { action: 'createProposal', requestId: f.requestId, input: { ...f.input, ...revisedTerms } });
  const proposed = (await f.service.snapshot('provider-private-id')).requests[0];
  assert.equal(proposed.proposals.length, 1);
  assert.equal(proposed.proposals[0].isMine, true);
  const replacementId = proposed.proposals[0].id;
  assert.notEqual(replacementId, withdrawnId);

  await assert.rejects(f.service.execute('owner-private-id', { action: 'chooseProposal', requestId: f.requestId, proposalId: withdrawnId }), { code: 'NOT_FOUND', status: 404 });
  const beforeSelection = (await f.service.snapshot(null)).requests[0];
  assert.equal(beforeSelection.status, 'open');
  assert.equal(beforeSelection.selectedProposalId, null);
  await f.service.execute('owner-private-id', { action: 'chooseProposal', requestId: f.requestId, proposalId: replacementId });
  assert.equal((await f.service.snapshot(null)).requests[0].confirmedCount, 0);

  await f.service.execute('friend-private-id', { action: 'confirm', requestId: f.requestId });
  const confirmed = (await f.service.snapshot('friend-private-id')).requests[0];
  assert.equal(confirmed.status, 'confirming');
  assert.equal(confirmed.selectedProposalId, replacementId);
  assert.equal(confirmed.isConfirmed, true);
  assert.equal(confirmed.confirmedCount, 1);
  assert.equal(confirmed.proposals.length, 1);
  const selected = confirmed.proposals[0];
  assert.equal(selected.id, replacementId);
  assert.equal(selected.isSelected, true);
  assert.equal(selected.confirmedCount, 1);
  const { price, startsAt, durationMinutes, location, minParticipants, capacity } = selected;
  assert.deepEqual({ price, startsAt, durationMinutes, location, minParticipants, capacity }, revisedTerms);
});

test('마지막 한 자리에 동시에 신청해도 한 명만 확정되고 중복 클릭은 집계되지 않는다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  await f.choose();
  await f.service.execute('owner-private-id', { action: 'confirm', requestId: f.requestId });
  const attempts = await Promise.allSettled(['friend-private-id', 'other-private-id'].map((user) => f.service.execute(user, { action: 'confirm', requestId: f.requestId })));
  assert.equal(attempts.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(attempts.filter((r) => r.status === 'rejected').length, 1);
  await f.service.execute('owner-private-id', { action: 'confirm', requestId: f.requestId });
  assert.equal((await f.service.snapshot(null)).requests[0].confirmedCount, 2);
  await assert.rejects(f.service.execute('provider-private-id', { action: 'confirm', requestId: f.requestId }), { code: 'PROVIDER_REGISTRATION' });
});

test('참가를 취소한 자리는 돌아오고 관심은 자동 취소되지 않는다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  await f.choose();
  for (const user of ['owner-private-id', 'friend-private-id']) await f.service.execute(user, { action: 'confirm', requestId: f.requestId });
  await f.service.execute('friend-private-id', { action: 'unconfirm', requestId: f.requestId });
  await f.service.execute('other-private-id', { action: 'confirm', requestId: f.requestId });
  const snapshot = await f.service.snapshot('friend-private-id');
  assert.equal(snapshot.requests[0].confirmedCount, 2);
  assert.equal(snapshot.requests[0].isConfirmed, false);
  assert.equal(snapshot.requests[0].isInterested, true);
});

test('서버 시간 기준 마감과 시작 이후 변경 제한', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  f.setTime(START + 6 * 86400000);
  assert.equal((await f.service.snapshot(null)).requests[0].status, 'expired');
  await assert.rejects(f.service.execute('friend-private-id', { action: 'interest', requestId: f.requestId, interested: true }), { code: 'STATE_CONFLICT' });
  f.setTime(START);
  await f.choose();
  await f.service.execute('owner-private-id', { action: 'confirm', requestId: f.requestId });
  f.setTime(START + 7 * 86400000);
  await assert.rejects(f.service.execute('friend-private-id', { action: 'confirm', requestId: f.requestId }), { code: 'STATE_CONFLICT' });
  await assert.rejects(f.service.execute('owner-private-id', { action: 'unconfirm', requestId: f.requestId }), { code: 'STATE_CONFLICT' });
});

test('모임 취소는 소유자/선택 운영자만 가능하고 확정 이력은 남는다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  await f.choose();
  await f.service.execute('friend-private-id', { action: 'confirm', requestId: f.requestId });
  await assert.rejects(f.service.execute('other-private-id', { action: 'cancel', requestId: f.requestId, reason: '권한 없는 취소' }), { code: 'FORBIDDEN' });
  await f.service.execute('provider-private-id', { action: 'cancel', requestId: f.requestId, reason: '운영 일정이 바뀌었어요' });
  const row = (await f.service.snapshot(null)).requests[0];
  assert.equal(row.status, 'cancelled');
  assert.equal(row.confirmedCount, 1);
  assert.equal(row.cancellationReason, '운영 일정이 바뀌었어요');
  await assert.rejects(f.service.execute('owner-private-id', { action: 'confirm', requestId: f.requestId }), { code: 'STATE_CONFLICT' });
  await assert.rejects(f.service.execute('owner-private-id', { action: 'complete', requestId: f.requestId }), { code: 'STATE_CONFLICT' });
});

test('완료는 종료 시각·최소 인원·기록자 권한을 모두 확인한다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  await f.choose();
  await assert.rejects(f.service.execute('owner-private-id', { action: 'complete', requestId: f.requestId }), { code: 'STATE_CONFLICT' });
  f.setTime(START + 8 * 86400000);
  await assert.rejects(f.service.execute('owner-private-id', { action: 'complete', requestId: f.requestId }), { code: 'STATE_CONFLICT' });
  f.setTime(START);
  for (const user of ['owner-private-id', 'friend-private-id']) await f.service.execute(user, { action: 'confirm', requestId: f.requestId });
  f.setTime(START + 8 * 86400000);
  await assert.rejects(f.service.execute('other-private-id', { action: 'complete', requestId: f.requestId }), { code: 'FORBIDDEN' });
  await f.service.execute('provider-private-id', { action: 'complete', requestId: f.requestId });
  assert.equal((await f.service.snapshot(null)).requests[0].status, 'completed');
});

test('최소 인원이 모여도 수업 시작과 종료 직전에는 완료할 수 없고 정확한 종료 시각부터 가능하다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  await f.choose();
  for (const user of ['owner-private-id', 'friend-private-id']) await f.service.execute(user, { action: 'confirm', requestId: f.requestId });
  const startsAt = Date.parse(f.input.startsAt);
  const endsAt = startsAt + f.input.durationMinutes * 60_000;

  // 인원 조건을 먼저 충족해 종료 시각 제한 자체를 확인한다.
  for (const time of [startsAt, startsAt + 1, endsAt - 1]) {
    f.setTime(time);
    await assert.rejects(f.service.execute('owner-private-id', { action: 'complete', requestId: f.requestId }), { code: 'STATE_CONFLICT', status: 409 });
    const ongoing = (await f.service.snapshot(null)).requests[0];
    assert.equal(ongoing.status, 'confirming');
    assert.equal(ongoing.confirmedCount, f.input.minParticipants);
  }

  f.setTime(endsAt);
  await f.service.execute('provider-private-id', { action: 'complete', requestId: f.requestId });
  const completed = (await f.service.snapshot(null)).requests[0];
  assert.equal(completed.status, 'completed');
  assert.equal(completed.confirmedCount, f.input.minParticipants);
  assert.equal(completed.updatedAt, new Date(endsAt).toISOString());
});

test('데이터베이스 연결을 닫았다 열어도 요청과 참가가 유지된다', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'yeoreojwo-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'test.sqlite');
  const f = await fixture(path);
  await f.choose();
  await f.service.execute('friend-private-id', { action: 'confirm', requestId: f.requestId });
  f.database.close();
  const reopened = new SqliteD1(path); t.after(() => reopened.close());
  const nextService = new PlatformService(reopened.asD1(), { now: () => START });
  const snapshot = await nextService.snapshot('friend-private-id');
  assert.equal(snapshot.requests[0].id, f.requestId);
  assert.equal(snapshot.requests[0].isConfirmed, true);
  assert.equal(snapshot.requests[0].confirmedCount, 1);
});

test('공개 최신 200개 밖의 내 요청·관심·제안·참가 이력과 해당 제안을 보존한다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  const ownProposalId = await f.choose();
  const input = {
    title: '지난 활동 기록을 계속 확인하고 싶어요', description: '한 사람이 실제로 참여한 요청과 제안 기록을 확인하는 검증입니다.',
    category: 'craft', region: '서울 마포구', preferredTime: '평일 저녁', budget: 45000, targetPeople: 6,
    deadline: new Date(START + 5 * 86400000).toISOString(),
  };
  const create = async (user: string) => (await f.service.execute(user, { action: 'createRequest', input })).requestId!;
  const interestedId = await create('friend-private-id');
  await f.service.execute('owner-private-id', { action: 'interest', requestId: interestedId, interested: true });

  const proposedId = await create('friend-private-id');
  await f.service.execute('owner-private-id', { action: 'createProposal', requestId: proposedId, input: f.input });

  const confirmedId = await create('friend-private-id');
  await f.service.execute('provider-private-id', { action: 'createProposal', requestId: confirmedId, input: f.input });
  const confirmedProposalId = (await f.service.snapshot('friend-private-id')).requests.find((r) => r.id === confirmedId)!.proposals[0].id;
  await f.service.execute('friend-private-id', { action: 'chooseProposal', requestId: confirmedId, proposalId: confirmedProposalId });
  await f.service.execute('owner-private-id', { action: 'confirm', requestId: confirmedId });

  const unrelatedId = await create('other-private-id');
  let newestId = '';
  for (let i = 0; i < 201; i++) {
    f.setTime(START + 1000 + i);
    newestId = await create('other-private-id');
  }
  // This record belongs to both sets and must not occur twice in the result.
  await f.service.execute('owner-private-id', { action: 'interest', requestId: newestId, interested: true });

  const anonymous = await f.service.snapshot(null);
  assert.equal(anonymous.requests.length, 200);
  for (const id of [f.requestId, interestedId, proposedId, confirmedId, unrelatedId]) {
    assert.equal(anonymous.requests.some((r) => r.id === id), false);
  }

  const personal = await f.service.snapshot('owner-private-id');
  assert.equal(personal.requests.length, 204);
  assert.equal(new Set(personal.requests.map((r) => r.id)).size, personal.requests.length);
  const own = personal.requests.find((r) => r.id === f.requestId)!;
  assert.equal(own.isMine, true);
  assert.equal(own.proposals[0].id, ownProposalId);
  assert.equal(personal.requests.find((r) => r.id === interestedId)!.isInterested, true);
  assert.equal(personal.requests.find((r) => r.id === proposedId)!.proposals.some((p) => p.isMine), true);
  const confirmed = personal.requests.find((r) => r.id === confirmedId)!;
  assert.equal(confirmed.isConfirmed, true);
  assert.equal(confirmed.proposals[0].id, confirmedProposalId);
  assert.equal(confirmed.proposals[0].confirmedCount, 1);
  assert.equal(personal.requests.some((r) => r.id === unrelatedId), false);
  assert.equal(JSON.stringify(personal).includes('owner-private-id'), false);
});

test('이전 요청 공유 링크는 익명·다른 사용자에게도 해당 요청과 제안만 추가로 제공한다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  const proposalId = await f.choose();
  const { title, description, category, region, preferredTime, budget, targetPeople, deadline } = (await f.service.snapshot(null)).requests[0];
  const input = { title, description, category, region, preferredTime, budget, targetPeople, deadline };
  let newestId = '';
  for (let i = 0; i < 200; i++) {
    f.setTime(START + 1000 + i);
    newestId = (await f.service.execute('other-private-id', { action: 'createRequest', input })).requestId!;
  }
  const standard = await f.service.snapshot(null);
  assert.equal(standard.requests.length, 200);
  assert.equal(standard.requests.some((r) => r.id === f.requestId), false);

  for (const viewer of [null, 'friend-private-id']) {
    const focused = await f.service.snapshot(viewer, f.requestId);
    assert.equal(focused.requests.length, 201);
    const shared = focused.requests.find((r) => r.id === f.requestId)!;
    assert.equal(shared.proposals[0].id, proposalId);
    assert.equal(shared.proposals[0].isSelected, true);
    assert.equal(shared.isMine, false);
    assert.equal(shared.proposals[0].isMine, false);
    assert.equal(JSON.stringify(focused).includes('owner-private-id'), false);
    assert.equal(JSON.stringify(focused).includes('provider-private-id'), false);
  }
  assert.equal((await f.service.snapshot(null, newestId)).requests.length, 200);
  assert.equal((await f.service.snapshot(null, 'nonexistent-request')).requests.length, 200);
  assert.equal((await f.service.snapshot(null, "' OR 1=1 --")).requests.length, 200);
  await assert.rejects(f.service.snapshot(null, 'x'.repeat(101)), { code: 'INVALID_REQUEST_ID', status: 400 });
  await assert.rejects(f.service.snapshot(null, ''), { code: 'INVALID_REQUEST_ID', status: 400 });
});

test('공개 DB 전체 검색은 최신 200개 밖의 요청도 찾고 일반 목록은 유지한다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  const oldId = f.requestId;
  for (let i = 0; i < 202; i++) {
    await f.service.execute('other-private-id', {
      action: 'createRequest',
      input: { ...requestInput(), title: '검색되지 않는 일반 활동', description: '일반 활동을 위한 설명입니다.',
        deadline: new Date(START + 7 * 86400000).toISOString() },
    });
  }
  const ordinary = await f.service.snapshot(null);
  assert.equal(ordinary.requests.some((r) => r.id === oldId), false);
  const found = await f.service.snapshot(null, null, '초보 도자기');
  assert.deepEqual(found.requests.map((r) => r.id), [oldId]);
  assert.equal(found.requests[0].title, '초보 도자기 수업을 열어주세요');
  const noMatch = await f.service.snapshot(null, null, '다른 검색어');
  assert.equal(noMatch.requests.length, 0);
  const own = await f.service.snapshot('owner-private-id', oldId, '도자기');
  assert.equal(own.requests.some((r) => r.id === oldId), true);
  await assert.rejects(f.service.snapshot(null, null, 'x'.repeat(81)), { code: 'INVALID_SEARCH', status: 400 });
});

test('일별 요청 제한은 새 요청만 차단하고 동일 저장 작업의 복구는 허용한다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  let id = 0;
  const limited = new PlatformService(f.database.asD1(), { now: () => START, id: () => `limited-${++id}`, maxDailyRequests: 2 });
  const command = { action: 'createRequest' as const, operationId, input: requestInput() };
  const first = await limited.execute('owner-private-id', command);
  assert.ok(first.requestId);
  await assert.rejects(limited.execute('owner-private-id', { action: 'createRequest', operationId: anotherOperationId, input: requestInput() }),
    { code: 'REQUEST_LIMIT', status: 429 });
  assert.deepEqual(await limited.execute('owner-private-id', command), first);
  assert.equal((await limited.snapshot('owner-private-id')).requests.length, 2);
});

test('확정 참가자 닉네임은 요청자와 선택 운영자에게만 보인다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  await f.choose();
  await f.service.execute('friend-private-id', { action: 'confirm', requestId: f.requestId });
  const manager = (await f.service.snapshot('owner-private-id')).requests[0];
  const provider = (await f.service.snapshot('provider-private-id')).requests[0];
  assert.deepEqual(manager.confirmedParticipants, ['참여이웃']);
  assert.deepEqual(provider.confirmedParticipants, ['참여이웃']);
  for (const viewer of [null, 'friend-private-id', 'other-private-id']) {
    const view = (await f.service.snapshot(viewer)).requests[0];
    assert.equal(Object.hasOwn(view, 'confirmedParticipants'), false);
    assert.equal(view.confirmedCount, 1);
  }
  await f.service.execute('friend-private-id', { action: 'unconfirm', requestId: f.requestId });
  const empty = (await f.service.snapshot('owner-private-id')).requests[0];
  assert.equal(empty.confirmedCount, 0);
  assert.equal(empty.confirmedParticipants, undefined);
  await f.service.execute('friend-private-id', { action: 'confirm', requestId: f.requestId });
  await f.service.execute('owner-private-id', { action: 'cancel', requestId: f.requestId, reason: '실험 종료' });
  assert.deepEqual((await f.service.snapshot('provider-private-id')).requests[0].confirmedParticipants, ['참여이웃']);
});
