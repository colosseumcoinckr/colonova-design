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
