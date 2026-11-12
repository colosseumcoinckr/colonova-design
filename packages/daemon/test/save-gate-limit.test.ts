// 보관 게이트의 무한 넘김을 끊는 두 판정 (2026-11-12 기획자 체험 — 작성자 확인 실패가
// AI 에게 넘어가 «고칠 것이 없다» 는 답 뒤 자동 보관이 다시 돌아 15장의 같은 카드가 섰다):
// ① 이 기계 · 계정 원인(연결 코드 · 권한 · 한도 · 네트워크 · GitHub 응답 없음 · 5xx)은
// AI 턴 없이 대화의 한 줄로 간다 — 그중 연결 코드 · 권한만 개발자 알림(save:commit)도 받는다. ② 같은 단계의 같은 실패는 AI 에게
// 두 번까지만 — 세 번째부터는 사람 안내다. 보관 성공이나 내용 바뀜이 세던 것을 지운다.
// 순수 시험 — failGate 를 직접 부른다(push-gate-kind.test.ts 와 같은 길); 진짜 git 장면은
// save-gate-real.test.ts 가 본다.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { DiffStatus } from "@colonova-design/protocol";
// `../dist` 임포트인 이유: repo-publish 는 형제를 `.js` 지정자로 부른다 — src 직접 로드는 그 지정을 못 고친다.
import { RepoCore } from "../dist/repo-core.js";
import { PublishCycle } from "../dist/repo-publish.js";

function scene() {
  const notices: Array<[string, string]> = [];
  const briefs: string[] = [];
  const events: Array<{ event: { kind: string; detail?: string }; sessionId?: string }> = [];
  const core = new RepoCore({
    root: "/tmp/colonova-save-gate-never-cloned",
    url: null,
    onStatus: () => {},
  });
  const publish = new PublishCycle(core, {
    machineMemo: async () => null,
    notice: (key, detail) => notices.push([key, detail]),
    onCycleEvent: (event, sessionId) =>
      events.push({ event: event as { kind: string; detail?: string }, sessionId }),
  });
  /** 게이트 실패를 직접 부른다 — 부르는 쪽(보관 · 제출)의 git 은 이 시험의 몫이 아니다. */
  const fail = (gate: "commit" | "push" | "pr", text: string, sessionId?: string): DiffStatus =>
    (
      publish as unknown as {
        failGate(
          gate: string,
          error: unknown,
          onSessionTurn: (brief: string) => void,
          sessionId?: string,
        ): DiffStatus;
      }
    ).failGate(gate, new Error(text), (brief) => briefs.push(brief), sessionId);
  const saveOk = () => (publish as unknown as { markSaveOk(): void }).markSaveOk();
  return { notices, briefs, events, fail, saveOk };
}

test("작성자 확인의 실패는 AI 에게 가지 않는다 — 네트워크 · 401 · 불완전 응답 모두", () => {
  // [실패 문장, 개발자에게 알리는가] — 일시적인 기계 원인은 알리지 않는다(대화의 한 줄만), 연결 코드 · 권한은 알린다.
  const cases: Array<[string, boolean]> = [
    // GET /user 가 던진 네트워크 실패(whoAmI unreachable)
    ["GitHub에 연결하지 못했습니다 — fetch failed", false],
    // 401 — 만료된 연결 코드(whoAmI unauthorized)
    [
      "연결 코드가 유효하지 않거나 만료됐습니다 — 개발자에게 새 코드를 요청해 다시 넣어 주세요.",
      true,
    ],
    // 불완전 응답 — login 없음 · id 없음(commitIdentity)
    ["GitHub 응답을 읽지 못했습니다.", false],
    ["GitHub 계정 정보를 읽지 못했습니다. 다시 시도해 주세요.", false],
    // 연결 코드 자체가 없음(identityArgs)
    ["연결 코드가 없습니다. 초대 파일을 다시 열어 주세요.", true],
    // GitHub 서버 쪽 실패 · 한도
    ["GitHub 확인에 실패했습니다 — GitHub 503: Service Unavailable", false],
    ["GitHub 확인에 실패했습니다 — GitHub 429: rate limit exceeded", false],
    // 권한 부족 — 개발자가 코드의 권한을 고쳐야 한다
    [
      "GitHub 확인에 실패했습니다 — GitHub 403: Resource not accessible by personal access token",
      true,
    ],
  ];
  for (const [text, notified] of cases) {
    const { notices, briefs, events, fail } = scene();
    const status = fail("commit", text);
    assert.equal(status.stage, "failed", text);
    assert.equal(briefs.length, 0, `AI 턴이 생기지 않는다: ${text}`);
    assert.deepEqual(
      notices.map(([key]) => key),
      notified ? ["save:commit"] : [],
      text,
    );
    // 알리든 아니든 기획자에게는 대화의 한 줄이 선다.
    assert.equal(events.filter(({ event }) => event.kind === "cycle.saveBlocked").length, 1, text);
  }
});

test("연결 코드가 원인인 보관 실패는 재연결 안내가 선다 — reason push-auth", () => {
  const { notices, briefs, fail } = scene();
  const status = fail("commit", "연결 코드가 없습니다. 초대 파일을 다시 열어 주세요.");
  assert.equal(status.stage === "failed" && status.reason, "push-auth");
  assert.deepEqual(
    notices.map(([key]) => key),
    ["save:commit"],
    "개발자 알림은 보관 멈춤의 키로",
  );
  assert.deepEqual(briefs, []);
});

test("분류되지 않는 같은 실패는 AI 에게 두 번까지 — 세 번째부터 사람 안내다", () => {
  const { notices, briefs, fail } = scene();
  const detail = "git add에 실패했습니다 (128) — 무언가가 꼬였습니다";
  for (let i = 0; i < 2; i += 1) fail("commit", detail);
  assert.equal(briefs.length, 2, "첫 두 번은 AI 의 과제다");
  assert.deepEqual(notices, []);
  for (let i = 0; i < 3; i += 1) fail("commit", detail);
  assert.equal(briefs.length, 2, "세 번째부터는 AI 턴을 만들지 않는다");
  assert.deepEqual(
    notices.map(([key]) => key),
    ["save:commit", "save:commit", "save:commit"],
    "막힌 뒤의 실패마다 사람 안내다",
  );
});

test("실패 내용이 바뀌면 다시 센다 — 다른 단계도 따로 센다", () => {
  const { briefs, fail } = scene();
  const detailA = "실패 가";
  for (let i = 0; i < 2; i += 1) fail("commit", detailA);
  fail("commit", "실패 나 — 다른 내용이다");
  fail("push", "fatal: push 무언가 실패");
  assert.equal(briefs.length, 4, "내용 · 단계가 다르면 각각 새로 센다");
});

test("pr 단계는 기존 그대로 — submit:pr 알림 · reason 없음 · AI 에게 안 간다", () => {
  const { notices, briefs, fail } = scene();
  const status = fail("pr", "GitHub 422: Validation Failed");
  assert.equal(status.stage === "failed" && status.reason, undefined);
  assert.deepEqual(
    notices.map(([key]) => key),
    ["submit:pr"],
  );
  assert.deepEqual(briefs, []);
});

test("올리기(push) 단계에도 같은 한도 — 세 번째부터 save:push", () => {
  const { notices, briefs, fail } = scene();
  const detail = "error: RPC failed; curl 55 Send failure";
  for (let i = 0; i < 2; i += 1) fail("push", detail);
  assert.equal(briefs.length, 2);
  fail("push", detail);
  assert.equal(briefs.length, 2);
  assert.deepEqual(
    notices.map(([key]) => key),
    ["save:push"],
  );
});

test("사람 안내로 돌린 실패는 대화에 빨간 한 줄을 남긴다 — 같은 실패는 한 번만(FA-2)", () => {
  const { events, fail } = scene();
  const detail = "GitHub 계정 정보를 읽지 못했습니다 — connect ECONNREFUSED 127.0.0.1:1";
  fail("commit", detail, "sess-1");
  // 같은 단계 · 같은 실패가 이어지는 동안은 한 번만 — 되풀이를 만든 자리이므로.
  fail("commit", detail, "sess-1");
  fail("commit", detail, "sess-1");
  const blocked = events.filter(({ event }) => event.kind === "cycle.saveBlocked");
  assert.equal(blocked.length, 1, "같은 실패는 한 줄만");
  assert.equal(blocked[0]!.sessionId, "sess-1", "부른 대화에 귀속");
  const text = blocked[0]!.event.detail ?? "";
  // 첫 줄은 사람의 말 — 무슨 일 · 고친 내용은 남는다 · 다음에 무엇이 되는지.
  const [lead, ...rest] = text.split("\n\n");
  assert.match(lead ?? "", /^보관하지 못했어요/);
  assert.match(lead ?? "", /이 컴퓨터에 그대로/);
  assert.match(lead ?? "", /다시 보관해요|다시 연결/);
  assert.equal(rest.join("\n\n"), detail, "빈 줄 뒤에는 원문 그대로");
  // 내용이 바뀌면 다시 남긴다.
  fail("commit", "connect ECONNREFUSED 10.0.0.1:2 — GitHub 응답을 읽지 못했습니다", "sess-1");
  assert.equal(
    events.filter(({ event }) => event.kind === "cycle.saveBlocked").length,
    2,
    "다른 실패는 새 한 줄",
  );
});

test("성공하면 남긴 한 줄의 기록을 지운다 — 같은 실패가 오면 다시 남긴다(FA-2)", () => {
  const { events, fail, saveOk } = scene();
  const detail = "GitHub에 연결하지 못했습니다";
  fail("commit", detail);
  saveOk();
  fail("commit", detail);
  assert.equal(
    events.filter(({ event }) => event.kind === "cycle.saveBlocked").length,
    2,
    "성공 뒤엔 다시 남긴다",
  );
});

test("한도로 사람에게 돌아간 실패도 한 줄을 남긴다 — 세 번째부터(FA-2)", () => {
  const { events, briefs, fail } = scene();
  const detail = "error: object file .git/objects/ab/cd is empty";
  fail("commit", detail);
  fail("commit", detail);
  assert.equal(events.length, 0, "AI 에게 가는 동안은 한 줄 없다");
  assert.equal(briefs.length, 2, "두 번까지는 AI 에게 간다");
  fail("commit", detail);
  assert.equal(briefs.length, 2, "세 번째는 AI 에게 가지 않는다");
  const blocked = events.filter(({ event }) => event.kind === "cycle.saveBlocked");
  assert.equal(blocked.length, 1);
  assert.match(blocked[0]!.event.detail ?? "", /같은 문제가 이어져 AI 에게 더 맡기지 않았어요/);
});
