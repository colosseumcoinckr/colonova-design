import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  new URL("../src/next/plans/comments/CommentComposer.tsx", import.meta.url),
  "utf8",
);
const reread = source.slice(source.indexOf("const reread ="), source.indexOf("const onKeyDown"));
// 2026-11-12 UI 조사 U-076 — 실제 부품의 지연·실패·왕복 입력 여정은 별도 Chromium 기록과 함께 본다.
test("재확인은 목록 차이를 성공 증거로 삼지 않고 처음 명령을 같은 아이디로 부른다", () => {
  assert.match(source, /pending.current = command/);
  assert.match(reread, /await pending.current\(\)/);
  assert.doesNotMatch(source, /recoveredComment|before: comments|row.body/);
  assert.ok(reread.indexOf("await pending.current()") < reread.indexOf("setCommandId("));
});
test("계속 모르면 목록 읽기와 적용이 끝나야 글을 남긴 채 잠금을 푼다", () => {
  const unknown = reread.slice(reread.indexOf("const reply = await"), reread.indexOf("} catch"));
  assert.ok(
    unknown.indexOf("await apiRef.current.docRead") <
      unknown.indexOf('setPhase({ state: "idle" })'),
  );
  assert.ok(
    unknown.indexOf("onReread(reply.comments)") < unknown.indexOf('setPhase({ state: "idle" })'),
  );
  assert.doesNotMatch(unknown, /setText/);
  assert.match(unknown, /reply.comments === null/);
});
test("요청이 던져지거나 목록 읽기가 실패하면 기존 명령과 잠금을 보존한다", () => {
  const catches = source.match(/} catch \{[\s\S]*?} finally/g) ?? [];
  assert.equal(catches.length, 2);
  for (const block of catches)
    assert.doesNotMatch(block, /setCommandId|pending.current = null|state: "idle"/);
});
