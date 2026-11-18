import type { Category, CommandResult, PlatformSnapshot, ProposalView, RequestInput, RequestView } from './contracts.ts';
import { DomainError, effectiveStatus, validateCommand, validateRequestOperationId } from './domain.ts';

export type PlatformDatabase = Pick<D1Database, 'prepare' | 'batch'>;

type RequestRow = {
  id: string; owner_id: string; title: string; description: string; category: Category;
  region: string; preferred_time: string; budget: number; target_people: number;
  deadline: number; status: string; selected_proposal_id: string | null;
  cancellation_reason: string | null; created_at: number; updated_at: number; operation_id: string | null;
};

type ProposalRow = {
  id: string; request_id: string; owner_id: string; provider_name: string; title: string;
  description: string; price: number; starts_at: number; duration_minutes: number;
  location: string; min_participants: number; capacity: number; booking_url: string; created_at: number;
};

type RequestListing = RequestRow & { nickname: string; interest_count: number; confirmed_count: number; my_interest: number; my_registration: number };
type ProposalListing = ProposalRow & { nickname: string; confirmed_count: number };
const iso = (value: number) => new Date(value).toISOString();

async function draftScope(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const bytes = new TextEncoder().encode(`yeoreojwo:drafts:v1:${userId}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sameRequestInput(row: RequestRow, input: RequestInput): boolean {
  return row.title === input.title && row.description === input.description && row.category === input.category
    && row.region === input.region && row.preferred_time === input.preferredTime && row.budget === input.budget
    && row.target_people === input.targetPeople && row.deadline === Date.parse(input.deadline);
}

function creationResult(row: RequestRow, input: RequestInput): CommandResult {
  if (!sameRequestInput(row, input)) {
    throw new DomainError('OPERATION_CONFLICT', '앞선 저장과 내용이 달라요. 내 활동에서 저장 결과를 확인한 뒤 새 요청으로 작성해 주세요.', 409);
  }
  return { ok: true, requestId: row.id };
}

export function validateFocusedRequestId(value: string | null): string | null {
  if (value === null) return null;
  if (value.length < 1 || value.length > 100 || !value.trim()) {
    throw new DomainError('INVALID_REQUEST_ID', '공유 링크의 요청 ID를 확인해 주세요.');
  }
  return value;
}

function conflict(message = '요청 상태가 바뀌었어요. 새로고침 후 확인해 주세요.'): never {
  throw new DomainError('STATE_CONFLICT', message, 409);
}

export class PlatformService {
  private readonly db: PlatformDatabase;
  private readonly clock: () => number;
  private readonly nextId: () => string;

  constructor(db: PlatformDatabase, options: { now?: () => number; id?: () => string } = {}) {
    this.db = db;
    this.clock = options.now ?? Date.now;
    this.nextId = options.id ?? (() => crypto.randomUUID());
  }

  private async request(id: string): Promise<RequestRow> {
    const row = await this.db.prepare('SELECT * FROM requests WHERE id = ?').bind(id).first<RequestRow>();
    if (!row) throw new DomainError('NOT_FOUND', '요청을 찾을 수 없어요.', 404);
    return row;
  }

  private async proposal(id: string, requestId: string): Promise<ProposalRow> {
    const row = await this.db.prepare('SELECT * FROM proposals WHERE id = ? AND request_id = ?').bind(id, requestId).first<ProposalRow>();
    if (!row) throw new DomainError('NOT_FOUND', '제안을 찾을 수 없어요.', 404);
    return row;
  }

  private requireOpen(request: RequestRow, now: number): void {
    if (effectiveStatus(request.status, request.deadline, now) !== 'open') conflict('모집 중인 요청에서만 할 수 있어요.');
  }

  private requireOwner(request: RequestRow, userId: string): void {
    if (request.owner_id !== userId) throw new DomainError('FORBIDDEN', '이 요청을 작성한 사람만 할 수 있어요.', 403);
  }

  private async selected(request: RequestRow): Promise<ProposalRow> {
    if (request.status !== 'confirming' || !request.selected_proposal_id) conflict('아직 참가할 제안이 선택되지 않았어요.');
    return this.proposal(request.selected_proposal_id, request.id);
  }

  async snapshot(userId: string | null, focusedRequestId?: string | null): Promise<PlatformSnapshot> {
    const user = userId ?? '';
    const now = this.clock();
    const focusedId = validateFocusedRequestId(focusedRequestId ?? null);
    // Keep the public discovery feed bounded without making a member's older
    // activity disappear. Both reads use the exact same UNION of request IDs.
    const recentIds = 'SELECT id FROM (SELECT id FROM requests ORDER BY created_at DESC, id DESC LIMIT 200)';
    const personalIds = userId ? `${recentIds}
      UNION SELECT id FROM requests WHERE owner_id = ?
      UNION SELECT request_id FROM interests WHERE user_id = ?
      UNION SELECT request_id FROM proposals WHERE owner_id = ?
      UNION SELECT request_id FROM registrations WHERE user_id = ?` : recentIds;
    // A shared link includes at most one additional public request and its
    // proposals. The value remains a bound parameter, never SQL source.
    const visibleIds = focusedId ? `${personalIds} UNION SELECT id FROM requests WHERE id = ?` : personalIds;
    const visibleIdBindings = [
      ...(userId ? [userId, userId, userId, userId] : []),
      ...(focusedId ? [focusedId] : []),
    ];
    const [requestResult, proposalResult, profileResult] = await this.db.batch([
      this.db.prepare(`SELECT r.*, p.nickname,
        (SELECT COUNT(*) FROM interests i WHERE i.request_id = r.id) AS interest_count,
        (SELECT COUNT(*) FROM registrations g WHERE g.request_id = r.id) AS confirmed_count,
        (SELECT COUNT(*) FROM interests i WHERE i.request_id = r.id AND i.user_id = ?) AS my_interest,
        (SELECT COUNT(*) FROM registrations g WHERE g.request_id = r.id AND g.user_id = ?) AS my_registration
        FROM requests r JOIN profiles p ON p.user_id = r.owner_id
        WHERE r.id IN (${visibleIds})
        ORDER BY r.created_at DESC, r.id DESC`).bind(user, user, ...visibleIdBindings),
      this.db.prepare(`SELECT p.*, u.nickname,
        (SELECT COUNT(*) FROM registrations g WHERE g.proposal_id = p.id) AS confirmed_count
        FROM proposals p JOIN profiles u ON u.user_id = p.owner_id
        WHERE p.request_id IN (${visibleIds})
        ORDER BY p.created_at ASC, p.id ASC`).bind(...visibleIdBindings),
      this.db.prepare('SELECT nickname FROM profiles WHERE user_id = ?').bind(user),
    ]);
    const rows = requestResult.results as RequestListing[];
    const proposals = proposalResult.results as ProposalListing[];
    const profile = (profileResult.results as { nickname: string }[])[0];
    const requests: RequestView[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description,
      category: row.category,
      region: row.region,
      preferredTime: row.preferred_time,
      budget: row.budget,
      targetPeople: row.target_people,
      deadline: iso(row.deadline),
      nickname: row.nickname,
      status: effectiveStatus(row.status, row.deadline, now),
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      isMine: row.owner_id === user,
      isInterested: row.my_interest > 0,
      isConfirmed: row.my_registration > 0,
      interestCount: row.interest_count,
      confirmedCount: row.confirmed_count,
      selectedProposalId: row.selected_proposal_id,
      cancellationReason: row.cancellation_reason,
      proposals: proposals.filter((p) => p.request_id === row.id).map((p): ProposalView => ({
        id: p.id,
        providerName: p.provider_name,
        title: p.title,
        description: p.description,
        price: p.price,
        startsAt: iso(p.starts_at),
        durationMinutes: p.duration_minutes,
        location: p.location,
        minParticipants: p.min_participants,
        capacity: p.capacity,
        bookingUrl: p.booking_url,
        nickname: p.nickname,
        createdAt: iso(p.created_at),
        isMine: p.owner_id === user,
        isSelected: p.id === row.selected_proposal_id,
        confirmedCount: p.confirmed_count,
      })),
    }));
    return {
      viewer: { signedIn: Boolean(userId), nickname: profile?.nickname ?? '새로운 이웃', profileReady: Boolean(profile), draftScope: await draftScope(userId) },
      requests,
      serverTime: iso(now),
    };
  }

  async execute(userId: string | null, value: unknown): Promise<CommandResult> {
    if (!userId) throw new DomainError('SIGN_IN_REQUIRED', '로그인하면 참여할 수 있어요.', 401);
    const now = this.clock();
    // Look up only this authenticated user's completed creation. Revalidate a
    // replay at its original creation time so a later deadline does not hide a
    // successful save whose response was lost. Stored conditions are immutable.
    if (value && typeof value === 'object' && !Array.isArray(value) && 'action' in value && value.action === 'createRequest') {
      const operationId = validateRequestOperationId('operationId' in value ? value.operationId : undefined);
      if (operationId) {
        const saved = await this.db.prepare('SELECT * FROM requests WHERE owner_id = ? AND operation_id = ?').bind(userId, operationId).first<RequestRow>();
        if (saved) {
          const replay = validateCommand(value, saved.created_at);
          if (replay.action === 'createRequest') return creationResult(saved, replay.input);
        }
      }
    }
    const command = validateCommand(value, now);
    if (command.action === 'profile') {
      await this.db.prepare(`INSERT INTO profiles (user_id, nickname, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET nickname = excluded.nickname, updated_at = excluded.updated_at`)
        .bind(userId, command.nickname, now).run();
      return { ok: true };
    }
    const profile = await this.db.prepare('SELECT user_id FROM profiles WHERE user_id = ?').bind(userId).first();
    if (!profile) throw new DomainError('PROFILE_REQUIRED', '먼저 공개 닉네임을 정해 주세요.', 409);
    if (command.action === 'createRequest') {
      const id = this.nextId();
      const input = command.input;
      await this.db.batch([
        this.db.prepare(`INSERT INTO requests
          (id, owner_id, operation_id, title, description, category, region, preferred_time, budget, target_people, deadline, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
          ON CONFLICT(owner_id, operation_id) DO NOTHING`)
          .bind(id, userId, command.operationId ?? null, input.title, input.description, input.category, input.region, input.preferredTime, input.budget, input.targetPeople, Date.parse(input.deadline), now, now),
        // A losing duplicate inserts no row or interest. The winning request and
        // its owner's first interest commit together in the same atomic batch.
        this.db.prepare(`INSERT INTO interests (request_id, user_id, created_at)
          SELECT id, owner_id, created_at FROM requests WHERE id = ?`).bind(id),
      ]);
      if (command.operationId) {
        const saved = await this.db.prepare('SELECT * FROM requests WHERE owner_id = ? AND operation_id = ?').bind(userId, command.operationId).first<RequestRow>();
        if (!saved) throw new Error('Creation result is not available.');
        return creationResult(saved, input);
      }
      return { ok: true, requestId: id };
    }

    const request = await this.request(command.requestId);
    const requestId = request.id;
    switch (command.action) {
      case 'interest': {
        this.requireOpen(request, now);
        if (!command.interested && request.owner_id === userId) throw new DomainError('OWNER_INTEREST', '작성자는 첫 관심 참여자로 남아요. 진행하지 않으려면 요청을 취소해 주세요.', 409);
        if (command.interested) {
          await this.db.prepare(`INSERT OR IGNORE INTO interests (request_id, user_id, created_at)
            SELECT id, ?, ? FROM requests WHERE id = ? AND status = 'open' AND deadline > ?`)
            .bind(userId, now, requestId, now).run();
        } else {
          await this.db.prepare(`DELETE FROM interests WHERE request_id = ? AND user_id = ?
            AND EXISTS (SELECT 1 FROM requests r WHERE r.id = ? AND r.status = 'open' AND r.deadline > ? AND r.owner_id <> ?)`)
            .bind(requestId, userId, requestId, now, userId).run();
        }
        this.requireOpen(await this.request(requestId), now);
        break;
      }
      case 'createProposal': {
        this.requireOpen(request, now);
        if (request.owner_id === userId) throw new DomainError('SELF_PROPOSAL', '내가 올린 요청에는 운영자 제안을 할 수 없어요.', 403);
        const existing = await this.db.prepare('SELECT id FROM proposals WHERE request_id = ? AND owner_id = ?').bind(requestId, userId).first();
        if (existing) conflict('이미 제안을 보냈어요. 조건을 바꾸려면 기존 제안을 철회한 뒤 다시 보내 주세요.');
        const input = command.input;
        const result = await this.db.prepare(`INSERT OR IGNORE INTO proposals
          (id, request_id, owner_id, provider_name, title, description, price, starts_at, duration_minutes, location, min_participants, capacity, booking_url, created_at)
          SELECT ?, id, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM requests
          WHERE id = ? AND status = 'open' AND deadline > ? AND owner_id <> ?`)
          .bind(this.nextId(), userId, input.providerName, input.title, input.description, input.price, Date.parse(input.startsAt), input.durationMinutes, input.location, input.minParticipants, input.capacity, input.bookingUrl, now, requestId, now, userId).run();
        if (!result.meta.changes) conflict();
        break;
      }
      case 'chooseProposal': {
        this.requireOwner(request, userId);
        if (request.status === 'confirming' && request.selected_proposal_id === command.proposalId) break;
        this.requireOpen(request, now);
        const proposal = await this.proposal(command.proposalId, requestId);
        if (proposal.starts_at <= now) conflict('이미 시작한 제안은 선택할 수 없어요.');
        const result = await this.db.prepare(`UPDATE requests SET status = 'confirming', selected_proposal_id = ?, updated_at = ?
          WHERE id = ? AND owner_id = ? AND status = 'open' AND deadline > ?
          AND EXISTS (SELECT 1 FROM proposals p WHERE p.id = ? AND p.request_id = requests.id AND p.starts_at > ? AND p.owner_id <> ?)`)
          .bind(proposal.id, now, requestId, userId, now, proposal.id, now, userId).run();
        if (!result.meta.changes) conflict();
        break;
      }
      case 'withdrawProposal': {
        const proposal = await this.proposal(command.proposalId, requestId);
        if (proposal.owner_id !== userId) throw new DomainError('FORBIDDEN', '내가 보낸 제안만 철회할 수 있어요.', 403);
        this.requireOpen(request, now);
        const result = await this.db.prepare(`DELETE FROM proposals WHERE id = ? AND owner_id = ? AND request_id = ?
          AND EXISTS (SELECT 1 FROM requests r WHERE r.id = ? AND r.status = 'open' AND r.deadline > ? AND r.selected_proposal_id IS NULL)`)
          .bind(proposal.id, userId, requestId, requestId, now).run();
        if (!result.meta.changes) conflict();
        break;
      }
      case 'confirm': {
        const proposal = await this.selected(request);
        if (proposal.starts_at <= now) conflict('시작 시간이 지나 참가를 확정할 수 없어요.');
        if (proposal.owner_id === userId) throw new DomainError('PROVIDER_REGISTRATION', '운영자는 자기 모임의 참가자로 등록할 수 없어요.', 403);
        // Capacity is evaluated in the INSERT itself. D1 serializes writes, so two
        // requests for the final seat cannot both pass this predicate.
        const [result] = await this.db.batch([
          this.db.prepare(`INSERT OR IGNORE INTO registrations (request_id, user_id, proposal_id, created_at)
            SELECT r.id, ?, p.id, ? FROM requests r JOIN proposals p ON p.id = r.selected_proposal_id
            WHERE r.id = ? AND r.status = 'confirming' AND p.starts_at > ? AND p.owner_id <> ?
            AND (SELECT COUNT(*) FROM registrations g WHERE g.request_id = r.id) < p.capacity`)
            .bind(userId, now, requestId, now, userId),
          this.db.prepare(`INSERT OR IGNORE INTO interests (request_id, user_id, created_at)
            SELECT request_id, user_id, ? FROM registrations WHERE request_id = ? AND user_id = ?`)
            .bind(now, requestId, userId),
        ]);
        if (!result.meta.changes) {
          const registered = await this.db.prepare('SELECT request_id FROM registrations WHERE request_id = ? AND user_id = ?').bind(requestId, userId).first();
          if (!registered) conflict('정원이 찼거나 모집 상태가 바뀌었어요. 새로고침해서 확인해 주세요.');
        }
        break;
      }
      case 'unconfirm': {
        const proposal = await this.selected(request);
        if (proposal.starts_at <= now) conflict('시작 시간이 지나 참가를 취소할 수 없어요.');
        await this.db.prepare(`DELETE FROM registrations WHERE request_id = ? AND user_id = ?
          AND EXISTS (SELECT 1 FROM requests r JOIN proposals p ON p.id = r.selected_proposal_id
            WHERE r.id = ? AND r.status = 'confirming' AND p.starts_at > ?)`)
          .bind(requestId, userId, requestId, now).run();
        const updated = await this.request(requestId);
        if (updated.status !== 'confirming') conflict();
        break;
      }
      case 'cancel': {
        const proposal = request.selected_proposal_id ? await this.proposal(request.selected_proposal_id, requestId) : null;
        if (request.owner_id !== userId && proposal?.owner_id !== userId) throw new DomainError('FORBIDDEN', '요청자 또는 선택된 운영자만 취소할 수 있어요.', 403);
        if (!['open', 'confirming'].includes(effectiveStatus(request.status, request.deadline, now))) conflict('이미 종료되거나 마감된 요청이에요.');
        const result = await this.db.prepare(`UPDATE requests SET status = 'cancelled', cancellation_reason = ?, updated_at = ?
          WHERE id = ? AND ((status = 'open' AND deadline > ?) OR status = 'confirming')
          AND (owner_id = ? OR EXISTS (SELECT 1 FROM proposals p WHERE p.id = requests.selected_proposal_id AND p.owner_id = ?))`)
          .bind(command.reason, now, requestId, now, userId, userId).run();
        if (!result.meta.changes) conflict();
        break;
      }
      case 'complete': {
        const proposal = await this.selected(request);
        if (request.owner_id !== userId && proposal.owner_id !== userId) throw new DomainError('FORBIDDEN', '요청자 또는 선택된 운영자만 완료를 기록할 수 있어요.', 403);
        if (proposal.starts_at + proposal.duration_minutes * 60_000 > now) conflict('모임 종료 시간이 지난 뒤 완료를 기록해 주세요.');
        const result = await this.db.prepare(`UPDATE requests SET status = 'completed', updated_at = ?
          WHERE id = ? AND status = 'confirming'
          AND (owner_id = ? OR EXISTS (SELECT 1 FROM proposals p WHERE p.id = requests.selected_proposal_id AND p.owner_id = ?))
          AND EXISTS (SELECT 1 FROM proposals p WHERE p.id = requests.selected_proposal_id
            AND p.starts_at + p.duration_minutes * 60000 <= ?
            AND (SELECT COUNT(*) FROM registrations g WHERE g.request_id = requests.id) >= p.min_participants)`)
          .bind(now, requestId, userId, userId, now).run();
        if (!result.meta.changes) conflict('최소 확정 인원이 충족되지 않았거나 모임 상태가 바뀌었어요.');
        break;
      }
    }
    return { ok: true, requestId };
  }
}
