import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FEATURE_CONTEXT_MAX,
  FEATURE_REQUEST_MAX,
  featureRequestInputSchema,
  parseClientMessage,
  RELEASES_REPO,
} from "@colonova-design/protocol";
// `../dist` 임포트 — 형제를 `.js` 지정자로 부르는 모듈은 src 직접 로드가 그
// 지정을 못 고친다(cycle-supervisor.test.ts 와 같은 길).
import { CommandDedupe } from "../dist/command-dedupe.js";
import { RequestRouter, type RouterDeps } from "../dist/dispatch.js";
import {
  FEEDBACK_ISSUES_URL,
  FEEDBACK_NEW_ISSUE_URL,
  feedbackBody,
  feedbackTitle,
  submitFeatureRequest,
} from "../dist/feedback.js";
import { GitHubClient } from "../dist/github.js";
import type { RestTransport } from "../dist/rest-transport.js";

/** 녹음된 한 번의 REST 왕복 — 진짜 GitHubClient 를 돌리는 가짜 전송. */
function recordedTransport(
  respond: (input: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: Uint8Array;
  }) => { status: number; body: Uint8Array },
) {
  const requests: Array<{
    method: string;
    url: string;
    body?: unknown;
  }> = [];
  const transport: RestTransport = {
    request: async (input) => {
      let body: unknown;
      try {
        body = JSON.parse(new TextDecoder().decode(input.body ?? new Uint8Array()));
      } catch {
        body = undefined;
      }
      requests.push({ method: input.method, url: input.url, body });
      return respond(input);
    },
  };
  return { transport, requests };
}
const json = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

const INPUT = { request: "회원 목록에 검색창을 넣어 줘", context: "지금은 찾기가 너무 어려워요" };
const DEPS = (client: GitHubClient | null, authExpired = false) => ({
  github: { client: () => client, authExpired },
  appVersion: () => "0.4.0",
});

test("sent — 고정 저장소에, 라벨 꾸미기 없이, 제목·본문 계약대로", async () => {
  const { transport, requests } = recordedTransport(() => ({
    status: 201,
    body: json({ number: 42 }),
  }));
  const result = await submitFeatureRequest(INPUT, DEPS(new GitHubClient("t", transport)));
  assert.deepEqual(result, { kind: "sent", number: 42, url: `${FEEDBACK_ISSUES_URL}/42` });
  assert.equal(requests.length, 1, "접수는 요청 하나뿐이다");
  const [request] = requests;
  assert.equal(request?.url, `/repos/${RELEASES_REPO}/issues`);
  assert.equal(request?.method, "POST");
  assert.equal(request?.body?.title, "[기능 제안] 회원 목록에 검색창을 넣어 줘");
  const body = String(request?.body?.body ?? "");
  assert.ok(body.includes(INPUT.request));
  assert.ok(body.includes(INPUT.context));
  assert.ok(body.includes("0.4.0"));
  assert.ok(body.includes(process.platform));
  assert.ok(!body.includes("projectName"), "프로젝트 이름은 절대 실리지 않는다");
});

test("제목은 첫 줄 최대 80자, 문맥·버전은 본문의 계약대로", () => {
  const long = "가".repeat(200);
  assert.equal(feedbackTitle(long), `[기능 제안] ${"가".repeat(80)}`);
  assert.equal(feedbackTitle("첫줄\n둘째줄"), "[기능 제안] 첫줄");
  const withAll = feedbackBody({ request: "요청", context: "불편" }, "1.2.3", "darwin");
  assert.ok(withAll.includes("### 요청"));
  assert.ok(withAll.includes("### 불편한 점"));
  assert.ok(withAll.includes("- 앱 버전: 1.2.3"));
  assert.ok(withAll.includes("- 운영체제: darwin"));
  const noContext = feedbackBody({ request: "요청" }, null, "win32");
  assert.ok(!noContext.includes("불편한 점"));
  assert.ok(!noContext.includes("앱 버전"), "버전을 모르면 줄 자체가 없다");
});

test("입력 계약 — 공백 제거·공백만 거절·길이 상한", () => {
  const trimmed = featureRequestInputSchema.parse({
    request: "  검색창  ",
    context: "  불편  ",
  });
  assert.equal(trimmed.request, "검색창");
  assert.equal(trimmed.context, "불편");
  const blank = featureRequestInputSchema.parse({ request: "x", context: "   " });
  assert.equal(blank.context, "");
  assert.ok(!feedbackBody(blank, null, process.platform).includes("불편한 점"));
  assert.equal(featureRequestInputSchema.safeParse({ request: "   " }).success, false);
  assert.equal(
    featureRequestInputSchema.safeParse({ request: "x".repeat(FEATURE_REQUEST_MAX + 1) }).success,
    false,
  );
  assert.equal(
    featureRequestInputSchema.safeParse({
      request: "x",
      context: "y".repeat(FEATURE_CONTEXT_MAX + 1),
    }).success,
    false,
  );
});

test("browser — 토큰 없음·만료·401/403/404/410, 한글은 URL 인코딩", async () => {
  // 토큰 없음: 요청이 아예 나가지 않는다.
  const none = recordedTransport(() => ({ status: 201, body: json({ number: 1 }) }));
  const noToken = await submitFeatureRequest(INPUT, DEPS(null));
  assert.equal(noToken.kind, "browser");
  assert.equal(none.requests.length, 0);

  for (const status of [401, 403, 404, 410]) {
    const { transport } = recordedTransport(() => ({ status, body: json({ message: "no" }) }));
    const result = await submitFeatureRequest(INPUT, DEPS(new GitHubClient("t", transport)));
    assert.equal(result.kind, "browser", `HTTP ${status} 은 브라우저 마무리`);
    if (result.kind !== "browser") continue;
    assert.ok(result.url.startsWith(`${FEEDBACK_NEW_ISSUE_URL}?`), "고정 새 이슈 페이지");
    const query = new URL(result.url).searchParams;
    assert.equal(query.get("title"), "[기능 제안] 회원 목록에 검색창을 넣어 줘");
    assert.ok(query.get("body")?.includes(INPUT.request));
    assert.ok(/%[0-9A-F]{2}/.test(result.url), "한글은 퍼센트 인코딩으로 간다");
  }

  // 만료가 확인된 토큰 — 브리지가 이미 401 을 본 토큰으로는 쓰러 가지 않는다.
  const expired = recordedTransport(() => ({ status: 201, body: json({ number: 1 }) }));
  const result = await submitFeatureRequest(
    INPUT,
    DEPS(new GitHubClient("t", expired.transport), true),
  );
  assert.equal(result.kind, "browser");
  assert.equal(expired.requests.length, 0);
});

test("failed — 422 등 명시적 거절", async () => {
  for (const status of [400, 422, 423]) {
    const { transport } = recordedTransport(() => ({ status, body: json({ message: "no" }) }));
    const result = await submitFeatureRequest(INPUT, DEPS(new GitHubClient("t", transport)));
    assert.deepEqual(result, { kind: "failed", reason: "rejected" }, `HTTP ${status}`);
  }
});

test("uncertain — 5xx·네트워크 단절·잘못된 성공 응답, 그리고 재전송 없음", async () => {
  const cases = [
    () => ({ status: 502, body: json({ message: "bad gateway" }) }),
    () => ({ status: 500, body: json({ message: "boom" }) }),
  ];
  for (const respond of cases) {
    const { transport, requests } = recordedTransport(respond);
    const result = await submitFeatureRequest(INPUT, DEPS(new GitHubClient("t", transport)));
    assert.deepEqual(result, { kind: "uncertain", url: FEEDBACK_ISSUES_URL });
    assert.equal(requests.length, 1, "자동 재전송은 없다");
  }
  // 네트워크 단절 — 전송 자체가 던진다.
  const dead: RestTransport = {
    request: async () => {
      throw new Error("fetch failed");
    },
  };
  assert.deepEqual(await submitFeatureRequest(INPUT, DEPS(new GitHubClient("t", dead))), {
    kind: "uncertain",
    url: FEEDBACK_ISSUES_URL,
  });
  // 2xx 인데 이슈 번호가 없다 — 거짓 접수 완료가 아니라 확인 불가다.
  for (const payload of [
    {},
    { number: "abc" },
    { number: "42" },
    { number: true },
    { number: 0 },
    { number: -3 },
    { number: 1.5 },
    { number: Number.MAX_SAFE_INTEGER + 1 },
    [42],
    5,
    "scalar",
  ]) {
    const { transport } = recordedTransport(() => ({ status: 201, body: json(payload) }));
    const result = await submitFeatureRequest(INPUT, DEPS(new GitHubClient("t", transport)));
    assert.deepEqual(
      result,
      { kind: "uncertain", url: FEEDBACK_ISSUES_URL },
      JSON.stringify(payload),
    );
  }
  // 2xx 인데 본문이 JSON 이 아니다(프록시의 로그인 페이지).
  const html = recordedTransport(() => ({ status: 200, body: new TextEncoder().encode("<html>") }));
  assert.equal(
    (await submitFeatureRequest(INPUT, DEPS(new GitHubClient("t", html.transport)))).kind,
    "uncertain",
  );
});

test("명령 멱장 — 같은 id 의 도는 중 호출은 첫 실행을 함께 기다린다", async () => {
  const dedupe = new CommandDedupe();
  let runs = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = dedupe.run("stable-id", async () => {
    runs += 1;
    await gate;
    return "answer";
  });
  const second = dedupe.run("stable-id", async () => {
    runs += 1;
    return "other";
  });
  release();
  assert.equal(await first, "answer");
  assert.equal(await second, "answer", "둘째 호출은 첫 약속을 그대로 받는다");
  assert.equal(runs, 1, "task 는 첫 도착자만 돈다");
  // 정산 뒤의 같은 id 재전송도 기억된 답을 되돌린다 — 두 번 접수가 없다.
  assert.equal(await dedupe.run("stable-id", async () => "third"), "answer");
  assert.equal(runs, 1);
});

test("선로 경계 — parseClientMessage 가 feedback.submit 의 입력을 잣는다", () => {
  // 정상: 공백은 정리되고 context 는 없어도 된다.
  const bare = parseClientMessage(
    JSON.stringify({ id: "w1", type: "feedback.submit", request: "  검색창  " }),
  );
  assert.ok(bare.ok);
  assert.equal(bare.value.type, "feedback.submit");
  assert.equal(bare.value.request, "검색창");
  assert.equal(bare.value.context, undefined, "context 는 선택이다");
  const withContext = parseClientMessage(
    JSON.stringify({ id: "w2", type: "feedback.submit", request: "r", context: "  불편  " }),
  );
  assert.ok(withContext.ok);
  assert.equal(withContext.value.context, "불편");
  // 거절: 공백만의 요청 · 길이 상한 · id 없음.
  for (const raw of [
    JSON.stringify({ id: "w3", type: "feedback.submit", request: "   " }),
    JSON.stringify({
      id: "w4",
      type: "feedback.submit",
      request: "x".repeat(FEATURE_REQUEST_MAX + 1),
    }),
    JSON.stringify({
      id: "w5",
      type: "feedback.submit",
      request: "x",
      context: "y".repeat(FEATURE_CONTEXT_MAX + 1),
    }),
    JSON.stringify({ type: "feedback.submit", request: "x" }),
  ]) {
    const parsed = parseClientMessage(raw);
    assert.equal(parsed.ok, false, raw.slice(0, 60));
  }
});

test("멱장 접수 — CommandDedupe 로 같은 id 의 접수는 전송 한 번", async () => {
  const { transport, requests } = recordedTransport(() => ({
    status: 201,
    body: json({ number: 7 }),
  }));
  const client = new GitHubClient("t", transport);
  const dedupe = new CommandDedupe();
  const submit = (id: string) => dedupe.run(id, () => submitFeatureRequest(INPUT, DEPS(client)));
  const first = await submit("cmd-1");
  const replay = await submit("cmd-1");
  assert.deepEqual(first, replay, "재전송은 기억된 답을 받는다");
  assert.equal(first.kind, "sent");
  assert.equal(requests.length, 1, "같은 id 로는 GitHub 에 두 번 닿지 않는다");
});

test("라우터 — 활성 프로젝트 없이 feedback.submit 을 접수한다", async () => {
  const { transport, requests } = recordedTransport(() => ({
    status: 201,
    body: json({ number: 9 }),
  }));
  // fleet · registry · manager 등 프로젝트 상태는 아예 없다 — 이 명령이
  // 그것들을 건드리지 않는다는 것이 이 시험의 판정이다.
  const router = new RequestRouter({
    github: { client: () => new GitHubClient("t", transport), authExpired: false },
    appVersion: () => "0.4.0",
  } as unknown as RouterDeps);
  const result = await router.dispatch({
    id: "f1",
    type: "feedback.submit",
    request: INPUT.request,
    context: INPUT.context,
  });
  assert.deepEqual(result, { kind: "sent", number: 9, url: `${FEEDBACK_ISSUES_URL}/9` });
  assert.equal(requests.length, 1);
  assert.equal(String(requests[0]?.url), `/repos/${RELEASES_REPO}/issues`, "고정 저장소만 겨눈다");
});
