import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseClientMessage } from "@colonova-design/protocol";

/**
 * `repo.submit` 의 `sent`(2026-10-07 UX 점검 3단계) — 제출을 누를 때 확인 창이 보인 화면. 선택 필드라 옛 클라이언트의
 * 제출은 그대로 되고(선로 버전은 올리지 않는다), 모양이 다르거나 너무 많으면 선로가 막는다.
 */
const submit = (extra: Record<string, unknown>) =>
  parseClientMessage(JSON.stringify({ id: "1", type: "repo.submit", ...extra }));

test("sent 는 선택 필드다 — 없어도 된다", () => {
  assert.equal(submit({}).ok, true);
  assert.equal(submit({ note: "급하지 않아요" }).ok, true);
});

test("sent 는 화면 수와 앞선 제목 셋까지를 싣는다", () => {
  const read = submit({ sent: { screens: 4, titles: ["회원 목록", "회원 상세", "결제 내역"] } });
  assert.equal(read.ok, true);
  if (read.ok && read.value.type === "repo.submit") {
    assert.deepEqual(read.value.sent, {
      screens: 4,
      titles: ["회원 목록", "회원 상세", "결제 내역"],
    });
  }
  // 제목이 없어도 수만으로 선다.
  assert.equal(submit({ sent: { screens: 1, titles: [] } }).ok, true);
});

test("sent 의 수가 없거나 넘치거나 정수가 아니면 막는다", () => {
  assert.equal(submit({ sent: { screens: 0, titles: [] } }).ok, false);
  assert.equal(submit({ sent: { screens: 1000, titles: [] } }).ok, false);
  assert.equal(submit({ sent: { screens: 2.5, titles: [] } }).ok, false);
  assert.equal(submit({ sent: { titles: ["회원 목록"] } }).ok, false);
});

test("sent 의 제목이 넷이거나 비었거나 너무 길면 막는다", () => {
  assert.equal(submit({ sent: { screens: 4, titles: ["가", "나", "다", "라"] } }).ok, false);
  assert.equal(submit({ sent: { screens: 1, titles: [""] } }).ok, false);
  assert.equal(submit({ sent: { screens: 1, titles: ["가".repeat(61)] } }).ok, false);
  assert.equal(submit({ sent: "회원 목록" }).ok, false);
});

// 데몬 안의 이음매 — 선로 → 감독자의 제출 의도. 한 곳만 빠져도 영수증이 조용히 예전으로 돌아간다.
const src = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

test("sent 는 dispatch 의 두 길(확인 창 · 직접) 모두에서 감독자의 의도로 간다", () => {
  const dispatch = src("dispatch.ts");
  const calls =
    dispatch.match(
      /active\.supervisor\.submit\(\s*"button",\s*message\.sessionId,\s*message\.note \|\| undefined,\s*message\.sent,\s*\)/g,
    ) ?? [];
  assert.equal(calls.length, 2);
  // 대화로 낸 제출은 확인 창이 없다 — 화면을 지어내 싣지 않는다.
  assert.doesNotMatch(src("server.ts"), /supervisor\.submit\("chat",[^)]*sent/);
});
