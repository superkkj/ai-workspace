import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../../chatgpt-auth';
import { DomainError, readMutationBody } from '../../../lib/domain';
import { PlatformService, validateFocusedRequestId } from '../../../lib/platform-service';

export const dynamic = 'force-dynamic';

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

function service(): PlatformService {
  if (!env.DB) throw new DomainError('STORAGE_UNAVAILABLE', '저장소를 연결하는 중이에요. 잠시 뒤 다시 시도해 주세요.', 503);
  return new PlatformService(env.DB);
}

function failure(error: unknown): Response {
  if (error instanceof DomainError) return response({ error: error.message, code: error.code }, error.status);
  // Never return SQL, identity values, or request bodies in public errors.
  console.error('[platform] storage operation failed');
  return response({ error: '저장소에 연결하지 못했어요. 잠시 뒤 다시 시도해 주세요.', code: 'STORAGE_ERROR' }, 503);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const focusedRequestId = validateFocusedRequestId(new URL(request.url).searchParams.get('request'));
    const user = await getChatGPTUser();
    return response(await service().snapshot(user?.userId ?? null, focusedRequestId));
  } catch (error) { return failure(error); }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await getChatGPTUser();
    if (!user) throw new DomainError('SIGN_IN_REQUIRED', '로그인하면 참여할 수 있어요.', 401);
    const body = await readMutationBody(request);
    return response(await service().execute(user.userId, body));
  } catch (error) { return failure(error); }
}
