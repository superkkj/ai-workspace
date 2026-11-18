import type { RequestView } from './contracts';

/** Explanatory examples only. Never inserted into the database or counted as real demand. */
export function getExamples(reference = new Date().toISOString()): RequestView[] {
  const now = new Date(reference).getTime();
  const at = (days: number) => new Date(now + days * 86_400_000).toISOString();
  const common = {
    nickname: '예시 이웃', status: 'open' as const, createdAt: at(-2), updatedAt: at(-1),
    isMine: false, isInterested: false, isConfirmed: false, confirmedCount: 0,
    selectedProposalId: null, cancellationReason: null, proposals: [], isExample: true,
  };
  const examples: RequestView[] = [
    { ...common, id: 'example-craft', title: '퇴근 후, 나만의 도자기 컵 만들어요', category: 'craft', region: '서울 마포구', preferredTime: '평일 저녁 7시 이후', budget: 45000, targetPeople: 6, interestCount: 4, deadline: at(7), description: '흙을 만지면서 하루를 차분하게 마무리하고 싶어요. 물레가 처음인 사람도 함께할 수 있는 도자기 수업을 요청해요.\n\n작은 머그컵 하나를 완성하는 과정이면 좋겠어요. 재료비와 소성비를 포함한 제안을 기다려요.' },
    { ...common, id: 'example-cooking', title: '주말 아침엔 갓 구운 소금빵', category: 'cooking', region: '인천 부평구', preferredTime: '토요일 오전 10시쯤', budget: 40000, targetPeople: 8, interestCount: 6, deadline: at(10), description: '집에서도 다시 만들 수 있는 소금빵을 배우고 싶어요. 베이킹을 처음 해보는 이웃도 편하게 함께해요.\n\n직접 반죽하고, 완성한 빵을 포장해 가져갈 수 있는 수업을 원해요.' },
    { ...common, id: 'example-sports', title: '몸도 마음도 가벼운 저녁 요가', category: 'sports', region: '서울 성동구', preferredTime: '수요일 저녁 8시', budget: 25000, targetPeople: 6, interestCount: 3, deadline: at(6), description: '오랫동안 앉아 일하는 이웃끼리 기초 요가를 배우고 싶어요. 어려운 동작보다는 천천히 몸을 움직이는 입문 수업이면 좋아요.\n\n매트 대여 여부를 함께 알려주세요.' },
    { ...common, id: 'example-culture', title: '좋아하는 노래, 우쿨렐레로 한 곡', category: 'culture', region: '경기 수원시', preferredTime: '일요일 오후', budget: 35000, targetPeople: 5, interestCount: 2, deadline: at(12), description: '악기를 처음 배우는 사람들끼리 쉬운 노래 한 곡을 연주해 보고 싶어요. 악보를 읽지 못해도 참여할 수 있으면 좋겠어요.\n\n처음에는 악기 대여가 가능한 수업을 찾고 있어요.' },
    { ...common, id: 'example-learning', title: '여행 사진, 스마트폰으로 더 잘 찍기', category: 'learning', region: '부산 수영구', preferredTime: '주말 오후 2시 이후', budget: 30000, targetPeople: 6, interestCount: 4, deadline: at(8), description: '매일 쓰는 스마트폰으로 빛과 구도를 배우고 싶어요. 가까운 곳을 함께 걸으며 찍고, 사진을 보며 이야기하는 수업이면 좋겠어요.\n\n특정 기종 없이 참여할 수 있는 기초 수업을 요청해요.' },
    { ...common, id: 'example-outdoor', title: '초보끼리 천천히, 동네 숲 산책', category: 'outdoor', region: '대전 유성구', preferredTime: '토요일 오전', budget: 15000, targetPeople: 8, interestCount: 5, deadline: at(9), description: '동네 숲에서 나무와 계절을 알아가는 가벼운 산책을 하고 싶어요. 빠르게 걷는 등산보다, 천천히 관찰하는 시간이 좋아요.\n\n걷는 거리와 준비물, 비가 올 때 일정을 제안에 함께 적어주세요.' },
  ];
  examples[0].proposals = [{
    id: 'example-pottery-offer', providerName: '예시 도자기 공방', nickname: '예시 운영자',
    title: '처음 만나는 물레, 나만의 머그컵',
    description: '제안 화면을 보여주는 가상 수업이에요. 재료와 소성 비용을 포함하고, 완성품 수령 방법은 수업에서 안내하는 구성의 예시예요.',
    price: 43000, startsAt: at(10), durationMinutes: 120, location: '서울 마포구 · 예시 공방',
    minParticipants: 4, capacity: 6, bookingUrl: '', createdAt: at(-1),
    isMine: false, isSelected: false, confirmedCount: 0,
  }];
  examples[1].status = 'confirming';
  examples[1].selectedProposalId = 'example-baking-offer';
  examples[1].confirmedCount = 4;
  examples[1].proposals = [{
    id: 'example-baking-offer', providerName: '예시 베이킹 스튜디오', nickname: '예시 운영자',
    title: '소금빵 네 개로 시작하는 주말',
    description: '참가 조건과 확정 인원을 보여주는 가상 수업이에요. 반죽부터 포장까지 함께하며 재료와 포장 비용을 포함하는 예시예요.',
    price: 38000, startsAt: at(12), durationMinutes: 150, location: '인천 부평구 · 예시 스튜디오',
    minParticipants: 4, capacity: 8, bookingUrl: '', createdAt: at(-1),
    isMine: false, isSelected: true, confirmedCount: 4,
  }];
  return examples;
}
