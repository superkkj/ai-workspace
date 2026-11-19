import { safeReturnPath } from './navigation.ts';

export const SESSION_COOKIE = '__Host-yeoreojwo_session';
export const OAUTH_COOKIE = '__Host-yeoreojwo_oauth';
export const CALLBACK_PATH = '/api/auth/google/callback';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

type Config = { clientId: string; clientSecret: string; redirectUri: string };
export type GoogleIdentity = { sub: string };
export type PendingLogin = { state: string; nonce: string; verifier: string; returnTo: string; issuedAt: number };

export function authConfig(values: Record<string, unknown>): Config | null {
  const clientId = values.GOOGLE_CLIENT_ID;
  const clientSecret = values.GOOGLE_CLIENT_SECRET;
  const redirectUri = values.GOOGLE_REDIRECT_URI;
  if (typeof clientId !== 'string' || !clientId || typeof clientSecret !== 'string' || !clientSecret || typeof redirectUri !== 'string') return null;
  try {
    const url = new URL(redirectUri);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || url.pathname !== CALLBACK_PATH) return null;
    return { clientId, clientSecret, redirectUri };
  } catch { return null; }
}

export function randomToken(size = 32): string {
  const data = crypto.getRandomValues(new Uint8Array(size));
  return base64Url(data);
}
function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function decodedBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Invalid base64url');
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
export async function sha256(value: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
export function readCookie(header: string | null, name: string): string | null {
  return header?.split(';').map(c => c.trim()).find(part => part.startsWith(name + '='))?.slice(name.length + 1) ?? null;
}
export function secureCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
export function removeCookie(name: string): string {
  return secureCookie(name, '', 0);
}
export function makePending(returnTo: string, now = Date.now()): PendingLogin {
  return { state: randomToken(), nonce: randomToken(), verifier: randomToken(48), returnTo: safeReturnPath(returnTo), issuedAt: now };
}
export function sealPending(pending: PendingLogin): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(pending)));
}
export function parsePending(raw: string | null, state: string | null, now = Date.now()): PendingLogin | null {
  if (!raw || raw.length > 2048 || !state) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(decodedBase64Url(raw))) as PendingLogin;
    if (!/^[\w-]{40,100}$/u.test(data.state) || data.state !== state ||
        !/^[\w-]{40,100}$/u.test(data.nonce) || !/^[\w-]{40,130}$/u.test(data.verifier) ||
        !Number.isFinite(data.issuedAt) || data.issuedAt > now || now - data.issuedAt > 600_000 ||
        safeReturnPath(data.returnTo) !== data.returnTo) return null;
    return data;
  } catch { return null; }
}
export async function googleAuthorizeUrl(config: Config, pending: PendingLogin): Promise<string> {
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code',
    scope: 'openid email profile', state: pending.state, nonce: pending.nonce,
    code_challenge: await sha256(pending.verifier), code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}

type TokenResponse = { id_token?: string };
export async function exchangeCode(config: Config, code: string, pending: PendingLogin, fetcher: typeof fetch = fetch): Promise<string> {
  if (!code || code.length > 2048) throw new Error('Invalid authorization code');
  const result = await fetcher(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: config.clientId, client_secret: config.clientSecret,
      redirect_uri: config.redirectUri, grant_type: 'authorization_code',
      code_verifier: pending.verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!result.ok) throw new Error('Google code exchange failed');
  const body = await result.json() as TokenResponse;
  if (typeof body.id_token !== 'string') throw new Error('Missing ID token');
  return body.id_token;
}

export async function verifyGoogleIdToken(token: string, audience: string, nonce: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<GoogleIdentity> {
  if (token.length > 10000 || token.split('.').length !== 3) throw new Error('Invalid ID token');
  const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
  const header = JSON.parse(new TextDecoder().decode(decodedBase64Url(encodedHeader))) as Record<string, unknown>;
  const claims = JSON.parse(new TextDecoder().decode(decodedBase64Url(encodedPayload))) as Record<string, unknown>;
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || header.typ && header.typ !== 'JWT') throw new Error('Unexpected JWT header');
  const keysResponse = await fetcher(JWKS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!keysResponse.ok) throw new Error('Google signing keys unavailable');
  const jwks = await keysResponse.json() as { keys?: Array<JsonWebKey & { kid?: string; use?: string; alg?: string }> };
  const key = jwks.keys?.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig') && (!k.alg || k.alg === 'RS256'));
  if (!key) throw new Error('Google signing key not found');
  const publicKey = await crypto.subtle.importKey('jwk', key, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, decodedBase64Url(encodedSignature) as Uint8Array<ArrayBuffer>, new TextEncoder().encode(encodedHeader + '.' + encodedPayload));
  const seconds = Math.floor(now / 1000);
  if (!verified || !['accounts.google.com', 'https://accounts.google.com'].includes(String(claims.iss)) ||
      claims.aud !== audience || typeof claims.exp !== 'number' || claims.exp <= seconds ||
      typeof claims.iat !== 'number' || claims.iat > seconds + 60 ||
      claims.nonce !== nonce || typeof claims.sub !== 'string' || !/^[\w-]{1,255}$/u.test(claims.sub)) {
    throw new Error('Google identity verification failed');
  }
  return { sub: claims.sub };
}
