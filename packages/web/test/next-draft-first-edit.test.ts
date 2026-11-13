import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * 초안 없는 문서의 첫 `고치기` 회복 배선(2026-11-01 실사용 관찰 수리) — 대화 판이 같은 열쇠로 먼저
 * 물어 「열려 있는 초안이 없습니다」에 죽어도, 편집기가 초안을 열면 다시 읽어 살아나는지를 마크업
 * 글로 잡는다(next-band-frame.test.ts 와 같은 눈). 리액트를 띄우지 않는다.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const editorTsx = read("../src/next/plans/draft/DraftEditor.tsx");
const columnTsx = read("../src/next/plans/PlansColumn.tsx");
const threadTsx = read("../src/next/plans/draft/use-draft-thread.ts");
const chatTsx = read("../src/next/plans/draft/PlanChat.tsx");

test("편집기가 초안을 열면 대화 판이 다시 읽는다 — 한 번만, 문서마다 한 번", () => {
  // 초안을 열었다는 판정 — 준비됐고 뷰가 있다.
  assert.match(
    columnTsx,
    /if \(draftHand\.phase !== "ready" \|\| draftHand\.view === null\) return;/,
  );
  // 같은 문서의 다시 읽기는 한 번만 — 문서 열쇠를 기억해 두 번째 준비에는 돌지 않는다.
  assert.match(columnTsx, /if \(openedKeyRef\.current === draftHand\.view\.docKey\) return;/);
  assert.match(columnTsx, /openedKeyRef\.current = draftHand\.view\.docKey;/);
  // 대화 판의 다시 읽기를 부른다.
  assert.match(columnTsx, /reloadThread\(\);/);
});

test("초안의 손은 칸이 쥔다 — 문서 판과 대화 칸이 같은 손을 본다", () => {
  // 칸이 손을 만든다 — 문서로 여는 길(첫 고치기)과 열쇠로 여는 길을 여기서 갈라.
  assert.match(columnTsx, /const draftHand = useDraft\(/);
  assert.match(columnTsx, /\? \{ pageId: draftPageId \}/);
  assert.match(columnTsx, /: \{ docKey: draftKey \}/);
  // 문서 판과 대화 칸이 같은 손을 받는다 — 대화 칸의 「읽는 중」 억제(draft?.phase)가 살아있다.
  assert.match(columnTsx, /draft=\{draftHand\}/);
  assert.match(columnTsx, /draft=\{editingDraft \? draftHand : null\}/);
  // 편집기는 손을 스스로 만들지 않는다 — 한 문서에 손이 둘이면 판이 어긋난다.
  assert.doesNotMatch(editorTsx, /useDraft\(/);
});

test("다시 읽기가 성공하면 지난 실패 문장은 거둔다 — 죽은 판이 회복되면 말도 바뀐다", () => {
  const reload = /const reload = useCallback\(/;
  assert.ok(reload.test(threadTsx), "대화 판의 다시 읽기가 있다");
  // 성공 갈래에서 실패 문장을 비운다(2026-11-01 실사용 관찰 — 초안이 생긴 뒤에도 남았다).
  const success =
    /\.then\(\(next\) => \{[\s\S]*?setPhase\("ready"\);[\s\S]*?setError\(null\);[\s\S]*?\}\)/;
  assert.match(threadTsx, success);
});

test("맡겨 둔 첫 말은 대화가 준비된 뒤에 한 번 간다 — 회복이 곧 첫 말의 길이다", () => {
  // 대화가 준비됐고 AI 가 돌지 않을 때만 꺼낸다 — 꺼내면 비워 두 번 가지 않는다.
  assert.match(
    chatTsx,
    /if \(docKey === null \|\| threadPhase !== "ready" \|\| threadRunning \|\| mutationLocked\) return;/,
  );
  assert.match(chatTsx, /const waiting = takeAsk\(docKey\);/);
});
