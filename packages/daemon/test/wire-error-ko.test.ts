import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseClientMessage } from "../../protocol/dist/messages.js";

/**
 * 선로 해석 실패의 한국어 답(2026-10-23 · 웹 검토 R2 의 3) — 스키마를 넘는 요청(제목 256자 ·
 * 근거 21개)은 선로에서 막히고, 화면에는 zod 의 영어 문장 대신 사람의 말이 오른다. 데몬 안의
 * 이음매는 submit-sent-wire 의 같은 감각으로 본문에서 못 박는다. 프로세스를 띄우지 않는 순수 시험이다.
 */

const create = (title: string) =>
  parseClientMessage(
    JSON.stringify({ id: "1", type: "draft.create", title, parentId: "1", parentType: "page" }),
  );

const ask = (refs: Array<Record<string, unknown>>) =>
  parseClientMessage(
    JSON.stringify({ id: "2", type: "draft.ask", docKey: "p-1", text: "이 절을 봐줘", refs }),
  );

test("256자 제목의 draft.create 는 선로에서 막힌다", () => {
  // 255자는 선을 안으므로, 256자가 막히는 건 한계값이 맞다는 뜻이다.
  assert.equal(create("가".repeat(255)).ok, true);
  const over = create("가".repeat(256));
  assert.equal(over.ok, false);
  if (!over.ok) assert.match(over.error, /title/);
});

test("21개 근거의 draft.ask 는 선로에서 막힌다", () => {
  assert.equal(ask(Array.from({ length: 20 }, (_, i) => ({ pageId: String(i + 1) }))).ok, true);
  const over = ask(Array.from({ length: 21 }, (_, i) => ({ pageId: String(i + 1) })));
  assert.equal(over.ok, false);
  if (!over.ok) assert.match(over.error, /refs/);
});

// 데몬의 이음매 — 막힌 요청의 답과 로그를 본문에서 못 박는다.
const src = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

test("선로 해석 실패의 답은 사람의 말이다", () => {
  const server = src("server.ts");
  const at = server.indexOf("if (!parsed.ok)");
  assert.ok(at > -1, "선로 해석 실패의 갈래가 사라졌다");
  const branch = server.slice(at, at + 700);
  assert.ok(
    branch.includes("요청을 읽지 못했어요 — 글이 너무 길거나 고른 것이 너무 많을 수 있어요"),
  );
  // zod 의 문장은 답에 오르지 않는다 — 검사 경로의 로그로만 흘러간다(사용자의 글은 남지 않는다).
  assert.ok(branch.includes('logger.info("선로 해석 실패"'));
  assert.doesNotMatch(branch, /message:\s*parsed\.error/);
});
