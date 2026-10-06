import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-conv-title.test.ts 와 같은 모양).
import { PIN_SHOT_MAX, pinsBeyondShots, pinsWordless } from "../src/next/lib/pin-words.ts";

/**
 * 핀을 보낼 때의 두 한계(2026-10-06 UX 점검): 사진은 앞 여섯 곳까지, 말이 어디에도 없는 핀은 보내지 않는다.
 * 둘 다 말없이 지나가던 것이다.
 */
test("pinsBeyondShots: 여섯까지는 모두 사진이 간다, 일곱째부터 센다", () => {
  assert.equal(PIN_SHOT_MAX, 6);
  assert.equal(pinsBeyondShots(0), 0);
  assert.equal(pinsBeyondShots(6), 0);
  assert.equal(pinsBeyondShots(7), 1);
  assert.equal(pinsBeyondShots(9), 3);
});

test("pinsWordless: 입력창의 글도 핀 메모도 비어 있을 때만 말이 없다", () => {
  const blank = [{ note: "" }, { note: "   " }];
  assert.equal(pinsWordless("", blank), true);
  assert.equal(pinsWordless("   \n", blank), true, "공백뿐인 글은 말이 아니다");
  assert.equal(pinsWordless("버튼을 크게", blank), false, "입력창에 말이 있다");
  assert.equal(
    pinsWordless("", [{ note: "" }, { note: "더 크게" }]),
    false,
    "한 핀에라도 메모가 있다",
  );
});

test("pinsWordless: 핀이 없으면 이 판정의 일이 아니다", () => {
  assert.equal(pinsWordless("", []), false);
});

test("사진 한도의 숫자는 한 곳 — 보내는 쪽이 같은 상수로 자른다", () => {
  const send = readFileSync(new URL("../src/next/chat/ChatColumn.tsx", import.meta.url), "utf8");
  assert.match(send, /sent\.slice\(0, PIN_SHOT_MAX\)/, "ChatColumn 이 PIN_SHOT_MAX 로 자른다");
  assert.doesNotMatch(send, /sent\.slice\(0, 6\)/, "리터럴 6 으로 자르지 않는다");
});

test("말 없는 핀 · 사진 한도의 문장은 labels 에 있고 개수를 말한다", async () => {
  const { L } = await import("../src/next/labels.ts");
  assert.match(L.composer.pinNeedsWords, /무엇을 바꿀지/);
  assert.match(L.composer.pinShotCap(3), /앞 여섯 곳/);
  assert.match(L.composer.pinShotCap(3), /3곳/);
});
