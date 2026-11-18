import assert from 'node:assert/strict';
import test from 'node:test';
import { draftStorageKey, draftValues, editDraft, newDraft, parseDraft, readDraft, removeDraft, writeDraft, type DraftStorage, type FormDraft } from '../lib/form-drafts.ts';

const scopeA = 'a'.repeat(64);
const scopeB = 'b'.repeat(64);
const operationA = '1337cbfa-d39a-4711-b5af-160559da30be';
const operationB = '1337cbfa-d39a-4711-b5af-160559da30bf';
function storage(): DraftStorage {
  const values = new Map<string, string>();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); } };
}

test('draft keys isolate the viewer, form and target without accepting raw identity', () => {
  assert.notEqual(draftStorageKey(scopeA, 'request'), draftStorageKey(scopeB, 'request'));
  assert.notEqual(draftStorageKey(scopeA, 'proposal', 'one'), draftStorageKey(scopeA, 'proposal', 'two'));
  assert.notEqual(draftStorageKey(scopeA, 'proposal', 'one'), draftStorageKey(scopeA, 'cancel', 'one'));
  assert.equal(draftStorageKey('person@example.test', 'request'), null);
  assert.equal(draftStorageKey(undefined, 'request'), null);
});

test('close/reopen or a page reload restores the same values and logical operation', () => {
  const session = storage();
  const key = draftStorageKey(scopeA, 'request');
  const original = newDraft('request', { title: '함께 만드는 도자기', description: '같은 동네 이웃과 활동하고 싶어요.', budget: '40000' }, operationA);
  assert.equal(writeDraft(session, key, original), true);
  assert.deepEqual(readDraft(session, key, 'request'), original);
  assert.equal(readDraft(session, draftStorageKey(scopeB, 'request'), 'request'), null);
});

test('an uncertain create keeps its submitted payload and key through edits and reload', () => {
  const original: FormDraft = { ...newDraft('request', { title: '최초 제출한 요청', budget: '40000' }, operationA), state: 'unknown' };
  const edited = editDraft(original, { title: '다른 내용으로 바꾸기', budget: '50000' });
  assert.deepEqual(edited, original);
  assert.deepEqual(parseDraft(JSON.stringify(edited), 'request'), original);
});

test('a deliberate new draft discards the previous body and uses a different operation', () => {
  const previous: FormDraft = { ...newDraft('request', { title: '앞서 제출한 요청' }, operationA), state: 'unknown' };
  const next = newDraft('request', { budget: '40000' }, operationB);
  assert.notEqual(next.operationId, previous.operationId);
  assert.equal(next.state, 'editing');
  assert.equal(next.values.title, undefined);
});

test('successful clearing deletes only the relevant draft', () => {
  const session = storage();
  const requestKey = draftStorageKey(scopeA, 'request');
  const proposalKey = draftStorageKey(scopeA, 'proposal', 'another-request');
  writeDraft(session, requestKey, newDraft('request', { title: '내 요청입니다' }, operationA));
  writeDraft(session, proposalKey, newDraft('proposal', { title: '내 제안입니다' }, operationB));
  assert.equal(removeDraft(session, requestKey), true);
  assert.equal(readDraft(session, requestKey, 'request'), null);
  assert.equal(readDraft(session, proposalKey, 'proposal')?.values.title, '내 제안입니다');
});

test('consent, tokens and unrelated values are never captured as a form draft', () => {
  assert.deepEqual(draftValues('cancel', [['reason', '일정 변경'], ['consent', 'on'], ['token', 'not-a-real-token'], ['email', 'person@example.test'], ['attachment', new Blob(['file'])]]), { reason: '일정 변경' });
  assert.deepEqual(draftValues('profile', [['nickname', '이웃'], ['consent', 'on']]), { nickname: '이웃' });
});

test('corrupt, mismatched and oversized stored drafts are ignored', () => {
  const valid = newDraft('request', { title: '유효한 초안입니다' }, operationA);
  for (const raw of ['{', 'null', '[]', JSON.stringify({ ...valid, version: 2 }), JSON.stringify({ ...valid, operationId: 'bad-key' }), JSON.stringify({ ...valid, state: 'committed' }), JSON.stringify({ ...valid, values: { consent: 'on' } }), JSON.stringify({ ...valid, values: { title: 'a'.repeat(4001) } }), ' '.repeat(32_769)]) {
    assert.equal(parseDraft(raw, 'request'), null);
  }
  assert.equal(parseDraft(JSON.stringify(valid), 'proposal'), null);
});

test('disabled or full browser storage does not crash form handling', () => {
  const blocked: DraftStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } };
  const key = draftStorageKey(scopeA, 'request');
  assert.equal(readDraft(blocked, key, 'request'), null);
  assert.equal(writeDraft(blocked, key, newDraft('request')), false);
  assert.equal(removeDraft(blocked, key), false);
  assert.equal(writeDraft(null, key, newDraft('request')), false);
  assert.equal(writeDraft(storage(), null, newDraft('request')), false);
});
