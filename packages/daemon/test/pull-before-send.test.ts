import assert from "node:assert/strict";
import { test } from "node:test";
import { RequestRouter } from "../dist/dispatch.js";

test("보내기는 최신화와 핀 파일 검색 없이 원문을 바로 전달한다", async () => {
  const sent: unknown[][] = [];
  let holds = 0;
  const target = {
    id: "s",
    cwd: "/repo",
    sendable: true,
    send: (...args: unknown[]) => sent.push(args),
  };
  const router = new RequestRouter({
    manager: { require: () => target },
    fleet: {
      workspaceCwd: () => "/repo",
      holdIfPreparing: () => {
        holds++;
      },
      workspaceOfSession: () => {
        throw new Error("no repository work before sending");
      },
    },
    previewDrivers: { gatedSessions: new Set() },
  } as never);
  await router.dispatch({
    id: "send",
    type: "session.send",
    sessionId: "s",
    text: "pin words",
    pinHints: [{ id: "pin", testId: "button" }],
    sentAt: 123,
  } as never);
  assert.equal(holds, 1);
  assert.deepEqual(sent, [["pin words", undefined, undefined, undefined, undefined, 123]]);
});

test("게이트 문제 해결 대화는 fleet 의 자동 대화 길로 연다 — codex 만 쓸 수 있으면 codex 로", async () => {
  // 공급자 고르기는 fleet → autoThreads(auto-thread.ts) 가 한다: codex 만
  // 쓸 수 있는 기계에서 그 판정이 codex 세션을 돌려준다. 라우터의 몫은 그
  // 길에 다리는 것뿐이다 — claude 실행 파일을 직접 보던 옛 길이라면 아래의
  // 최소 deps(claudeExecutable 없음)에서 무너진다.
  const codexSession = {
    id: "codex-s1",
    cwd: "/tmp/colonova-repo",
    state: "idle",
    title: "제출 문제 해결",
  };
  const opened: string[] = [];
  const fleet = {
    workspaceCwd: () => "/tmp/colonova-repo",
    requireActive: () => ({}),
    autoFixThreadFor: async (_workspaces: unknown, title: string) => {
      opened.push(title);
      return codexSession;
    },
  };
  const manager = { get: (id: string) => (id === "codex-s1" ? codexSession : undefined) };
  const router = new RequestRouter({ fleet, manager } as never);
  const gateThreadFor: (stage: string) => Promise<unknown> = (
    router as never as Record<string, (stage: string) => Promise<unknown>>
  )["gateThreadFor"].bind(router);

  assert.equal(await gateThreadFor("handoff"), codexSession, "fleet 이 연 codex 세션");
  assert.deepEqual(opened, ["제출 문제 해결"]);

  // 살아 있는 게이트 대화는 재사용한다 — 다시 열지 않는다.
  opened.length = 0;
  assert.equal(await gateThreadFor("save"), codexSession);
  assert.deepEqual(opened, [], "기억한 대화를 다시 쓴다");
});
