# 열어줘 HTTP 검사 런타임

GitHub Actions에서 실제 빌드 산출물과 로컬 D1을 검사할 때 사용하는 Wrangler를 별도 잠금 파일로 고정합니다. 앱의 Vinext·Vite 플러그인과 빌드 의존성은 `apps/yeoreojwo/package-lock.json`을 그대로 사용합니다.

## 분리한 이유

- 기존 Wrangler 4.92.0에서 요청 본문을 읽기 전에 401·403을 반환하면 다음 POST가 평문 503으로 실패하는 조건을 확인했습니다.
- [Cloudflare의 원문 이슈](https://github.com/cloudflare/workers-sdk/issues/15203)는 Wrangler 4.151.2의 새 workerd에서 해당 연결 문제를 수정했다고 기록합니다.
- 앱의 Wrangler를 직접 올리는 시도는 기존 Vite 플러그인의 `workers-types` peer 요구와 충돌했습니다. 이 디렉터리는 앱과 독립적인 npm 프로젝트이므로 빌드용 의존성을 강제로 덮어쓰지 않습니다.

## 실행과 적용 범위

Node.js 24에서 이 디렉터리의 `npm ci`로 설치합니다. 실제 실행 순서와 명령은 [검사 workflow](../../workflows/yeoreojwo.yml)를 기준으로 합니다.

`YEOREOJWO_WRANGLER_CLI`를 이 디렉터리의 `node_modules/wrangler/bin/wrangler.js` 절대 경로로 설정한 뒤, 앱 폴더에서 DB 마이그레이션·로컬 서버·테스트 정리 모두 같은 CLI를 사용합니다. 상태 저장 경로도 모두 `.wrangler/state`로 맞춥니다. `scripts/smoke-http.mjs`는 이 변수에 지정한 CLI로 자신이 만든 로컬 기록만 정리합니다.

생성된 `dist/server/wrangler.json`의 `no_bundle` 설정은 유지합니다. 요청을 자동 재시도하거나 인증·Origin 검사를 완화하지 않습니다. 8 KiB 본문의 인증·출처 거절 직후 다음 POST가 정상 응답하는 20쌍 검사와 기존 HTTP 사용 흐름 검사를 함께 실행합니다.

새 Wrangler가 제거한 `legacy_env` 필드 때문에 `prepare-config.mjs`를 빌드 후 실행합니다. 이 스크립트는 생성된 로컬 검사 설정의 `legacy_env: true`만 제거합니다. 새 도구의 기본 동작과 같으며, 다른 값이면 실패합니다. Worker JS·정적 파일·DB 바인딩·`no_bundle`을 수정하지 않고, 호스팅에 배포한 설정도 변경하지 않습니다. 관련 설명은 [Cloudflare 환경 설정 문서](https://developers.cloudflare.com/workers/wrangler/environments/)를 참고합니다.

이 도구는 HTTP loopback 테스트용입니다. 실제 호스팅의 인증, 원격 D1 부하, 다계정 브라우저 사용을 검증한 것으로 보지 않습니다. 실제 성공·실패 기록은 [CHECKS.md](../../../docs/ai/CHECKS.md)에 남깁니다.
