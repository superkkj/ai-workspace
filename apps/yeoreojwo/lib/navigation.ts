export type ResumeIntent = { kind: 'request' } | { kind: 'mine' }
  | { kind: 'proposal'; requestId: string } | { kind: 'confirm'; requestId: string }
  | { kind: 'interest'; requestId: string; interested: boolean };
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const LOGIN_KEY = 'yeoreojwo:login-intent:v1';
const validId = (id: string | null): id is string => !!id && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
const intentName = (intent: ResumeIntent) => intent.kind === 'interest' ? intent.interested ? 'interest' : 'uninterest' : intent.kind;

export function readNavigation(search: string): { requestId: string | null; intent: ResumeIntent | null; resumeKey: string | null } {
  const params = new URLSearchParams(search);
  const candidate = params.get('request');
  const requestId = validId(candidate) ? candidate : null;
  const name = params.get('resume');
  let intent: ResumeIntent | null = null;
  if (name === 'request' || name === 'mine') intent = { kind: name };
  else if (requestId && (name === 'proposal' || name === 'confirm')) intent = { kind: name, requestId };
  else if (requestId && (name === 'interest' || name === 'uninterest')) intent = { kind: 'interest', requestId, interested: name === 'interest' };
  const key = params.get('resumeKey');
  return { requestId, intent, resumeKey: key && /^[a-zA-Z0-9-]{10,100}$/.test(key) ? key : null };
}

export function appPath(requestId: string | null = null, intent: ResumeIntent | null = null, resumeKey: string | null = null) {
  const params = new URLSearchParams();
  const id = intent && 'requestId' in intent ? intent.requestId : requestId;
  if (validId(id)) params.set('request', id);
  if (intent) params.set('resume', intentName(intent));
  if (resumeKey && /^[a-zA-Z0-9-]{10,100}$/.test(resumeKey)) params.set('resumeKey', resumeKey);
  const query = params.toString();
  return query ? `/?${query}` : '/';
}

/** Only the app root and its recognised query fields are accepted as authentication return locations. */
export function safeReturnPath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return '/';
  try {
    const url = new URL(value, 'https://yeoreojwo.invalid');
    if (url.origin !== 'https://yeoreojwo.invalid' || url.pathname !== '/') return '/';
    const state = readNavigation(url.search);
    return appPath(state.requestId, state.intent, state.resumeKey);
  } catch { return '/'; }
}

export const signInHref = (path: string) => `/signin-with-chatgpt?return_to=${encodeURIComponent(safeReturnPath(path))}`;

export function rememberLoginIntent(storage: StorageLike | undefined, intent: ResumeIntent, key: string, now = Date.now()): string | null {
  if (!storage) return null;
  try { storage.setItem(LOGIN_KEY, JSON.stringify({ intent, key, createdAt: now })); return key; }
  catch { return null; }
}

/** A URL alone never authorises an automatic interest write. It must match a recent click in this tab. */
export function takeLoginIntent(storage: StorageLike | undefined, search: string, now = Date.now()): ResumeIntent | null {
  if (!storage) return null;
  const state = readNavigation(search);
  if (!state.resumeKey || !state.intent) return null;
  try {
    const raw = storage.getItem(LOGIN_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved.key !== state.resumeKey || !Number.isFinite(saved.createdAt) || now < saved.createdAt || now - saved.createdAt > 30 * 60_000 || JSON.stringify(saved.intent) !== JSON.stringify(state.intent)) return null;
    storage.removeItem(LOGIN_KEY);
    return state.intent;
  } catch { return null; }
}
