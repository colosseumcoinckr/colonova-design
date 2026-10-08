import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * `고친 화면` 카드 안의 전/후 토글(2026-10-06 UX 점검). 카드 전체는 제목 단추의 `::after` 가 덮어 어디를 눌러도
 * 화면이 열린다 — 토글이 그 위에 서지 않으면 눌러도 화면이 열릴 뿐 사진이 넘어가지 않는다. 눈으로 보는 확인은
 * `dev/thread-fixture.html` 이고, 이 시험은 그 조건이 CSS 에서 빠지지 않게 지킨다.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("../src/next/chat/chat.css");
const card = read("../src/next/chat/ResultScreens.tsx");
const outlines = read("../src/next/ui/PhotoOutlines.tsx");

/** 규칙 하나의 몸 — 첫 번째로 맞는 `{ … }`. */
function ruleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} 규칙이 있다`);
  return css.slice(start, css.indexOf("}", start));
}

test("전/후 토글은 카드를 덮는 ::after 위에 선다", () => {
  const overlay = ruleBody(".nx .nx-result-open::after");
  assert.match(overlay, /position: absolute;/);
  assert.doesNotMatch(
    overlay,
    /z-index/,
    "덮개는 z-index 가 없다 — 위에 서려면 z-index 가 있으면 된다",
  );
  const toggle = ruleBody(".nx-result-ba");
  assert.match(toggle, /position: absolute;/);
  assert.match(toggle, /z-index: 1;/);
});

test("토글은 수정 전 사진이 있을 때만 서고, 없으면 이름표다", () => {
  // 린트 예외 주석(`biome-ignore`)이 여는 괄호와 요소 사이에 서도 구조는 같다 — 분절 묶음이 `fieldset` 이 아닌 이유를 거기 적는다.
  assert.match(card, /\{before \? \(\s*(?:\/\/[^\n]*\n\s*)*<div className="nx-result-ba"/);
  assert.match(card, /\) : \(\s*<span className="nx-result-photo-label">/);
});

test("토글 단추는 눌림 상태를 말한다 — 색만으로 고른 쪽을 알리지 않는다", () => {
  assert.equal((card.match(/aria-pressed=\{showing === /g) ?? []).length, 2);
});

/**
 * 달라진 곳 표시 · 사진 복사(2026-10-08 베타 준비 분석 · 겹판 점검 E) — 카드의 새 단추도 전/후 토글과 같은 규칙을 지켜야
 * 한다: 카드를 덮는 ::after 위에 서지 않으면 눌러도 화면이 열릴 뿐이다.
 */
test("달라진 곳 표시 · 사진 복사 알약의 묶음은 카드를 덮는 ::after 위에 선다", () => {
  const tools = ruleBody(".nx .nx-diff-tools");
  assert.match(tools, /position: absolute;/);
  assert.match(tools, /z-index: 1;/);
  // 알약 둘은 한 묶음 안에서만 선다 — 개별로 absolute 를 걸어 자리가 겹치지 않게.
  assert.doesNotMatch(ruleBody(".nx .nx-diff-pill"), /position: absolute;/);
  assert.match(card, /<div className="nx-diff-tools">[\s\S]*?<\/div>/);
});

test("달라진 곳 표시는 눌림 단추이고, 수정 전을 보던 중에 켜면 수정 후로 넘어간다", () => {
  assert.match(card, /aria-pressed=\{tools\.on\}/);
  // 윤곽은 수정 후 사진 위에만 선다 — 안 넘어가면 켜도 아무것도 안 보인다.
  assert.match(card, /if \(!tools\.on\) setShowing\("after"\)/);
  assert.match(card, /tools\.on && tools\.diff && showing === "after" && tools\.boxes\.length > 0/);
});

test("사진 복사는 사진이 있으면 늘 서고, 달라진 곳 표시는 비교할 수 있을 때만 선다", () => {
  assert.match(card, /\{tools\.diff && \(\s*<button[^>]*className="nx-diff-pill"/);
  // 수정 전이 없으면 수정 전 자리를 비워 한 장만 복사한다 — 거짓 전·후를 짓지 않는다.
  assert.match(card, /before: before \? \{ src: before, label: L\.compare\.before \} : null/);
});

test("윤곽 SVG 는 카드 사진이 자르는 규칙(cover · 위 맞춤)을 그대로 따른다", () => {
  const img = ruleBody(".nx-result-img");
  assert.match(img, /object-fit: cover;/);
  assert.match(img, /object-position: top;/);
  assert.match(outlines, /preserveAspectRatio="xMidYMin slice"/);
});

test("윤곽은 사진과 함께 커진다 — 호버의 배율이 같다", () => {
  const scale = /transform: scale\(([\d.]+)\);/;
  const photo = scale.exec(ruleBody(".nx-result-screen:hover .nx-result-img"))?.[1];
  const outline = scale.exec(ruleBody(".nx-result-screen:hover .nx-diff-svg--card"))?.[1];
  assert.ok(photo, "사진의 호버 배율이 있다");
  assert.equal(outline, photo);
});
