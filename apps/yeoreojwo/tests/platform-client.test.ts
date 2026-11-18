import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientError, createSnapshotLoader, fetchSnapshot, sendCommand } from '../lib/platform-client.ts';
import type { PlatformSnapshot } from '../lib/contracts.ts';

const snapshot = (time = '2026-11-18T00:00:00Z'): PlatformSnapshot => ({ viewer: { signedIn: false, profileReady: false, nickname: '', draftScope: null }, requests: [], serverTime: time });
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const profile = { action: 'profile' as const, nickname: '동네 이웃' };

test('focus and visibility reads for the same detail share one request', async () => {
  const wait = deferred<PlatformSnapshot>(); let count = 0;
  const loader = createSnapshotLoader(async () => { count++; return wait.promise; });
  const first = loader.load('request-a'); const second = loader.load('request-a');
  assert.equal(first, second); await Promise.resolve(); assert.equal(count, 1);
  wait.resolve(snapshot()); assert.deepEqual(await first, snapshot()); assert.equal(loader.isPending(), false);
});

test('a pre-write GET cannot overwrite the fresh result even if it ignores abort', async () => {
  const stale = deferred<PlatformSnapshot>(); let count = 0;
  const fresh = snapshot('2026-11-18T01:00:00Z');
  const loader = createSnapshotLoader(async () => ++count === 1 ? stale.promise : fresh);
  const oldRead = loader.load('request-a'); await Promise.resolve();
  loader.invalidate(); assert.deepEqual(await loader.load('request-a'), fresh);
  stale.resolve(snapshot()); assert.equal(await oldRead, null);
});

test('changing the focused request cancels and discards only the obsolete response', async () => {
  const old = deferred<PlatformSnapshot>(); let oldSignal: AbortSignal | undefined;
  const loader = createSnapshotLoader(async (id, signal) => { if(id === 'a') { oldSignal = signal; return old.promise; } return snapshot(); });
  const first = loader.load('a'); await Promise.resolve();
  assert.deepEqual(await loader.load('b'), snapshot()); assert.equal(oldSignal?.aborted, true);
  old.resolve(snapshot()); assert.equal(await first, null);
});

test('read failure can recover; unmount invalidation hides an old failure', async () => {
  const wait = deferred<PlatformSnapshot>();
  const loader = createSnapshotLoader(async () => wait.promise);
  const result = loader.load(null); await Promise.resolve(); loader.invalidate(); wait.reject(new Error('cancelled')); assert.equal(await result, null);
  let attempts = 0;
  const retry = createSnapshotLoader(async () => { if(++attempts === 1) throw new Error('offline'); return snapshot(); });
  await assert.rejects(retry.load(null), /offline/); assert.deepEqual(await retry.load(null), snapshot());
});

test('POST success is returned once; no write is automatically retried', async () => {
  let calls = 0;
  const value = await sendCommand(profile, { fetcher: async (_url, init) => { calls++; assert.equal(init?.method, 'POST'); return json({ok:true}); } });
  assert.deepEqual(value, {ok:true}); assert.equal(calls, 1);
  await assert.rejects(sendCommand(profile, { fetcher: async () => { calls++; throw new TypeError('lost response'); } }), error => error instanceof ClientError && error.kind === 'unknown');
  assert.equal(calls, 2);
});

test('validation rejection, pre-send offline and unknown server outcome remain distinct', async () => {
  await assert.rejects(sendCommand(profile, { fetcher: async () => json({error:'닉네임을 수정해주세요.',code:'INVALID_INPUT'},400) }), error => error instanceof ClientError && error.kind === 'input' && error.code === 'INVALID_INPUT');
  let sent = false;
  await assert.rejects(sendCommand(profile, { online:false, fetcher: async () => { sent=true; return json({ok:true}); } }), error => error instanceof ClientError && error.kind === 'connection'); assert.equal(sent,false);
  await assert.rejects(sendCommand(profile, { fetcher: async () => json({error:'Unavailable',code:'STORAGE'},503) }), error => error instanceof ClientError && error.kind === 'unknown' && error.status === 503);
});

test('malformed response and POST timeout keep the outcome unknown; GET timeout is a read failure', async () => {
  await assert.rejects(sendCommand(profile, { fetcher: async () => new Response('<html>broken proxy</html>',{status:502}) }), error => error instanceof ClientError && error.kind === 'unknown');
  let writes = 0;
  const blocked: typeof fetch = async (_url, init) => { if(init?.method==='POST') writes++; return new Promise((_yes,no) => init?.signal?.addEventListener('abort', () => no(new DOMException('Aborted','AbortError')))); };
  await assert.rejects(sendCommand(profile,{fetcher:blocked,timeoutMs:5}), error => error instanceof ClientError && error.kind === 'unknown'); assert.equal(writes,1);
  await assert.rejects(fetchSnapshot(null,{fetcher:blocked,timeoutMs:5}), error => error instanceof ClientError && error.kind === 'connection');
});

test('focused snapshot encodes its identifier and rejects malformed data', async () => {
  let endpoint = '';
  await fetchSnapshot('a/b?', {fetcher:async url => { endpoint=String(url); return json(snapshot()); }});
  assert.equal(endpoint,'/api/platform?request=a%2Fb%3F');
  await assert.rejects(fetchSnapshot(null,{fetcher:async()=>json({requests:[]})}),error => error instanceof ClientError && error.kind==='server');
});
