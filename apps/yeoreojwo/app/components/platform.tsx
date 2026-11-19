'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, ArrowUpRight, BookOpen, CalendarDays, Check, CheckCircle2, ChefHat, ChevronDown, CircleHelp, Clock3, Heart, MapPin, Menu, MessageCircle, Mountain, Music2, Palette, Plus, RefreshCw, Search, Share2, Sparkles, Sprout, Users, Wallet, X } from 'lucide-react';
import { CATEGORIES, STATUS_LABELS, type Category, type CommandResult, type PlatformCommand, type PlatformSnapshot, type ProposalView, type RequestStatus, type RequestView } from '../../lib/contracts';
import { getExamples } from '../../lib/examples';
import { ClientError, createSnapshotLoader, fetchSnapshot, sendCommand } from '../../lib/platform-client';
import { appPath, readNavigation, rememberLoginIntent, signInHref, takeLoginIntent, type ResumeIntent } from '../../lib/navigation';
import { ActivityArt, HeroArt } from './illustrations';
import { Modal } from './modal';
import { CancelForm, dateLabel, DecisionForm, money, ProfileForm, ProposalForm, ProposalSummary, RequestForm, SignInMessage } from './forms';

type Overlay = { kind: 'request' | 'profile' | 'signin' | 'how' }
  | { kind: 'detail'; id: string; example?: boolean }
  | { kind: 'proposal' | 'cancel'; id: string }
  | { kind: 'choose' | 'confirm' | 'unconfirm' | 'withdraw' | 'complete'; id: string; proposalId: string };
type ListMode = 'actual' | 'examples' | 'mine';
type MyFilter = 'created' | 'interested' | 'proposed' | 'confirmed';
type Notice = { text: string; tone: 'success' | 'error' };
function tabStorage() { try { return window.sessionStorage; } catch { return undefined; } }

const categoryIcon = { craft: Palette, cooking: ChefHat, sports: Activity, culture: Music2, learning: BookOpen, outdoor: Mountain };

function Flower({ size = 32 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 36 36" fill="none" aria-hidden="true"><path d="M18 17C0 16 4-2 16 5c4 3 4 8 2 12Zm1 1C20 0 38 4 31 16c-3 4-8 4-12 2Zm-1 1C36 20 32 38 20 31c-4-3-4-8-2-12Zm-1-1C16 36-2 32 5 20c3-4 8-4 12-2Z" fill="currentColor"/><circle cx="18" cy="18" r="4" fill="#faefd7"/></svg>;
}

function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`status-badge status-${status}`}><span/>{STATUS_LABELS[status]}</span>;
}

function daysLabel(deadline: string, now: number) {
  const days = Math.ceil((new Date(deadline).getTime() - now) / 86_400_000);
  return days <= 0 ? '마감' : days === 1 ? '오늘 마감' : `${days}일 남음`;
}

function RequestCard({ request, now, onOpen }: { request: RequestView; now: number; onOpen: () => void }) {
  const Icon = categoryIcon[request.category];
  const progress = Math.min(100, request.interestCount / request.targetPeople * 100);
  return <button className="request-card" onClick={onOpen} aria-label={`${request.isExample ? '예시: ' : ''}${request.title} 상세 보기`}>
    <div className="card-art"><ActivityArt category={request.category}/><span className="art-label"><Icon size={13}/>{CATEGORIES.find(c => c.id === request.category)?.label}</span>{request.isExample ? <span className="example-badge">예시</span> : request.isInterested ? <span className="saved-heart" aria-label="관심 있는 요청"><Heart size={17} fill="currentColor"/></span> : null}</div>
    <div className="card-body"><div className="card-topline"><StatusBadge status={request.status}/><span className="card-deadline">{request.status === 'open' ? daysLabel(request.deadline, now) : dateLabel(request.createdAt)}</span></div><h3>{request.title}</h3><div className="card-meta"><span><MapPin size={14}/>{request.region}</span><span><Clock3 size={14}/>{request.preferredTime}</span></div><div className="card-budget">1인 희망 예산 <strong>{money(request.budget)}</strong></div><div className="card-divider"/><div className="card-progress-label"><span><Users size={15}/>{request.isExample ? '가상 관심' : '관심'} <strong>{request.interestCount}명</strong></span><span>희망 {request.targetPeople}명</span></div><div className="progress-track"><span style={{ width: `${progress}%` }}/></div><div className="card-bottom"><span className="card-author"><span className={`avatar-dot avatar-${request.category}`}>{request.nickname.slice(0,1)}</span>{request.nickname}{request.isMine && <span className="mine-label">나</span>}</span><span className="card-proposals">{request.proposals.length ? `제안 ${request.proposals.length}개` : '운영자 제안 기다리는 중'}<ArrowUpRight size={15}/></span></div></div>
  </button>;
}

function RequestDetail({ request, busy, now, onInterest, onProtected, onOverlay, onShare, onNewRequest }: {
  request: RequestView; busy: boolean; now: number; onInterest: () => void; onProtected: (next: Overlay) => void;
  onOverlay: (next: Overlay) => void; onShare: () => void; onNewRequest: () => void;
}) {
  const selected = request.proposals.find(p => p.id === request.selectedProposalId);
  const open = request.status === 'open' && new Date(request.deadline).getTime() > now;
  const active = request.status === 'confirming';
  const started = !!selected && new Date(selected.startsAt).getTime() <= now;
  const ended = !!selected && new Date(selected.startsAt).getTime() + selected.durationMinutes * 60_000 <= now;
  const isManager = request.isMine || !!selected?.isMine;
  return <div className="request-detail">
    {request.isExample && <div className="example-notice"><Sparkles size={17}/><span>이용 방법을 보여주는 예시예요. 인원과 내용은 가상이며 실제로 참여할 수 없어요.</span></div>}
    <div className="detail-cover"><ActivityArt category={request.category}/><div className="detail-cover-overlay"><span>{CATEGORIES.find(c => c.id === request.category)?.label}</span><span><MapPin size={14}/>{request.region}</span></div></div>
    <div className="detail-topline"><StatusBadge status={request.status}/><span>{request.nickname} · {dateLabel(request.createdAt)} 작성</span>{!request.isExample && <button className="icon-button" onClick={onShare} aria-label="요청 링크 복사"><Share2 size={17}/></button>}</div>
    <h3 className="detail-title">{request.title}</h3>
    <div className="detail-facts"><div><Clock3 size={18}/><span>희망 시간<strong>{request.preferredTime}</strong></span></div><div><Wallet size={18}/><span>1인 희망 예산<strong>{money(request.budget)}</strong></span></div><div><Users size={18}/><span>관심 / 희망 인원<strong>{request.interestCount}명 / {request.targetPeople}명</strong></span></div><div><CalendarDays size={18}/><span>요청 마감<strong>{dateLabel(request.deadline)}</strong></span></div></div>
    <p className="detail-description">{request.description}</p>
    {request.cancellationReason && <div className="cancellation-note"><strong>취소 사유</strong><p>{request.cancellationReason}</p></div>}
    {request.isExample ? <div className="detail-example-action"><p>내가 하고 싶은 활동도 요청해볼까요?</p><button className="button button-primary" onClick={onNewRequest}><Plus size={17}/> 내 요청 만들기</button></div> : open ? <div className="interest-actions"><div><strong>{request.interestCount}명이 함께하고 싶어 해요</strong><p>관심은 예약이 아니에요. 제안된 조건을 보고 참가를 정해요.</p></div><button className={`button ${request.isInterested ? 'button-outline' : 'button-primary'}`} onClick={onInterest} disabled={busy || request.isMine}><Heart size={17} fill={request.isInterested ? 'currentColor' : 'none'}/>{request.isMine ? '작성자로 관심 참여 중' : request.isInterested ? '관심 취소' : '관심 있어요'}</button></div> : null}
    {selected && <section className="selected-proposal"><div className="section-heading"><span className="selected-icon"><Check size={17}/></span><h3>함께하기로 한 제안</h3></div><ProposalSummary proposal={selected}/><p className="detail-description proposal-description">{selected.description}</p><div className="confirmation-count"><strong>{request.isExample ? '가상 참가 확정 ' : '참가 확정 '}{request.confirmedCount}명</strong><span>최소 {selected.minParticipants}명 · 정원 {selected.capacity}명</span></div><div className="progress-track confirmation"><span style={{ width: `${Math.min(100, request.confirmedCount / selected.capacity * 100)}%` }}/></div>
      {active && !request.isExample && <div className="confirmation-actions">{request.isConfirmed ? <><div className="participation-confirmed"><CheckCircle2 size={19}/> 내 참가 의사가 기록되었어요</div>{!started && <button className="text-button danger-text" onClick={() => onOverlay({ kind: 'unconfirm', id: request.id, proposalId: selected.id })} disabled={busy}>내 참가 취소</button>}</> : selected.isMine ? <p className="muted">내가 운영하는 모임이에요. 운영자는 참가 인원에 포함되지 않아요.</p> : started ? <p className="muted">시작 시간이 지나 참가 신청이 마감되었어요.</p> : request.confirmedCount >= selected.capacity ? <p className="full-message"><Users size={18}/> 정원이 모두 찼어요</p> : <button className="button button-primary full-width" disabled={busy} onClick={() => onProtected({ kind: 'confirm', id: request.id, proposalId: selected.id })}>조건 확인하고 참가 확정 <ArrowRight size={17}/></button>}</div>}
      {selected.bookingUrl && <a className="external-link" href={selected.bookingUrl} target="_blank" rel="noopener noreferrer">운영자의 외부 안내 보기 <ArrowUpRight size={15}/></a>}<p className="small-note">참가 확정은 의사 표시이며 결제·외부 예약 완료를 뜻하지 않아요.</p>
    </section>}
    {!selected && <section className="proposals-section"><div className="section-heading"><h3>운영자의 제안 <span>{request.proposals.length}</span></h3>{open && !request.isMine && !request.isExample && !request.proposals.some(p => p.isMine) && <button className="text-button" onClick={() => onProtected({ kind: 'proposal', id: request.id })} disabled={busy}><Plus size={15}/> 수업 제안하기</button>}</div>
      {request.proposals.length === 0 ? <div className="proposal-empty"><div className="small-flower"><Flower size={30}/></div><strong>어떤 제안이 도착할까요?</strong><p>공방과 강사가 날짜·장소·가격을 제안하면<br/>요청한 이웃이 조건을 보고 하나를 선택해요.</p></div> : <div className="proposal-list">{request.proposals.map(proposal => <article key={proposal.id} className="proposal-card"><div className="proposal-byline"><span><Sprout size={16}/>{proposal.providerName}</span>{proposal.isMine && <span className="mine-label">내 제안</span>}</div><h4>{proposal.title}</h4><p>{proposal.description}</p><div className="proposal-conditions"><span><CalendarDays size={15}/>{dateLabel(proposal.startsAt, true)}</span><span><MapPin size={15}/>{proposal.location}</span><span><Users size={15}/>최소 {proposal.minParticipants}명 · 정원 {proposal.capacity}명</span></div><div className="proposal-bottom"><strong>{money(proposal.price)} <small>/ 1인</small></strong>{open && !request.isExample && request.isMine && <button className="button button-primary button-small" disabled={busy || new Date(proposal.startsAt).getTime() <= now} onClick={() => onOverlay({ kind: 'choose', id: request.id, proposalId: proposal.id })}>제안 선택</button>}{open && !request.isExample && proposal.isMine && <button className="text-button danger-text" disabled={busy} onClick={() => onOverlay({ kind: 'withdraw', id: request.id, proposalId: proposal.id })}>철회</button>}</div><p className="small-note">운영자가 직접 작성한 제안이에요.</p></article>)}</div>}
    </section>}
    {!request.isExample && isManager && (open || active) && <div className="manage-actions">{active && ended && selected && request.confirmedCount >= selected.minParticipants && <button className="button button-outline" disabled={busy} onClick={() => onOverlay({ kind: 'complete', id: request.id, proposalId: selected.id })}><CheckCircle2 size={17}/> 진행 완료 기록</button>}<button className="text-button danger-text" disabled={busy} onClick={() => onOverlay({ kind: 'cancel', id: request.id })}>요청 취소하기</button></div>}
    {request.status === 'expired' && <div className="state-message"><Clock3 size={20}/><p>요청을 모으는 시간이 끝났어요. 새로운 조건으로 다시 요청해볼 수 있어요.</p></div>}
    {request.status === 'completed' && <div className="state-message completed-message"><CheckCircle2 size={20}/><p>진행 완료로 기록된 모임이에요. 다음에 하고 싶은 활동도 함께 열어봐요.</p></div>}
  </div>;
}

export default function Platform() {
  const [snapshot, setSnapshot] = useState<PlatformSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [mode, setMode] = useState<ListMode>('actual');
  const [myFilter, setMyFilter] = useState<MyFilter>('created');
  const [category, setCategory] = useState<Category | 'all'>('all');
  const [query, setQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<{ term: string; requests: RequestView[] } | null>(null);
  const [searchPending, setSearchPending] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [region, setRegion] = useState('');
  const [status, setStatus] = useState('all');
  const [sort, setSort] = useState('latest');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [, setTick] = useState(0);
  const serverOffset = useRef(0);
  const userChoseMode = useRef(false);
  const initialLoaded = useRef(false);
  const pendingIntent = useRef<ResumeIntent | null>(null);
  const loginResumeKey = useRef<string | null>(null);
  const snapshotRef = useRef<PlatformSnapshot | null>(null);
  const focusedId = useRef<string | null>(null);
  const busyRef = useRef(false);
  const viewGeneration = useRef(0);
  const mounted = useRef(false);
  const reader = useRef(createSnapshotLoader());
  const [lastChecked, setLastChecked] = useState('');
  const now = Date.now() + serverOffset.current;
  const viewer = snapshot?.viewer;
  const examples = useMemo(() => getExamples(snapshot?.serverTime), [snapshot?.serverTime]);

  const load = useCallback(async (requestId?: string | null, force = false) => {
    if (requestId !== undefined) focusedId.current = requestId;
    if (force) reader.current.invalidate();
    setLoading(true);
    try {
      const data = await reader.current.load(focusedId.current);
      if (!data || !mounted.current) return null;
      serverOffset.current = Date.parse(data.serverTime) - Date.now();
      snapshotRef.current = data;
      setSnapshot(data); setLoadError('');
      setLastChecked(new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' }).format(new Date()));
      return data;
    } finally { if (mounted.current && !reader.current.isPending()) setLoading(false); }
  }, []);
  const reportReadError = useCallback((error: unknown) => { if(mounted.current) setLoadError(error instanceof Error ? error.message : '최신 정보를 불러오지 못했어요.'); }, []);
  useEffect(() => {
    mounted.current = true;
    focusedId.current = readNavigation(window.location.search).requestId;
    void load().catch(reportReadError);
    const revisit = () => { if(document.visibilityState === 'visible' && !busyRef.current) void load().catch(reportReadError); };
    window.addEventListener('focus', revisit); document.addEventListener('visibilitychange', revisit);
    return () => { mounted.current = false; reader.current.invalidate(); window.removeEventListener('focus', revisit); document.removeEventListener('visibilitychange', revisit); };
  }, [load, reportReadError]);
  useEffect(() => { const id=window.setInterval(() => setTick(v => v + 1), 60_000); return () => window.clearInterval(id); }, []);
  useEffect(() => { if(!notice) return; const id=window.setTimeout(() => setNotice(null), 8000); return () => window.clearTimeout(id); }, [notice]);

  const chooseMode = (next: ListMode) => { userChoseMode.current = true; setMode(next); setMobileMenu(false); setCategory('all'); setStatus('all'); setQuery(''); setRegion(''); };
  const scrollToBrowse = () => document.getElementById('browse')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const showOverlay = (next: Overlay) => {
    viewGeneration.current++;
    setOverlay(next);
    if ('id' in next && !(next.kind === 'detail' && next.example)) {
      focusedId.current = next.id;
      window.history.replaceState(null, '', appPath(next.id));
      if (!busyRef.current) void load(next.id).catch(reportReadError);
    }
  };
  const command = async (value: PlatformCommand, success: string): Promise<CommandResult> => {
    if(busyRef.current) throw new ClientError('앞선 요청을 저장하고 있어요. 잠시만 기다려주세요.', 'input');
    busyRef.current = true; setBusy(true);
    // No read begun before a write may replace its subsequent result.
    reader.current.invalidate();
    try {
      const result = await sendCommand(value, { online: navigator.onLine });
      try { await load(result.requestId ?? focusedId.current, true); }
      catch { setLoadError('변경은 저장했지만 최신 정보를 불러오지 못했어요. 새로고침해주세요. 같은 내용을 다시 작성할 필요는 없어요.'); }
      setNotice({text:success,tone:'success'});
      return result;
    } catch (error) {
      if (error instanceof ClientError && error.kind === 'unknown') setLoadError('저장 결과가 아직 확인되지 않았어요. 새로고침으로 현재 상태를 확인해주세요.');
      throw error;
    } finally { busyRef.current = false; setBusy(false); }
  };
  const runIntent = async (intent: ResumeIntent) => {
    const view = ++viewGeneration.current;
    if(intent.kind === 'request') { setOverlay({kind:'request'}); return; }
    if(intent.kind === 'mine') { chooseMode('mine'); scrollToBrowse(); return; }
    focusedId.current = intent.requestId;
    window.history.replaceState(null, '', appPath(intent.requestId));
    setMode('actual'); setOverlay({kind:'detail',id:intent.requestId});
    if(intent.kind === 'interest') {
      await command({action:'interest',requestId:intent.requestId,interested:intent.interested}, intent.interested ? '함께하고 싶은 마음을 보탰어요.' : '관심을 취소했어요.');
      return;
    }
    let latest: PlatformSnapshot | null;
    try { latest = await load(intent.requestId); }
    catch (error) { if(view !== viewGeneration.current || !mounted.current) return; throw error; }
    if(view !== viewGeneration.current || !mounted.current) return;
    const request = latest?.requests.find(item => item.id === intent.requestId);
    if(!request) throw new ClientError('이 요청의 최신 상태를 확인하지 못했어요. 새로고침 후 다시 확인해주세요.', 'server');
    if(intent.kind === 'proposal') { setOverlay({kind:'proposal',id:request.id}); return; }
    if(request.status !== 'confirming' || !request.selectedProposalId) throw new ClientError('현재 참가를 확정할 수 없는 요청이에요. 상세 내용을 확인해주세요.', 'input');
    // Authentication never confirms participation; show the latest terms and a fresh consent checkbox.
    setOverlay({kind:'confirm',id:request.id,proposalId:request.selectedProposalId});
  };
  const reportActionError = (error: unknown) => setNotice({text:error instanceof Error ? error.message : '처리 결과를 확인하지 못했어요.',tone:'error'});
  const protect = (intent: ResumeIntent) => {
    viewGeneration.current++;
    const currentViewer = snapshotRef.current?.viewer;
    if(!currentViewer?.signedIn) {
      pendingIntent.current = intent;
      loginResumeKey.current = rememberLoginIntent(tabStorage(), intent, crypto.randomUUID());
      setOverlay({kind:'signin'}); return;
    }
    if(!currentViewer.profileReady && intent.kind !== 'mine') { pendingIntent.current = intent; setOverlay({kind:'profile'}); return; }
    void runIntent(intent).catch(reportActionError);
  };
  const openProtected = (next: Overlay) => {
    if(next.kind === 'request') protect({kind:'request'});
    else if(next.kind === 'proposal' || next.kind === 'confirm') protect({kind:next.kind,requestId:next.id});
  };
  const createRequest = () => protect({kind:'request'});
  const closeOverlay = () => {
    if(busyRef.current) return;
    viewGeneration.current++;
    const pending = pendingIntent.current;
    pendingIntent.current = null; loginResumeKey.current = null;
    if((overlay?.kind === 'profile' || overlay?.kind === 'signin') && pending && 'requestId' in pending) showOverlay({kind:'detail',id:pending.requestId});
    else { setOverlay(null); focusedId.current = null; window.history.replaceState(null,'','/'); }
  };
  const refresh = async () => { try { await load(); } catch(error) { reportReadError(error); throw error; } };
  const refreshClick = () => { void refresh().catch(() => {}); };
  const loginHref = signInHref(appPath(focusedId.current, pendingIntent.current ?? (mode === 'mine' ? {kind:'mine'} : null), loginResumeKey.current));
  useEffect(() => {
    if(!snapshot || initialLoaded.current) return;
    initialLoaded.current = true;
    const navigation = readNavigation(window.location.search);
    if(!userChoseMode.current) setMode(snapshot.requests.length ? 'actual' : 'examples');
    if(navigation.requestId && snapshot.requests.some(r => r.id === navigation.requestId)) { setOverlay({kind:'detail',id:navigation.requestId}); setMode('actual'); }
    else if(navigation.requestId) setNotice({text:'이 링크의 요청을 찾을 수 없어요. 활동 목록에서 다시 찾아주세요.',tone:'error'});
    if(snapshot.viewer.signedIn && navigation.intent) {
      const trusted = takeLoginIntent(tabStorage(), window.location.search);
      window.history.replaceState(null,'',appPath(navigation.requestId));
      if(trusted || navigation.intent.kind !== 'interest') protect(trusted ?? navigation.intent);
      else setNotice({text:'보던 요청으로 돌아왔어요. 관심 버튼을 눌러 참여 의사를 확인해주세요.',tone:'success'});
    }
  }, [snapshot]);
  const trimmedQuery = query.trim();
  const isRemoteSearch = mode === 'actual' && trimmedQuery.length >= 2;
  useEffect(() => {
    if (!isRemoteSearch) { setSearchMatches(null); setSearchPending(false); setSearchError(''); return; }
    const controller = new AbortController();
    setSearchPending(true); setSearchError('');
    const timer = window.setTimeout(() => {
      void fetchSnapshot(null, { signal: controller.signal }, trimmedQuery)
        .then(result => { if (!controller.signal.aborted) setSearchMatches({ term: trimmedQuery, requests: result.requests }); })
        .catch(error => { if (!controller.signal.aborted) setSearchError(error instanceof Error ? error.message : '전체 검색에 실패했어요.'); })
        .finally(() => { if (!controller.signal.aborted) setSearchPending(false); });
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [trimmedQuery, isRemoteSearch, snapshot?.serverTime]);
  const source = mode === 'examples' ? examples : isRemoteSearch && searchMatches?.term === trimmedQuery ? searchMatches.requests : snapshot?.requests ?? [];
  const visible = useMemo(() => source.filter(request => {
    if(mode === 'mine') {
      if(myFilter==='created' && !request.isMine) return false;
      if(myFilter==='interested' && !request.isInterested) return false;
      if(myFilter==='proposed' && !request.proposals.some(p=>p.isMine)) return false;
      if(myFilter==='confirmed' && !request.isConfirmed) return false;
    }
    return (category==='all'||request.category===category) && (status==='all'||request.status===status) && (!region.trim()||request.region.toLowerCase().includes(region.trim().toLowerCase())) && (!query.trim()||`${request.title} ${request.description} ${request.preferredTime}`.toLowerCase().includes(query.trim().toLowerCase()));
  }).sort((a,b) => sort==='popular' ? b.interestCount-a.interestCount : sort==='deadline' ? Date.parse(a.deadline)-Date.parse(b.deadline) : Date.parse(b.createdAt)-Date.parse(a.createdAt)), [source,mode,myFilter,category,status,region,query,sort]);
  const activeRequest = overlay && 'id' in overlay ? (overlay.kind==='detail' && overlay.example ? examples : snapshot?.requests ?? []).find(r=>r.id===overlay.id) : null;
  const activeProposal = overlay && 'proposalId' in overlay ? activeRequest?.proposals.find(p=>p.id===overlay.proposalId) : null;
  const hasFilters = category!=='all'||!!query||!!region||status!=='all';
  const actualCount = snapshot?.requests.filter(r=>r.status==='open'||r.status==='confirming').length ?? 0;
  const clearFilters = () => {setCategory('all');setQuery('');setRegion('');setStatus('all');};
  const backToDetail = () => { if(overlay && 'id' in overlay) showOverlay({kind:'detail',id:overlay.id}); };
  const title = overlay?.kind==='request'?'어떤 활동을 열어볼까요?':overlay?.kind==='profile'?'이웃에게 보여줄 이름':overlay?.kind==='signin'?'함께할 준비가 되었나요?':overlay?.kind==='how'?'이렇게, 함께 열어요':overlay?.kind==='proposal'?'이웃의 요청에 제안하기':overlay?.kind==='choose'?'이 조건으로 모아볼까요?':overlay?.kind==='confirm'?'참가할 조건을 확인해주세요':overlay?.kind==='unconfirm'?'내 참가를 취소할까요?':overlay?.kind==='withdraw'?'제안을 철회할까요?':overlay?.kind==='complete'?'모임이 잘 진행되었나요?':overlay?.kind==='cancel'?'요청을 취소할까요?':'함께 열어보는 활동';

  return <div className="site-shell">
    <a className="skip-link" href="#browse">활동 목록으로 건너뛰기</a>
    <header className="site-header"><div className="header-inner"><button className="brand" aria-label="열어줘 홈" onClick={()=>{chooseMode('actual');window.scrollTo({top:0,behavior:'smooth'});}}><Flower/><span>열어줘<span className="brand-dot">.</span></span></button><nav className="desktop-nav" aria-label="주 메뉴"><button className={mode!=='mine'?'active':''} onClick={()=>{chooseMode(snapshot?.requests.length?'actual':'examples');scrollToBrowse();}}>활동 둘러보기</button><button className={mode==='mine'?'active':''} onClick={()=>{chooseMode('mine');scrollToBrowse();}}>내 활동</button><button onClick={()=>setOverlay({kind:'how'})}>이용 방법</button></nav><div className="header-actions">{viewer?.signedIn ? <button className="profile-button" onClick={()=>{pendingIntent.current=null;setOverlay({kind:'profile'});}}><span className="profile-avatar">{viewer.profileReady?viewer.nickname.slice(0,1):'나'}</span><span>{viewer.profileReady?viewer.nickname:'닉네임 설정'}</span><ChevronDown size={13}/></button> : <a className="login-link" href={loginHref} target="_top">로그인</a>}<button className="button button-primary header-create" onClick={createRequest} disabled={!snapshot}><Plus size={17}/> 활동 요청하기</button><button className="icon-button mobile-menu-button" aria-label="메뉴" aria-expanded={mobileMenu} onClick={()=>setMobileMenu(!mobileMenu)}>{mobileMenu?<X size={23}/>:<Menu size={23}/>}</button></div></div>{mobileMenu&&<nav className="mobile-nav" aria-label="모바일 메뉴"><button onClick={()=>{chooseMode('actual');scrollToBrowse();}}>활동 둘러보기</button><button onClick={()=>{chooseMode('mine');scrollToBrowse();}}>내 활동</button><button onClick={()=>{setOverlay({kind:'how'});setMobileMenu(false);}}>이용 방법</button><button onClick={createRequest} disabled={!snapshot}>활동 요청하기</button></nav>}</header>
    <main><section className="hero"><div className="hero-copy"><p className="eyebrow"><span className="tiny-star">✳</span> OUR NEIGHBORHOOD, OUR IDEAS</p><h1>하고 싶던 그 일,<br/><span>함께라면</span> 열릴 거예요.</h1><p className="hero-description">내가 바라는 시간, 동네, 예산으로.<br/>이웃과 마음을 모으면 새로운 활동이 시작돼요.</p><div className="hero-actions"><button className="button button-primary hero-primary" onClick={createRequest} disabled={!snapshot}>하고 싶은 활동 요청하기 <ArrowUpRight size={18}/></button><button className="hero-how" onClick={()=>setOverlay({kind:'how'})}><CircleHelp size={17}/> 어떻게 이용하나요?</button></div><div className="hero-footnote"><span className="footnote-people"><i>나</i><i>너</i><i>우리</i></span><span>작은 바람이 모여, 함께하는 시간으로</span></div></div><HeroArt/></section>
      <div className="journey-strip"><div><span>01</span><p>하고 싶은 활동을 <strong>요청해요</strong></p></div><ArrowRight size={17}/><div><span>02</span><p>이웃과 함께 <strong>마음을 모아요</strong></p></div><ArrowRight size={17}/><div><span>03</span><p>운영자의 제안을 보고 <strong>참가해요</strong></p></div></div>
      <section id="browse" className="browse-section"><div className="browse-heading"><div><p className="section-eyebrow">A LITTLE IDEA, A NEW EXPERIENCE</p><h2>{mode==='mine'?'내가 함께하는 활동':'함께 열어볼까요?'} <span className="heading-star">✳</span></h2></div><button className="provider-link" onClick={()=>{chooseMode('actual');setStatus('open');setNotice({text:'관심 있는 요청을 열고 ‘수업 제안하기’를 선택해주세요.',tone:'success'});}}><Sprout size={18}/> 공방·강사로 제안하고 싶어요 <ArrowUpRight size={16}/></button></div>
        <div className="list-tabs" role="group" aria-label="요청 목록 선택"><button className={mode==='actual'?'selected':''} onClick={()=>chooseMode('actual')}>실제 모집 <span>{actualCount}</span></button><button className={mode==='examples'?'selected':''} onClick={()=>chooseMode('examples')}>예시 둘러보기 <Sparkles size={14}/></button><button className={mode==='mine'?'selected':''} onClick={()=>chooseMode('mine')}>내 활동 <Heart size={14}/></button></div>
        {searchPending && isRemoteSearch && <p role="status">전체 요청에서 검색하고 있어요…</p>}{searchError && isRemoteSearch && <div role="alert" className="load-error">{searchError}</div>}{loadError && <div className="load-error" role="alert"><span>{loadError}</span><button className="text-button" onClick={refreshClick} disabled={loading}>{loading?'불러오는 중…':'다시 불러오기'}</button></div>}
        {mode==='examples'&&<div className="examples-banner"><Sparkles size={17}/><span><strong>이렇게 요청할 수 있어요.</strong> 아래는 서비스 이용을 돕는 예시이며, 실제 모집과 별개예요.</span><button onClick={createRequest} disabled={!snapshot}>내 요청 만들기 <ArrowRight size={15}/></button></div>}
        {mode==='mine'&&<div className="my-filters" role="group" aria-label="내 활동 종류">{([['created','내 요청'],['interested','관심 있는 활동'],['proposed','보낸 제안'],['confirmed','참가 확정']] as [MyFilter,string][]).map(([id,label])=><button key={id} className={myFilter===id?'selected':''} onClick={()=>setMyFilter(id)}>{label}</button>)}</div>}
        <div className="category-list" role="group" aria-label="활동 분야"><button className={category==='all'?'selected':''} onClick={()=>setCategory('all')} aria-pressed={category==='all'}><span className="category-symbol all-symbol"><Flower size={19}/></span>전체</button>{CATEGORIES.map(item=>{const Icon=categoryIcon[item.id];return <button key={item.id} className={category===item.id?'selected':''} onClick={()=>setCategory(item.id)} aria-pressed={category===item.id}><span className={`category-symbol symbol-${item.id}`}><Icon size={19}/></span>{item.label}</button>;})}</div>
        <div className="search-row"><label className="search-box"><Search size={19}/><input aria-label="활동 검색" placeholder="어떤 활동을 하고 싶나요?" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<button className="icon-button" aria-label="검색어 지우기" onClick={()=>setQuery('')}><X size={15}/></button>}</label><label className="region-box"><MapPin size={17}/><input aria-label="동네 검색" placeholder="동네 전체" value={region} onChange={e=>setRegion(e.target.value)}/></label><select className="status-select" aria-label="모집 상태" value={status} onChange={e=>setStatus(e.target.value)}><option value="all">모든 상태</option><option value="open">함께 모으는 중</option><option value="confirming">참가 확정 중</option><option value="completed">함께한 모임</option><option value="expired">모집 마감</option><option value="cancelled">취소된 요청</option></select></div>
        <div className="refresh-status"><span role="status">{loading?'최신 상태 확인 중…':lastChecked?`최근 확인 ${lastChecked}`:'최신 상태를 불러와주세요'}</span><button className="text-button" onClick={refreshClick} disabled={loading||busy}><RefreshCw size={14} className={loading?'spin':''}/> 새로고침</button></div>
        <div className="results-heading"><p>{mode==='examples'?'예시 요청':mode==='mine'?'내 활동':'활동 요청'} <strong>{visible.length}</strong>{hasFilters&&<button className="text-button" onClick={clearFilters}>필터 초기화 <X size={12}/></button>}</p><select aria-label="정렬" value={sort} onChange={e=>setSort(e.target.value)}><option value="latest">최신순</option><option value="popular">관심 많은 순</option><option value="deadline">마감 가까운 순</option></select></div>
        {loading&&!snapshot ? <div className="request-grid" aria-label="활동을 불러오는 중" aria-busy="true">{[0,1,2].map(i=><div className="skeleton-card" key={i}><div/><span/><span/><p/></div>)}</div> : mode==='mine'&&!viewer?.signedIn ? <div className="empty-state"><Heart size={32}/><h3>나의 활동을 한눈에</h3><p>로그인하면 내가 올린 요청과 관심 있는 활동,<br/>참가를 확정한 모임을 함께 볼 수 있어요.</p><a className="button button-primary" href={loginHref} target="_top">로그인하고 시작하기 <ArrowRight size={16}/></a></div> : visible.length ? <div className="request-grid">{visible.map(request=><RequestCard request={request} now={now} key={request.id} onOpen={()=>showOverlay({kind:'detail',id:request.id,example:request.isExample})}/>)}</div> : <div className="empty-state"><span className="empty-flower"><Flower size={40}/></span><h3>{loadError?'요청 목록을 잠시 불러올 수 없어요':hasFilters?'조건에 맞는 요청이 아직 없어요':mode==='mine'?'아직 이곳에 담긴 활동이 없어요':'우리 동네의 첫 요청을 기다려요'}</h3><p>{loadError?'다시 불러오기를 눌러 최신 상태를 확인해주세요.':hasFilters?'조건을 바꾸거나, 내가 원하는 활동을 먼저 요청해보세요.':mode==='mine'?'활동을 요청하거나 관심 있는 요청에 마음을 보태보세요.':'하고 싶었던 활동 하나를 적어보세요.\n같은 생각을 한 이웃이 기다리고 있을지도 몰라요.'}</p><div className="empty-actions">{hasFilters&&<button className="button button-outline" onClick={clearFilters}>조건 초기화</button>}{loadError?<button className="button button-primary" onClick={refreshClick}>다시 불러오기</button>:<button className="button button-primary" onClick={createRequest} disabled={!snapshot}><Plus size={17}/> 활동 요청하기</button>}{mode!=='examples'&&!hasFilters&&<button className="text-button" onClick={()=>chooseMode('examples')}>예시 둘러보기 <ArrowRight size={16}/></button>}</div></div>}
      </section>
      <section className="bottom-invitation"><div className="invitation-icon"><Sprout size={35}/></div><div><h2>딱 맞는 활동이 없었다면,<br className="mobile-only"/> 직접 열어달라고 해보세요.</h2><p>작은 바람 하나가 우리 동네의 새로운 취미가 될 수 있어요.</p></div><button className="button button-primary" onClick={createRequest} disabled={!snapshot}>내 바람 적어보기 <Plus size={18}/></button></section>
    </main>
    <footer className="site-footer"><div><span className="footer-brand"><Flower size={23}/>열어줘.</span><p>하고 싶은 일이 모이는 곳</p></div><p>관심을 모으고, 조건을 확인하고, 함께 시작해요.<br/>참가 확정은 결제·외부 예약 완료를 의미하지 않아요.</p><button className="text-button" onClick={()=>setOverlay({kind:'how'})}>이용 방법 <ArrowUpRight size={15}/></button></footer>
    {notice&&!overlay&&<div className={`toast toast-${notice.tone}`} role={notice.tone==='error'?'alert':'status'}>{notice.tone==='success'?<CheckCircle2 size={19}/>:<CircleHelp size={19}/>}<span>{notice.text}</span><button className="icon-button" onClick={()=>setNotice(null)} aria-label="알림 닫기"><X size={16}/></button></div>}
    {overlay&&<Modal key={`${overlay.kind}-${'id'in overlay?overlay.id:''}`} title={title} onClose={closeOverlay} onBack={overlay.kind!=='detail'&&'id'in overlay?backToDetail:undefined} wide={overlay.kind==='detail'||overlay.kind==='request'||overlay.kind==='proposal'} busy={busy}>
      {notice&&<div className={`modal-notice modal-notice-${notice.tone}`} role={notice.tone==='error'?'alert':'status'}>{notice.tone==='success'?<CheckCircle2 size={18}/>:<CircleHelp size={18}/>}<span>{notice.text}</span><button type="button" className="icon-button" onClick={()=>setNotice(null)} aria-label="알림 닫기"><X size={15}/></button></div>}
      {loadError&&overlay.kind!=='detail'&&<div className="load-error" role="alert"><span>{loadError}</span><button type="button" className="text-button" onClick={refreshClick} disabled={loading||busy}>새로고침</button></div>}
      {overlay.kind==='request'&&<RequestForm busy={busy} now={now} draftScope={viewer?.draftScope} onRefresh={refresh} submit={async value=>{const result=await command(value,'요청을 올렸어요. 같은 마음의 이웃을 기다려봐요.');chooseMode('actual');if(result.requestId){setOverlay({kind:'detail',id:result.requestId});window.history.replaceState(null,'',appPath(result.requestId));}else setOverlay(null);}}/>}
      {overlay.kind==='profile'&&<ProfileForm busy={busy} draftScope={viewer?.draftScope} onRefresh={refresh} nickname={viewer?.profileReady?viewer.nickname:''} submit={async value=>{await command(value,'닉네임을 저장했어요.');const next=pendingIntent.current;pendingIntent.current=null;setOverlay(null);if(next){try{await runIntent(next);}catch(error){reportActionError(error);}}}}/>}
      {overlay.kind==='signin'&&<SignInMessage href={loginHref}/>}
      {overlay.kind==='how'&&<div className="how-content"><p className="how-lead">찾아도 없던 그 활동,<br/><strong>우리끼리 먼저 모아봐요.</strong></p>{[{n:'01',icon:MessageCircle,title:'하고 싶은 활동을 적어요',text:'동네, 희망 시간, 예산을 적어 요청해요. 같은 활동을 원하는 이웃은 관심을 눌러 마음을 보태요.'},{n:'02',icon:Sprout,title:'운영자의 제안을 받아요',text:'공방과 강사가 날짜·장소·가격을 제안해요. 요청자가 조건을 살펴보고 제안 하나를 선택해요.'},{n:'03',icon:Users,title:'내 조건에 맞으면 참가해요',text:'확정된 조건을 다시 읽고 각자 참가 의사를 기록해요. 관심을 누른 것만으로 참가가 확정되지는 않아요.'}].map(step=><div className="how-step" key={step.n}><span><step.icon size={22}/></span><div><small>STEP {step.n}</small><h3>{step.title}</h3><p>{step.text}</p></div></div>)}<div className="form-note"><CircleHelp size={18}/><span>결제·정산·외부 예약은 제공하지 않아요. 운영자 정보는 직접 작성한 내용이며, 예시 글은 실제 모집과 구분해 표시해요.</span></div><button className="button button-primary full-width" onClick={createRequest} disabled={!snapshot}>첫 활동 요청해보기 <ArrowRight size={17}/></button></div>}
      {overlay.kind==='detail'&&!overlay.example&&<div className="detail-refresh"><div className="refresh-status"><span role="status">{loading?'최신 상태 확인 중…':lastChecked?`최근 확인 ${lastChecked}`:''}</span><button className="text-button" onClick={refreshClick} disabled={loading||busy}><RefreshCw size={14} className={loading?'spin':''}/> 새로고침</button></div>{loadError&&<p className="load-error" role="alert">{loadError}</p>}</div>}
      {overlay.kind==='detail'&&activeRequest&&<RequestDetail request={activeRequest} busy={busy} now={now} onProtected={openProtected} onOverlay={showOverlay} onNewRequest={createRequest} onInterest={()=>protect({kind:'interest',requestId:activeRequest.id,interested:!activeRequest.isInterested})} onShare={()=>{const url=new URL(window.location.href);url.search='';url.searchParams.set('request',activeRequest.id);if(!navigator.clipboard?.writeText){setNotice({text:'이 브라우저에서는 링크 복사를 지원하지 않아요.',tone:'error'});return;}navigator.clipboard.writeText(url.toString()).then(()=>setNotice({text:'요청 링크를 복사했어요.',tone:'success'})).catch(()=>setNotice({text:'링크를 복사하지 못했어요. 브라우저 권한을 확인해주세요.',tone:'error'}));}}/>}
      {overlay.kind==='proposal'&&activeRequest&&<ProposalForm request={activeRequest} busy={busy} now={now} draftScope={viewer?.draftScope} onRefresh={refresh} submit={async value=>{await command(value,'제안을 보냈어요. 요청자가 조건을 살펴볼 거예요.');backToDetail();}}/>}
      {overlay.kind==='cancel'&&activeRequest&&<CancelForm request={activeRequest} busy={busy} draftScope={viewer?.draftScope} onRefresh={refresh} submit={async value=>{await command(value,'요청을 취소했어요.');backToDetail();}}/>}
      {['choose','confirm','unconfirm','withdraw','complete'].includes(overlay.kind)&&activeRequest&&activeProposal&&<DecisionForm kind={overlay.kind as 'choose'|'confirm'|'unconfirm'|'withdraw'|'complete'} request={activeRequest} proposal={activeProposal} busy={busy} submit={async value=>{const text=value.action==='chooseProposal'?'제안을 선택했어요. 참가 조건을 확인하고 각자 확정할 수 있어요.':value.action==='confirm'?'내 참가 의사를 기록했어요.':value.action==='unconfirm'?'내 참가를 취소했어요.':value.action==='complete'?'진행 완료로 기록했어요.':'제안을 철회했어요.';await command(value,text);backToDetail();}}/>}
      {'id'in overlay&&!activeRequest&&<div className="empty-state"><p>최신 요청 정보를 불러올 수 없어요.</p><button className="button button-outline" onClick={refreshClick}>다시 불러오기</button></div>}
      {'proposalId'in overlay&&activeRequest&&!activeProposal&&<div className="empty-state"><p>이 제안이 철회되었거나 현재 상태가 바뀌었어요. 요청에서 최신 내용을 확인해주세요.</p><button className="button button-outline" onClick={backToDetail}>최신 요청으로 돌아가기</button></div>}
    </Modal>}
  </div>;
}
