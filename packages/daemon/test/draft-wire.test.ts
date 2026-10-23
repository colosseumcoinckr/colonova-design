import assert from "node:assert/strict";
import { test } from "node:test";
import { draftStageOf, isDraftKey } from "../../protocol/dist/draft.js";
import { parseClientMessage } from "../../protocol/dist/messages.js";

/**
 * 초안 선로의 스키마(기획 올인원 · A3, 2026-10-23) — confluence-wire.test.ts 의 parseClientMessage
 * 양식. draft.* 요청의 해석과 한계값(열쇠 · 명령 열쇠 · 길이 · 개수 · 종류)을 못 박는다. 프로세스를
 * 띄우지 않는 순수 시험이다.
 */

/** 소문자 UUID — 발행 명령의 멱등 키. */
const COMMAND_ID = "6f1c2f6e-1c2b-4f8e-9a3d-7b2c5d4e3f21";

test("draft.list — id 만 실린다", () => {
  const parsed = parseClientMessage(JSON.stringify({ id: "d1", type: "draft.list" }));
  assert.ok(parsed.ok);
  if (parsed.ok) assert.equal(parsed.value.type, "draft.list");
});

test("draft.open — 페이지 id 로 연다", () => {
  const parsed = parseClientMessage(
    JSON.stringify({ id: "d2", type: "draft.open", pageId: "12345" }),
  );
  assert.ok(parsed.ok);
  if (parsed.ok) {
    assert.equal(parsed.value.type, "draft.open");
    const message = parsed.value as { pageId: string };
    assert.equal(message.pageId, "12345");
  }
});

test("draft.create — 부모와 이름으로 새 초안을 만들고 견본을 받을 수 있다", () => {
  const parsed = parseClientMessage(
    JSON.stringify({
      id: "d3",
      type: "draft.create",
      title: "새 기획서",
      parentId: "98765",
      parentType: "page",
      templatePageId: "11111",
    }),
  );
  assert.ok(parsed.ok);
  if (parsed.ok) assert.equal(parsed.value.type, "draft.create");

  const noTemplate = parseClientMessage(
    JSON.stringify({
      id: "d3b",
      type: "draft.create",
      title: "새 기획서",
      parentId: "98765",
      parentType: "folder",
    }),
  );
  assert.ok(noTemplate.ok);
});

test("draft.get · draft.discard · draft.cancel · draft.thread — 문서 열쇠 하나로 부른다", () => {
  for (const type of ["draft.get", "draft.discard", "draft.cancel", "draft.thread"]) {
    const parsed = parseClientMessage(JSON.stringify({ id: "x1", type, docKey: "p-42" }));
    assert.ok(parsed.ok, type);
    if (parsed.ok) assert.equal(parsed.value.type, type);
  }
});

test("draft.edit — 여러 걸음을 한 요청에 싣는다", () => {
  const parsed = parseClientMessage(
    JSON.stringify({
      id: "d4",
      type: "draft.edit",
      docKey: "p-42",
      expectedRevision: 3,
      edits: [
        { type: "set", blockId: "b0", view: { kind: "paragraph", text: "고친 문단" } },
        { type: "insert", afterBlockId: null, view: { kind: "heading", level: 2, text: "새 절" } },
        { type: "move", blockId: "b7", afterBlockId: "b1" },
        { type: "revert", blockId: "b9" },
        { type: "delete", blockId: "b8" },
        { type: "title", title: "출고 정책서 v0.9" },
      ],
    }),
  );
  assert.ok(parsed.ok);
  if (parsed.ok) {
    const message = parsed.value as { edits: Array<{ type: string }> };
    assert.equal(message.edits.length, 6);
  }
});

test("draft.ask — 말과 근거 문서를 싣는다", () => {
  const parsed = parseClientMessage(
    JSON.stringify({
      id: "d5",
      type: "draft.ask",
      docKey: "p-42",
      text: "둘째 절을 다듬어 주세요",
      refs: [{ pageId: "12345", sections: ["배경", "목표"] }],
    }),
  );
  assert.ok(parsed.ok);
  if (parsed.ok) {
    const message = parsed.value as { refs: Array<{ pageId: string; sections?: string[] }> };
    assert.deepEqual(message.refs, [{ pageId: "12345", sections: ["배경", "목표"] }]);
  }

  const noRefs = parseClientMessage(
    JSON.stringify({ id: "d5b", type: "draft.ask", docKey: "p-42", text: "요약해 주세요" }),
  );
  assert.ok(!noRefs.ok);
});

test("draft.adopt · draft.reject — 변경안을 골라 반영하거나 물린다", () => {
  const adopt = parseClientMessage(
    JSON.stringify({
      id: "d6",
      type: "draft.adopt",
      docKey: `n-${"0123456789abcdef".repeat(2)}`,
      proposalId: "pr-1",
      opIds: ["op-1", "op-2"],
      expectedRevision: 7,
    }),
  );
  assert.ok(adopt.ok);

  const reject = parseClientMessage(
    JSON.stringify({ id: "d7", type: "draft.reject", docKey: "p-42", proposalId: "pr-1" }),
  );
  assert.ok(reject.ok);

  const rejectSome = parseClientMessage(
    JSON.stringify({
      id: "d7b",
      type: "draft.reject",
      docKey: "p-42",
      proposalId: "pr-1",
      opIds: ["op-3"],
    }),
  );
  assert.ok(rejectSome.ok);
});

test("draft.publish — 명령 열쇠와 기대 개정, 필요하면 새 단계 표기와 사유를 싣는다", () => {
  const plain = parseClientMessage(
    JSON.stringify({
      id: "d8",
      type: "draft.publish",
      docKey: "p-42",
      commandId: COMMAND_ID,
      expectedRevision: 4,
    }),
  );
  assert.ok(plain.ok);

  const staged = parseClientMessage(
    JSON.stringify({
      id: "d8b",
      type: "draft.publish",
      docKey: "p-42",
      commandId: COMMAND_ID,
      expectedRevision: 4,
      stage: { notation: "1.1", reason: "출고 뒤 첫 개정" },
    }),
  );
  assert.ok(staged.ok);
});

test("draft.publish.recheck · draft.publish.close — 명령 열쇠만 싣는다", () => {
  for (const type of ["draft.publish.recheck", "draft.publish.close"]) {
    const parsed = parseClientMessage(JSON.stringify({ id: "x2", type, commandId: COMMAND_ID }));
    assert.ok(parsed.ok, type);
    if (parsed.ok) assert.equal(parsed.value.type, type);
  }
});

test("draft.rebase — 기준을 원격 최신본으로 옮긴다", () => {
  const parsed = parseClientMessage(
    JSON.stringify({ id: "d9", type: "draft.rebase", docKey: "p-42" }),
  );
  assert.ok(parsed.ok);
});

test("draft.resolve — 부딪친 블록을 고른다", () => {
  const mine = parseClientMessage(
    JSON.stringify({
      id: "d10",
      type: "draft.resolve",
      docKey: "p-42",
      blockId: "b3",
      choice: "mine",
    }),
  );
  assert.ok(mine.ok);

  const theirs = parseClientMessage(
    JSON.stringify({
      id: "d10b",
      type: "draft.resolve",
      docKey: "p-42",
      blockId: "b3",
      choice: "theirs",
    }),
  );
  assert.ok(theirs.ok);
});

test("draft.snapshot — pageId 와 docKey 중 정확히 하나를 싣는다", () => {
  const byPage = parseClientMessage(
    JSON.stringify({ id: "s1", type: "draft.snapshot", pageId: "12345" }),
  );
  assert.ok(byPage.ok);
  if (byPage.ok) assert.equal(byPage.value.type, "draft.snapshot");

  const byDoc = parseClientMessage(
    JSON.stringify({
      id: "s2",
      type: "draft.snapshot",
      docKey: "p-42",
      sections: ["배경", "목표"],
    }),
  );
  assert.ok(byDoc.ok);

  const both = parseClientMessage(
    JSON.stringify({ id: "s3", type: "draft.snapshot", pageId: "12345", docKey: "p-42" }),
  );
  assert.ok(!both.ok, "둘 다 싶은 요청은 거절이다");

  const none = parseClientMessage(JSON.stringify({ id: "s4", type: "draft.snapshot" }));
  assert.ok(!none.ok, "비워 둔 요청도 거절이다");

  const badKey = parseClientMessage(
    JSON.stringify({ id: "s5", type: "draft.snapshot", docKey: "p-x" }),
  );
  assert.ok(!badKey.ok);
});

test("문서 열쇠가 어긋나면 거절이다", () => {
  for (const docKey of ["../a", "p-x", "p-", "P-42", "n-123"]) {
    const parsed = parseClientMessage(JSON.stringify({ id: "r1", type: "draft.get", docKey }));
    assert.ok(!parsed.ok, docKey);
  }
});

test("발행 명령의 열쇠는 소문자 UUID 뿐이다", () => {
  for (const commandId of ["not-a-uuid", COMMAND_ID.toUpperCase(), COMMAND_ID.slice(1)]) {
    const parsed = parseClientMessage(
      JSON.stringify({
        id: "r2",
        type: "draft.publish",
        docKey: "p-42",
        commandId,
        expectedRevision: 1,
      }),
    );
    assert.ok(!parsed.ok, commandId);
  }
});

test("초안 대화의 말은 8,000자까지다", () => {
  const parsed = parseClientMessage(
    JSON.stringify({
      id: "r3",
      type: "draft.ask",
      docKey: "p-42",
      text: "가".repeat(8_001),
      refs: [],
    }),
  );
  assert.ok(!parsed.ok);
});

test("편집 걸음은 200개까지다", () => {
  const parsed = parseClientMessage(
    JSON.stringify({
      id: "r4",
      type: "draft.edit",
      docKey: "p-42",
      expectedRevision: 1,
      edits: Array.from({ length: 201 }, (_, i) => ({
        type: "revert",
        blockId: `b${i}`,
      })),
    }),
  );
  assert.ok(!parsed.ok);
});

test("모르는 블록 종류는 거절이다", () => {
  const parsed = parseClientMessage(
    JSON.stringify({
      id: "r5",
      type: "draft.edit",
      docKey: "p-42",
      expectedRevision: 1,
      edits: [{ type: "set", blockId: "b0", view: { kind: "quote", text: "인용" } }],
    }),
  );
  assert.ok(!parsed.ok);
});

test("기대 개정은 0 이상의 정수다", () => {
  for (const expectedRevision of [-1, 1.5]) {
    const parsed = parseClientMessage(
      JSON.stringify({
        id: "r6",
        type: "draft.edit",
        docKey: "p-42",
        expectedRevision,
        edits: [{ type: "revert", blockId: "b0" }],
      }),
    );
    assert.ok(!parsed.ok, String(expectedRevision));
  }
});

test("draftStageOf — 제목의 마지막 표기를 읽는다", () => {
  assert.deepEqual(draftStageOf("출고 정책서 v0.8"), { notation: "0.8", closed: false });
  assert.deepEqual(draftStageOf("정책서 v1.01"), { notation: "1.01", closed: true });
  assert.deepEqual(draftStageOf("v1.0 기능설계서 v0.9"), { notation: "0.9", closed: false });
});

test("draftStageOf — 표기가 아니면 없다", () => {
  assert.deepEqual(draftStageOf("dev2 정책"), { notation: null, closed: false });
  assert.deepEqual(draftStageOf("정책서"), { notation: null, closed: false });
});

test("isDraftKey — 초안의 열쇠만 통과한다", () => {
  assert.equal(isDraftKey("p-12345"), true);
  assert.equal(isDraftKey("n-0123456789abcdef0123456789abcdef"), true);
  assert.equal(isDraftKey("../a"), false);
  assert.equal(isDraftKey("p-x"), false);
  assert.equal(isDraftKey("n-0123456789abcdef"), false);
});
