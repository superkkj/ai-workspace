import type { CommandResult, PlatformCommand, PlatformSnapshot } from './contracts.ts';

export type ClientErrorKind = 'input' | 'connection' | 'unknown' | 'server';
export class ClientError extends Error {
  kind: ClientErrorKind;
  code?: string;
  status?: number;
  constructor(message: string, kind: ClientErrorKind, code?: string, status?: number) {
    super(message); this.name = 'ClientError'; this.kind = kind; this.code = code; this.status = status;
  }
}
type Fetcher = typeof fetch;
type Options = { fetcher?: Fetcher; signal?: AbortSignal; timeoutMs?: number; online?: boolean };
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const unknownSave = '저장됐는지 아직 확인하지 못했어요. 작성 내용은 유지했어요. 요청은 같은 내용으로 저장 결과를 다시 확인하고, 다른 변경은 최신 상태를 먼저 확인해주세요.';

async function jsonRequest(url: string, command: PlatformCommand | undefined, options: Options) {
  const writing = command !== undefined;
  if (options.online === false) throw new ClientError('연결이 끊겨 요청을 보내지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해주세요.', 'connection');
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, options.timeoutMs ?? 15_000);
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      cache: 'no-store', signal: controller.signal,
      ...(writing ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command) } : {}),
    });
    let body: unknown;
    try { body = await response.json(); }
    catch { throw new ClientError(writing ? unknownSave : '서버 응답을 읽지 못했어요. 다시 불러와주세요.', writing ? 'unknown' : 'server', undefined, response.status); }
    if (!record(body)) throw new ClientError(writing ? unknownSave : '요청을 불러오지 못했어요. 다시 시도해주세요.', writing ? 'unknown' : 'server');
    if (!response.ok) {
      // A server error after a write may follow a committed transaction. Never retry it automatically.
      const uncertain = writing && response.status >= 500;
      const message = uncertain ? unknownSave : typeof body.error === 'string' ? body.error : writing ? '입력과 현재 상태를 확인해주세요.' : '요청을 불러오지 못했어요.';
      throw new ClientError(message, uncertain ? 'unknown' : writing ? 'input' : 'server', typeof body.code === 'string' ? body.code : undefined, response.status);
    }
    return body;
  } catch (error) {
    if (error instanceof ClientError) throw error;
    throw new ClientError(writing ? unknownSave : '연결이 지연되거나 끊겼어요. 기존 화면은 유지했으니 다시 불러와주세요.', writing ? 'unknown' : 'connection');
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}

export async function fetchSnapshot(requestId: string | null, options: Options = {}, search?: string): Promise<PlatformSnapshot> {
  const params = new URLSearchParams();
  if (requestId) params.set('request', requestId);
  if (search) params.set('search', search);
  const body = await jsonRequest(`/api/platform${params.size ? `?${params.toString()}` : ''}`, undefined, options);
  if (!Array.isArray(body.requests) || !record(body.viewer) || typeof body.viewer.signedIn !== 'boolean' || typeof body.serverTime !== 'string' || !Number.isFinite(Date.parse(body.serverTime))) {
    throw new ClientError('최신 정보를 읽지 못했어요. 다시 불러와주세요.', 'server');
  }
  return body as unknown as PlatformSnapshot;
}

export async function sendCommand(command: PlatformCommand, options: Options = {}): Promise<CommandResult> {
  const body = await jsonRequest('/api/platform', command, options);
  if (body.ok !== true) throw new ClientError(unknownSave, 'unknown');
  return { ok: true, ...(typeof body.requestId === 'string' ? { requestId: body.requestId } : {}) };
}

/** Share concurrent reads for one request, and discard all reads invalidated by a write or navigation. */
export function createSnapshotLoader(reader: (requestId: string | null, signal: AbortSignal) => Promise<PlatformSnapshot> = (id, signal) => fetchSnapshot(id, { signal })) {
  let generation = 0;
  let pending: { key: string | null; controller: AbortController; promise: Promise<PlatformSnapshot | null> } | null = null;
  const invalidate = () => { generation++; pending?.controller.abort(); pending = null; };
  return {
    invalidate,
    isPending: () => pending !== null,
    load(key: string | null): Promise<PlatformSnapshot | null> {
      if (pending?.key === key) return pending.promise;
      invalidate();
      const current = generation;
      const controller = new AbortController();
      const promise = Promise.resolve().then(() => reader(key, controller.signal))
        .then(data => current === generation ? data : null)
        .catch(error => { if (current !== generation) return null; throw error; })
        .finally(() => { if (current === generation) pending = null; });
      pending = { key, controller, promise };
      return promise;
    },
  };
}
