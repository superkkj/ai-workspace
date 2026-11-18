// Drafts contain form values only. Authentication state and consent are never stored here.
export type DraftKind = 'request' | 'proposal' | 'profile' | 'cancel';
export type DraftValues = Record<string, string>;
export type FormDraft = {
  version: 1;
  kind: DraftKind;
  values: DraftValues;
  operationId: string;
  state: 'editing' | 'unknown';
};
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const fields: Record<DraftKind, readonly string[]> = {
  request: ['title', 'description', 'category', 'region', 'preferredTime', 'budget', 'targetPeople', 'deadline'],
  proposal: ['providerName', 'title', 'description', 'price', 'startsAt', 'durationMinutes', 'location', 'minParticipants', 'capacity', 'bookingUrl'],
  profile: ['nickname'],
  cancel: ['reason'],
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function draftStorageKey(scope: string | null | undefined, kind: DraftKind, target = 'new'): string | null {
  // The server supplies an opaque viewer-only scope, never an email or original auth ID.
  if (!scope || !/^[a-f0-9]{64}$/i.test(scope)) return null;
  return `yeoreojwo:draft:v1:${scope}:${kind}:${encodeURIComponent(target)}`;
}

export function draftValues(kind: DraftKind, values: Iterable<readonly [string, unknown]>): DraftValues {
  const allowed = fields[kind];
  return Object.fromEntries(Array.from(values).filter(([name, value]) => allowed.includes(name) && typeof value === 'string' && value.length <= 4000)) as DraftValues;
}

export function newDraft(kind: DraftKind, values: DraftValues = {}, operationId: string = crypto.randomUUID()): FormDraft {
  return { version: 1, kind, values: draftValues(kind, Object.entries(values)), operationId, state: 'editing' };
}

export function editDraft(draft: FormDraft, values: DraftValues): FormDraft {
  // A create attempt with an uncertain result must retain precisely the original payload.
  if (draft.kind === 'request' && draft.state === 'unknown') return draft;
  return { ...draft, values: draftValues(draft.kind, Object.entries(values)) };
}

export function parseDraft(raw: string | null, kind: DraftKind): FormDraft | null {
  if (!raw || raw.length > 32_768) return null;
  try {
    const item: unknown = JSON.parse(raw);
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const value = item as Record<string, unknown>;
    if (value.version !== 1 || value.kind !== kind || typeof value.operationId !== 'string' || !uuid.test(value.operationId)) return null;
    if (value.state !== 'editing' && value.state !== 'unknown') return null;
    if (!value.values || typeof value.values !== 'object' || Array.isArray(value.values)) return null;
    const entries = Object.entries(value.values);
    if (entries.some(([name, text]) => !fields[kind].includes(name) || typeof text !== 'string' || text.length > 4000)) return null;
    return { version: 1, kind, operationId: value.operationId, state: value.state, values: draftValues(kind, entries) };
  } catch { return null; }
}

export function readDraft(storage: DraftStorage | null, key: string | null, kind: DraftKind): FormDraft | null {
  if (!storage || !key) return null;
  try { return parseDraft(storage.getItem(key), kind); } catch { return null; }
}

export function writeDraft(storage: DraftStorage | null, key: string | null, draft: FormDraft): boolean {
  if (!storage || !key) return false;
  try { storage.setItem(key, JSON.stringify(draft)); return true; } catch { return false; }
}

export function removeDraft(storage: DraftStorage | null, key: string | null): boolean {
  if (!storage || !key) return false;
  try { storage.removeItem(key); return true; } catch { return false; }
}
