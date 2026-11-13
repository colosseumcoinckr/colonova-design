import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (name: string) =>
  readFileSync(new URL(`../src/next/plans/${name}`, import.meta.url), "utf8");
test("문서 관리 복구는 이전 목록 조회 뒤 새 조회를 기다리고 실패를 창에 남긴다", () => {
  const hand = source("use-plans.ts");
  const wait = hand.slice(hand.indexOf("const refreshListAndWait"), hand.indexOf("const openDoc"));
  assert.match(wait, /while \(listPending.current !== null\) await listPending.current/);
  assert.match(wait, /!\(await loadList\(true\)\)/);
  const dialog = source("doc-actions/DocOpDialog.tsx");
  const recover = dialog.slice(dialog.indexOf("const recover"), dialog.indexOf("const send"));
  assert.ok(recover.indexOf("await plans.refreshListAndWait()") < recover.indexOf("onClose()"));
  assert.match(recover, /catch[\s\S]*setRecoveryError\(true\)/);
});
test("숨은 문서 판의 동작을 머리에 돌리고 다른 대화 확인에서는 지난 오류를 비운다", () => {
  const header = source("PlansHeader.tsx");
  assert.match(header, /getClientRects\(\).length === 0/);
  assert.match(header, /state.docPhase !== "ready" \|\| docHidden/);
  assert.match(header, /ResizeObserver/);
  assert.match(header, /attributeFilter: \["data-tab", "data-chat"\]/);
  assert.match(
    source("PlansSidebar.tsx"),
    /setDeleteError\(null\);\s*setConfirmFor\(conv.threadId\)/,
  );
});
