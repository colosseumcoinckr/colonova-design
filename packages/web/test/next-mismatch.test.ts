import assert from "node:assert/strict";
import test from "node:test";
import { L } from "../src/next/labels.ts";
import { mismatchRowKey } from "../src/next/lib/mismatch-model.ts";

/**
 * 어긋남 카드의 순수 재료 시험(2026-11-02 · 같이 고치기 UX 계획 C7 · C8) — 줄의 열쇠와 손이 채울
 * 브리프. 브리프는 파일 경로 · 컴포넌트 이름 없이 끝의 기준 한 줄로 닫는다(같은 계획 §3).
 * 문장 시험(next-labels · vocab-sweep)이 금칙어를 따로 본다.
 */

const row = {
  section: "비밀번호 규칙",
  plan: "비밀번호는 8자 이상이다.",
  screen: "10자 이상이다.",
  screenName: "회원가입",
};

test("줄의 열쇠 — 절과 화면 이름의 짝이 같으면 같은 열쇠다", () => {
  assert.equal(mismatchRowKey(row), mismatchRowKey({ ...row }));
  assert.notEqual(mismatchRowKey(row), mismatchRowKey({ ...row, screenName: "내 정보" }));
  assert.notEqual(mismatchRowKey(row), mismatchRowKey({ ...row, section: "휴면 전환" }));
});

test("기획서를 화면대로 브리프 — 화면의 말을 옮기고 기준 한 줄로 닫는다", () => {
  const brief = L.compare.applyBrief(row);
  assert.match(brief, /「비밀번호 규칙」 절의 규칙을 화면과 같게 고쳐 줘/);
  assert.match(brief, /화면\(회원가입\)은 10자 이상이다/);
  assert.ok(brief.endsWith("기준: 「비밀번호 규칙」 절이 화면과 같은 규칙을 말하면 끝이다."));
  assert.ok(!/[A-Za-z0-9_/]+\.(ts|tsx|js)\b/u.test(brief), "브리프에 파일 이름이 없다");
});

test("화면을 기획서대로 브리프 — 문서 이름과 기획서의 말을 옮기고 기준 한 줄로 닫는다", () => {
  const brief = L.compare.sendBrief(row, "회원가입 정책서");
  assert.match(brief, /「회원가입 정책서」 의 「비밀번호 규칙」 규칙을 기획서대로 맞춰 줘/);
  assert.match(brief, /기획서: 비밀번호는 8자 이상이다/);
  assert.ok(
    brief.endsWith(
      "기준: 화면의 비밀번호 규칙 이 「비밀번호 규칙」 절과 같은 규칙을 말하면 끝이다.",
    ),
  );
  assert.ok(!/[A-Za-z0-9_/]+\.(ts|tsx|js)\b/u.test(brief), "브리프에 파일 이름이 없다");
});
