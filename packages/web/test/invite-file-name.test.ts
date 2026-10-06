import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-labels.test.ts 와 같은 모양).
import { isInviteFile } from "../src/lib/invite-bus.ts";
import { readInviteFile } from "../src/lib/invite-import.ts";
import { L } from "../src/next/labels.ts";

/** 이름만 가진 가짜 파일 — 내용은 JSON 이 아니라 내용 문의 정해진 오류를 낸다. */
function named(name: string): File {
  return new File(["초대장이 아닌 내용"], name, { type: "text/plain" });
}

test("isInviteFile: 초대 파일 확장자를 받는다", () => {
  assert.equal(isInviteFile(named("회원 관리.colonova-invite")), true);
  assert.equal(isInviteFile(named("사진.png")), false);
  assert.equal(isInviteFile(named("a.colonova-invite.txt")), false);
  // 대소문자는 구분한다 — 데스크톱 지우기(invite-discard)와 같은 잣대.
  assert.equal(isInviteFile(named("a.COLONOVA-INVITE")), false);
});

test("readInviteFile: 초대 파일이 아니면 확장자를 말하지 않는 문장으로 거절한다", async () => {
  const read = await readInviteFile(named("사진.png"));
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.error, L.invite.errNotInvite);
});

test("readInviteFile: 초대 파일은 이름 문을 지나 내용 문에서 답한다", async () => {
  const read = await readInviteFile(named("회원 관리.colonova-invite"));
  assert.equal(read.ok, false);
  if (read.ok) return;
  assert.equal(read.error, L.invite.errUnreadable);
});
