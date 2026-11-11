import assert from "node:assert/strict";
import { test } from "node:test";
import type { DraftBlock } from "@colonova-design/protocol";
// 순수 모듈 — src 에서 곧장 읽는다(next-drafts.test.ts 와 같은 모양).
import {
  type DraftChangeRow,
  draftChangeRows,
} from "../src/next/plans/draft/change-review-model.ts";

/**
 * 초안 검토 줄의 모델 시험(2026-11-11 초안 검토 개선) — 편집기의 `Confluence 판과 견주기` 와 발행 확인 창의
 * 검토가 함께 쓰는 `draftChangeRows`. 계약은 둘이다:
 *   - 삽입 · 삭제 때문에 위치만 밀린 블록은 이동으로 세지 않는다(moved = false)
 *   - 공유 블록끼리의 상대 순서가 뒤바뀌었을 때만 이동이다(moved = true)
 * 최소 편집 횟수나 최적 이동 집합은 요구하지 않는다 — 상대 순서 대조만으로 잰다.
 */

const para = (id: string, text: string, status: DraftBlock["status"] = "same"): DraftBlock => ({
  id,
  view: { kind: "paragraph", text },
  editable: true,
  tokens: {},
  status,
});

const head = (id: string, text: string): DraftBlock => ({
  id,
  view: { kind: "heading", level: 2, text },
  editable: true,
  tokens: {},
  status: "same",
});

const table = (id: string, text: string): DraftBlock => ({
  id,
  view: { kind: "table", rows: [{ cells: [{ header: false, text }] }] },
  editable: true,
  tokens: {},
  status: "same",
});

const preserved = (id: string, label: string): DraftBlock => ({
  id,
  view: { kind: "preserved", label },
  editable: false,
  tokens: {},
  status: "same",
});

const byId = (rows: DraftChangeRow[]) => new Map(rows.map((row) => [row.id, row]));

/** 문단 · 제목 블록의 글 — 다른 종류면 null(단언 대신 좁힌다). */
const textOf = (block: DraftBlock | undefined): string | null => {
  const view = block?.view;
  return view && (view.kind === "paragraph" || view.kind === "heading") ? view.text : null;
};

/** 보존 블록의 이름표 — 다른 종류면 null. */
const labelOf = (block: DraftBlock | undefined): string | null => {
  const view = block?.view;
  return view && view.kind === "preserved" ? view.label : null;
};

test("본문 변경 — view 가 다르면 changed 이고 전 · 후 블록이 함께 선다", () => {
  const base = [para("b1", "옛 문장"), para("b2", "그대로")];
  const blocks = [para("b1", "새 문장", "changed"), para("b2", "그대로")];
  const rows = byId(draftChangeRows(base, blocks));
  assert.equal(rows.get("b1")?.kind, "changed");
  assert.equal(rows.get("b1")?.before?.view.kind, "paragraph");
  assert.equal(textOf(rows.get("b1")?.before), "옛 문장");
  assert.equal(textOf(rows.get("b1")?.after), "새 문장");
  assert.equal(rows.get("b1")?.moved, false);
  assert.equal(rows.get("b2")?.kind, "same");
});

test("제목 블록 변경 — 문단이 아니라 제목도 changed 로 잡힌다", () => {
  const base = [head("b0", "1. 목적"), para("b1", "본문")];
  const blocks = [
    { ...head("b0", "1. 목적과 범위"), status: "changed" as const },
    para("b1", "본문"),
  ];
  const rows = byId(draftChangeRows(base, blocks));
  assert.equal(rows.get("b0")?.kind, "changed");
  assert.equal(rows.get("b1")?.kind, "same");
});

test("서식만 변경 — 글은 같고 인라인 표식만 달라도 changed 다", () => {
  const base = [para("b1", "출고 지시는 재고 확정 뒤에 만든다")];
  const blocks = [para("b1", "출고 지시는 **재고 확정** 뒤에 만든다", "changed")];
  const rows = byId(draftChangeRows(base, blocks));
  assert.equal(rows.get("b1")?.kind, "changed");
  assert.equal(rows.get("b1")?.moved, false);
});

test("토큰만 다름 — view 가 같아도 토큰 맵이 다르면 changed 다", () => {
  const baseBlock = { ...para("b1", "상태는 ⟦t1⟧"), tokens: { t1: "macro:status" } };
  const afterBlock = { ...para("b1", "상태는 ⟦t1⟧", "changed"), tokens: { t1: "macro:note" } };
  const rows = draftChangeRows([baseBlock], [afterBlock]);
  assert.equal(rows[0]?.kind, "changed");
});

test("처지 표식만 바뀜 — view · 토큰이 같아도 status 가 same 이 아니면 changed 로 보인다", () => {
  // 데몬이 고침으로 표시해 둔 블록을 사람이 원문으로 되돌린 상태 — 검토는 그대로로 숨기지 않는다.
  const base = [para("b1", "같은 글")];
  const blocks = [para("b1", "같은 글", "changed")];
  const rows = draftChangeRows(base, blocks);
  assert.equal(rows[0]?.kind, "changed");
  assert.equal(rows[0]?.moved, false);
});

test("순서 바꿈 — 공유 블록의 상대 순서가 뒤바뀌면 moved = true 다", () => {
  const base = [para("b1", "하나"), para("b2", "둘"), para("b3", "셋")];
  const blocks = [para("b2", "둘"), para("b1", "하나"), para("b3", "셋")];
  const rows = byId(draftChangeRows(base, blocks));
  assert.equal(rows.get("b1")?.moved, true);
  assert.equal(rows.get("b2")?.moved, true);
  assert.equal(rows.get("b3")?.moved, false);
  // 내용이 안 바뀐 순수 순서 바꿈도 changed 줄로 선다 — 위치 변화 자체가 검토 대상이다.
  assert.equal(rows.get("b1")?.kind, "changed");
  assert.equal(rows.get("b2")?.kind, "changed");
  assert.equal(rows.get("b3")?.kind, "same");
  // 줄은 발행본 기준 몇 번째에서 몇 번째로 갔는지 알린다(1-based).
  assert.equal(rows.get("b2")?.beforePosition, 2);
  assert.equal(rows.get("b2")?.afterPosition, 1);
});

test("앞에 삽입으로 밀림 — 뒤로 밀려난 블록은 moved = false 다", () => {
  const base = [para("b1", "하나"), para("b2", "둘"), para("b3", "셋")];
  const blocks = [
    para("b1", "하나"),
    para("n1", "새로", "new"),
    para("b2", "둘"),
    para("b3", "셋"),
  ];
  const rows = byId(draftChangeRows(base, blocks));
  assert.equal(rows.get("n1")?.kind, "inserted");
  assert.equal(rows.get("n1")?.before, undefined);
  assert.equal(rows.get("b2")?.moved, false, "삽입으로 밀린 자리는 이동이 아니다");
  assert.equal(rows.get("b3")?.moved, false);
  assert.equal(rows.get("b2")?.kind, "same");
  // 실제 자리는 말한다 — b2 는 발행본 2번째에서 초안 3번째.
  assert.equal(rows.get("b2")?.beforePosition, 2);
  assert.equal(rows.get("b2")?.afterPosition, 3);
});

test("삭제로 밀림 — 앞 블록이 지워져 당겨진 블록도 moved = false 다", () => {
  const base = [para("b1", "하나"), para("b2", "둘"), para("b3", "셋")];
  const blocks = [para("b2", "둘"), para("b3", "셋")];
  const rows = byId(draftChangeRows(base, blocks));
  assert.equal(rows.get("b1")?.kind, "deleted");
  assert.equal(rows.get("b1")?.beforePosition, 1);
  assert.equal(rows.get("b1")?.afterPosition, null);
  assert.equal(rows.get("b1")?.after, undefined);
  assert.equal(rows.get("b2")?.moved, false, "삭제로 당겨진 자리는 이동이 아니다");
  assert.equal(rows.get("b3")?.moved, false);
  assert.equal(rows.get("b2")?.kind, "same");
});

test("삭제 보존 조각 — 지워진 preserved 블록도 deleted 줄로 남고 이전 모습을 보인다", () => {
  const base = [para("b1", "본문"), preserved("b4", "macro:info")];
  const blocks = [para("b1", "본문")];
  const rows = byId(draftChangeRows(base, blocks));
  assert.equal(rows.get("b4")?.kind, "deleted");
  assert.equal(rows.get("b4")?.before?.view.kind, "preserved");
  assert.equal(labelOf(rows.get("b4")?.before), "macro:info");
});

test("지운 줄은 끝에 — 초안에 남은 블록 뒤로 삭제 줄이 붙는다", () => {
  const base = [para("b1", "하나"), para("b2", "둘"), para("b3", "셋")];
  const blocks = [para("b2", "둘", "changed")];
  const rows = draftChangeRows(base, blocks);
  // 초안에 있는 줄이 먼저, 지운 줄(b1 · b3)이 뒤에 발행본 순서로 붙는다.
  assert.deepEqual(
    rows.map((row) => row.id),
    ["b2", "b1", "b3"],
  );
  assert.equal(rows[0]?.kind, "changed");
  assert.equal(rows[1]?.kind, "deleted");
  assert.equal(rows[2]?.kind, "deleted");
});

test("전부 그대로 — 바뀐 게 없으면 전 줄이 same 이고 moved 없다", () => {
  const base = [head("b0", "1. 목적"), para("b1", "본문"), table("b2", "셀")];
  const rows = draftChangeRows(
    base,
    base.map((block) => ({ ...block })),
  );
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.kind === "same"));
  assert.ok(rows.every((row) => row.moved === false));
});

test("새 문서 — 기준이 없으면 전 블록이 inserted 다", () => {
  const blocks = [head("b0", "1. 목적"), para("b1", "본문"), preserved("b2", "image")];
  const rows = draftChangeRows([], blocks);
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.kind === "inserted"));
  assert.ok(rows.every((row) => row.before === undefined));
  assert.ok(rows.every((row) => row.beforePosition === null));
  assert.deepEqual(
    rows.map((row) => row.afterPosition),
    [1, 2, 3],
  );
});

test("기준만 있는 빈 초안 — 전 블록이 deleted 다", () => {
  const base = [para("b1", "하나"), preserved("b4", "macro:info")];
  const rows = draftChangeRows(base, []);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.kind === "deleted"));
});
