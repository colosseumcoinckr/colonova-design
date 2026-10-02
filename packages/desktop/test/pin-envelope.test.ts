import assert from "node:assert/strict";
import { test } from "node:test";
import { isPinEnvelope, isPinFocus } from "../src/pin-envelope.ts";

/**
 * 오버레이 다리는 연결 레포의 페이지 스크립트도 부를 수 있다 — 봉투의 모양 ·
 * 크기가 아니면 통째로 버린다(2026-10-02). 검증이 없던 시절, 페이지가 만든
 * payload 가 그대로 AI 턴에 실렸다.
 */
const VALID = {
  type: "colonova-design.pin",
  pin: {
    id: "b3a9c1e0-1111-4bbb-8ccc-000000000001",
    screen: "회원 관리",
    element: {
      kind: "element",
      component: "button",
      text: "저장",
      path: "body>main>form>button",
      rect: { x: 10, y: 20, width: 100, height: 40 },
    },
  },
};

test("핀 봉투: 바른 봉투는 지나간다", () => {
  assert.equal(isPinEnvelope(VALID), true);
  const region = {
    ...VALID,
    pin: {
      ...VALID.pin,
      element: {
        kind: "region",
        component: "div",
        text: "",
        path: "",
        rect: { x: 0, y: 0, width: 300, height: 200 },
        rectView: { x: 0, y: 0, width: 300, height: 200 },
      },
    },
  };
  assert.equal(isPinEnvelope(region), true);
});

test("핀 봉투: 종류가 다르거나 모양이 어긋나면 버린다", () => {
  assert.equal(isPinEnvelope(null), false);
  assert.equal(isPinEnvelope({}), false);
  assert.equal(isPinEnvelope({ ...VALID, type: "colonova-design.pin-focus" }), false);
  assert.equal(isPinEnvelope({ ...VALID, pin: null }), false);
  assert.equal(isPinEnvelope({ ...VALID, pin: { ...VALID.pin, id: "" } }), false);
  assert.equal(isPinEnvelope({ ...VALID, pin: { ...VALID.pin, id: 42 } }), false);
  assert.equal(
    isPinEnvelope({
      ...VALID,
      pin: { ...VALID.pin, element: { ...VALID.pin.element, kind: "script" } },
    }),
    false,
  );
  assert.equal(
    isPinEnvelope({
      ...VALID,
      pin: { ...VALID.pin, element: { ...VALID.pin.element, component: "" } },
    }),
    false,
  );
});

test("핀 봉투: 좌표는 유한한 수 네 개여야 한다", () => {
  const broken = {
    ...VALID,
    pin: {
      ...VALID.pin,
      element: { ...VALID.pin.element, rect: { x: 0, y: 0, width: 100 } },
    },
  };
  assert.equal(isPinEnvelope(broken), false);
  const nan = {
    ...VALID,
    pin: {
      ...VALID.pin,
      element: { ...VALID.pin.element, rect: { x: Number.NaN, y: 0, width: 1, height: 1 } },
    },
  };
  assert.equal(isPinEnvelope(nan), false);
  const badView = {
    ...VALID,
    pin: {
      ...VALID.pin,
      element: { ...VALID.pin.element, rectView: { x: "0", y: 0, width: 1, height: 1 } },
    },
  };
  assert.equal(isPinEnvelope(badView), false);
});

test("핀 봉투: 크기가 한계를 넘으면 버린다", () => {
  const verbose = {
    ...VALID,
    pin: {
      ...VALID.pin,
      element: { ...VALID.pin.element, text: "가".repeat(4_001) },
    },
  };
  assert.equal(isPinEnvelope(verbose), false);
  const hugeHtml = {
    ...VALID,
    pin: {
      ...VALID.pin,
      element: { ...VALID.pin.element, html: "<div>".repeat(2_000) },
    },
  };
  assert.equal(isPinEnvelope(hugeHtml), false);
});

test("핀 봉투: 오버레이가 실은 사진은 받지 않는다 — 사진은 뷰가 채운다", () => {
  const withShot = {
    ...VALID,
    pin: { ...VALID.pin, shot: { mediaType: "image/jpeg", data: "AAAA" } },
  };
  assert.equal(isPinEnvelope(withShot), false);
});

test("핀 초점: 문장은 없고 id 만 실는다", () => {
  assert.equal(isPinFocus({ type: "colonova-design.pin-focus", id: "b3a9c1e0-2" }), true);
  assert.equal(isPinFocus({ type: "colonova-design.pin-focus", id: "" }), false);
  assert.equal(isPinFocus({ type: "colonova-design.pin-focus", id: 7 }), false);
  assert.equal(isPinFocus({ type: "colonova-design.pin", id: "x" }), false);
});
