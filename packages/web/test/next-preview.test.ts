import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(turn-screens.test.ts 와 같은 모양).
import {
  arriveOnTurnEnd,
  bubblePlacement,
  bubbleRect,
  elapsedParts,
  prepProgress,
  prepStep,
  zoomButtons,
} from "../src/next/lib/preview-geometry.ts";

const BOX = { width: 800, height: 600 };
const BUBBLE = { width: 300, height: 110 };

test("말풍선 — 요소 바로 아래, 게스트의 화면 위치만큼 옮겨서", () => {
  const place = bubblePlacement({
    rect: { x: 100, y: 50, width: 80, height: 30 },
    frame: { left: 20, top: 48 },
    zoom: 1,
    box: BOX,
    bubble: BUBBLE,
  });
  assert.deepEqual(
    { left: place.left, top: place.top, up: place.up, arrowLeft: place.arrowLeft },
    { left: 106, top: 138, up: false, arrowLeft: 54 },
  );
  // 아래로 열면 위끝이 붙들리고, 쓸 수 있는 높이는 요소 아래의 남은 자리다(칸 바닥 8px 앞까지).
  assert.deepEqual(place.anchor, { edge: "top", at: 138 });
  assert.equal(place.maxHeight, 600 - 8 - 138);
});

test("말풍선 — 배율을 곱한다", () => {
  const place = bubblePlacement({
    rect: { x: 100, y: 50, width: 80, height: 30 },
    frame: { left: 0, top: 48 },
    zoom: 1.25,
    box: BOX,
    bubble: BUBBLE,
  });
  assert.equal(place.left, Math.round(125 - 14));
  assert.equal(place.top, Math.round(48 + (50 + 30) * 1.25 + 10));
});

test("말풍선 — 바닥을 넘으면 요소 위로 올라간다", () => {
  const place = bubblePlacement({
    rect: { x: 100, y: 480, width: 80, height: 40 },
    frame: { left: 0, top: 48 },
    zoom: 1,
    box: BOX,
    bubble: BUBBLE,
  });
  assert.equal(place.up, true);
  assert.equal(place.top, 48 + 480 - 10 - 110);
});

test("말풍선 — 가로는 칸 안에 묶인다, 칸보다 큰 요소는 칸 안에 붙든다", () => {
  const right = bubblePlacement({
    rect: { x: 760, y: 10, width: 20, height: 20 },
    frame: { left: 0, top: 0 },
    zoom: 1,
    box: BOX,
    bubble: BUBBLE,
  });
  assert.equal(right.left, 800 - 300 - 8);
  const left = bubblePlacement({
    rect: { x: 0, y: 10, width: 20, height: 20 },
    frame: { left: 0, top: 0 },
    zoom: 1,
    box: BOX,
    bubble: BUBBLE,
  });
  assert.equal(left.left, 8);
  const huge = bubblePlacement({
    rect: { x: 0, y: 0, width: 800, height: 600 },
    frame: { left: 0, top: 0 },
    zoom: 1,
    box: BOX,
    bubble: BUBBLE,
  });
  assert.equal(huge.top, 600 - 8 - 110);
  assert.equal(huge.up, false);
});

test("말풍선 화살표 — 요소의 가운데를 가리키되 말풍선 안으로 묶인다", () => {
  // 가운데가 말풍선 안에 있으면 그대로 가리킨다: elLeft=120, 폭 80 → 160.
  const on = bubblePlacement({
    rect: { x: 120, y: 50, width: 80, height: 30 },
    frame: { left: 0, top: 0 },
    zoom: 1,
    box: BOX,
    bubble: BUBBLE,
  });
  assert.equal(on.arrowLeft, 160 - on.left);
  // 오른쪽 끝의 요소 — 말풍선은 안으로 밀리고, 화살표는 오른쪽 한계(280)에 붙는다.
  const right = bubblePlacement({
    rect: { x: 790, y: 10, width: 20, height: 20 },
    frame: { left: 0, top: 0 },
    zoom: 1,
    box: BOX,
    bubble: BUBBLE,
  });
  assert.equal(right.left, 800 - 300 - 8);
  assert.equal(right.arrowLeft, 280);
  // 왼쪽 벽에 붙은 요소 — 화살표는 왼쪽 한계(10)에 붙는다.
  const left = bubblePlacement({
    rect: { x: 0, y: 10, width: 8, height: 8 },
    frame: { left: 0, top: 0 },
    zoom: 1,
    box: BOX,
    bubble: BUBBLE,
  });
  assert.equal(left.left, 8);
  assert.equal(left.arrowLeft, 10);
});

test("말풍선 — 위로 열면 아랫끝이 붙들린다: 높이가 늘어도 요소와의 간격이 그대로", () => {
  const input = {
    rect: { x: 100, y: 480, width: 80, height: 40 },
    frame: { left: 0, top: 48 },
    zoom: 1,
    box: BOX,
  };
  const small = bubblePlacement({ ...input, bubble: BUBBLE });
  assert.equal(small.up, true);
  // 요소 위끝(528) 10px 위가 말풍선의 아랫끝 — 칸 바닥에서 600 - 518 = 82px.
  assert.deepEqual(small.anchor, { edge: "bottom", at: 82 });
  assert.equal(small.maxHeight, 528 - 10 - 8);
  // 높이가 늘어 다시 불러도 아랫끝은 같다 — 위끝만 올라간다.
  const tall = bubblePlacement({ ...input, bubble: { width: 300, height: 260 }, prefer: "up" });
  assert.equal(tall.up, true);
  assert.deepEqual(tall.anchor, { edge: "bottom", at: 82 });
  assert.equal(tall.top, 528 - 10 - 260);
});

test("말풍선 — 지금 서 있는 쪽에 아직 들어가면 옮기지 않는다(prefer)", () => {
  // 요소 아래 자리 = 600 - 8 - (128 + 10) = 454. 위 자리 = 98 - 10 - 8 = 80.
  const input = {
    rect: { x: 100, y: 50, width: 80, height: 30 },
    frame: { left: 0, top: 48 },
    zoom: 1,
    box: BOX,
  };
  // 위로 서 있던 말풍선이 아직 위에 들어가면(80 이하) 그대로 위.
  const keepUp = bubblePlacement({ ...input, bubble: { width: 300, height: 70 }, prefer: "up" });
  assert.equal(keepUp.up, true);
  // 위에 안 들어가면 아래가 통째로 들어가니 아래로 간다.
  const flip = bubblePlacement({ ...input, bubble: { width: 300, height: 200 }, prefer: "up" });
  assert.equal(flip.up, false);
  assert.deepEqual(flip.anchor, { edge: "top", at: 138 });
});

test("말풍선 — 어느 쪽에도 통째로 안 들어가면 더 넓은 쪽에 서고 높이를 조인다", () => {
  // 칸 가운데의 요소: 아래 자리 = 600 - 8 - (298 + 10) = 284, 위 자리 = 248 - 10 - 8 = 230. 말풍선이 400.
  const place = bubblePlacement({
    rect: { x: 100, y: 200, width: 80, height: 50 },
    frame: { left: 0, top: 48 },
    zoom: 1,
    box: BOX,
    bubble: { width: 300, height: 400 },
  });
  assert.equal(place.up, false);
  assert.deepEqual(place.anchor, { edge: "top", at: 308 });
  assert.equal(place.maxHeight, 284);
  // 위가 더 넓은 자리면 위로 서고 같은 식으로 조인다.
  const above = bubblePlacement({
    rect: { x: 100, y: 300, width: 80, height: 50 },
    frame: { left: 0, top: 48 },
    zoom: 1,
    box: BOX,
    bubble: { width: 300, height: 500 },
  });
  assert.equal(above.up, true);
  assert.equal(above.maxHeight, 348 - 10 - 8);
  assert.deepEqual(above.anchor, { edge: "bottom", at: 600 - 338 });
});

test("말풍선 — 칸을 덮는 요소는 칸 안에 붙들고, 높이는 칸에서 여백을 뺀 만큼", () => {
  const place = bubblePlacement({
    rect: { x: 0, y: 0, width: 800, height: 600 },
    frame: { left: 0, top: 0 },
    zoom: 1,
    box: BOX,
    bubble: BUBBLE,
  });
  assert.equal(place.up, false);
  assert.deepEqual(place.anchor, { edge: "top", at: 600 - 8 - 110 });
  assert.equal(place.maxHeight, 600 - 16);
});

test("도착 판정 — 답이 끝났을 때 한 번, 옮겨 감과 이미 거기서 바뀜을 가른다", () => {
  const screens = [
    { path: "/member/list", key: "member/list" },
    { path: "/member/detail", key: "member/detail" },
  ];
  // 턴이 살아 있거나 다른 대화이면 신호가 없다.
  assert.equal(arriveOnTurnEnd({ ended: false, external: false, screens, hereKey: "" }), null);
  // 사람이 일부러 밖을 보고 있으면 칸이 움직이지 않는다.
  assert.equal(arriveOnTurnEnd({ ended: true, external: true, screens, hereKey: "" }), null);
  // 이번 턴이 화면을 말하지 않았으면 신호가 없다.
  assert.equal(arriveOnTurnEnd({ ended: true, external: false, screens: [], hereKey: "x" }), null);
  // 다른 화면을 보고 있었으면 첫 화면으로 옮겨 간다.
  assert.deepEqual(arriveOnTurnEnd({ ended: true, external: false, screens, hereKey: "home" }), {
    path: "/member/list",
    already: false,
  });
  // 이미 그 화면이면 옮기지 않고 도착만 알린다.
  assert.deepEqual(
    arriveOnTurnEnd({ ended: true, external: false, screens, hereKey: "member/detail" }),
    { path: "/member/list", already: true },
  );
});

test("준비의 걸음 — 내려받기 · 설치하기 · 미리보기 켜기", () => {
  assert.equal(prepStep("missing"), 0);
  assert.equal(prepStep("cloning"), 0);
  assert.equal(prepStep("pulling"), 0);
  assert.equal(prepStep("installing"), 1);
  assert.equal(prepStep("starting"), 2);
  assert.equal(prepStep("ready"), null);
  assert.equal(prepStep("error"), null);
});

test("준비의 막대 — 걸음마다 오르고, 한 걸음 안에서 끝까지 차지 않는다", () => {
  const cloning = prepProgress("cloning", 0);
  const cloningLate = prepProgress("cloning", 600_000);
  const installing = prepProgress("installing", 0);
  const starting = prepProgress("starting", 10_000);
  assert.ok(cloning >= 2 && cloning < cloningLate);
  assert.ok(cloningLate < installing + 5);
  assert.ok(installing < starting);
  assert.ok(prepProgress("starting", 10_000_000) <= 99);
  assert.equal(prepProgress("ready", 0), 100);
  assert.equal(prepProgress("cloning", -5), prepProgress("cloning", 0));
});

test("흐른 시간 — 분과 초", () => {
  assert.deepEqual(elapsedParts(0), { minutes: 0, seconds: 0 });
  assert.deepEqual(elapsedParts(12_400), { minutes: 0, seconds: 12 });
  assert.deepEqual(elapsedParts(65_000), { minutes: 1, seconds: 5 });
  assert.deepEqual(elapsedParts(-1), { minutes: 0, seconds: 0 });
});

test("말풍선 상자 — 영역 핀은 화면 좌표(rectView), 없으면 rect 그대로", () => {
  const page = { x: 120, y: 900, width: 100, height: 60 };
  const view = { x: 120, y: 140, width: 100, height: 60 };
  assert.deepEqual(bubbleRect({ rect: page, rectView: view }), view);
  assert.deepEqual(bubbleRect({ rect: page }), page);
  // 요소 핀은 rectView 를 싣지 않으므로 언제나 rect 가 말한다.
  const el = { x: 10, y: 20, width: 30, height: 40 };
  assert.deepEqual(bubbleRect({ rect: el }), el);
});

test("줌 막대 — 100% 는 배율이 1 일 때만 켜지고, 한계에서 바깥 단추는 멈춘다", () => {
  assert.deepEqual(zoomButtons(1), { out: false, in: false, reset: true });
  assert.deepEqual(zoomButtons(1.25), { out: false, in: false, reset: false });
  assert.deepEqual(zoomButtons(0.5), { out: true, in: false, reset: false });
  assert.deepEqual(zoomButtons(2), { out: false, in: true, reset: false });
  // 경계 바로 안쪽은 살아 있어야 한다 — 이르면 줌이 한 칸 일찍 잠긴다.
  assert.deepEqual(zoomButtons(0.51), { out: false, in: false, reset: false });
  // 이상한 값은 1로 읽는다(main 이 보내기 전의 빈 상태).
  assert.deepEqual(zoomButtons(Number.NaN), { out: false, in: false, reset: true });
});
