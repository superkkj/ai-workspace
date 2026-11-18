import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlatformService } from '../lib/platform-service.ts';
import { SqliteD1 } from './sqlite-d1.ts';

const START = Date.parse('2026-11-18T03:00:00Z');

async function fixture(path = ':memory:') {
  const database = new SqliteD1(path);
  database.migrate();
  let now = START;
  let id = 0;
  const service = new PlatformService(database.asD1(), { now: () => now, id: () => `fixture-${++id}` });
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
});

test('비로그인과 공개 닉네임 미설정 사용자의 쓰기를 거절한다', async (t) => {
  const f = await fixture(); t.after(() => f.database.close());
  await assert.rejects(f.service.execute(null, { action: 'interest', requestId: f.requestId, interested: true }), { code: 'SIGN_IN_REQUIRED' });
  await assert.rejects(f.service.execute('new-private-id', { action: 'interest', requestId: f.requestId, interested: true }), { code: 'PROFILE_REQUIRED' });
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
