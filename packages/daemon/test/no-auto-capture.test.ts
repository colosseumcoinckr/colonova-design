import assert from "node:assert/strict";
import { test } from "node:test";
import { RequestRouter } from "../dist/dispatch.js";

test("제출 초안과 직접 넘기기는 브라우저를 열거나 촬영하지 않는다", async () => {
  let draft: unknown;
  let handoff: unknown;
  const router = new RequestRouter({
    fleet: {
      requireActive: () => ({
        slug: "project",
        paths: { root: "/project" },
        repo: {
          handoffDraft: async (input: unknown) => {
            draft = input;
            return input;
          },
          handoff: async (input: unknown) => {
            handoff = input;
            return input;
          },
        },
      }),
    },
    registry: { get: () => ({ name: "project" }) },
    previewDrivers: new Proxy({}, {
      get: () => {
        throw new Error("자동 촬영은 브라우저 도구를 호출하면 안 된다");
      },
    }),
  } as never);
  await router.dispatch({ id: "draft", type: "repo.handoffDraft" });
  assert.equal((draft as { shotCount: number }).shotCount, 0);
  await router.dispatch({ id: "handoff", type: "repo.handoff" });
  assert.ok(handoff);
  assert.equal("shots" in (handoff as object), false);
});
