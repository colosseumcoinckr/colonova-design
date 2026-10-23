import assert from "node:assert/strict";
import { test } from "node:test";
import { L } from "../src/next/labels.ts";
// 순수 모듈 — src 에서 곧장 읽는다(next-doc-actions.test.ts 와 같은 모양).
import {
  commentActions,
  commentFailLine,
  commentThreads,
  composerCount,
  inlineAnchor,
} from "../src/next/plans/comments/comments-model.ts";
import { type PlanCommentRow, planCommentRows } from "../src/next/plans/plans-list.ts";

/**
 * 문서 코멘트 쓰기 도우미의 순수 시험(2026-10-23 · 최종 구현 계획 F4 · 작업 D2b) — 스레드 묶기 · 줄마다
 * 단추 · 인라인 닻 판정 · 실패의 말 · 글자 수가 리액트 없이 잡힌다.
 */

/** doc.read 의 코멘트 표본 — 쓰기의 재료만 바꿔 쓴다. */
const comment = (over: {
  body: string;
  author?: string;
  anchorText?: string | null;
  id?: string;
  kind?: "footer" | "inline";
  version?: number;
  parentId?: string | null;
  editable?: boolean;
}) => ({
  author: over.author ?? "정인권",
  body: over.body,
  createdAt: "2026-10-23T01:00:00Z",
  anchorText: over.anchorText ?? null,
  ...(over.id === undefined ? {} : { id: over.id }),
  ...(over.kind === undefined ? {} : { kind: over.kind }),
  ...(over.version === undefined ? {} : { version: over.version }),
  ...(over.parentId === undefined ? {} : { parentId: over.parentId }),
  ...(over.editable === undefined ? {} : { editable: over.editable }),
});

/** 한 줄짜리 표본 — 첫 줄이 반드시 있다. */
function firstRow(rows: PlanCommentRow[]): PlanCommentRow {
  const row = rows[0];
  assert.ok(row !== undefined);
  return row;
}

test("코멘트 묶음 — 답글은 부모 아래로, 부모를 잃은 바닥글 답글은 맨 위로, 인라인 답글은 숨는다", () => {
  const rows = planCommentRows([
    comment({ id: "c1", kind: "footer", body: "첫 코멘트", version: 1 }),
    comment({ id: "c2", kind: "footer", body: "둘째 코멘트", version: 1, parentId: "c1" }),
    // 부모 c9 는 목록에 없다(해결된 스레드) — 바닥글 답글은 맨 위 줄로 선다.
    comment({ id: "c3", kind: "footer", body: "외톨이 답글", version: 1, parentId: "c9" }),
    // 같은 형편의 인라인 답글은 숨는다.
    comment({
      id: "c4",
      kind: "inline",
      body: "숨을 답글",
      version: 1,
      parentId: "c8",
      anchorText: "문장",
    }),
    comment({ id: "c5", kind: "footer", body: "셋째 코멘트", version: 1 }),
    // 답글의 답글도 같은 스레드에 들어간다.
    comment({ id: "c6", kind: "footer", body: "답글의 답글", version: 1, parentId: "c2" }),
  ]);
  const threads = commentThreads(rows);
  assert.deepEqual(
    threads.map((thread) => [thread.top.id, ...thread.replies.map((reply) => reply.id)]),
    [["c1", "c2", "c6"], ["c3"], ["c5"]],
  );
});

test("코멘트 묶음 — id 없는 옛 줄은 그대로 맨 위 줄로 선다", () => {
  const threads = commentThreads(planCommentRows([comment({ body: "옛 데몬의 코멘트" })]));
  assert.equal(threads.length, 1);
  assert.deepEqual(threads[0]?.replies, []);
});

test("줄마다 단추 — 답글은 맨 위만, 고치기는 재료가 갖춰진 줄만, 해결은 인라인 맨 위만", () => {
  const footerTop = firstRow(
    planCommentRows([comment({ id: "c1", kind: "footer", body: "a", version: 1 })]),
  );
  assert.deepEqual(commentActions(footerTop, true), ["reply"]);

  const inlineTop = firstRow(
    planCommentRows([
      comment({ id: "c2", kind: "inline", body: "a", version: 1, anchorText: "문장" }),
    ]),
  );
  assert.deepEqual(commentActions(inlineTop, true), ["reply", "resolve"]);
  // 답글 줄에는 답글 · 해결이 서지 않는다.
  assert.deepEqual(commentActions(inlineTop, false), []);

  const editable = firstRow(
    planCommentRows([comment({ id: "c3", kind: "footer", body: "a", version: 2, editable: true })]),
  );
  assert.deepEqual(commentActions(editable, true), ["reply", "edit"]);
  // 남의 코멘트 · 서식 있는 코멘트는 고쳐도 잃는 것이 있어 고치기가 서지 않는다.
  const notEditable = firstRow(
    planCommentRows([
      comment({ id: "c4", kind: "footer", body: "a", version: 2, editable: false }),
    ]),
  );
  assert.deepEqual(commentActions(notEditable, true), ["reply"]);

  // id 나 version 이 없는 줄(옛 데몬)에는 아무 단추도 서지 않는다.
  assert.deepEqual(commentActions(firstRow(planCommentRows([comment({ body: "a" })])), true), []);
  assert.deepEqual(
    commentActions(
      firstRow(planCommentRows([comment({ id: "c5", kind: "footer", body: "a" })])),
      true,
    ),
    [],
  );
});

test("인라인 닻 — 빈 선택 · 줄바꿈 · 너무 김 · 0번 · 2번을 막고 1번만 통과시킨다", () => {
  const body = "첫 문단의 문장이다.\n둘째 문단의 문장이다. 둘째 문단의 문장이다.";
  assert.deepEqual(inlineAnchor(body, "   "), { ok: false, reason: "empty" });
  assert.deepEqual(inlineAnchor(body, "문장이다.\n둘째"), { ok: false, reason: "multi-block" });
  assert.deepEqual(inlineAnchor(body, "가".repeat(501)), { ok: false, reason: "too-long" });
  assert.equal(inlineAnchor(body, "가".repeat(500)).ok, false);
  // 본문에 없는 문장(0번)과 두 번 나오는 문장(2번)은 다시 고르게 한다.
  assert.deepEqual(inlineAnchor(body, "없는 문장"), { ok: false, reason: "repeated" });
  assert.deepEqual(inlineAnchor(body, "둘째 문단의 문장이다"), { ok: false, reason: "repeated" });
  // 공백의 꼴이 달라도 같다고 본다 — 앞뒤 공백도 벗는다.
  assert.deepEqual(inlineAnchor(body, "  첫 문단의 문장이다. "), {
    ok: true,
    selection: "첫 문단의 문장이다.",
    index: 0,
  });
});

test("인라인 닻 — 본문의 공백 꼴(연속 · nbsp)을 하나로 보고 센다", () => {
  const body = "가나\u00a0\u00a0다라    마바";
  assert.deepEqual(inlineAnchor(body, "가나 다라"), {
    ok: true,
    selection: "가나 다라",
    index: 0,
  });
});

test("실패의 말 — 여덟 기계 이름은 각각 사람의 말, 그 밖은 실패 한 줄에 받은 글을 보탠다", () => {
  const eight = [
    "publish-disabled",
    "out-of-scope",
    "anchor-missing",
    "anchor-ambiguous",
    "comment-changed",
    "comment-missing",
    "comment-not-plain",
    "comment-unreadable",
  ] as const;
  for (const name of eight) {
    assert.deepEqual(commentFailLine(name), { line: L.comments.reason[name], sub: null });
  }
  assert.equal(
    commentFailLine("publish-disabled").line,
    "지금은 이 앱에서 Confluence 에 쓰기가 꺼져 있어요 — Confluence 에서 직접 남겨 주세요",
  );
  // 모르는 이름 — 실패의 한 줄과 작은 둘째 줄.
  assert.deepEqual(commentFailLine("token-expired"), {
    line: L.comments.failed,
    sub: "token-expired",
  });
  assert.deepEqual(commentFailLine(""), { line: L.comments.failed, sub: null });
  assert.deepEqual(commentFailLine("  "), { line: L.comments.failed, sub: null });
});

test("입력의 글자 수 — 9,000자를 넘기면 남은 수, 상한을 넘기면 넘은 수를 말한다", () => {
  // 빈 글 · 공백뿐은 보낼 수 없다.
  assert.deepEqual(composerCount(""), { note: null, sendable: false });
  assert.deepEqual(composerCount("  "), { note: null, sendable: false });
  assert.deepEqual(composerCount("한 마디"), { note: null, sendable: true });
  // 9,000자까지는 말이 없다.
  assert.deepEqual(composerCount("가".repeat(9000)), { note: null, sendable: true });
  assert.deepEqual(composerCount("가".repeat(9001)), {
    note: "999자 더 쓸 수 있어요",
    sendable: true,
  });
  assert.deepEqual(composerCount("가".repeat(10000)), {
    note: "0자 더 쓸 수 있어요",
    sendable: true,
  });
  // 상한을 넘으면 넘은 수를 말하고 보낼 수 없다.
  assert.deepEqual(composerCount("가".repeat(10001)), {
    note: "1자 넘었어요 — 줄여 주세요",
    sendable: false,
  });
});
