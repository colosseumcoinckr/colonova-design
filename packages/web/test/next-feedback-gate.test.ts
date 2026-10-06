import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-shortcut-sheet.test.ts 와 같은 모양).
import {
  closedArrival,
  counterState,
  type Phase,
  rejectedBeforeSend,
  sendLockLine,
  stageCopy,
  stepStates,
} from "../src/next/feedback/gate.ts";
import { L } from "../src/next/labels.ts";
import { connectionLock } from "../src/next/lib/connection-copy.ts";

const PHASES: Phase[] = ["edit", "review", "sending", "sent", "browser", "failed", "uncertain"];

test("rejectedBeforeSend: 건네받는 순간 이미 거절된 약속은 나가기 전의 거절이다", async () => {
  // `call` 은 소켓이 열려 있지 않으면 보내지도 않고 곧바로 거절한다.
  assert.equal(
    await rejectedBeforeSend(Promise.reject(new Error("아직 연결되지 않았습니다"))),
    true,
  );
});

test("rejectedBeforeSend: 보낸 뒤에 늦게 거절되는 약속은 나가기 전의 거절이 아니다", async () => {
  // 연결이 끊김 · 응답이 늦음 — 요청은 나갔으니 등록 여부를 모른다(확인 불가).
  const { promise, reject } = Promise.withResolvers<never>();
  const judged = rejectedBeforeSend(promise);
  reject(new Error("연결이 끊어졌습니다"));
  assert.equal(await judged, false);
  await promise.catch(() => undefined);
});

test("rejectedBeforeSend: 한참 뒤에 거절돼도 아직 도는 약속은 거절이 아니다", async () => {
  const { promise, reject } = Promise.withResolvers<never>();
  const judged = rejectedBeforeSend(promise);
  // 판정이 끝난 뒤(다음 매크로 태스크)의 거절 — 시계에 기대지 않아도 같은 답이다.
  await new Promise((resolve) => setTimeout(resolve, 5));
  reject(new Error("응답이 늦어졌습니다"));
  assert.equal(await judged, false);
  await promise.catch(() => undefined);
});

test("rejectedBeforeSend: 이미 답이 온 약속도 거절이 아니고, 판정이 약속의 거절을 새로 만들지 않는다", async () => {
  assert.equal(await rejectedBeforeSend(Promise.resolve({ kind: "sent" })), false);
  // 판정이 끝난 약속에 붙인 손이 처리되지 않은 거절을 남기지 않는다(시험 러너가 잡는다).
  const failing = Promise.reject(new Error("x"));
  await rejectedBeforeSend(failing);
  await failing.catch(() => undefined);
});

test("sendLockLine: 열려 있으면 잠그지 않고, 끊겼으면 이유 뒤에 약속을 붙인다", () => {
  assert.equal(sendLockLine(connectionLock("open", L), L), null);
  const offline = sendLockLine(connectionLock("closed", L), L);
  assert.equal(offline, `${L.chat.offline} — ${L.feedback.lockNote}`);
  // 잇는 중에는 잇는 중이라고 말한다.
  assert.equal(
    sendLockLine(connectionLock("connecting", L), L),
    `${L.chat.connecting} — ${L.feedback.lockNote}`,
  );
});

test("stageCopy: 판의 이름이 단계를 따라 바뀐다 — 모두 다르고 비어 있지 않다", () => {
  const titles = PHASES.map((phase) => stageCopy(phase, L).title);
  assert.ok(titles.every((title) => title.length > 0));
  assert.equal(new Set(titles).size, PHASES.length);
  assert.equal(stageCopy("review", L).title, L.feedback.reviewTitle);
  assert.equal(stageCopy("sending", L).title, L.feedback.sendingTitle);
  assert.equal(stageCopy("sent", L).title, L.feedback.sentHead);
});

test("stageCopy: 전송 중에는 닫아도 계속 보낸다는 한 줄이 선다", () => {
  assert.equal(stageCopy("sending", L).sub, L.feedback.sendingSub);
  assert.equal(stageCopy("sent", L).sub, null);
});

test("stepStates: 지난 점은 done, 지금은 now, 남은 것은 todo", () => {
  assert.deepEqual(stepStates("edit"), ["now", "todo", "todo"]);
  assert.deepEqual(stepStates("review"), ["done", "now", "todo"]);
  assert.deepEqual(stepStates("sending"), ["done", "done", "now"]);
  assert.deepEqual(stepStates("sent"), ["done", "done", "done"]);
});

test("stepStates: 브라우저 · 거절 · 확인 불가는 접수 점이 손을 기다린다", () => {
  for (const phase of ["browser", "failed", "uncertain"] as const) {
    assert.deepEqual(stepStates(phase), ["done", "done", "warn"]);
  }
});

test("counterState: 80% 부터 보이고, 90% 에 노랗고, 넘으면 빨갛다", () => {
  const max = 100;
  const at = (n: number) => counterState("가".repeat(n), max);
  assert.equal(at(0).shown, false);
  assert.equal(at(79).shown, false);
  assert.deepEqual(at(80), { used: 80, shown: true, tone: "calm" });
  assert.deepEqual(at(89), { used: 89, shown: true, tone: "calm" });
  assert.deepEqual(at(90), { used: 90, shown: true, tone: "warn" });
  assert.deepEqual(at(100), { used: 100, shown: true, tone: "warn" });
  assert.deepEqual(at(101), { used: 101, shown: true, tone: "over" });
});

test("counterState: 앞뒤 공백은 세지 않는다 — 한도를 가르는 잣대와 같다", () => {
  const padded = `  ${"가".repeat(100)}  \n`;
  assert.equal(counterState(padded, 100).used, 100);
  assert.equal(counterState(padded, 100).tone, "warn");
  assert.equal(counterState("   ", 100).used, 0);
});

test("closedArrival: 접수는 기쁜 소식, 나머지는 열어서 마저 하라는 말이다", () => {
  assert.equal(closedArrival(true, L), L.feedback.toastSent);
  assert.equal(closedArrival(false, L), L.feedback.toastNeedsYou);
  assert.notEqual(L.feedback.toastSent, L.feedback.toastNeedsYou);
});
