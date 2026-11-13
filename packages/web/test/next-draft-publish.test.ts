import assert from "node:assert/strict";
import { test } from "node:test";
import type { DraftPublishPreview, DraftPublishResult } from "@colonova-design/protocol";
import { L } from "../src/next/labels.ts";
// 순수 모듈 — src 에서 곧장 읽는다(next-drafts.test.ts 와 같은 모양).
import {
  blockerLines,
  changeSummary,
  newCommandId,
  nextNotation,
  previewStateOf,
  resultLine,
  stageInputNeeded,
} from "../src/next/plans/draft/publish-model.ts";

/**
 * 발행 확인의 순수 시험(2026-10-23 · 최종 구현 계획 F2) — 막는 이유의 열한 갈래, 바뀜 요약, 단계 표기,
 * 결과 처지의 문장이 리액트 없이 잡힌다.
 */

const preview = (overrides: Partial<DraftPublishPreview> = {}): DraftPublishPreview => ({
  docKey: "p-1",
  kind: "update",
  pageId: "1",
  title: "주문 기획",
  titleChanged: false,
  parent: { id: "2", type: "page", title: "기획서 묶음" },
  baseVersion: 3,
  remoteVersion: 3,
  draftRevision: 4,
  changes: { changed: 0, inserted: 0, deleted: 0, protectedRemoved: [] },
  stage: { current: "0.8", closed: false, required: false },
  blockers: [],
  checkedAt: "2026-10-23T09:00:00.000Z",
  ...overrides,
});

const result = (
  state: DraftPublishResult["state"],
  extra: Partial<DraftPublishResult> = {},
): DraftPublishResult => ({
  commandId: "0b1c2d3e-4f50-6a7b-8c9d-0e1f2a3b4c5d",
  docKey: "p-1",
  pageId: "1",
  version: null,
  detail: "",
  state,
  ...extra,
});

test("막는 이유 — 열한 갈래마다 글이 있고 다음 행동이 맞다", () => {
  const names = [
    "publish-disabled",
    "nothing-to-publish",
    "remote-newer",
    "remote-draft",
    "remote-draft-unknown",
    "remote-missing",
    "no-permission",
    "out-of-scope",
    "conflict-open",
    "pending-command",
    "unsupported-change",
  ] as const;
  const wantActions = [
    null,
    null,
    "rebase",
    "open-confluence",
    "open-confluence",
    null,
    "open-confluence",
    null,
    "resolve",
    "recheck",
    null,
  ];
  const lines = blockerLines(preview({ blockers: [...names] }));
  assert.deepEqual(
    lines.map((line) => line.text),
    names.map((name) => L.drafts.blocker[name]),
  );
  assert.ok(
    lines.every((line) => line.text !== ""),
    "글이 빈 이유가 있다",
  );
  assert.deepEqual(
    lines.map((line) => line.action),
    wantActions,
  );
});

test("한 줄 상태 — 판 숫자 셋 대신 처지를 고른다(2026-11-12 결정 ㉰)", () => {
  // 새 문서는 기준 판이 없다 — 원본 판과 무관하게 «새 문서» 가 선다.
  assert.equal(previewStateOf(preview({ baseVersion: null, remoteVersion: null })), "new");
  // 원본을 읽지 못하면 «확인하지 못했어요» — 기준 판과 견주는 말은 세우지 않는다.
  assert.equal(previewStateOf(preview({ remoteVersion: null })), "unread");
  // 원본이 출발 판보다 앞서면 «바뀌었어요» — 막는 판정(`remote-newer`)과는 다른 표시다.
  assert.equal(previewStateOf(preview({ baseVersion: 3, remoteVersion: 5 })), "moved");
  // 같은 판 · 본 적 없는 처지(원본이 기준보다 낮음)는 «최신에서 출발» 로 둔다.
  assert.equal(previewStateOf(preview({ baseVersion: 3, remoteVersion: 3 })), "latest");
  assert.equal(previewStateOf(preview({ baseVersion: 3, remoteVersion: 2 })), "latest");
  // 네 열쇠 모두 사람의 말이 있다 — 칸과 판정이 어긋나면 여기서 잡힌다.
  for (const key of ["new", "unread", "moved", "latest"] as const) {
    assert.ok(L.drafts.previewState[key].length > 0, `${key} 의 글이 비어 있다`);
  }
});

test("바뀜 요약 — 바뀜 · 새로 · 지움 수를 한 줄로 세고 지운 보호 조각은 사람의 말로 선다", () => {
  const lines = changeSummary(
    preview({
      changes: { changed: 2, inserted: 1, deleted: 0, protectedRemoved: ["macro:info", "image"] },
    }),
  );
  assert.deepEqual(lines, [
    "고침 2 · 새로 1",
    "정보 상자 — 지운 조각이 발행물에서도 빠져요",
    "이미지 — 지운 조각이 발행물에서도 빠져요",
  ]);
});

test("바뀜 요약 — 아무것도 바뀌지 않으면 아무 줄도 서지 않는다", () => {
  assert.deepEqual(changeSummary(preview()), []);
});

test("단계 표기 — 1.0 이상이면 새 표기와 사유를 받는다", () => {
  assert.equal(
    stageInputNeeded(preview({ stage: { current: "1.0", closed: true, required: true } })),
    true,
  );
  assert.equal(
    stageInputNeeded(preview({ stage: { current: "0.8", closed: false, required: false } })),
    false,
  );
});

test("다음 표기 — 같은 단계의 개정으로 한 걸음 더 가고, 마치지 못한 단계는 그대로다", () => {
  assert.equal(nextNotation("1.0"), "1.01");
  assert.equal(nextNotation("1.01"), "1.02");
  assert.equal(nextNotation("1.09"), "1.10");
  assert.equal(nextNotation("0.8"), "0.8");
  assert.equal(nextNotation(null), null);
});

test("결과 처지 — 여섯 처지마다 한 줄이 선다", () => {
  assert.equal(resultLine(result("applied", { version: 7 })), "발행했어요 — Confluence 판 7");
  assert.equal(resultLine(result("unknown")), "결과 확인 필요");
  assert.equal(resultLine(result("conflict")), L.drafts.resultConflict);
  assert.equal(
    resultLine(result("not-applied")),
    "이번 발행이 적용되지 않은 것으로 확인됐어요. 내용을 확인하고 다시 발행해 주세요.",
  );
  assert.equal(
    resultLine(result("failed", { detail: "Confluence 가 거절했어요" })),
    "Confluence 가 거절했어요",
  );
  assert.equal(resultLine(result("failed")), "발행하지 못했어요");
  assert.equal(resultLine(result("closed-unconfirmed")), L.drafts.resultClosed);
});

// 2026-11-12 UI 조사 검토 R5 — 새 문서가 없을 때도 같은 한 줄로 미적용과 다음 행동을 말한다.
test("새 문서 미적용 안내는 기존 원본이나 아래 이유를 전제하지 않는다", () => {
  assert.equal(
    resultLine(result("not-applied", { pageId: null, detail: "원격에 새 문서가 없다" })),
    "이번 발행이 적용되지 않은 것으로 확인됐어요. 내용을 확인하고 다시 발행해 주세요.",
  );
});

test("결과 처치의 실패 — 막는 이유의 기계 이름은 사람의 말로 바꿔 선다", () => {
  // 데몬이 보내기 전 검사의 막는 이유 이름을 그대로 실을 때의 몫이다(2026-10-23 화면 확인 · R2 검토 2).
  assert.equal(
    resultLine(result("failed", { detail: "pending-command" })),
    L.drafts.blocker["pending-command"],
  );
  assert.equal(
    resultLine(result("failed", { detail: "remote-newer" })),
    L.drafts.blocker["remote-newer"],
  );
  assert.equal(
    resultLine(result("failed", { detail: "publish-disabled" })),
    L.drafts.blocker["publish-disabled"],
  );
  // 모르는 글은 받은 대로 보인다.
  assert.equal(
    resultLine(result("failed", { detail: "Confluence 가 거절했어요" })),
    "Confluence 가 거절했어요",
  );
  assert.equal(resultLine(result("failed", { detail: "무슨 코드" })), "무슨 코드");
});

test("발행 명령의 열쇠 — 소문자 UUID 이고 부를 때마다 새것이다", () => {
  const id = newCommandId();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.notEqual(id, newCommandId());
});
