import { randomToken, sha256 } from './google-oauth.ts';

export type LoginDatabase = Pick<D1Database, 'prepare' | 'batch'>;

export async function createGoogleSession(db: LoginDatabase, subject: string, now = Date.now()) {
  // The Google subject is never exposed as an application user ID.
  const candidate = crypto.randomUUID();
  await db.prepare('INSERT OR IGNORE INTO auth_accounts (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?)')
    .bind('google', subject, candidate, now).run();
  const account = await db.prepare('SELECT user_id FROM auth_accounts WHERE provider = ? AND subject = ?')
    .bind('google', subject).first<{ user_id: string }>();
  if (!account) throw new Error('Unable to obtain Google account');
  const token = randomToken(48);
  await db.prepare('INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), account.user_id, now, now + 7 * 86400_000).run();
  return { token, userId: account.user_id };
}

export async function revokeGoogleSession(db: LoginDatabase, token: string): Promise<void> {
  await db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
}
