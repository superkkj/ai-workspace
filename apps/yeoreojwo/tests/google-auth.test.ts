import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createSign } from 'node:crypto';
import { makePending, sealPending, parsePending, authConfig, googleAuthorizeUrl, verifyGoogleIdToken, secureCookie, SESSION_COOKIE } from '../lib/google-oauth.ts';
import { safeReturnPath } from '../lib/navigation.ts';
import { SqliteD1 } from './sqlite-d1.ts';
import { createGoogleSession, revokeGoogleSession } from '../lib/google-session.ts';
import { allowLegacyProxyIdentity } from '../lib/auth-policy.ts';

const config = { GOOGLE_CLIENT_ID: 'test.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'not-real', GOOGLE_REDIRECT_URI: 'https://example.com/api/auth/google/callback' };
test('OAuth 설정은 정확한 HTTPS callback 주소를 요구한다', () => {
  assert.ok(authConfig(config));
  for (const uri of ['http://example.com/api/auth/google/callback','https://evil.com/callback','https://example.com/api/auth/google/callback?next=foo']) {
    assert.equal(authConfig({ ...config, GOOGLE_REDIRECT_URI: uri }), null);
  }
});
test('state nonce PKCE 및 안전한 로그인 복귀 경로', async () => {
  const pending = makePending('/?request=abc&resume=interest');
  assert.equal(pending.returnTo, safeReturnPath('/?request=abc&resume=interest'));
  const link = new URL(await googleAuthorizeUrl(authConfig(config)!, pending));
  assert.equal(link.origin, 'https://accounts.google.com');
  assert.equal(link.searchParams.get('response_type'), 'code');
  assert.equal(link.searchParams.get('nonce'), pending.nonce);
  assert.equal(link.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(link.searchParams.get('redirect_uri'), config.GOOGLE_REDIRECT_URI);
  const encoded = sealPending(pending);
  assert.deepEqual(parsePending(encoded, pending.state), pending);
  assert.equal(parsePending(encoded, 'wrong-state'), null);
  assert.equal(parsePending(encoded, pending.state, pending.issuedAt + 600001), null);
  assert.equal(makePending('https://phish.example/').returnTo, '/');
  assert.match(secureCookie(SESSION_COOKIE, 'test', 100), /HttpOnly; Secure; SameSite=Lax/);
});
test('ID token RS256 서명·aud·iss·nonce·exp 검증과 조작 거절', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const current = Math.floor(Date.now() / 1000);
  const sign = (claims: Record<string, unknown>) => {
    const header = encode({ alg: 'RS256', typ: 'JWT', kid: 'testkey' });
    const payload = encode(claims);
    const signature = createSign('RSA-SHA256').update(header + '.' + payload).sign(privateKey).toString('base64url');
    return header + '.' + payload + '.' + signature;
  };
  const keys = async () => Response.json({ keys: [{ ...jwk, kid: 'testkey', use: 'sig', alg: 'RS256' }] });
  const base = { iss: 'https://accounts.google.com', aud: config.GOOGLE_CLIENT_ID, sub: 'stable-google-sub', nonce: 'nonce', iat: current, exp: current + 600 };
  assert.deepEqual(await verifyGoogleIdToken(sign(base), base.aud, 'nonce', keys as typeof fetch), { sub: base.sub });
  for (const changed of [{ ...base, aud: 'attacker' }, { ...base, iss: 'https://attacker.test' }, { ...base, exp: current - 1 }, { ...base, nonce: 'wrong' }]) {
    await assert.rejects(verifyGoogleIdToken(sign(changed), base.aud, 'nonce', keys as typeof fetch));
  }
  const fake = sign(base).split('.');
  fake[1] = encode({ ...base, sub: 'victim' });
  await assert.rejects(verifyGoogleIdToken(fake.join('.'), base.aud, 'nonce', keys as typeof fetch));
});
test('Google sub 회원 매핑은 사용자별로 고정되고 세션은 서버에서 해지된다', async (t) => {
  const db = new SqliteD1(); t.after(() => db.close()); db.migrate();
  const first = await createGoogleSession(db.asD1(), 'subject-A', 1_800_000_000_000);
  const repeat = await createGoogleSession(db.asD1(), 'subject-A', 1_800_000_000_100);
  const other = await createGoogleSession(db.asD1(), 'subject-B', 1_800_000_000_100);
  assert.equal(first.userId, repeat.userId);
  assert.notEqual(first.userId, other.userId);
  assert.notEqual(first.token, repeat.token);
  const sessions = db.sqlite.prepare('SELECT * FROM auth_sessions').all();
  assert.equal(sessions.length, 3);
  assert.equal(JSON.stringify(sessions).includes(first.token), false);
  await revokeGoogleSession(db.asD1(), first.token);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) AS count FROM auth_sessions').get()?.count, 2);
});


test('공개 Google OAuth 배포는 요청자가 임의로 보낼 수 있는 ChatGPT 헤더 인증을 사용하지 않는다', () => {
  assert.equal(allowLegacyProxyIdentity({}), true); // Access-controlled ChatGPT Sites legacy mode only
  assert.equal(allowLegacyProxyIdentity({ GOOGLE_CLIENT_ID: 'client.apps.googleusercontent.com' }), false);
  assert.equal(allowLegacyProxyIdentity({ GOOGLE_CLIENT_ID: '  ' }), true);
});
