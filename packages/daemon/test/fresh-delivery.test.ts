import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import type { ChatEvent } from "@colonova-design/protocol";
import { Session } from "../dist/session.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function setup(check: () => Promise<void>, save?: () => Promise<void>) {
  const sends: string[] = [];
  const events: ChatEvent[] = [];
  const session = new Session(
    { cwd: tmpdir(), retryDelays: [1] },
    {
      onEvent: (_id, event) => events.push(event),
      onState: () => undefined,
      onPermissionRequest: () => undefined,
      onQuestionRequest: () => undefined,
      beforeDeliver: save,
      beforeAgentSend: check,
    },
  );
  session.attach({
    send: async ({ text }: { text: string }) => {
      sends.push(text);
    },
    close: async () => {},
  } as never);
  return { session, sends, events };
}

test("직전 보관 다음 최신 준비가 끝나야 실제 AI에게 한 번 보낸다", async () => {
  const saved = Promise.withResolvers<void>();
  const prepared = Promise.withResolvers<void>();
  let checks = 0;
  const { session, sends } = setup(
    () => {
      checks++;
      return prepared.promise;
    },
    () => saved.promise,
  );
  try {
    session.send("회원 목록을 고쳐 줘");
    await flush();
    assert.equal(checks, 0);
    assert.equal(session.preparingForDelivery, true);
    saved.resolve();
    await flush();
    assert.equal(checks, 1);
    assert.deepEqual(sends, []);
    prepared.resolve();
    await flush();
    assert.deepEqual(sends, ["회원 목록을 고쳐 줘"]);
    assert.equal(session.preparingForDelivery, false);
  } finally {
    await session.close();
  }
});

test("앱 준비 중 대기한 요청도 최신 준비 실패 시 보내지 않고 오류로 끝난다", async () => {
  let checks = 0;
  const { session, sends, events } = setup(async () => {
    checks++;
    throw new Error("최신 내용을 확인하지 못했어요 — 다시 보내 주세요.");
  });
  try {
    session.setPreparing(true);
    session.send("대기하던 요청");
    await flush();
    assert.equal(checks, 0);
    session.setPreparing(false);
    await flush();
    assert.equal(checks, 1);
    assert.deepEqual(sends, []);
    assert.equal(session.state, "idle");
    assert.ok(events.some((event) => event.kind === "turn.end" && event.isError));
    assert.ok(events.some((event) => event.kind === "notice" && event.text.includes("최신 내용")));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(checks, 1, "준비 실패를 공급자 자동 재시도로 반복하지 않는다");
    assert.equal(events.filter((event) => event.kind === "user.echo").length, 1);
  } finally {
    await session.close();
  }
});

test("공급자 재시도도 최신 확인을 건너뛰지 않는다", async () => {
  let checks = 0;
  const { session, sends, events } = setup(async () => {
    if (++checks > 1) throw new Error("최신 내용을 확인하지 못했어요.");
  });
  try {
    session.send("처음 요청");
    await flush();
    assert.equal(sends.length, 1);
    session.driverHooks.onEvent({
      kind: "turn.end",
      subtype: "error",
      isError: true,
      costUsd: null,
      numTurns: null,
      durationMs: 1,
      resultText: "Service temporarily unavailable",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(checks, 2);
    assert.equal(sends.length, 1, "재시도의 최신 준비가 실패하면 다시 전송하지 않는다");
    assert.equal(events.filter((event) => event.kind === "user.echo").length, 1);
  } finally {
    await session.close();
  }
});

test("최신 확인 중 닫힌 대화는 뒤늦게 보내지 않는다", async () => {
  const prepared = Promise.withResolvers<void>();
  const { session, sends } = setup(() => prepared.promise);
  session.send("취소할 요청");
  await flush();
  await session.close();
  prepared.resolve();
  await flush();
  assert.deepEqual(sends, []);
});
