# 열어줘 개발 안내

원하는 활동·동네·시간·예산을 요청하고, 관심 참여자를 모아 운영자의 제안을 받고, 각자 참가를 확정하는 첫 버전입니다.

공통 개발 규칙과 기획·검사 기록은 [superkkj/ai-workspace](https://github.com/superkkj/ai-workspace)에 있습니다. GitHub에서 이 프로젝트의 위치는 `apps/yeoreojwo/`입니다.

## 기능 범위

- 활동 요청, 지역·분야·문자 검색, 관심 등록·취소. 실제 요청 검색어 2자 이상은 서버 DB에서 최근 공개 목록 밖까지 검색하며 결과는 200개로 제한합니다.
- 운영자 제안, 요청자의 한 제안 선택, 조건 재확인 후 참가 확정·취소.
- 내 활동, 취소 이유와 완료 상태, 실제 DB 영속 저장.
- 요청자와 선택된 운영자에게만 확정 참가자 **공개 닉네임** 표시. 일반 방문자와 일반 참가자는 확정 인원 수만 봅니다.
- 계정별 최근 24시간 새 활동 요청은 10건까지만 작성 가능. 저장 응답이 유실된 같은 요청의 재확인은 새 작성으로 계산되지 않습니다.
- 화면 이해용 예시 분리. 예시 인원은 실제 참여자가 아닙니다.

참가 확정은 이 서비스 안의 의사 표현입니다. 결제·외부 예약·환불·문자 발송은 처리하지 않습니다.

## 배포 상태와 검증 경계

2026-11-19 GitHub [PR #1](https://github.com/superkkj/ai-workspace/pull/1)을 통해 위 운영 개선 소스가 `main`에 병합됐고 [최종 CI](https://github.com/superkkj/ai-workspace/actions/runs/44467428520)에서 테스트 56개, HTTP 15개, 브라우저 6개, 타입 검사·빌드가 통과했습니다. **기존 Sites 앱은 소유자 전용이며 새 코드의 Sites 배포는 이 대화에서 수행·확인하지 못했습니다.** GitHub 코드가 곧바로 라이브 사이트에 반영됐다고 가정하지 마세요. 실계정 다인 사용과 사용자 PC 구동도 별도 검증 항목입니다.

## Google 계정 로그인 (설정 후 활성화)

**보안 주의:** `GOOGLE_CLIENT_ID`가 설정된 독립 Google OAuth 배포에서는 기존 ChatGPT 프록시 헤더 인증을 자동으로 비활성화합니다. 일반 공개 Cloudflare Worker에서 클라이언트가 보낸 `oai-authenticated-user-id` 등의 헤더를 신원 증명으로 사용하면 안 됩니다. 기존 ChatGPT Sites 전용 인증은 Google 설정이 없는, 접근 통제된 기존 Sites 배포에만 한정합니다. 이 두 로그인 방식을 하나의 공개 배포에서 동시에 허용하는 기능은 구현하지 않았습니다.

**배포 전제:** 현재 호스팅 사이트는 소유자 전용이고, 이 대화에서는 Google Cloud·Cloudflare의 외부 계정 로그인과 비밀 설정을 대행할 수 없습니다. 새로운 Google OAuth 사이트를 독립 호스팅하려면 실제 호스트명·D1 연결 및 별도 배포 권한이 먼저 필요합니다. 기존 Sites의 소유자 전용 설정을 무단 변경하지 않습니다.


Google OAuth 2.0 / OpenID Connect 로그인 코드는 `app/api/auth/google/`에 있고 기존 ChatGPT 로그인은 그대로 보존합니다. 새 Google 계정은 Google의 불변 `sub`를 `auth_accounts`의 내부 사용자 UUID와 연결합니다. **동일한 이메일이어도 기존 ChatGPT 계정 활동과 자동 연결하지 않습니다.** 계정 연결·이전 작업은 신원 확인 정책과 별도 마이그레이션이 정해질 때까지 진행하지 않습니다.

1. Google Cloud Console의 Google Auth Platform에서 동의 화면과 **웹 애플리케이션 OAuth 클라이언트**를 만듭니다. 필요한 범위는 `openid email profile`이며 Gmail·Drive 접근 권한은 필요하지 않습니다.
2. **실제 HTTPS 도메인**의 정확한 승인된 리디렉션 URI를 `https://<APP_HOST>/api/auth/google/callback`으로 등록합니다. 도메인/경로의 철자와 슬래시가 정확히 일치해야 합니다. 로컬 HTTP로 Google OAuth를 시험하려면 현재 HTTPS 고정 설계를 먼저 재검토해야 합니다.
3. 배포 비밀값 관리 화면에 `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`를 설정합니다. **절대로 GitHub, 프런트엔드 코드, CI 로그, 채팅에 Secret을 올리지 않습니다.** 설정이 없으면 Google 로그인 시작은 503 안내를 반환하며 기존 ChatGPT 로그인은 유지됩니다.
4. 기존 D1 DB에 새로운 `drizzle/0002_google_auth.sql` 마이그레이션을 **한 번만** 적용합니다. 신규 DB는 0000→0001→0002 순서입니다. 기존 프로필·요청·참가 테이블은 변경하지 않습니다.
5. HTTPS 배포 후 **Google 새 계정 로그인 → 닉네임 설정 → 요청 작성 → 새로고침 → 로그아웃 → 재로그인 → 동일 활동 확인**을 실제 계정으로 검증합니다. 운영 배포가 소유자 전용이면 방문자 공개를 별도로 허용하기 전에는 다른 사람 로그인 검증이 불가능합니다.

구현은 authorization code, PKCE(S256), state·nonce, Google RS256 ID 토큰 서명·발급자·수신자·만료 확인을 사용합니다. 앱 세션은 원문을 DB에 저장하지 않고 SHA-256 해시로 저장하며 7일 만료·서버 로그아웃 삭제·HttpOnly/Secure/SameSite=Lax 쿠키를 사용합니다. Google 토큰을 DB에 저장하지 않습니다.

**주의:** Google OAuth 코드를 GitHub에 반영하는 것과 실제 Google 로그인이 동작하는 것은 별개입니다. 현재 OAuth 클라이언트 정보 설정, 새 기능 배포, 실제 구글 계정 검증은 아직 끝나지 않았습니다. 비공개 Sites 접근 제한은 Google OAuth 코드와 별개입니다.

## 최신 상태와 작성 내용

- 목록과 실제 요청 상세의 **새로고침**으로 다른 사람의 제안·참가·취소를 확인합니다. 브라우저 탭으로 돌아오거나 상세를 다시 열 때도 재조회합니다. 상시 실시간 알림은 아닙니다.
- 공유 요청에서 로그인하면 같은 요청과 하려던 작업으로 돌아옵니다. 첫 관심 등록 중 닉네임을 정하면 상세로 돌아와 관심이 반영됩니다. 참가 확정은 날짜·장소·금액과 새 동의 체크를 다시 확인해야 합니다.
- 요청·제안·닉네임·취소 사유는 **현재 브라우저 탭과 로그인 계정별**로 초안을 보관합니다. 닫기·Escape·새로고침 후 다시 열면 복원됩니다. 저장 성공 또는 **초안 지우고 새로 쓰기**로 정리하며 동의 체크박스는 보관하지 않습니다. 다른 탭·기기 사이에는 동기화하지 않습니다.
- 저장 결과를 확인하지 못한 요청은 처음 보낸 내용이 고정됩니다. **같은 요청의 저장 결과 다시 확인**을 누르면 같은 생성 키로 확인하여 요청을 중복 생성하지 않습니다. 별개의 새 요청을 쓰려면 안내를 읽고 명시적으로 초안을 지웁니다. 자동으로 쓰기 요청을 재전송하지 않습니다.
- **변경은 저장했지만 최신 정보를 불러오지 못했어요** 안내가 나오면 새로고침만 합니다. 동일한 내용을 새 요청으로 다시 작성하지 않습니다.
- 브라우저 저장 공간이 차거나 차단되면 새로고침 후 초안 보관을 보장할 수 없다는 안내를 보여줍니다. 서버에 저장한 요청은 초안과 별개입니다.

## 실행 환경

- Node.js 24 권장. 테스트는 내장 `node:sqlite`를 사용합니다.
- npm과 저장된 `package-lock.json`을 사용합니다.
- React, TypeScript, Vinext, Cloudflare D1. 설치한 정확한 버전은 `package.json`과 잠금 파일을 기준으로 합니다.
- API 키가 필요한 외부 AI·지도 서비스는 사용하지 않습니다.

프로젝트 폴더에서 `npm ci`로 의존성을 설치합니다. `npm run typecheck`, `npm test`, `npm run build`가 검사 명령입니다. 실제 실행 결과는 저장소의 `docs/ai/CHECKS.md`에서 확인합니다.

## 로컬 데이터베이스

`npm run build` 이후 `dist/server/wrangler.json`이 생성됩니다. `drizzle/`의 SQL 마이그레이션을 순서대로 로컬 D1에 적용해야 합니다. 적용한 파일을 다시 실행하지 않습니다. 현재 마이그레이션은 `0000_famous_toro.sql`과 `0001_request_operation.sql`입니다. 기존 첫 버전 DB에는 새 `0001`만 적용합니다. 새 DB에는 두 파일을 순서대로 적용합니다. `0001`은 nullable 생성 키와 사용자별 고유 인덱스를 추가하고 기존 요청을 유지합니다.

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_famous_toro.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_request_operation.sql
```

그다음 `npm run dev`를 실행하고 터미널에 표시된 주소로 접속합니다. Windows·macOS 등 일반 로컬 환경에서는 starter의 loopback 전용 로그인 모의 기능을 사용할 수 있습니다. 호스팅에서는 플랫폼의 실제 인증을 사용합니다. 앱 서버를 일반 공개 서버로 임의 실행하면서 인증 헤더를 신뢰해서는 안 됩니다.

로컬 데이터와 호스팅 데이터는 별개입니다. `.wrangler/`, `.sites-runtime/`, `.env*`, `.dev.vars*`, `node_modules/`, `dist/`는 커밋하지 않습니다.

## 처음 확인하는 순서

1. 예시 둘러보기에서 어떤 요청·제안인지 확인합니다.
2. 로그인하고 공개 닉네임을 설정합니다.
3. 실제 요청을 작성하고 새로고침 후에도 남는지 확인합니다.
4. 다른 사용자가 관심과 운영 제안을 남기면 요청 작성자가 하나를 선택합니다.
5. 참가자는 일정·장소·가격을 확인하고 별도로 참가를 확정합니다.

요청 작성자는 자신의 요청에 운영 제안을 제출할 수 없습니다. 소유자 전용 호스팅에서는 실제 다인 사용을 위해 추후 방문 권한을 설정해야 합니다. 테스트의 합성 사용자를 실서비스 사용자로 표시하지 않습니다.

## HTTP 통합 검사

로컬 D1 마이그레이션과 미리보기 서버를 먼저 준비한 뒤 `npm run test:http -- http://127.0.0.1:4173`을 실행합니다. 포트는 실제 로컬 서버 포트로 맞춥니다. 이 스크립트는 HTTP loopback 주소만 허용하고 합성 사용자로 실제 API·D1 흐름을 확인한 뒤 자신이 만든 데이터만 정리합니다. 호스팅 환경의 인증 계정 검증과는 별도입니다.

GitHub CI는 구버전 로컬 프록시의 연결 문제를 피하기 위해 [독립 HTTP 검사 런타임](https://github.com/superkkj/ai-workspace/tree/main/.github/tools/yeoreojwo-http-runtime)을 사용합니다. 같은 검사를 재현할 때는 해당 안내와 workflow를 따르고, `YEOREOJWO_WRANGLER_CLI`를 설정해 DB 준비·서버·테스트 정리가 같은 CLI와 상태 저장 경로를 사용하도록 합니다. 앱 빌드용 의존성과 호스팅 인증은 바꾸지 않습니다.

## CI 브라우저 회귀 검사

동일한 GitHub workflow는 별도 검사 런타임의 Playwright/Chromium으로 역할별 브라우저 컨텍스트, 로그인 복귀 경로와 닉네임 이후 관심, 제안 선택 후 별도 확정·취소, 닫기·Escape·재접속 초안, 늦은 응답, 저장 응답 유실 및 저장 후 조회 실패를 확인합니다. 실제 빌드와 로컬 D1을 사용하며 합성 사용자만 생성하고 종료 시 정리합니다. 쿠키·토큰·인증 상태 파일을 Git에 저장하지 않습니다.

이 검사는 **실제 호스팅의 로그인 제공자·실제 계정 로그인 검증을 대신하지 않습니다.** 실행 명령은 `.github/tools/yeoreojwo-http-runtime/README.md`와 workflow, 최신 성공·실패 기록은 `docs/ai/CHECKS.md`를 참고합니다.

## 주요 파일

- `app/components/`: 탐색·상세·입력·확정 화면.
- `app/api/platform/route.ts`: 인증과 HTTP 요청 경계.
- `lib/contracts.ts`, `lib/domain.ts`, `lib/platform-service.ts`: 공개 형식·검증·서버 업무 규칙.
- `lib/platform-client.ts`, `lib/navigation.ts`, `lib/form-drafts.ts`: 조회·오류 분류, 안전한 작업 복귀, 탭별 초안.
- `db/schema.ts`, `drizzle/`: DB 스키마와 버전 관리되는 마이그레이션.
- `tests/`: 실제 SQL에 기반한 상태·권한·경쟁 신청 회귀 검사.

프레임워크와 Sites 통합 파일의 기존 라이선스는 보존합니다. `README.md`·기획서의 설명만으로 테스트나 배포가 완료된 것으로 판단하지 않습니다.
