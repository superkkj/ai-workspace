export const CATEGORIES = [
  { id: 'craft', label: '공예', icon: 'palette' },
  { id: 'cooking', label: '요리·베이킹', icon: 'chef' },
  { id: 'sports', label: '운동', icon: 'activity' },
  { id: 'culture', label: '문화·취미', icon: 'music' },
  { id: 'learning', label: '배움', icon: 'book' },
  { id: 'outdoor', label: '아웃도어', icon: 'mountain' },
] as const;

export type Category = (typeof CATEGORIES)[number]['id'];
export type RequestStatus = 'open' | 'confirming' | 'completed' | 'cancelled' | 'expired';

export type Viewer = {
  signedIn: boolean;
  nickname: string;
  profileReady: boolean;
  /** Opaque per-account label for local drafts; never an authentication token. */
  draftScope: string | null;
  provider?: 'google' | 'chatgpt' | null;
};

export type RequestInput = {
  title: string;
  description: string;
  category: Category;
  region: string;
  preferredTime: string;
  budget: number;
  targetPeople: number;
  deadline: string;
};

export type ProposalInput = {
  providerName: string;
  title: string;
  description: string;
  price: number;
  startsAt: string;
  durationMinutes: number;
  location: string;
  minParticipants: number;
  capacity: number;
  bookingUrl: string;
};

export type ProposalView = ProposalInput & {
  id: string;
  nickname: string;
  createdAt: string;
  isMine: boolean;
  isSelected: boolean;
  confirmedCount: number;
};

export type RequestView = RequestInput & {
  id: string;
  nickname: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  isMine: boolean;
  isInterested: boolean;
  isConfirmed: boolean;
  interestCount: number;
  confirmedCount: number;
  /** Only returned to the request owner and selected provider. Never public. */
  confirmedParticipants?: string[];
  selectedProposalId: string | null;
  cancellationReason: string | null;
  proposals: ProposalView[];
  isExample?: boolean;
};

export type PlatformSnapshot = {
  viewer: Viewer;
  requests: RequestView[];
  serverTime: string;
};

export type PlatformCommand =
  | { action: 'profile'; nickname: string }
  | { action: 'createRequest'; operationId?: string; input: RequestInput }
  | { action: 'interest'; requestId: string; interested: boolean }
  | { action: 'createProposal'; requestId: string; input: ProposalInput }
  | { action: 'chooseProposal'; requestId: string; proposalId: string }
  | { action: 'withdrawProposal'; requestId: string; proposalId: string }
  | { action: 'confirm'; requestId: string }
  | { action: 'unconfirm'; requestId: string }
  | { action: 'cancel'; requestId: string; reason: string }
  | { action: 'complete'; requestId: string };

export type CommandResult = { ok: true; requestId?: string };
export type ApiError = { error: string; code: string };

export const STATUS_LABELS: Record<RequestStatus, string> = {
  open: '함께 모으는 중',
  confirming: '참가 확정 중',
  completed: '함께한 모임',
  cancelled: '취소된 요청',
  expired: '모집 마감',
};
