import { CATEGORIES } from './contracts.ts';
import type { Category, PlatformCommand, ProposalInput, RequestInput, RequestStatus } from './contracts.ts';

export class DomainError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.status = status;
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DomainError('INVALID_INPUT', '입력 내용을 다시 확인해 주세요.');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string') throw new DomainError('INVALID_INPUT', `${label}을(를) 입력해 주세요.`);
  const clean = value.trim();
  if (clean.length < min || clean.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(clean)) {
    throw new DomainError('INVALID_INPUT', `${label}은(는) ${min}~${max}자로 입력해 주세요.`);
  }
  return clean;
}

function integer(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new DomainError('INVALID_INPUT', `${label}은(는) ${min.toLocaleString('ko-KR')}~${max.toLocaleString('ko-KR')} 사이의 정수로 입력해 주세요.`);
  }
  return value;
}

export function parseTime(value: unknown, label: string, allowDay = false): number {
  let raw = text(value, label, 10, 40);
  if (allowDay && /^\d{4}-\d{2}-\d{2}$/u.test(raw)) raw += 'T23:59:59.999+09:00';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(raw)) {
    throw new DomainError('INVALID_DATE', `${label}의 날짜와 시간대를 확인해 주세요.`);
  }
  const parts = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/u)!;
  const [, year, month, day, hour, minute, second = '0'] = parts;
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  const result = Date.parse(raw);
  if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > daysInMonth || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 || !Number.isFinite(result)) {
    throw new DomainError('INVALID_DATE', `${label}에 올바른 날짜를 입력해 주세요.`);
  }
  return result;
}

function futureTime(value: unknown, label: string, now: number, days: number, allowDay = false): string {
  const time = parseTime(value, label, allowDay);
  if (time <= now || time > now + days * 86_400_000) {
    throw new DomainError('INVALID_DATE', `${label}은(는) 지금 이후 ${days}일 이내로 정해 주세요.`);
  }
  return new Date(time).toISOString();
}

export function validateNickname(value: unknown): string {
  const name = text(value, '닉네임', 2, 20);
  if (/@|https?:\/\/|\d{3}[- ]?\d{3,4}[- ]?\d{4}/iu.test(name)) {
    throw new DomainError('INVALID_INPUT', '닉네임에 이메일이나 연락처를 넣지 말아 주세요.');
  }
  return name;
}

export function validateBookingUrl(value: unknown): string {
  const raw = text(value ?? '', '예약 링크', 0, 500);
  if (!raw) return '';
  let url: URL;
  try { url = new URL(raw); } catch { throw new DomainError('INVALID_URL', 'https://로 시작하는 올바른 예약 링크를 입력해 주세요.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.') || url.hostname === 'localhost' || /^(?:\d+\.){3}\d+$/u.test(url.hostname) || url.hostname.startsWith('[') || /\.(?:localhost|local|internal)$/iu.test(url.hostname)) {
    throw new DomainError('INVALID_URL', '공개 웹사이트의 https:// 예약 링크를 입력해 주세요.');
  }
  return url.toString();
}

export function validateRequest(value: unknown, now: number): RequestInput {
  const input = object(value);
  if (!CATEGORIES.some((category) => category.id === input.category)) throw new DomainError('INVALID_INPUT', '활동 분야를 선택해 주세요.');
  return {
    title: text(input.title, '제목', 5, 80),
    description: text(input.description, '설명', 10, 2000),
    category: input.category as Category,
    region: text(input.region, '동네', 2, 40),
    preferredTime: text(input.preferredTime, '희망 시간', 2, 80),
    budget: integer(input.budget, '1인 예산', 0, 1_000_000),
    targetPeople: integer(input.targetPeople, '희망 인원', 2, 30),
    deadline: futureTime(input.deadline, '모집 마감', now, 90, true),
  };
}

export function validateProposal(value: unknown, now: number): ProposalInput {
  const input = object(value);
  const capacity = integer(input.capacity, '정원', 2, 30);
  return {
    providerName: text(input.providerName, '운영 이름', 2, 40),
    title: text(input.title, '제안 제목', 5, 80),
    description: text(input.description, '제안 설명', 10, 2000),
    price: integer(input.price, '1인 가격', 0, 1_000_000),
    startsAt: futureTime(input.startsAt, '시작 일시', now, 180),
    durationMinutes: integer(input.durationMinutes, '소요 시간', 15, 720),
    location: text(input.location, '장소', 2, 120),
    minParticipants: integer(input.minParticipants, '최소 인원', 1, capacity),
    capacity,
    bookingUrl: validateBookingUrl(input.bookingUrl),
  };
}

export function validateRequestOperationId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)) {
    throw new DomainError('INVALID_OPERATION_ID', '작성 중인 요청을 다시 열어 저장해 주세요.');
  }
  return value.toLowerCase();
}

export function validateCommand(value: unknown, now: number): PlatformCommand {
  const command = object(value);
  const action = command.action;
  if (action === 'profile') return { action, nickname: validateNickname(command.nickname) };
  if (action === 'createRequest') {
    const operationId = validateRequestOperationId(command.operationId);
    return { action, ...(operationId ? { operationId } : {}), input: validateRequest(command.input, now) };
  }
  const requestId = text(command.requestId, '요청 ID', 1, 100);
  if (action === 'interest') {
    if (typeof command.interested !== 'boolean') throw new DomainError('INVALID_INPUT', '관심 참여 상태를 확인해 주세요.');
    return { action, requestId, interested: command.interested };
  }
  if (action === 'createProposal') return { action, requestId, input: validateProposal(command.input, now) };
  if (action === 'chooseProposal' || action === 'withdrawProposal') return { action, requestId, proposalId: text(command.proposalId, '제안 ID', 1, 100) };
  if (action === 'cancel') return { action, requestId, reason: text(command.reason, '취소 사유', 2, 200) };
  if (action === 'confirm' || action === 'unconfirm' || action === 'complete') return { action, requestId };
  throw new DomainError('INVALID_ACTION', '지원하지 않는 작업이에요. 새로고침 후 다시 시도해 주세요.');
}

export function effectiveStatus(status: string, deadline: number, now: number): RequestStatus {
  return status === 'open' && deadline <= now ? 'expired' : status as RequestStatus;
}

/** Reject cross-site writes and stop reading large bodies before buffering them. */
export async function readMutationBody(request: Request): Promise<unknown> {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) throw new DomainError('INVALID_ORIGIN', '이 페이지에서 다시 시도해 주세요.', 403);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new DomainError('INVALID_CONTENT_TYPE', 'JSON 형식의 요청이 필요해요.', 415);
  const limit = 16_384;
  if (Number(request.headers.get('content-length')) > limit) throw new DomainError('BODY_TOO_LARGE', '입력 내용이 너무 길어요.', 413);
  if (!request.body) throw new DomainError('INVALID_JSON', '입력 내용이 비어 있어요.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new DomainError('BODY_TOO_LARGE', '입력 내용이 너무 길어요.', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new DomainError('INVALID_JSON', '입력 내용을 읽지 못했어요. 다시 시도해 주세요.'); }
}
