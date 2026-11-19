import { env } from 'cloudflare:workers';
import { authConfig, googleAuthorizeUrl, makePending, OAUTH_COOKIE, sealPending, secureCookie } from '../../../../../lib/google-oauth';
import { safeReturnPath } from '../../../../../lib/navigation';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const config = authConfig(env as unknown as Record<string, unknown>);
  if (!config) return new Response('Google 로그인 설정이 아직 완료되지 않았어요.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  if (new URL(request.url).origin !== new URL(config.redirectUri).origin) {
    return new Response('인증 주소가 맞지 않아요.', { status: 400 });
  }
  const returnTo = safeReturnPath(new URL(request.url).searchParams.get('return_to') ?? '/');
  const pending = makePending(returnTo);
  const authorizeUrl = await googleAuthorizeUrl(config, pending);
  return new Response(null, { status: 302, headers: {
    Location: authorizeUrl,
    'Set-Cookie': secureCookie(OAUTH_COOKIE, sealPending(pending), 600),
    'Cache-Control': 'no-store',
  } });
}
