import assert from "node:assert/strict";
import { test } from "node:test";
import { isPinEnvelope, isPinFocus, readPinEnvelope } from "../src/pin-envelope.ts";

/**
 * 오버레이 다리는 연결 레포의 페이지 스크립트도 부를 수 있다 — 필수 칸의 모양이
 * 아니면 버린다(2026-10-02). 검증이 없던 시절, 페이지가 만든 payload 가 그대로 AI
 * 턴에 실렸다. 2026-10-06 부터 보강 칸(스타일 · 접근성 · 속성 · 주변 글 · html …)은
 * 크다고 버리지 않고 자른다 — 오버레이의 정상 출력을 버려 핀이 말없이 사라졌다.
 * 오버레이의 진짜 출력으로 도는 시험은 pin-envelope-overlay.test.ts.
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

test("핀 봉투: 필수 칸이 어긋나면 버린다 — 까닭의 종류와 함께", () => {
  const withElement = (patch: Record<string, unknown>) => ({
    ...VALID,
    pin: { ...VALID.pin, element: { ...VALID.pin.element, ...patch } },
  });
  const reasonOf = (payload: unknown) => {
    const read = readPinEnvelope(payload);
    return read.ok ? "ok" : read.reason;
  };
  assert.equal(reasonOf(null), "shape");
  assert.equal(reasonOf({ ...VALID, type: "colonova-design.pin-focus" }), "shape");
  assert.equal(reasonOf({ ...VALID, pin: { ...VALID.pin, id: "가".repeat(101) } }), "id");
  assert.equal(reasonOf({ ...VALID, pin: { ...VALID.pin, element: null } }), "element");
  assert.equal(reasonOf(withElement({ kind: "script" })), "kind");
  assert.equal(reasonOf(withElement({ component: "x".repeat(201) })), "component");
  assert.equal(reasonOf(withElement({ text: 7 })), "text");
  assert.equal(reasonOf(withElement({ path: "a".repeat(4_001) })), "path");
  assert.equal(reasonOf(withElement({ rect: { x: 0, y: 0, width: 1 } })), "rect");
  assert.equal(reasonOf(withElement({ rectView: { x: "0", y: 0, width: 1, height: 1 } })), "rect");
  assert.equal(
    reasonOf({ ...VALID, pin: { ...VALID.pin, shot: { mediaType: "image/jpeg", data: "AAAA" } } }),
    "shot",
  );
  assert.equal(reasonOf(VALID), "ok");
});

test("핀 봉투: 보강 칸이 크면 그 칸을 자르고 핀은 살린다", () => {
  const read = readPinEnvelope({
    ...VALID,
    pin: {
      ...VALID.pin,
      screen: "화".repeat(600),
      element: {
        ...VALID.pin.element,
        text: "가".repeat(4_001),
        html: "<div>".repeat(2_000),
        xpath: "/body/".repeat(1_000),
        styles: { "font-family": "x".repeat(500), color: "red" },
        a11y: { role: "button", name: "이".repeat(1_000) },
        attrs: { id: "save", href: "h".repeat(900) },
        nearby: "근".repeat(5_000),
        owners: Array.from({ length: 12 }, (_, i) => `Owner${i}`),
      },
    },
  });
  assert.equal(read.ok, true, "크기 때문에 핀을 버리지 않는다");
  if (!read.ok) return;
  const { pin } = read.envelope;
  assert.equal(pin.screen.length, 500);
  assert.equal(pin.element.text.length, 4_000);
  assert.equal(pin.element.html?.length, 6_144);
  assert.equal(
    pin.element.xpath,
    undefined,
    "xpath 는 한계를 넘으면 칸째 뺀다(잘린 주소는 거짓말이다)",
  );
  assert.equal(pin.element.styles?.["font-family"]?.length, 200);
  assert.equal(pin.element.styles?.color, "red");
  assert.equal(pin.element.a11y?.name?.length, 300);
  assert.equal(pin.element.a11y?.role, "button");
  assert.equal(pin.element.attrs?.id, "save");
  assert.equal(pin.element.attrs?.href?.length, 500);
  assert.equal(pin.element.nearby?.length, 1_000);
  assert.equal(pin.element.owners?.length, 8);
});

test("핀 봉투: attrs.classes 는 문자열 배열이다 — 받고, 길면 자르고, 문자열이 아닌 것은 뺀다", () => {
  const read = readPinEnvelope({
    ...VALID,
    pin: {
      ...VALID.pin,
      element: {
        ...VALID.pin.element,
        attrs: {
          classes: ["btn", "btn-primary", 7, "", null, "c".repeat(300), ...Array(10).fill("x")],
        },
      },
    },
  });
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const classes = read.envelope.pin.element.attrs?.classes ?? [];
  assert.equal(classes.length, 10, "열 개까지");
  assert.deepEqual(classes.slice(0, 2), ["btn", "btn-primary"]);
  assert.equal(classes[2]?.length, 200, "한 이름은 200자까지");
  assert.ok(classes.every((name) => typeof name === "string" && name !== ""));
});

test("핀 봉투: 알려지지 않은 칸은 새 봉투로 옮기지 않는다", () => {
  const forged = JSON.parse(
    JSON.stringify({
      ...VALID,
      extra: "봉투 밖의 칸",
      pin: {
        ...VALID.pin,
        smuggled: { a: 1 },
        element: {
          ...VALID.pin.element,
          onclick: "alert(1)",
          attrs: { id: "ok", onload: "x", classes: ["a"] },
          a11y: { role: "button", "aria-hidden": "true" },
        },
      },
    }),
  );
  forged.pin.element.__proto__ = { polluted: true };
  const read = readPinEnvelope(forged);
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const serialized = JSON.stringify(read.envelope);
  for (const leaked of ["extra", "smuggled", "onclick", "onload", "aria-hidden", "polluted"]) {
    assert.equal(serialized.includes(leaked), false, `${leaked} 가 새 봉투에 없다`);
  }
  assert.equal(read.envelope.pin.element.attrs?.id, "ok");
  assert.deepEqual(read.envelope.pin.element.attrs?.classes, ["a"]);
});

test("핀 봉투: 오버레이가 실은 사진은 받지 않는다 — 사진은 뷰가 채운다", () => {
  const withShot = {
    ...VALID,
    pin: { ...VALID.pin, shot: { mediaType: "image/jpeg", data: "AAAA" } },
  };
  assert.equal(isPinEnvelope(withShot), false);
  assert.deepEqual(readPinEnvelope(withShot), { ok: false, reason: "shot" });
});

test("핀 초점: 문장은 없고 id 만 실는다", () => {
  assert.equal(isPinFocus({ type: "colonova-design.pin-focus", id: "b3a9c1e0-2" }), true);
  assert.equal(isPinFocus({ type: "colonova-design.pin-focus", id: "" }), false);
  assert.equal(isPinFocus({ type: "colonova-design.pin-focus", id: 7 }), false);
  assert.equal(isPinFocus({ type: "colonova-design.pin", id: "x" }), false);
});
