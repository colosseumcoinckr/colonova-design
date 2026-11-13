import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClientMessage } from "../../protocol/dist/messages.js";

/**
 * 문서 코멘트 명령의 선로 스키마(2026-10-23 · 작업 D2a) — doc-ops-wire.test.ts 의
 * parseClientMessage 양식. 네 요청의 해석과 명령 아이디 · 본문 길이 · 인라인 닻의
 * 검사를 못 박는다. 프로세스를 띄우지 않는 순수 시험이다.
 */

const COMMAND_ID = "0b1e5f5a-6c7d-4e8f-9a0b-1c2d3e4f5a6b";

test("doc.comment.create — anchor 가 없으면 바닥글, 있으면 인라인으로 열린다", () => {
  const footer = parseClientMessage(
    JSON.stringify({
      id: "c1",
      type: "doc.comment.create",
      pageId: "123",
      commandId: COMMAND_ID,
      text: "합성 코멘트",
    }),
  );
  assert.ok(footer.ok);
  const inline = parseClientMessage(
    JSON.stringify({
      id: "c2",
      type: "doc.comment.create",
      pageId: "123",
      commandId: COMMAND_ID,
      text: "합성 코멘트",
      anchor: { selection: "데이터 모델 SSoT", index: 1 },
    }),
  );
  assert.ok(inline.ok);
  // 본문이 비면 거절이다
  const empty = parseClientMessage(
    JSON.stringify({
      id: "c3",
      type: "doc.comment.create",
      pageId: "123",
      commandId: COMMAND_ID,
      text: "",
    }),
  );
  assert.ok(!empty.ok);
});

test("doc.comment.reply — 부모 · 종류 · 본문이 필수다", () => {
  const ok = parseClientMessage(
    JSON.stringify({
      id: "r1",
      type: "doc.comment.reply",
      pageId: "123",
      commandId: COMMAND_ID,
      parentId: "41",
      kind: "footer",
      text: "합성 답글",
    }),
  );
  assert.ok(ok.ok);
  const noParent = parseClientMessage(
    JSON.stringify({
      id: "r2",
      type: "doc.comment.reply",
      pageId: "123",
      commandId: COMMAND_ID,
      kind: "inline",
      text: "합성 답글",
    }),
  );
  assert.ok(!noParent.ok);
  const unknownKind = parseClientMessage(
    JSON.stringify({
      id: "r3",
      type: "doc.comment.reply",
      pageId: "123",
      commandId: COMMAND_ID,
      parentId: "41",
      kind: "side",
      text: "합성 답글",
    }),
  );
  assert.ok(!unknownKind.ok);
});

test("doc.comment.update — 코멘트 · 종류 · 현재 판이 필수다", () => {
  const ok = parseClientMessage(
    JSON.stringify({
      id: "u1",
      type: "doc.comment.update",
      pageId: "123",
      commandId: COMMAND_ID,
      commentId: "41",
      kind: "inline",
      version: 3,
      text: "고친 코멘트",
    }),
  );
  assert.ok(ok.ok);
  const noVersion = parseClientMessage(
    JSON.stringify({
      id: "u2",
      type: "doc.comment.update",
      pageId: "123",
      commandId: COMMAND_ID,
      commentId: "41",
      kind: "inline",
      text: "고친 코멘트",
    }),
  );
  assert.ok(!noVersion.ok);
  const zeroVersion = parseClientMessage(
    JSON.stringify({
      id: "u3",
      type: "doc.comment.update",
      pageId: "123",
      commandId: COMMAND_ID,
      commentId: "41",
      kind: "inline",
      version: 0,
      text: "고친 코멘트",
    }),
  );
  assert.ok(!zeroVersion.ok);
});

test("doc.comment.resolve — 해결 여부가 필수다(인라인의 몫)", () => {
  const ok = parseClientMessage(
    JSON.stringify({
      id: "s1",
      type: "doc.comment.resolve",
      pageId: "123",
      commandId: COMMAND_ID,
      commentId: "32",
      version: 2,
      resolved: true,
    }),
  );
  assert.ok(ok.ok);
  const reopen = parseClientMessage(
    JSON.stringify({
      id: "s2",
      type: "doc.comment.resolve",
      pageId: "123",
      commandId: COMMAND_ID,
      commentId: "32",
      version: 2,
      resolved: false,
    }),
  );
  assert.ok(reopen.ok);
  const noResolved = parseClientMessage(
    JSON.stringify({
      id: "s3",
      type: "doc.comment.resolve",
      pageId: "123",
      commandId: COMMAND_ID,
      commentId: "32",
      version: 2,
    }),
  );
  assert.ok(!noResolved.ok);
});

test("명령 아이디 — 소문자 UUID 가 아니면 거절이다", () => {
  const upper = parseClientMessage(
    JSON.stringify({
      id: "i1",
      type: "doc.comment.create",
      pageId: "123",
      commandId: COMMAND_ID.toUpperCase(),
      text: "합성 코멘트",
    }),
  );
  assert.ok(!upper.ok);
  const notUuid = parseClientMessage(
    JSON.stringify({
      id: "i2",
      type: "doc.comment.create",
      pageId: "123",
      commandId: "다시 보내기",
      text: "합성 코멘트",
    }),
  );
  assert.ok(!notUuid.ok);
});

test("본문 — 10,000자를 넘으면 거절이다", () => {
  const tooLong = parseClientMessage(
    JSON.stringify({
      id: "l1",
      type: "doc.comment.create",
      pageId: "123",
      commandId: COMMAND_ID,
      text: "가".repeat(10001),
    }),
  );
  assert.ok(!tooLong.ok);
  const edge = parseClientMessage(
    JSON.stringify({
      id: "l2",
      type: "doc.comment.create",
      pageId: "123",
      commandId: COMMAND_ID,
      text: "가".repeat(10000),
    }),
  );
  assert.ok(edge.ok);
});

test("인라인 닻 — 문장이 비었거나 index 가 음수·개수이면 거절이다", () => {
  const emptySelection = parseClientMessage(
    JSON.stringify({
      id: "a1",
      type: "doc.comment.create",
      pageId: "123",
      commandId: COMMAND_ID,
      text: "합성 코멘트",
      anchor: { selection: "", index: 0 },
    }),
  );
  assert.ok(!emptySelection.ok);
  const negativeIndex = parseClientMessage(
    JSON.stringify({
      id: "a2",
      type: "doc.comment.create",
      pageId: "123",
      commandId: COMMAND_ID,
      text: "합성 코멘트",
      anchor: { selection: "데이터 모델 SSoT", index: -1 },
    }),
  );
  assert.ok(!negativeIndex.ok);
  const fractionalIndex = parseClientMessage(
    JSON.stringify({
      id: "a3",
      type: "doc.comment.create",
      pageId: "123",
      commandId: COMMAND_ID,
      text: "합성 코멘트",
      anchor: { selection: "데이터 모델 SSoT", index: 1.5 },
    }),
  );
  assert.ok(!fractionalIndex.ok);
});
