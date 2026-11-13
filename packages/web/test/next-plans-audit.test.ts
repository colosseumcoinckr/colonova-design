import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (file: string) =>
  readFileSync(new URL(`../src/next/plans/${file}`, import.meta.url), "utf8");
// 2026-11-12 UI 조사 — 순수 판정 시험과 Chromium 여정에 더해 호출부의 보호 연결을 지킨다.
test("문서 관리 실패는 재조회, 결과 모름은 쓰기 재전송 없이 목록 가져오기로 잇는다", () => {
  const dialog = source("doc-actions/DocOpDialog.tsx");
  assert.match(dialog, /phase === "failed"[\s\S]*?onClick=\{\(\) => setRetry/);
  const recover = dialog.slice(dialog.indexOf("const recover ="), dialog.indexOf("const send ="));
  assert.match(recover, /await apiRef.current.confluenceImportNow\(\)/);
  assert.doesNotMatch(recover, /docTrash|docCopy|docMove|docRestore/);
  assert.match(dialog, /result\?\.state === "unknown"[\s\S]*?onClick=\{\(\) => void recover\(\)\}/);
  assert.match(recover, /await plans.refreshListAndWait\(\)/);
});
test("휴지통 재조회는 시작부터 로딩과 중복 방지를 세우고 옛 답을 버린다", () => {
  const trash = source("doc-actions/TrashDialog.tsx");
  assert.ok(trash.indexOf('setPhase("loading")') < trash.indexOf(".docTrashed()"));
  assert.match(trash, /if \(loading.current\) return/);
  assert.match(trash, /requests.isCurrent\(ticket, apiRef.current\)/);
  assert.match(trash, /requests.invalidate\(\)/);
});
test("대화 삭제는 진행 잠금과 실패 안내를 확인판에 유지한다", () => {
  const sidebar = source("PlansSidebar.tsx");
  assert.match(sidebar, /if \(deleteBusy.current\) return/);
  assert.match(sidebar, /busy=\{deleting === conv.threadId\}/);
  assert.match(sidebar, /busyWhy=\{deleting === conv.threadId \? L.drafts.convDeleting/);
  assert.match(sidebar, /deleteError &&[\s\S]*?role="alert"/);
  assert.doesNotMatch(sidebar, /if \(deleteBusy.current \|\| conv.running\)/);
});
test("읽기 머리의 확대 이름과 상태, 본문 실패 알림과 줄인 움직임을 연결한다", () => {
  const doc = source("PlanDocView.tsx");
  assert.match(doc, /aria-label=\{expanded \? L.plans.restoreDocument : L.plans.expandDocument\}/);
  assert.match(doc, /aria-expanded=\{expanded\}/);
  const view = source("view/DocView.tsx");
  assert.match(view, /missing &&[\s\S]*?role="status"[\s\S]*?pageMissing/);
  assert.match(view, /phase === "failed" \|\| phase === "too-large"[\s\S]*?role="status"/);
  assert.match(view, /scrollToTarget\(headings\[same\]/);
  assert.doesNotMatch(view, /behavior: "smooth"/);
});
