import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { DomainError, readMutationBody } from '../../../lib/domain';
import { PlatformService, validateFocusedRequestId, validateSearchTerm } from '../../../lib/platform-service';

export const dynamic = 'force-dynamic';

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

function service(): PlatformService {
  if (!env.DB) throw new DomainError('STORAGE_UNAVAILABLE', '저장소를 연결하는 중이에요. 잠시 뒤 다시 시도해 주세요.', 503);
  return new PlatformService(env.DB);
}

function failure(error: unknown, stage: string): Response {
  if (error instanceof DomainError) return response({ error: error.message, code: error.code }, error.status);
  // Never return SQL, identity values, or request bodies in public errors.
  const errorType = error instanceof TypeError ? 'TypeError' : error instanceof RangeError ? 'RangeError' : 'Error';
  const errorCodes = error instanceof Error ? [...new Set(error.message.match(/\b(?:D1|SQLITE)_[A-Z_]+\b/g) ?? [])] : [];
  // Fixed stage, error class and code tokens are enough to distinguish auth,
  // body and storage failures without logging raw messages or user values.
  console.error('[platform] operation failed', { stage, errorType, errorCodes });
  return response({ error: '저장소에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.', code: 'STORAGE_ERROR' }, 503);
}

export async function GET(request: Request): Promise<Response> {
  let stage = 'read-link';
  try {
    const url = new URL(request.url);
    const focusedRequestId = validateFocusedRequestId(url.searchParams.get('request'));
    const searchTerm = validateSearchTerm(url.searchParams.get('search'));
    stage = 'read-auth';
    const user = await getChatGPTUser();
    stage = 'read-snapshot';
    return response(await service().snapshot(user?.userId ?? null, focusedRequestId, searchTerm));
  } catch (error) { return failure(error, stage); }
}

export async function POST(request: Request): Promise<Response> {
  let stage = 'write-auth';
  try {
    const user = await getChatGPTUser();
    if (!user) throw new DomainError('SIGN_IN_REQUIRED', '로그인하면 참여할 수 있어요.', 401);
    stage = 'write-body';
    const body = await readMutationBody(request);
    stage = 'write-command';
    return response(await service().execute(user.userId, body));
  } catch (error) { return failure(error, stage); }
}
