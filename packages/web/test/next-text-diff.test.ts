import assert from "node:assert/strict";
import { test } from "node:test";
import type { DraftSummary } from "@colonova-design/protocol";
// 순수 모듈 — src 에서 곧장 읽는다(thread-model.test 와 같은 모양).
import { diffWords, hasChanges } from "../src/next/plans/draft/text-diff.ts";
import { draftMarkOf } from "../src/next/plans/plans-list.ts";

/**
 * Confluence 판과 견주기의 낱말 견주기와 사이드바 줄 끝 표시의 우선순위(2026-10-31 기획서 칸
 * 개선 §B · §E) — 리액트 없이 잰다.
 */

const summary = (overrides: Partial<DraftSummary> = {}): DraftSummary => ({
  docKey: "p-1",
  pageId: "1",
  title: "문서",
  revision: 1,
  state: "editing",
  changedBlocks: 2,
  baseVersion: 4,
  observedVersion: null,
  updatedAt: "2026-10-31T00:00:00.000Z",
  ...overrides,
});

test("견주기 — 같은 문장은 그대로 한 조각이다", () => {
  const pieces = diffWords(
    "출고 지시는 재고 확정 뒤에 만든다",
    "출고 지시는 재고 확정 뒤에 만든다",
  );
  assert.deepEqual(pieces, [{ kind: "same", text: "출고 지시는 재고 확정 뒤에 만든다" }]);
  assert.equal(hasChanges(pieces), false);
  assert.deepEqual(diffWords("", ""), []);
});

test("견주기 — 바뀐 글은 지운 조각과 더한 조각으로 갈라진다", () => {
  const pieces = diffWords("재시도는 3회다", "재시도는 5회다");
  assert.equal(hasChanges(pieces), true);
  const del = pieces.find((piece) => piece.kind === "del");
  const ins = pieces.find((piece) => piece.kind === "ins");
  assert.equal(del?.text.trim(), "3회다");
  assert.equal(ins?.text.trim(), "5회다");
  // 붙여 그리면 문장이 통한다 — 공백 조각이 사라지지 않았다.
  const joined = pieces.map((piece) => piece.text).join("");
  assert.equal(joined, "재시도는 3회다5회다");
});

test("견주기 — 지운 문장은 del 만, 더한 문장은 ins 만 남는다", () => {
  assert.deepEqual(diffWords("사라진 문장이다", ""), [{ kind: "del", text: "사라진 문장이다" }]);
  assert.deepEqual(diffWords("", "새 문장이다"), [{ kind: "ins", text: "새 문장이다" }]);
});

test("줄 끝 표시 — 결과 확인 필요가 이기고, 그다음이 충돌, 초안은 맨 뒤다(2026-10-31 E)", () => {
  assert.deepEqual(draftMarkOf(summary({ state: "result-unknown" })), {
    tone: "unknown",
    label: "결과 확인 필요",
  });
  assert.deepEqual(draftMarkOf(summary({ state: "conflict" })), {
    tone: "conflict",
    label: "충돌",
  });
  assert.deepEqual(draftMarkOf(summary({ changedBlocks: 3 })), {
    tone: "draft",
    label: "초안 · 3",
  });
  assert.deepEqual(draftMarkOf(summary({ changedBlocks: 0 })), {
    tone: "draft",
    label: "초안",
  });
});
