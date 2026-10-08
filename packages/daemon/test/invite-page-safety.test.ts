// 소개 페이지(site/invite.js)의 비밀 다루기 — 순수 시험이다(프로세스도 네트워크도 없다).
// 2026-10-08 검토 FIX1:
//   F2 연결 코드가 가는 API 주소는 루프백 출처만 바꿀 수 있다(apiBaseFor — invite-check.mjs).
//   F3 초대 JSON 미리 보기는 연결 코드뿐 아니라 Slack 웹훅 주소 · 봇 토큰도 가린다(maskInviteForPreview).
// 브라우저 스크립트는 DOM 을 써서 여기서 못 돌리니, 판정을 순수 함수로 빼 시험하고 스크립트가 그 함수를
// 실제로 쓰는지는 소스 계약으로 지킨다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// 패키지 바깥의 파일 경로라 정적 import 로는 쓸 수 없다(invite-check.test.ts 와 같은 길).
const { DEFAULT_API_BASE, apiBaseFor } = await import(
  new URL("../../../site/invite-check.mjs", import.meta.url).href
);
const { PREVIEW_MASK, buildInvite, maskInviteForPreview } = await import(
  new URL("../../../site/invite-format.mjs", import.meta.url).href
);
const inviteSource = readFileSync(new URL("../../../site/invite.js", import.meta.url), "utf8");

// ————— F2. ?api= 는 루프백 출처만 —————

test("?api= — 127.0.0.1 · localhost 의 http 출처는 그대로 받는다(경로 · 쿼리는 버린다)", () => {
  assert.equal(apiBaseFor("127.0.0.1", "http://127.0.0.1:8123"), "http://127.0.0.1:8123");
  assert.equal(apiBaseFor("localhost", "http://localhost:3000"), "http://localhost:3000");
  // 페이지를 연 호스트와 ?api= 의 호스트는 서로 달라도 둘 다 루프백이면 된다.
  assert.equal(apiBaseFor("localhost", "http://127.0.0.1:8123"), "http://127.0.0.1:8123");
  assert.equal(apiBaseFor("127.0.0.1", "http://LOCALHOST:8123/"), "http://localhost:8123");
  assert.equal(
    apiBaseFor("127.0.0.1", "http://127.0.0.1:8123/api/v3?x=1#y"),
    "http://127.0.0.1:8123",
  );
});

test("?api= — 루프백이 아닌 출처는 무시하고 기본 GitHub 를 쓴다", () => {
  const attacks = [
    "https://evil.example",
    "http://evil.example:8123",
    "http://127.0.0.1.evil.example:8123", // 앞이 숫자 주소처럼 보이는 호스트
    "http://localhost.evil.example:8123",
    "http://127.0.0.1:8123@evil.example", // 자격 정보처럼 보이지만 호스트는 evil.example
    "http://evil.example/@127.0.0.1:8123",
    "http://user:pw@127.0.0.1:8123", // 자격 정보가 붙은 루프백도 받지 않는다
    "http://user@localhost:8123",
    "https://127.0.0.1:8123", // https 는 받지 않는다 — 가짜 GitHub 는 http 다
    "https://api.github.com.evil.example",
    "//evil.example",
    "javascript:alert(1)",
    "ftp://127.0.0.1:21",
    "http://[::1]:8123", // 페이지 쪽 호스트 규칙과 같은 두 가지만
    "http://0.0.0.0:8123",
    "http://127.0.0.2:8123",
    "http://localhost:99999", // 읽을 수 없는 포트
    "127.0.0.1:8123", // 스킴 없는 값
    "localhost:8123", // `localhost:` 가 스킴으로 읽히는 값
    "not a url",
    "",
  ];
  for (const attack of attacks) {
    assert.equal(apiBaseFor("127.0.0.1", attack), DEFAULT_API_BASE, attack);
    assert.equal(apiBaseFor("localhost", attack), DEFAULT_API_BASE, attack);
  }
  assert.equal(apiBaseFor("127.0.0.1", null), DEFAULT_API_BASE, "?api= 가 없으면 기본이다");
  assert.equal(apiBaseFor("127.0.0.1", undefined), DEFAULT_API_BASE);
});

test("?api= — 루프백이 아닌 곳에서 열린 페이지는 ?api= 가 무엇이든 기본이다", () => {
  for (const host of [
    "colonova.design",
    "example.github.io",
    "evil.example",
    "127.0.0.1.evil.example",
    "",
  ]) {
    assert.equal(apiBaseFor(host, "http://127.0.0.1:8123"), DEFAULT_API_BASE, host);
    assert.equal(apiBaseFor(host, "http://localhost:3000"), DEFAULT_API_BASE, host);
  }
  assert.equal(apiBaseFor(undefined, "http://127.0.0.1:8123"), DEFAULT_API_BASE);
  assert.equal(DEFAULT_API_BASE, "https://api.github.com");
});

test("소스 계약 — invite.js 의 API 주소는 apiBaseFor 만 거친다(?api= 값을 그대로 쓰지 않는다)", () => {
  assert.match(inviteSource, /const API_BASE = inviteCheck\.apiBaseFor\(\s*location\.hostname,/);
  assert.equal(
    /get\("api"\)\s*\?\?/.test(inviteSource),
    false,
    "?api= 값이 판정 없이 API_BASE 가 되는 옛 길이 남았다",
  );
  // 연결 코드 머리는 API_BASE 로만 간다 — 다른 fetch 가 코드를 싣지 않는다.
  const bearers = inviteSource.match(/Bearer \$\{/g) ?? [];
  assert.equal(bearers.length, 1, "Authorization 머리는 apiHeaders 한 곳에서만 만든다");
});

// ————— F3. 미리 보기 가림 —————

const GITHUB_TOKEN = "github_pat_PREVIEW_SECRET_123";
const WEBHOOK = "https://hooks.slack.com/services/T000/B000/WEBHOOK_SECRET_XYZ";
const BOT_TOKEN = "xoxb-1111-2222-BOT_SECRET_ABC";

function inviteWith(slack?: Record<string, string>) {
  return buildInvite({
    token: GITHUB_TOKEN,
    author: "김기획",
    ...(slack ? { notify: { slack } } : {}),
    projects: [
      {
        repoUrl: "https://github.com/org/app.git",
        name: "회원 관리",
        baseBranch: "main",
        instructions: "",
      },
    ],
  });
}

test("미리 보기 — 연결 코드와 Slack 웹훅 주소가 가려지고 kind 는 남는다", () => {
  const values = inviteWith({ kind: "webhook", url: WEBHOOK });
  const masked = maskInviteForPreview(values);
  assert.equal(masked.token, PREVIEW_MASK);
  assert.deepEqual(masked.notify, { slack: { kind: "webhook", url: PREVIEW_MASK } });
  const text = JSON.stringify(masked, null, 2);
  for (const secret of [GITHUB_TOKEN, WEBHOOK, "WEBHOOK_SECRET_XYZ", "hooks.slack.com"]) {
    assert.equal(text.includes(secret), false, `미리 보기에 비밀이 남았다: ${secret.slice(0, 8)}…`);
  }
  // 비밀이 아닌 칸은 그대로다.
  assert.equal(masked.authorName, "김기획");
  assert.equal(masked.projects[0].repoUrl, "https://github.com/org/app.git");
});

test("미리 보기 — Slack 봇 토큰이 가려지고 kind · channel 은 남는다", () => {
  const values = inviteWith({ kind: "bot", token: BOT_TOKEN, channel: "#dev-alerts" });
  const masked = maskInviteForPreview(values);
  assert.deepEqual(masked.notify, {
    slack: { kind: "bot", token: PREVIEW_MASK, channel: "#dev-alerts" },
  });
  const text = JSON.stringify(masked, null, 2);
  assert.equal(text.includes(BOT_TOKEN), false);
  assert.equal(text.includes("BOT_SECRET_ABC"), false);
  assert.equal(text.includes(GITHUB_TOKEN), false);
});

test("미리 보기 — 새 글자 칸이 Slack 길에 생겨도 기본은 가림이다", () => {
  const values = inviteWith({ kind: "webhook", url: WEBHOOK, signingSecret: "SIGNING_SECRET_1" });
  const masked = maskInviteForPreview(values);
  assert.equal(masked.notify.slack.signingSecret, PREVIEW_MASK);
  assert.equal(JSON.stringify(masked).includes("SIGNING_SECRET_1"), false);
});

test("미리 보기 — Slack 길이 없으면 notify 를 만들지 않고, 코드가 비면 빈 칸이다", () => {
  const masked = maskInviteForPreview(inviteWith());
  assert.equal("notify" in masked, false);
  assert.equal(masked.token, PREVIEW_MASK);
  const empty = maskInviteForPreview({ ...inviteWith(), token: "" });
  assert.equal(empty.token, "", "코드를 안 넣었으면 가림 표시도 없다");
});

test("미리 보기 — 원본은 건드리지 않는다(내려받는 파일에는 진짜 값이 간다)", () => {
  const values = inviteWith({ kind: "bot", token: BOT_TOKEN, channel: "C0123" });
  const before = JSON.stringify(values);
  maskInviteForPreview(values);
  assert.equal(JSON.stringify(values), before);
  assert.equal(values.token, GITHUB_TOKEN);
  assert.equal(values.notify.slack.token, BOT_TOKEN);
});

test("소스 계약 — invite.js 의 미리 보기는 maskInviteForPreview 를 거친다", () => {
  assert.match(
    inviteSource,
    /preview\.textContent = JSON\.stringify\(maskInviteForPreview\(values\)/,
  );
  assert.equal(
    /JSON\.stringify\(\{\s*\.\.\.values,\s*token:/.test(inviteSource),
    false,
    "연결 코드만 가리는 옛 미리 보기가 남았다",
  );
});
