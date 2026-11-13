// 미리보기 키 넘김의 순수 판정 시험(2026-11-12 UI 조사 U-180) — 조합 중인 키는
// 게스트에 남고, 봉투가 alt 와 조합 여부를 잃지 않는다. `../dist` 임포트인
// 이유는 다른 데스크톱 시험과 같다(src 의 `.js` 지정자를 node --test 가 못 읽는다).
import assert from "node:assert/strict";
import { test } from "node:test";
import { forwardPreviewKey, type PreviewKeyInput } from "../dist/preview-keys.js";

function key(partial: Partial<PreviewKeyInput>): PreviewKeyInput {
  return {
    type: "keyDown",
    key: "k",
    isComposing: false,
    meta: true,
    shift: false,
    alt: false,
    control: false,
    ...partial,
  };
}

test("조합 중인 키는 어떤 것이든 게스트에 남긴다 — 찍기 · 겹판 닫기로 새지 않는다", () => {
  assert.equal(forwardPreviewKey(key({ key: "Escape", isComposing: true })), null);
  assert.equal(forwardPreviewKey(key({ isComposing: true })), null);
  assert.equal(forwardPreviewKey(key({ key: "p", shift: true, isComposing: true })), null);
});

test("조합이 아닌 Esc 와 웹 지도의 코드는 예전처럼 넘어간다", () => {
  assert.deepEqual(forwardPreviewKey(key({ key: "Escape", meta: false })), {
    key: "Escape",
    meta: false,
    shift: false,
    alt: false,
    control: false,
    composing: false,
  });
  assert.deepEqual(forwardPreviewKey(key({ key: "p", shift: true })), {
    key: "p",
    meta: true,
    shift: true,
    alt: false,
    control: false,
    composing: false,
  });
  // Windows/Linux 의 ⌘ 자리는 control — 같은 수정자로 본다(D71).
  assert.deepEqual(forwardPreviewKey(key({ meta: false, control: true })), {
    key: "k",
    meta: false,
    shift: false,
    alt: false,
    control: true,
    composing: false,
  });
});

test("봉투가 alt 를 잃지 않는다 — 재생 쪽의 altKey 가 살아야 한다(U-180)", () => {
  const envelope = forwardPreviewKey(key({ key: "k", alt: true }));
  assert.equal(envelope?.alt, true);
  // 대문자 K 도 코드로 넘어간다(옛 게이트와 같은 목록).
  assert.equal(forwardPreviewKey(key({ key: "K", alt: true }))?.key, "K");
});

test("넘기지 않던 것은 그대로 넘기지 않는다", () => {
  assert.equal(forwardPreviewKey(key({ type: "char" })), null);
  assert.equal(forwardPreviewKey(key({ type: "rawKeyDown", key: "Escape" })), null);
  assert.equal(forwardPreviewKey(key({ key: "k", meta: false, control: false })), null);
  assert.equal(forwardPreviewKey(key({ key: "p", shift: false })), null);
  assert.equal(forwardPreviewKey(key({ key: "t" })), null);
});
