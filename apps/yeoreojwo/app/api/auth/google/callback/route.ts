import { env } from 'cloudflare:workers';
import { authConfig, CALLBACK_PATH, exchangeCode, OAUTH_COOKIE, parsePending, readCookie, removeCookie, secureCookie, SESSION_COOKIE, verifyGoogleIdToken } from '../../../../../lib/google-oauth';
import { createGoogleSession } from '../../../../../lib/google-auth';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const config = authConfig(env as unknown as Record<string, unknown>);
  const url = new URL(request.url);
  if (!config || url.origin !== new URL(config.redirectUri).origin || url.pathname !== CALLBACK_PATH) {
    return new Response('Google 인증 설정이 올바르지 않아요.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
  const pending = parsePending(readCookie(request.headers.get('cookie'), OAUTH_COOKIE), url.searchParams.get('state'));
  // Clear transient state regardless of success. Authorization codes and tokens
  // are never put in a redirect URL or persisted to the application database.
  const cleanup = removeCookie(OAUTH_COOKIE);
  if (!pending || url.searchParams.has('error') || !url.searchParams.get('code')) {
    return new Response('로그인이 취소되었거나 유효하지 않아요. 다시 로그인해주세요.', {
      status: 400, headers: { 'Set-Cookie': cleanup, 'Cache-Control': 'no-store' },
    });
  }
  try {
    const idToken = await exchangeCode(config, url.searchParams.get('code')!, pending);
    const identity = await verifyGoogleIdToken(idToken, config.clientId, pending.nonce);
    if (!env.DB) throw new Error('Database unavailable');
    const session = await createGoogleSession(env.DB, identity.sub);
    const response = new Response(null, { status: 303, headers: {
      Location: pending.returnTo,
      'Cache-Control': 'no-store',
    } });
    response.headers.append('Set-Cookie', cleanup);
    response.headers.append('Set-Cookie', secureCookie(SESSION_COOKIE, session.token, 7 * 86400));
    return response;
  } catch {
    // Do not leak provider tokens, personal data, response bodies or SQL errors.
    return new Response('로그인을 완료하지 못했어요. 다시 시도해주세요.', {
      status: 502, headers: { 'Set-Cookie': cleanup, 'Cache-Control': 'no-store' },
    });
  }
}
