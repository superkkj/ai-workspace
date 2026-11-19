/**
 * CI browser regression checks against the built HTTP loopback app and local D1.
 * Synthetic identity headers are confined to separate local browser contexts.
 * This does not exercise ChatGPT's hosted login provider or save auth-state files.
 * Browser installation/execution belongs to GitHub CI, not the managed preview.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:4173');
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password) {
  throw new Error('Browser checks only accept an HTTP loopback URL.');
}
if (process.env.SITES_MANAGED_LINUX_CONTAINER === '1') {
  throw new Error('Use the managed preview for local browser work; run this regression script in GitHub CI.');
}
const modulePath = process.env.YEOREOJWO_PLAYWRIGHT_MODULE;
assert.ok(modulePath, 'Set YEOREOJWO_PLAYWRIGHT_MODULE to the isolated pinned Playwright index.mjs.');
const { chromium } = await import(pathToFileURL(resolve(modulePath)).href);
const wranglerCli = process.env.YEOREOJWO_WRANGLER_CLI;
assert.ok(wranglerCli, 'Use the same isolated Wrangler CLI as the local HTTP server.');

const suffix = randomUUID();
const actors = ['owner', 'provider', 'newcomer', 'another'].map(role => `browser-${role}-${suffix}`);
const [owner, provider, newcomer, another] = actors;
const headersFor = actor => actor ? {
  'oai-authenticated-user-id': actor,
  'oai-authenticated-user-email': `${actor}@example.invalid`,
} : {};
const requestTitle = `브라우저 회귀 모임 ${suffix.slice(0, 8)}`;
const proposalTitle = '함께 만드는 브라우저 검증 수업';
const proposalPlace = '브라우저 검증 공간';
let browser;
let passed = 0;
let stage = 'preparing local fixtures';
const diagnostics = [];
const pendingDiagnostics = new Set();
let contextNumber = 0;
const pass = name => { passed++; console.log(`PASS browser: ${name}`); };
const dialog = page => page.getByRole('dialog');
const safeDiagnostic = value => {
  let text = String(value);
  for (const actor of actors) text = text.replaceAll(actor, '[synthetic-user]');
  return text.replace(/[^\s@]+@[^\s@]+/g, '[email]')
    .replace(/https?:\/\/[^\s)]+/g, value => { try { return new URL(value).pathname; } catch { return '[url]'; } })
    .replace(/resumeKey=[^&\s]+/g, 'resumeKey=[redacted]')
    .replace(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/gi, '[uuid]').slice(0, 500);
};
function recordDiagnostic(event) {
  diagnostics.push(event);
  if (diagnostics.length > 40) diagnostics.shift();
}

async function api(actor, command, focusedRequestId) {
  const endpoint = new URL('/api/platform', base);
  if (focusedRequestId) endpoint.searchParams.set('request', focusedRequestId);
  const response = await fetch(endpoint, {
    method: command ? 'POST' : 'GET',
    headers: { ...headersFor(actor), ...(command ? { 'Content-Type': 'application/json', Origin: base.origin } : {}) },
    body: command ? JSON.stringify(command) : undefined,
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`Local fixture ${command?.action ?? 'GET snapshot'} returned HTTP ${response.status} with non-JSON data.`); }
  assert.equal(response.status, 200, `Local fixture ${command?.action ?? 'GET snapshot'} (focused=${Boolean(focusedRequestId)}) returned HTTP ${response.status}, code=${/^[A-Z_]{1,60}$/.test(data.code) ? data.code : 'unknown'}.`);
  return data;
}
async function requestState(actor, id) {
  const snapshot = await api(actor);
  const serialized = JSON.stringify(snapshot);
  for (const identity of actors) assert.equal(serialized.includes(identity), false, 'Raw identity must not be in the public DTO.');
  assert.equal(serialized.includes('@example.invalid'), false);
  return snapshot.requests.find(request => request.id === id);
}
async function eventually(read, message) {
  const until = Date.now() + 12_000;
  let lastError;
  while (Date.now() < until) {
    try { if (await read()) return; } catch (error) { lastError = error; }
    await delay(100); // Poll assertions only. Writes are never retried by this helper.
  }
  throw new Error(message, { cause: lastError });
}
async function bounded(promise, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), 12_000); })]);
  } finally { clearTimeout(timer); }
}
async function pageFor(actor = null) {
  const context = await browser.newContext({
    extraHTTPHeaders: headersFor(actor), viewport: { width: 1280, height: 900 },
    locale: 'ko-KR', timezoneId: 'Asia/Seoul', serviceWorkers: 'block',
  });
  // Never send synthetic identity headers to an external service.
  await context.route('**/*', route => new URL(route.request().url()).origin === base.origin
    ? route.continue() : route.abort('blockedbyclient'));
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  const name = `context-${++contextNumber}`;
  page.on('pageerror', error => recordDiagnostic({ context: name, event: 'pageerror', name: safeDiagnostic(error.name), message: safeDiagnostic(error.message) }));
  page.on('requestfailed', request => {
    if (new URL(request.url()).pathname === '/api/platform') recordDiagnostic({ context: name, event: 'requestfailed', method: request.method(), path: '/api/platform', error: safeDiagnostic(request.failure()?.errorText ?? 'unknown') });
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname !== '/api/platform') return;
    const event = { context: name, event: 'response', method: response.request().method(), path: '/api/platform', focused: url.searchParams.has('request'), status: response.status() };
    const inspect = response.json().then(data => {
      if (response.status() >= 400) event.code = /^[A-Z_]{1,60}$/.test(data?.code) ? data.code : 'unknown';
      else if (response.request().method() === 'GET') {
        event.signedIn = typeof data?.viewer?.signedIn === 'boolean' ? data.viewer.signedIn : null;
        event.profileReady = typeof data?.viewer?.profileReady === 'boolean' ? data.viewer.profileReady : null;
        event.requestCount = Array.isArray(data?.requests) ? data.requests.length : null;
      }
    }).catch(() => { event.code = 'UNREADABLE_RESPONSE'; }).finally(() => { recordDiagnostic(event); pendingDiagnostics.delete(inspect); });
    pendingDiagnostics.add(inspect);
  });
  return { context, page };
}
async function showRequest(page, id) {
  await page.goto(new URL(`/?request=${encodeURIComponent(id)}`, base).href);
  await dialog(page).getByRole('heading', { name: requestTitle, exact: true }).waitFor();
}
async function openNewRequest(page) {
  await page.locator('.header-create').click();
  await dialog(page).locator('input[name="title"]').waitFor();
}
function platformGet(response) {
  return new URL(response.url()).pathname === '/api/platform' && response.request().method() === 'GET' && response.status() === 200;
}

try {
  for (const [actor, nickname] of [[owner, '브라우저요청자'], [provider, '브라우저운영자'], [another, '브라우저이웃']]) {
    await api(actor, { action: 'profile', nickname });
  }
  const { requestId } = await api(owner, {
    action: 'createRequest', operationId: randomUUID(), input: {
      title: requestTitle, description: '별도 합성 사용자로 실제 브라우저와 로컬 데이터베이스를 검증하는 요청입니다.',
      category: 'craft', region: '검증 동네', preferredTime: '주말 오후', budget: 45000,
      targetPeople: 6, deadline: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    },
  });
  assert.ok(requestId);
  stage = 'authenticated snapshot preflight with and without a shared-link ID';
  for (const [label, actor, focused, profileReady] of [
    ['existing profile with shared link', owner, requestId, true],
    ['new identity without profile', newcomer, undefined, false],
    ['new identity with shared link', newcomer, requestId, false],
  ]) {
    stage = `snapshot preflight: ${label}`;
    const snapshot = await api(actor, undefined, focused);
    assert.equal(snapshot.viewer.signedIn, true, label);
    assert.equal(snapshot.viewer.profileReady, profileReady, label);
    assert.ok(snapshot.requests.some(request => request.id === requestId), label);
    console.log(`PASS browser preflight: ${label}`);
  }
  browser = await chromium.launch({ headless: true });

  stage = 'shared-link login return and first profile continuation';
  const member = await pageFor();
  await showRequest(member.page, requestId);
  await dialog(member.page).getByRole('button', { name: '관심 있어요', exact: true }).click();
  const googleLogin = dialog(member.page).getByRole('link', { name: 'Google 계정으로 로그인' });
  const googleLoginUrl = new URL((await googleLogin.getAttribute('href'))!, base);
  assert.equal(googleLoginUrl.pathname, '/api/auth/google/start');
  assert.equal(googleLoginUrl.searchParams.get('return_to')?.startsWith('/'), true);
  const login = dialog(member.page).getByRole('link', { name: '기존 ChatGPT 로그인' });
  const href = await login.getAttribute('href');
  const loginUrl = new URL(href, base);
  assert.equal(loginUrl.origin, base.origin);
  assert.equal(loginUrl.pathname, '/signin-with-chatgpt');
  const returnPath = loginUrl.searchParams.get('return_to');
  assert.ok(returnPath?.startsWith('/') && !returnPath.startsWith('//'));
  const returnUrl = new URL(returnPath, base);
  assert.equal(returnUrl.origin, base.origin);
  assert.equal(returnUrl.pathname, '/');
  assert.equal(returnUrl.searchParams.get('request'), requestId);
  assert.equal(returnUrl.searchParams.get('resume'), 'interest');
  assert.ok(returnUrl.searchParams.get('resumeKey'));
  // Simulate only the trusted local identity after the provider returns, keeping
  // this tab's explicit interest intent. No real login or account is used.
  await member.context.setExtraHTTPHeaders(headersFor(newcomer));
  await member.page.goto(returnUrl.href);
  await dialog(member.page).locator('input[name="nickname"]').fill('브라우저새이웃');
  await dialog(member.page).getByRole('button', { name: '닉네임 저장하기', exact: true }).click();
  await dialog(member.page).getByRole('heading', { name: requestTitle, exact: true }).waitFor();
  await dialog(member.page).getByRole('button', { name: '관심 취소', exact: true }).waitFor();
  assert.equal((await requestState(newcomer, requestId)).isInterested, true);
  assert.equal((await requestState(owner, requestId)).interestCount, 2);
  pass('same-tab safe login return, nickname setup and explicit first interest');

  stage = 'refresh while a proposal draft is open';
  const operator = await pageFor(provider);
  await showRequest(operator.page, requestId);
  await dialog(operator.page).getByRole('button', { name: '수업 제안하기', exact: true }).click();
  const proposalDraft = dialog(operator.page).locator('input[name="title"]');
  await proposalDraft.fill('새로고침 중에도 보존할 제안 초안');
  await api(another, { action: 'interest', requestId, interested: true });
  const refreshed = operator.page.waitForResponse(platformGet);
  await operator.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await refreshed;
  assert.equal(await proposalDraft.inputValue(), '새로고침 중에도 보존할 제안 초안');
  await dialog(operator.page).getByRole('button', { name: '요청으로 돌아가기', exact: true }).click();
  await eventually(async () => (await dialog(operator.page).locator('.detail-facts').innerText()).includes('3명 / 6명'), 'Returned detail should include the other member’s interest.');

  const requester = await pageFor(owner);
  await showRequest(requester.page, requestId);
  assert.equal(await dialog(requester.page).getByRole('button', { name: '수업 제안하기', exact: true }).count(), 0, 'Requester cannot propose on own request.');
  await api(provider, { action: 'createProposal', requestId, input: {
    providerName: '브라우저검증공방', title: proposalTitle,
    description: '검증용 제안이며 실제 수업이나 외부 예약을 진행하지 않습니다.',
    price: 42000, startsAt: new Date(Date.now() + 9 * 86_400_000).toISOString(), durationMinutes: 90,
    location: proposalPlace, minParticipants: 2, capacity: 3, bookingUrl: '',
  } });
  await dialog(requester.page).getByRole('button', { name: '새로고침', exact: true }).click();
  await dialog(requester.page).getByRole('heading', { name: proposalTitle, exact: true }).waitFor();
  pass('other-user updates on focus/manual refresh without replacing an open draft');

  stage = 'selection, detail reentry and separate confirmation consent';
  await dialog(requester.page).getByRole('button', { name: '제안 선택', exact: true }).click();
  await dialog(requester.page).getByRole('checkbox').check();
  await dialog(requester.page).getByRole('button', { name: '이 제안으로 모집하기', exact: true }).click();
  await dialog(requester.page).getByRole('heading', { name: '함께하기로 한 제안', exact: true }).waitFor();
  assert.equal((await requestState(owner, requestId)).confirmedCount, 0, 'Selecting a proposal does not confirm interested people.');

  await member.page.keyboard.press('Escape');
  await member.page.getByRole('button', { name: `${requestTitle} 상세 보기`, exact: true }).click();
  const confirm = dialog(member.page).getByRole('button', { name: '조건 확인하고 참가 확정', exact: true });
  await confirm.waitFor();
  await member.page.bringToFront();
  await eventually(() => dialog(member.page).getByRole('button', { name: '새로고침', exact: true }).isEnabled(), 'Detail should finish its current refresh before the delayed action check.');
  const actionReadStarted = Promise.withResolvers();
  const releaseActionRead = Promise.withResolvers();
  let interceptedActionRead = false;
  const delayActionRead = async route => {
    if (route.request().method() !== 'GET' || interceptedActionRead) return route.continue();
    interceptedActionRead = true;
    try {
      const response = await route.fetch({ maxRetries: 0, maxRedirects: 0, timeout: 20_000 });
      assert.equal(response.status(), 200);
      actionReadStarted.resolve();
      await releaseActionRead.promise;
      await route.fulfill({ response });
    } catch (error) {
      actionReadStarted.reject(error);
      await route.abort('failed');
    }
  };
  await member.page.route('**/api/platform*', delayActionRead);
  try {
    await confirm.click();
    await bounded(actionReadStarted.promise, 'Opening confirmation should request the latest conditions.');
    const releasedResponse = member.page.waitForResponse(platformGet);
    await member.page.keyboard.press('Escape');
    await dialog(member.page).waitFor({ state: 'hidden' });
    releaseActionRead.resolve();
    await (await releasedResponse).finished();
    // Wait for the released fetch and React render, not an arbitrary long sleep.
    await member.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await dialog(member.page).isVisible(), false, 'A late conditions response must not reopen a dismissed dialog.');
  } finally {
    releaseActionRead.resolve();
    await member.page.unroute('**/api/platform*', delayActionRead);
  }
  await member.page.getByRole('button', { name: `${requestTitle} 상세 보기`, exact: true }).click();
  await confirm.click();
  const terms = dialog(member.page).locator('.conditions');
  assert.ok((await terms.innerText()).includes(proposalPlace));
  assert.ok((await terms.innerText()).includes('42,000원'));
  assert.ok((await terms.innerText()).includes('90분'));
  assert.equal(await dialog(member.page).getByRole('checkbox').isChecked(), false);
  await dialog(member.page).getByRole('button', { name: '이 조건으로 참가할게요', exact: true }).click();
  assert.equal((await requestState(newcomer, requestId)).isConfirmed, false, 'Unchecked consent must block the write.');
  await dialog(member.page).getByRole('checkbox').check();
  await member.page.keyboard.press('Escape');
  await member.page.getByRole('button', { name: `${requestTitle} 상세 보기`, exact: true }).click();
  await dialog(member.page).getByRole('button', { name: '조건 확인하고 참가 확정', exact: true }).click();
  assert.equal(await dialog(member.page).getByRole('checkbox').isChecked(), false, 'Consent is not a saved draft.');
  await dialog(member.page).getByRole('checkbox').check();
  await dialog(member.page).getByRole('button', { name: '이 조건으로 참가할게요', exact: true }).click();
  await dialog(member.page).getByText('내 참가 의사가 기록되었어요', { exact: true }).waitFor();
  assert.equal((await requestState(newcomer, requestId)).isConfirmed, true);
  await dialog(member.page).getByRole('button', { name: '내 참가 취소', exact: true }).click();
  await dialog(member.page).getByRole('checkbox').check();
  await dialog(member.page).getByRole('button', { name: '내 참가 취소하기', exact: true }).click();
  await dialog(member.page).getByRole('button', { name: '조건 확인하고 참가 확정', exact: true }).waitFor();
  assert.equal((await requestState(newcomer, requestId)).isConfirmed, false);
  await showRequest(operator.page, requestId);
  await dialog(operator.page).getByText('내가 운영하는 모임이에요. 운영자는 참가 인원에 포함되지 않아요.', { exact: true }).waitFor();
  assert.equal(await dialog(operator.page).getByRole('button', { name: '조건 확인하고 참가 확정', exact: true }).count(), 0);
  pass('detail reentry, dismissed delayed dialog, visible terms, fresh consent, confirmation/cancellation and operator role');

  stage = 'request draft close, Escape, reload and keyboard/mobile layout';
  await requester.page.goto(base.href);
  await openNewRequest(requester.page);
  const draftTitle = `응답 유실 복구 요청 ${suffix.slice(0, 8)}`;
  await dialog(requester.page).locator('input[name="title"]').fill(draftTitle);
  await dialog(requester.page).locator('input[name="region"]').fill('복구 검증 동네');
  await dialog(requester.page).locator('textarea[name="description"]').fill('창을 닫거나 저장 응답이 유실된 뒤에도 같은 초안을 유지하는 검증입니다.');
  await dialog(requester.page).locator('input[name="preferredTime"]').fill('평일 저녁');
  await requester.page.keyboard.press('Escape');
  await dialog(requester.page).waitFor({ state: 'hidden' });
  await openNewRequest(requester.page);
  assert.equal(await dialog(requester.page).locator('input[name="title"]').inputValue(), draftTitle);
  await dialog(requester.page).getByRole('button', { name: '닫기', exact: true }).click();
  await openNewRequest(requester.page);
  assert.equal(await dialog(requester.page).locator('input[name="region"]').inputValue(), '복구 검증 동네');
  await requester.page.reload();
  await requester.page.locator('.header-create').waitFor();
  if (!await requester.page.locator('dialog input[name="title"]').isVisible()) await openNewRequest(requester.page);
  assert.equal(await dialog(requester.page).locator('input[name="title"]').inputValue(), draftTitle);
  await requester.page.setViewportSize({ width: 390, height: 844 });
  const bounds = await dialog(requester.page).boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391, 'Mobile dialog should stay within the viewport.');
  await dialog(requester.page).locator('input[name="title"]').focus();
  await requester.page.keyboard.press('Tab');
  assert.equal(await requester.page.evaluate(() => !!document.activeElement?.closest('dialog')), true, 'Keyboard focus stays inside the modal.');
  await requester.page.setViewportSize({ width: 1280, height: 900 });
  pass('request draft survives Escape, close and reload; mobile dialog and keyboard remain usable');

  stage = 'committed POST with lost response and deliberate same-operation recovery';
  const submitted = [];
  let committedId;
  let interceptFailure;
  const loseFirstCreationResponse = async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const command = route.request().postDataJSON();
    if (command?.action !== 'createRequest') return route.continue();
    submitted.push(command);
    if (submitted.length > 1) return route.continue();
    try {
      // Actually commit to local D1, then discard only the response. No POST is
      // retried by Playwright or the test harness.
      const saved = await route.fetch({ maxRetries: 0, maxRedirects: 0, timeout: 20_000 });
      assert.equal(saved.status(), 200);
      committedId = (await saved.json()).requestId;
      assert.ok(committedId);
      await route.abort('failed');
    } catch (error) {
      interceptFailure = error;
      await route.abort('failed');
    }
  };
  await requester.page.route('**/api/platform', loseFirstCreationResponse);
  await dialog(requester.page).getByRole('button', { name: '함께할 이웃 찾아보기', exact: true }).click();
  await dialog(requester.page).getByRole('button', { name: '같은 요청의 저장 결과 다시 확인', exact: true }).waitFor();
  if (interceptFailure) throw interceptFailure;
  assert.equal(submitted.length, 1, 'Client must not retry writes automatically.');
  assert.match(submitted[0].operationId, /^[a-f0-9-]{36}$/i);
  assert.equal(await dialog(requester.page).locator('input[name="title"]').isDisabled(), true);
  assert.equal((await api(owner)).requests.filter(item => item.title === draftTitle).length, 1);
  await requester.page.keyboard.press('Escape');
  await openNewRequest(requester.page);
  await dialog(requester.page).getByRole('button', { name: '같은 요청의 저장 결과 다시 확인', exact: true }).click();
  await dialog(requester.page).getByRole('heading', { name: draftTitle, exact: true }).waitFor();
  assert.equal(submitted.length, 2, 'Exactly one user-requested recovery POST.');
  assert.deepEqual(submitted[1], submitted[0], 'Recovery must use the original key and input.');
  const recovered = (await api(owner)).requests.filter(item => item.title === draftTitle);
  assert.equal(recovered.length, 1, 'Lost response and recovery must produce only one request.');
  assert.equal(recovered[0].id, committedId);
  await requester.page.unroute('**/api/platform', loseFirstCreationResponse);
  await requester.page.keyboard.press('Escape');
  await openNewRequest(requester.page);
  assert.equal(await dialog(requester.page).locator('input[name="title"]').inputValue(), '', 'Acknowledged save clears the old draft.');
  pass('lost committed response remains recoverable without duplicate creation or automatic POST retry');

  stage = 'acknowledged save followed by a failed list refresh';
  const refreshFailureTitle = `저장 후 조회 실패 요청 ${suffix.slice(0, 8)}`;
  await dialog(requester.page).locator('input[name="title"]').fill(refreshFailureTitle);
  await dialog(requester.page).locator('input[name="region"]').fill('조회 검증 동네');
  await dialog(requester.page).locator('textarea[name="description"]').fill('저장은 성공했지만 이어지는 목록 조회만 실패하는 상황을 검증합니다.');
  await dialog(requester.page).locator('input[name="preferredTime"]').fill('토요일 오후');
  let blockReads = false;
  const acknowledgedPosts = [];
  const failPostSaveRead = async route => {
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON();
      if (command?.action === 'createRequest') {
        acknowledgedPosts.push(command);
        blockReads = true;
      }
      return route.continue();
    }
    if (blockReads && route.request().method() === 'GET') return route.abort('failed');
    return route.continue();
  };
  await requester.page.route('**/api/platform*', failPostSaveRead);
  await dialog(requester.page).getByRole('button', { name: '함께할 이웃 찾아보기', exact: true }).click();
  await dialog(requester.page).getByRole('alert').filter({ hasText: '변경은 저장했지만' }).waitFor();
  assert.equal(acknowledgedPosts.length, 1, 'A failed read must not resend a successful creation.');
  assert.notEqual(acknowledgedPosts[0].operationId, submitted[0].operationId, 'A deliberate new request has a new operation key.');
  assert.equal((await api(owner)).requests.filter(item => item.title === refreshFailureTitle).length, 1);
  await requester.page.unroute('**/api/platform*', failPostSaveRead);
  await dialog(requester.page).getByRole('button', { name: '새로고침', exact: true }).click();
  await dialog(requester.page).getByRole('heading', { name: refreshFailureTitle, exact: true }).waitFor();
  await requester.page.keyboard.press('Escape');
  await openNewRequest(requester.page);
  assert.equal(await dialog(requester.page).locator('input[name="title"]').inputValue(), '', 'Successful write clears the draft even when its following read failed.');
  pass('successful save and failed read are distinguished, recoverable and use a fresh operation for new work');

  console.log(`Browser smoke checks: ${passed} passed against the built loopback app and local D1.`);
} catch (error) {
  console.error(`Browser regression failed during: ${stage}`);
  await Promise.race([Promise.allSettled([...pendingDiagnostics]), delay(1000)]);
  console.error('Recent browser diagnostics (no headers, query values, identity or storage):', JSON.stringify(diagnostics));
  if (error instanceof Error) {
    error.message = safeDiagnostic(error.message);
    if (error.stack) error.stack = error.stack.split('\n').slice(0, 14).map(safeDiagnostic).join('\n');
  }
  throw error;
} finally {
  await browser?.close();
  // Also removes writes whose successful response was lost before its ID was
  // captured. The unique identities restrict cleanup to this test run.
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const people = actors.map(quote).join(',');
  const owned = `SELECT id FROM requests WHERE owner_id IN (${people})`;
  const cleanup = `DELETE FROM registrations WHERE request_id IN (${owned});
    DELETE FROM interests WHERE request_id IN (${owned});
    DELETE FROM proposals WHERE request_id IN (${owned});
    DELETE FROM requests WHERE owner_id IN (${people});
    DELETE FROM profiles WHERE user_id IN (${people});`;
  execFileSync(process.execPath, ['--import', './scripts/sites-env.mjs', wranglerCli,
    'd1', 'execute', 'DB', '--local', '--config', 'dist/server/wrangler.json', '--persist-to', '.wrangler/state', '--command', cleanup],
    { cwd: process.cwd(), stdio: 'pipe', timeout: 30_000 });
  console.log('Removed this run’s synthetic browser records. No authentication state files were written.');
}
