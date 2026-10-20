import assert from "node:assert/strict";
import { test } from "node:test";
// 컴파일된 dist 를 읽는다 — 데몬 시험의 계약.
import { RequestRouter } from "../dist/dispatch.js";

test("앱에서 뺀 AI(옛 codex)로 만든 대화의 재개는 새 대화로 안내한다 — 다른 드라이버로 열지 않는다", async () => {
  const warned: unknown[] = [];
  const router = new RequestRouter({
    // 신원 일지가 그 대화의 주인을 codex 로 기억한다(2026-10-20 이전에 만든 대화).
    manager: { get: () => undefined, findStoredProvider: async () => "codex" },
    fleet: { workspaceCwd: () => "/tmp/colonova-repo" },
    agentDrivers: { get: (id: string) => (id === "claude" ? {} : undefined) },
    logger: { warn: (...args: unknown[]) => warned.push(args) },
  } as never);
  await assert.rejects(
    router.dispatch({
      id: "r",
      type: "session.create",
      resume: "old-codex-thread",
      provider: "claude",
    } as never),
    /이 대화를 만든 AI 는 이제 이 앱에서 쓰지 않아/,
  );
  // 요청의 claude 는 주인(codex)에 밀려 무시된다 — 남의 대화록을 claude 로 열지 않는다.
  assert.equal(warned.length, 1);
});
