import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClientMessage } from "../../protocol/dist/messages.js";

/**
 * 문서 관리 명령의 선로 스키마(2026-10-23 · 작업 D1a) — confluence-wire.test.ts 의
 * parseClientMessage 양식. 여섯 요청의 해석과 문서 · 명령 아이디의 모양 검사를 못 박는다.
 * 프로세스를 띄우지 않는 순수 시험이다.
 */

const COMMAND_ID = "0b1e5f5a-6c7d-4e8f-9a0b-1c2d3e4f5a6b";

test("doc.op.preview — 종류와 문서 아이디로 열리고 부모는 선택이다", () => {
  const withParent = parseClientMessage(
    JSON.stringify({
      id: "p1",
      type: "doc.op.preview",
      op: "move",
      pageId: "123",
      parentId: "77",
    }),
  );
  assert.ok(withParent.ok);
  const withoutParent = parseClientMessage(
    JSON.stringify({ id: "p2", type: "doc.op.preview", op: "trash", pageId: "123" }),
  );
  assert.ok(withoutParent.ok);
  // 모르는 종류는 선로에서 걸린다
  const unknownOp = parseClientMessage(
    JSON.stringify({ id: "p3", type: "doc.op.preview", op: "purge", pageId: "123" }),
  );
  assert.ok(!unknownOp.ok);
});

test("doc.trash — 문서 아이디와 명령 아이디가 필수다", () => {
  const ok = parseClientMessage(
    JSON.stringify({ id: "t1", type: "doc.trash", pageId: "123", commandId: COMMAND_ID }),
  );
  assert.ok(ok.ok);
  const missingCommand = parseClientMessage(
    JSON.stringify({ id: "t2", type: "doc.trash", pageId: "123" }),
  );
  assert.ok(!missingCommand.ok);
});

test("doc.restore — 휴지통 문서 아이디와 명령 아이디로 열린다", () => {
  const ok = parseClientMessage(
    JSON.stringify({ id: "r1", type: "doc.restore", pageId: "123", commandId: COMMAND_ID }),
  );
  assert.ok(ok.ok);
});

test("doc.copy — 제목 1~255자와 부모가 필수다", () => {
  const ok = parseClientMessage(
    JSON.stringify({
      id: "c1",
      type: "doc.copy",
      pageId: "123",
      commandId: COMMAND_ID,
      title: "합성 사본",
      parentId: "77",
    }),
  );
  assert.ok(ok.ok);

  const emptyTitle = parseClientMessage(
    JSON.stringify({
      id: "c2",
      type: "doc.copy",
      pageId: "123",
      commandId: COMMAND_ID,
      title: "",
      parentId: "77",
    }),
  );
  assert.ok(!emptyTitle.ok);

  const tooLongTitle = parseClientMessage(
    JSON.stringify({
      id: "c3",
      type: "doc.copy",
      pageId: "123",
      commandId: COMMAND_ID,
      title: "가".repeat(256),
      parentId: "77",
    }),
  );
  assert.ok(!tooLongTitle.ok);

  const missingParent = parseClientMessage(
    JSON.stringify({
      id: "c4",
      type: "doc.copy",
      pageId: "123",
      commandId: COMMAND_ID,
      title: "합성 사본",
    }),
  );
  assert.ok(!missingParent.ok);
});

test("doc.move — 새 부모가 필수다", () => {
  const ok = parseClientMessage(
    JSON.stringify({
      id: "m1",
      type: "doc.move",
      pageId: "123",
      commandId: COMMAND_ID,
      parentId: "77",
    }),
  );
  assert.ok(ok.ok);
  const missingParent = parseClientMessage(
    JSON.stringify({ id: "m2", type: "doc.move", pageId: "123", commandId: COMMAND_ID }),
  );
  assert.ok(!missingParent.ok);
});

test("doc.trashed — 몸 없이 열린다", () => {
  const ok = parseClientMessage(JSON.stringify({ id: "l1", type: "doc.trashed" }));
  assert.ok(ok.ok);
});

test("문서 아이디 — 숫자가 아니거나 너무 길면 거절이다", () => {
  const notNumber = parseClientMessage(
    JSON.stringify({
      id: "i1",
      type: "doc.trash",
      pageId: "p-123",
      commandId: COMMAND_ID,
    }),
  );
  assert.ok(!notNumber.ok);
  const tooLong = parseClientMessage(
    JSON.stringify({
      id: "i2",
      type: "doc.trash",
      pageId: "1".repeat(21),
      commandId: COMMAND_ID,
    }),
  );
  assert.ok(!tooLong.ok);
});

test("명령 아이디 — 소문자 UUID 가 아니면 거절이다", () => {
  const upper = parseClientMessage(
    JSON.stringify({
      id: "u1",
      type: "doc.trash",
      pageId: "123",
      commandId: COMMAND_ID.toUpperCase(),
    }),
  );
  assert.ok(!upper.ok);
  const notUuid = parseClientMessage(
    JSON.stringify({ id: "u2", type: "doc.trash", pageId: "123", commandId: "다시 보내기" }),
  );
  assert.ok(!notUuid.ok);
});
