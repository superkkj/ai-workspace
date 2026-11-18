'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, Info, LoaderCircle } from 'lucide-react';
import { CATEGORIES, type Category, type PlatformCommand, type ProposalView, type RequestView } from '../../lib/contracts';
import { ClientError } from '../../lib/platform-client';
import { draftStorageKey, draftValues, editDraft, newDraft, readDraft, removeDraft, writeDraft, type DraftKind, type DraftStorage, type DraftValues, type FormDraft } from '../../lib/form-drafts';

type DraftProps = { draftScope?: string | null; onRefresh?: () => Promise<void> };
const memoryDrafts = new Map<string, FormDraft | null>();
function sessionDraftStorage(): DraftStorage | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}
function useFormDraft(kind: DraftKind, scope: string | null | undefined, defaults: DraftValues, target?: string) {
  const key = draftStorageKey(scope, kind, target);
  const initial = () => {
    const stored = key && memoryDrafts.has(key) ? memoryDrafts.get(key) : readDraft(sessionDraftStorage(), key, kind);
    return stored ? { ...stored, values: { ...defaults, ...stored.values } } : newDraft(kind, defaults);
  };
  const [record, setRecord] = useState<FormDraft>(initial);
  const latest = useRef(record);
  const previousKey = useRef(key);
  const [persistent, setPersistent] = useState(!!key && !!sessionDraftStorage());
  useEffect(() => {
    if (previousKey.current === key) return;
    previousKey.current = key;
    const next = initial();
    latest.current = next;
    setRecord(next);
    setPersistent(!!key && !!sessionDraftStorage());
  }, [key]); // Scope changes reset fields; routine snapshots never replace a draft.
  const store = (next: FormDraft) => {
    latest.current = next;
    setRecord(next);
    if (key) memoryDrafts.set(key, next);
    setPersistent(writeDraft(sessionDraftStorage(), key, next));
  };
  return {
    record, persistent,
    update(data: FormData) { store(editDraft(latest.current, draftValues(kind, data.entries()))); },
    start(data: FormData) {
      const next = editDraft(latest.current, draftValues(kind, data.entries()));
      // A page reload can happen before fetch settles. Treat the in-flight attempt as uncertain.
      store({ ...next, state: 'unknown' });
    },
    reject() { store({ ...latest.current, state: 'editing' }); },
    reset() { store(newDraft(kind, defaults)); },
    clear() { if (key) memoryDrafts.set(key, null); removeDraft(sessionDraftStorage(), key); },
  };
}
type DraftController = ReturnType<typeof useFormDraft>;
function formDataFor(values: DraftValues) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

export const money = (value: number) => `${value.toLocaleString('ko-KR')}원`;
export function dateLabel(value: string, includeTime = false) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', ...(includeTime ? { hour: 'numeric', minute: '2-digit' } : {}) }).format(new Date(value));
}
function inputDate(value: number) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value));
  const part = (type: string) => p.find(x => x.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}
type Submit = (command: PlatformCommand) => Promise<void>;
type FieldProps = { label: string; hint?: string; children: React.ReactNode; className?: string };
export function Field({ label, hint, children, className = '' }: FieldProps) {
  return <label className={`field ${className}`}><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}
export function FormFrame({ children, submitLabel, onSubmit, busy, secondary, tone = 'primary', draft, onRefresh }: {
  children: React.ReactNode; submitLabel: string; onSubmit: (data: FormData) => Promise<void>; busy: boolean; secondary?: React.ReactNode; tone?: 'primary' | 'danger'; draft?: DraftController; onRefresh?: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [resetWarning, setResetWarning] = useState(false);
  const [checking, setChecking] = useState(false);
  const submitting = useRef(false);
  const unknown = draft?.record.state === 'unknown';
  const locked = unknown && draft?.record.kind === 'request';
  const reset = () => { draft?.reset(); setError(''); setResetWarning(false); };
  return <form className="app-form" onChange={event => { if (!busy && !locked) draft?.update(new FormData(event.currentTarget)); }} onSubmit={async event => {
    event.preventDefault();
    if (busy || submitting.current) return;
    const data = locked && draft ? formDataFor(draft.record.values) : new FormData(event.currentTarget);
    submitting.current = true;
    setError('');
    draft?.start(data);
    try { await onSubmit(data); draft?.clear(); }
    catch (err) {
      // A missing response is different from a rejected input. An already-uncertain
      // operation also stays locked when this retry never reaches the server.
      if (err instanceof ClientError && err.code !== 'OPERATION_CONFLICT' &&
        (err.kind === 'input' || (err.kind === 'connection' && !unknown))) draft?.reject();
      setError(err instanceof Error ? err.message : '저장 여부를 확인하지 못했어요. 최신 상태를 확인해주세요.');
    } finally { submitting.current = false; }
  }}>
    {draft && <div className="draft-status"><p className="small-note">{draft.persistent ? '작성 내용은 이 브라우저 탭에 보관돼요. 저장에 성공하거나 초안을 지우면 삭제해요.' : '이 브라우저에서는 새로고침 후 초안 보관을 보장할 수 없어요. 중요한 내용은 따로 복사해주세요.'}</p>{unknown && !busy && <div className="form-note" role="status"><Info size={17}/><span>{locked ? '이 요청이 이미 저장됐을 수 있어요. 아래에서 같은 요청의 저장 결과를 다시 확인하면 중복으로 만들지 않아요. 확인 전에는 처음 보낸 내용을 유지해요.' : '앞선 저장 결과가 아직 확인되지 않았어요. 최신 상태를 먼저 확인하고 다시 진행해주세요.'}</span></div>}<div className="draft-actions"><button type="button" className="text-button" disabled={busy || checking} onClick={() => unknown ? setResetWarning(true) : reset()}>초안 지우고 새로 쓰기</button>{unknown && onRefresh && <button type="button" className="text-button" disabled={busy || checking} onClick={async () => { setChecking(true); try { await onRefresh(); } catch (err) { setError(err instanceof Error ? err.message : '최신 상태를 불러오지 못했어요.'); } finally { setChecking(false); } }}>{checking ? '확인하는 중…' : '최신 상태 확인'}</button>}</div>{resetWarning && <div className="form-error" role="alert"><p>앞선 내용이 이미 저장됐을 수 있어요. 새로 쓰면 별개의 요청이나 제안이 됩니다. 내 활동을 확인한 뒤 진행해주세요.</p><button type="button" className="text-button danger-text" disabled={busy} onClick={reset}>기존 내용과 별도로 새로 쓰기</button><button type="button" className="text-button" onClick={() => setResetWarning(false)}>기존 내용 계속 확인하기</button></div>}</div>}
    <fieldset className="form-fields" key={draft?.record.operationId} disabled={busy || locked}>{children}</fieldset>
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="form-footer">{secondary}<button type="submit" className={`button button-${tone}`} disabled={busy || checking}>{busy ? <LoaderCircle className="spin" size={18}/> : null}{busy ? '저장하는 중…' : locked ? '같은 요청의 저장 결과 다시 확인' : submitLabel}{!busy && tone === 'primary' && <ArrowRight size={17}/>}</button></div>
  </form>;
}

export function RequestForm({ submit, busy, now, draftScope, onRefresh }: { submit: Submit; busy: boolean; now: number } & DraftProps) {
  const draft = useFormDraft('request', draftScope, { category: 'craft', budget: '40000', targetPeople: '6', deadline: inputDate(now + 14 * 86_400_000) });
  const values = draft.record.values;
  return <FormFrame submitLabel="함께할 이웃 찾아보기" busy={busy} draft={draft} onRefresh={onRefresh} onSubmit={data => submit({ action: 'createRequest', operationId: draft.record.operationId, input: {
    title: String(data.get('title')), description: String(data.get('description')), category: String(data.get('category')) as Category,
    region: String(data.get('region')), preferredTime: String(data.get('preferredTime')), budget: Number(data.get('budget')),
    targetPeople: Number(data.get('targetPeople')), deadline: new Date(`${data.get('deadline')}T23:59:59+09:00`).toISOString(),
  } })}>
    <div className="form-intro"><span className="intro-number">01</span><div><strong>어떤 시간을 보내고 싶나요?</strong><p>바라는 활동을 적으면, 같은 마음인 이웃이 모여요.</p></div></div>
    <Field label="요청 제목"><input name="title" defaultValue={values.title ?? ''} placeholder="예: 퇴근 후 도자기 컵을 만들고 싶어요" minLength={5} maxLength={80} required autoFocus/></Field>
    <div className="field-row"><Field label="활동 분야"><select name="category" defaultValue={values.category}>{CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></Field><Field label="동네" hint="시·구 또는 생활권을 적어주세요."><input name="region" defaultValue={values.region ?? ''} placeholder="예: 서울 마포구" minLength={2} maxLength={40} required/></Field></div>
    <Field label="바라는 활동을 알려주세요" hint="개인 연락처나 상세 집 주소는 적지 마세요."><textarea name="description" defaultValue={values.description ?? ''} rows={4} placeholder="처음 배우는 사람도 참여할 수 있으면 좋겠어요. 만들고 싶은 것, 필요한 준비물 등을 적어주세요." minLength={10} maxLength={2000} required/></Field>
    <div className="form-intro second"><span className="intro-number">02</span><div><strong>함께할 조건을 정해볼까요?</strong><p>정확한 일정은 운영자의 제안을 받은 뒤 선택해요.</p></div></div>
    <Field label="희망하는 요일·시간"><input name="preferredTime" defaultValue={values.preferredTime ?? ''} placeholder="예: 평일 저녁 7시 이후" minLength={2} maxLength={80} required/></Field>
    <div className="field-row"><Field label="1인 희망 예산" hint="재료비 등을 포함해 생각한 금액"><div className="input-unit"><input name="budget" type="number" min={0} max={1000000} step={1} defaultValue={values.budget} required/><span>원</span></div></Field><Field label="희망 인원" hint="관심을 모으는 목표예요."><div className="input-unit"><input name="targetPeople" type="number" min={2} max={30} defaultValue={values.targetPeople} required/><span>명</span></div></Field></div>
    <Field label="요청을 모을 마감일" hint="한국 시간 오후 11시 59분까지 요청을 모아요. 최대 90일 이내."><input name="deadline" type="date" min={inputDate(now)} max={inputDate(now + 89 * 86_400_000)} defaultValue={values.deadline} required/></Field>
    <div className="form-note"><Info size={17}/><span>요청을 올리면 작성자도 관심 인원 1명에 포함돼요. 예약이나 결제는 이루어지지 않아요.</span></div>
  </FormFrame>;
}

export function ProfileForm({ submit, busy, nickname, draftScope, onRefresh }: { submit: Submit; busy: boolean; nickname: string } & DraftProps) {
  const draft = useFormDraft('profile', draftScope, { nickname });
  return <FormFrame submitLabel="닉네임 저장하기" busy={busy} draft={draft} onRefresh={onRefresh} onSubmit={data => submit({ action: 'profile', nickname: String(data.get('nickname')) })}>
    <div className="profile-illustration">반가워요<span>✳</span></div><p className="form-copy">요청과 제안에 사용할 이름을 정해주세요.<br/>다른 이웃에게는 이 닉네임만 보여요.</p>
    <Field label="공개 닉네임" hint="2~20자. 이메일이나 전화번호는 사용하지 마세요."><input name="nickname" minLength={2} maxLength={20} placeholder="예: 느긋한 산책자" defaultValue={draft.record.values.nickname} required autoFocus autoComplete="nickname"/></Field>
  </FormFrame>;
}

export function ProposalForm({ submit, busy, request, now, draftScope, onRefresh }: { submit: Submit; busy: boolean; request: RequestView; now: number } & DraftProps) {
  const defaultDate = `${inputDate(now + 7 * 86_400_000)}T19:00`;
  const draft = useFormDraft('proposal', draftScope, { startsAt: defaultDate, durationMinutes: '120', price: String(request.budget), minParticipants: '2', capacity: String(request.targetPeople) }, request.id);
  const values = draft.record.values;
  return <FormFrame submitLabel="수업 제안 보내기" busy={busy} draft={draft} onRefresh={onRefresh} onSubmit={data => submit({ action: 'createProposal', requestId: request.id, input: {
    providerName: String(data.get('providerName')), title: String(data.get('title')), description: String(data.get('description')),
    price: Number(data.get('price')), startsAt: new Date(`${data.get('startsAt')}:00+09:00`).toISOString(), durationMinutes: Number(data.get('durationMinutes')),
    location: String(data.get('location')), minParticipants: Number(data.get('minParticipants')), capacity: Number(data.get('capacity')), bookingUrl: String(data.get('bookingUrl') ?? '').trim(),
  } })}>
    <div className="request-summary"><span>이 요청에 제안해요</span><strong>{request.title}</strong><p>{request.region} · {request.preferredTime} · 희망 예산 {money(request.budget)}</p></div>
    <Field label="공방·운영자 이름"><input name="providerName" defaultValue={values.providerName ?? ''} placeholder="예: 도란도란 공방" minLength={2} maxLength={40} required autoFocus/></Field>
    <Field label="수업 이름"><input name="title" defaultValue={values.title ?? ''} placeholder="예: 처음 만나는 물레, 나만의 머그컵" minLength={5} maxLength={80} required/></Field>
    <Field label="활동 내용과 준비물" hint="가격에 포함된 항목과 참가자가 준비할 것을 알려주세요."><textarea name="description" defaultValue={values.description ?? ''} rows={4} minLength={10} maxLength={2000} required placeholder="수업 순서, 재료비 포함 여부, 준비물, 취소 시 안내 방법 등을 적어주세요."/></Field>
    <div className="field-row"><Field label="시작 날짜·시간" hint="한국 시간 기준"><input name="startsAt" type="datetime-local" defaultValue={values.startsAt} min={`${inputDate(now)}T00:00`} max={`${inputDate(now + 179 * 86_400_000)}T23:59`} required/></Field><Field label="진행 시간"><div className="input-unit"><input name="durationMinutes" type="number" min={15} max={720} step={1} defaultValue={values.durationMinutes} required/><span>분</span></div></Field></div>
    <Field label="활동 장소" hint="참가자가 확인할 수 있는 공방·시설의 위치를 적어주세요."><input name="location" defaultValue={values.location ?? ''} placeholder="예: 서울 마포구 ○○로, ○○공방" minLength={2} maxLength={120} required/></Field>
    <Field label="1인 참가 금액" hint="필수 재료비 등 추가 비용을 모두 포함한 금액"><div className="input-unit"><input name="price" type="number" min={0} max={1000000} step={1} defaultValue={values.price} required/><span>원</span></div></Field>
    <div className="field-row"><Field label="최소 진행 인원"><div className="input-unit"><input name="minParticipants" type="number" min={1} max={30} defaultValue={values.minParticipants} required/><span>명</span></div></Field><Field label="최대 정원"><div className="input-unit"><input name="capacity" type="number" min={2} max={30} defaultValue={values.capacity} required/><span>명</span></div></Field></div>
    <Field label="외부 안내·예약 링크 (선택)" hint="https로 시작하는 공개 웹주소만 입력할 수 있어요."><input name="bookingUrl" defaultValue={values.bookingUrl ?? ''} type="url" maxLength={500} placeholder="https://"/></Field>
    <div className="form-note"><Info size={17}/><span>선택된 뒤에는 날짜·가격·정원을 바꿀 수 없어요. 운영자 정보는 직접 작성한 정보로 표시돼요.</span></div>
  </FormFrame>;
}

export function ProposalSummary({ proposal }: { proposal: ProposalView }) {
  return <div className="conditions"><h3>{proposal.title}</h3><dl><div><dt>운영</dt><dd>{proposal.providerName}</dd></div><div><dt>일정</dt><dd>{dateLabel(proposal.startsAt, true)} · {proposal.durationMinutes}분</dd></div><div><dt>장소</dt><dd>{proposal.location}</dd></div><div><dt>1인 금액</dt><dd className="condition-price">{money(proposal.price)}</dd></div><div><dt>진행 인원</dt><dd>최소 {proposal.minParticipants}명 · 최대 {proposal.capacity}명</dd></div></dl></div>;
}

export function DecisionForm({ kind, request, proposal, submit, busy }: {
  kind: 'choose' | 'confirm' | 'unconfirm' | 'withdraw' | 'complete'; request: RequestView; proposal: ProposalView; submit: Submit; busy: boolean;
}) {
  const config = {
    choose: { label: '이 제안으로 모집하기', consent: '이 조건으로 참가자를 모집하고, 선택 후 조건을 바꿀 수 없음을 확인했어요.', copy: '관심을 표시한 이웃도 이 조건을 확인한 뒤 각자 참가를 확정해요. 작성자도 별도로 참가를 확정해야 해요.' },
    confirm: { label: '이 조건으로 참가할게요', consent: '날짜·장소·금액을 확인했고, 내 자리 1석의 참가 의사를 기록할게요.', copy: '열어줘의 참가 확정은 의사 표시예요. 결제나 외부 예약이 완료되는 것은 아니에요.' },
    unconfirm: { label: '내 참가 취소하기', consent: '내 참가 의사를 취소하고 자리를 돌려줄게요.', copy: '외부에서 따로 결제·예약했다면 해당 운영자의 취소 절차를 확인해주세요.' },
    withdraw: { label: '제안 철회하기', consent: '아직 선택되지 않은 이 제안을 철회할게요.', copy: '철회한 제안은 이 요청에서 더 이상 선택할 수 없어요.' },
    complete: { label: '진행 완료로 기록하기', consent: '이 일정의 활동이 실제로 진행되었음을 확인했어요.', copy: '완료로 기록한 모임은 다시 모집할 수 없어요. 실제 진행된 경우에만 기록해주세요.' },
  }[kind];
  return <FormFrame submitLabel={config.label} busy={busy} tone={kind === 'unconfirm' || kind === 'withdraw' ? 'danger' : 'primary'} onSubmit={() => submit(kind === 'choose' ? { action: 'chooseProposal', requestId: request.id, proposalId: proposal.id } : kind === 'withdraw' ? { action: 'withdrawProposal', requestId: request.id, proposalId: proposal.id } : { action: kind === 'complete' ? 'complete' : kind, requestId: request.id })}>
    <ProposalSummary proposal={proposal}/><p className="form-copy">{config.copy}</p><label className="consent"><input type="checkbox" required/><span>{config.consent}</span></label>
  </FormFrame>;
}

export function CancelForm({ request, submit, busy, draftScope, onRefresh }: { request: RequestView; submit: Submit; busy: boolean } & DraftProps) {
  const draft = useFormDraft('cancel', draftScope, {}, request.id);
  return <FormFrame submitLabel="요청 취소하기" tone="danger" busy={busy} draft={draft} onRefresh={onRefresh} onSubmit={data => submit({ action: 'cancel', requestId: request.id, reason: String(data.get('reason')) })}>
    <div className="request-summary"><span>취소할 요청</span><strong>{request.title}</strong></div><p className="form-copy">요청과 제안 내역은 남고, 새로운 참여는 마감돼요. 취소 사유는 이 요청을 보는 이웃에게 공개돼요.</p>
    <Field label="취소 사유"><textarea name="reason" defaultValue={draft.record.values.reason ?? ''} minLength={2} maxLength={200} rows={3} placeholder="예: 일정이 맞지 않아 이번 요청을 취소해요." required autoFocus/></Field>
    <label className="consent"><input type="checkbox" required/><span>이미 외부에서 진행한 예약·결제는 별도로 확인할게요.</span></label>
  </FormFrame>;
}

export function SignInMessage({ href = '/signin-with-chatgpt?return_to=/' }: { href?: string }) {
  return <div className="signin-message"><div className="signin-mark"><Check size={28}/></div><h3>내 이름으로 함께해요</h3><p>요청을 올리거나 참여하려면 로그인해주세요.<br/>로그인한 뒤 공개 닉네임을 정할 수 있어요.</p><a href={href} target="_top" className="button button-primary">ChatGPT로 로그인 <ArrowRight size={17}/></a></div>;
}
