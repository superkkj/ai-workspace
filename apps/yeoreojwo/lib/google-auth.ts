import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../app/chatgpt-auth';
import { readCookie, SESSION_COOKIE, sha256 } from './google-oauth.ts';
import { allowLegacyProxyIdentity } from './auth-policy.ts';

export type AuthenticatedUser = { userId: string; provider: 'google' | 'chatgpt' };

export async function getAuthenticatedUser(request: Request): Promise<AuthenticatedUser | null> {
  const token = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
  // An invalid/expired Google cookie must not authorize a mutation by itself.
  if (token && /^[a-zA-Z0-9_-]{35,200}$/u.test(token) && env.DB) {
    const digest = await sha256(token);
    const row = await env.DB.prepare('SELECT user_id FROM auth_sessions WHERE token_hash = ? AND expires_at > ?')
      .bind(digest, Date.now()).first<{ user_id: string }>();
    if (row) return { userId: row.user_id, provider: 'google' };
  }
  if (!allowLegacyProxyIdentity(env as unknown as Record<string, unknown>)) return null;
  const legacy = await getChatGPTUser();
  return legacy ? { userId: legacy.userId, provider: 'chatgpt' } : null;
}

