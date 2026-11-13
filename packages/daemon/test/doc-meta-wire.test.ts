import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClientMessage } from "../../protocol/dist/messages.js";

/**
 * Confluence 기능 확장의 선로 스키마(2026-10-30 사용자 요청) — doc-comments-wire.test.ts 의
 * parseClientMessage 양식. 첨부 · 라벨 · 판 기록 · 본문 찾기 · 보존 블록 그림 요청의 해석과
 * 한계값을 못 박는다. 프로세스를 띄우지 않는 순수 시험이다.
 */

const COMMAND_ID = "0b1e5f5a-6c7d-4e8f-9a0b-1c2d3e4f5a6b";
const parse = (message: Record<string, unknown>) =>
  parseClientMessage(JSON.stringify({ id: "w1", ...message }));

test("doc.attachment.read — 문서 id 는 숫자, 파일 이름은 1~255자", () => {
  assert.ok(parse({ type: "doc.attachment.read", pageId: "123", filename: "흐름도.png" }).ok);
  assert.ok(!parse({ type: "doc.attachment.read", pageId: "abc", filename: "a.png" }).ok);
  assert.ok(!parse({ type: "doc.attachment.read", pageId: "123", filename: "" }).ok);
});

test("doc.label.add · remove — 명령 아이디는 소문자 UUID, 라벨에 빈칸이 없다", () => {
  assert.ok(parse({ type: "doc.label.add", pageId: "1", commandId: COMMAND_ID, label: "정책" }).ok);
  assert.ok(
    parse({ type: "doc.label.remove", pageId: "1", commandId: COMMAND_ID, label: "old" }).ok,
  );
  assert.ok(
    !parse({ type: "doc.label.add", pageId: "1", commandId: COMMAND_ID, label: "두 단어" }).ok,
  );
  assert.ok(!parse({ type: "doc.label.add", pageId: "1", commandId: "X", label: "a" }).ok);
  assert.ok(!parse({ type: "doc.label.add", pageId: "1", commandId: COMMAND_ID, label: "" }).ok);
});

test("doc.versions · doc.version.read — 판은 1 이상의 정수", () => {
  assert.ok(parse({ type: "doc.versions", pageId: "1" }).ok);
  assert.ok(parse({ type: "doc.version.read", pageId: "1", version: 3 }).ok);
  assert.ok(!parse({ type: "doc.version.read", pageId: "1", version: 0 }).ok);
  assert.ok(!parse({ type: "doc.version.read", pageId: "1", version: 1.5 }).ok);
});

test("doc.search · doc.blockPreview — 찾는 말은 1~200자, 초안 열쇠는 모양을 지킨다", () => {
  assert.ok(parse({ type: "doc.search", query: "노쇼" }).ok);
  assert.ok(!parse({ type: "doc.search", query: "" }).ok);
  assert.ok(!parse({ type: "doc.search", query: "x".repeat(201) }).ok);
  assert.ok(parse({ type: "doc.blockPreview", docKey: "p-123" }).ok);
  assert.ok(parse({ type: "doc.blockPreview", docKey: `n-${"a".repeat(32)}` }).ok);
  assert.ok(!parse({ type: "doc.blockPreview", docKey: "../x" }).ok);
});
