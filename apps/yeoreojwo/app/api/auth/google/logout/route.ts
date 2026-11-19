import { env } from 'cloudflare:workers';
import { readCookie, removeCookie, SESSION_COOKIE } from '../../../../../lib/google-oauth';
import { revokeGoogleSession } from '../../../../../lib/google-session';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return new Response('올바른 페이지에서 다시 시도해주세요.', { status: 403 });
  }
  const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
  if (token && env.DB) await revokeGoogleSession(env.DB, token);
  return new Response(null, {
    status: 303,
    headers: { Location: '/', 'Set-Cookie': removeCookie(SESSION_COOKIE), 'Cache-Control': 'no-store' },
  });
}
