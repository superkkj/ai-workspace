import test from 'node:test';
import assert from 'node:assert/strict';
import { DomainError, parseTime, readMutationBody, validateBookingUrl, validateCommand, validateNickname, validateProposal, validateRequest } from '../lib/domain.ts';

const NOW = Date.parse('2026-11-18T03:00:00Z');
const request = () => ({
  title: '퇴근 후 도자기 수업을 열어주세요', description: '처음 도자기를 배우는 이웃들과 함께 컵을 만들고 싶어요.',
  category: 'craft', region: '서울 마포구', preferredTime: '평일 저녁', budget: 45000, targetPeople: 6, deadline: '2026-11-25',
});
const proposal = () => ({
  providerName: '예시 공방', title: '첫 도자기 컵 만들기', description: '초보자도 참여할 수 있는 컵 만들기 수업입니다.', price: 40000,
  startsAt: '2026-11-28T19:00:00+09:00', durationMinutes: 120, location: '서울 마포구 예시 장소', minParticipants: 2, capacity: 6, bookingUrl: '',
});

test('KST 모집 날짜는 그 날짜 종료 시각으로 정규화한다', () => {
  assert.equal(validateRequest(request(), NOW).deadline, '2026-11-25T14:59:59.999Z');
  assert.equal(validateProposal(proposal(), NOW).startsAt, '2026-11-28T10:00:00.000Z');
});

test('존재하지 않는 날짜와 시간대가 빠진 일시는 거절한다', () => {
  for (const value of ['2026-02-30T12:00:00+09:00', '2026-13-02T12:00:00Z', '2026-11-28T24:00:00Z', '2026-11-28T19:00']) {
    assert.throws(() => parseTime(value, '시작 일시'), DomainError);
  }
});

test('요청 필수 내용·범위·정수·마감은 서버가 검증한다', () => {
  const invalid = [
    { title: '짧음' }, { description: '짧음' }, { budget: -1 }, { budget: 1.2 }, { budget: '30000' },
    { targetPeople: 31 }, { targetPeople: 1 }, { category: 'unknown' }, { deadline: '2026-11-17' },
    { deadline: '2027-11-18' }, { description: 'x'.repeat(2001) }, { region: '\u0000서울' },
  ];
  for (const patch of invalid) assert.throws(() => validateRequest({ ...request(), ...patch }, NOW), DomainError);
});

test('제안의 최소 인원·정원·시작 일시를 검증한다', () => {
  for (const patch of [{ minParticipants: 7 }, { capacity: 1 }, { durationMinutes: 0 }, { startsAt: '2026-11-17T12:00:00+09:00' }]) {
    assert.throws(() => validateProposal({ ...proposal(), ...patch }, NOW), DomainError);
  }
});

test('예약 링크는 자격 증명이나 위험 프로토콜 없는 공개 HTTPS 링크만 받는다', () => {
  assert.equal(validateBookingUrl(''), '');
  assert.equal(validateBookingUrl('https://example.com/book?q=1'), 'https://example.com/book?q=1');
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'http://example.com', 'https://me:secret@example.com', 'https://127.0.0.1', 'https://localhost', 'https://app.internal']) {
    assert.throws(() => validateBookingUrl(value), DomainError);
  }
});

test('공개 닉네임에 이메일·전화번호를 사용하지 않는다', () => {
  assert.equal(validateNickname('  동네친구  '), '동네친구');
  for (const value of ['a', 'person@example.com', '010-1234-5678']) assert.throws(() => validateNickname(value), DomainError);
});

test('알 수 없는 작업·타입을 거절하고 클라이언트가 보낸 소유자 값은 사용하지 않는다', () => {
  assert.throws(() => validateCommand({ action: 'interest', requestId: 'r', interested: 'true' }, NOW), DomainError);
  assert.throws(() => validateCommand({ action: 'deleteAll', requestId: 'r' }, NOW), DomainError);
  const parsed = validateCommand({ action: 'createRequest', input: { ...request(), ownerId: 'someone-else' } }, NOW);
  assert.equal(JSON.stringify(parsed).includes('someone-else'), false);
});

test('요청 생성 키는 UUID만 허용하며 기존 키 없는 호출은 유지한다', () => {
  const operationId = '8F2B5BD9-A17C-4C4E-AF63-29C523B1A639';
  const parsed = validateCommand({ action: 'createRequest', operationId, input: request() }, NOW);
  assert.equal(parsed.action === 'createRequest' && parsed.operationId, operationId.toLowerCase());
  const legacy = validateCommand({ action: 'createRequest', input: request() }, NOW);
  assert.equal('operationId' in legacy, false);
  for (const key of ['', 'not-a-uuid', null, 12, 'x'.repeat(1000), '00000000-0000-0000-0000-000000000000']) {
    assert.throws(() => validateCommand({ action: 'createRequest', operationId: key, input: request() }, NOW), { code: 'INVALID_OPERATION_ID' });
  }
});

test('쓰기 API는 같은 출처 JSON만 받는다', async () => {
  const sameOrigin = new Request('https://example.com/api/platform', { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: '{"action":"profile","nickname":"이웃"}' });
  assert.deepEqual(await readMutationBody(sameOrigin), { action: 'profile', nickname: '이웃' });
  const foreign = new Request('https://example.com/api/platform', { method: 'POST', headers: { origin: 'https://attacker.example', 'content-type': 'application/json' }, body: '{}' });
  await assert.rejects(readMutationBody(foreign), { code: 'INVALID_ORIGIN' });
  const invalidJson = new Request('https://example.com/api/platform', { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: '{' });
  await assert.rejects(readMutationBody(invalidJson), { code: 'INVALID_JSON' });
});

test('Content-Length를 주지 않아도 큰 요청 본문을 중단한다', async () => {
  const huge = new Request('https://example.com/api/platform', { method: 'POST', headers: { origin: 'https://example.com', 'content-type': 'application/json' }, body: JSON.stringify({ value: '가'.repeat(6000) }) });
  await assert.rejects(readMutationBody(huge), { code: 'BODY_TOO_LARGE' });
});
