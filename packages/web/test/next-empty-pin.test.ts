import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * 좁은 창의 대화 탭에는 `수정할 곳 선택` 이 하나만 선다(2026-10-24 QA 15) — 빈 화면의 안내 단추와 입력창의 좁은 창 칩이 같은 말로
 * 80px 간격에 함께 서던 것. 새 대화의 안내는 입력창 바로 위에 있고 `수정할 곳 선택` 을 누르면 화면 탭으로 간다(GUIDE §2) — 그래서 빈 화면의
 * 단추를 남기고, 첫 말이 올라와 빈 화면이 빠지면 입력창의 칩이 그 자리를 잇는다. 마크업을 글로 읽는다.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const column = read("../src/next/chat/ChatColumn.tsx");
const composer = read("../src/next/chat/Composer.tsx");

test("수정할 곳 선택: 빈 화면의 단추가 서 있는 동안 입력창의 같은 칩은 서지 않는다", () => {
  // 한 이름의 조건 — 빈 화면 단추를 세우는 자리와 입력창 칩을 감추는 자리가 같은 값을 읽는다(어긋나면 둘이 서거나 둘 다 빠진다).
  assert.match(
    column,
    /const emptyPinShown = \(empty \|\| emptyFade\) && project !== null && !preparing;/,
  );
  assert.match(
    column,
    /\{emptyPinShown && \(\s*<button\s+type="button"\s+className="nx-btn nx-empty-pin"/,
  );
  assert.match(column, /onPinMode=\{\s*emptyPinShown\s*\?\s*undefined\s*:/);
  // 입력창의 좁은 창 칩은 `onPinMode` 가 있을 때만 선다 — 비우면 칩이 빠진다.
  assert.match(composer, /\{narrow && onPinMode && \(/);
  assert.match(composer, /onPinMode\?: \(\) => void;/);
});

test("수정할 곳 선택: 빈 화면 단추는 좁은 창에서 화면 탭으로 가고 곧 핀 켜기를 청한다 — 입력창 칩이 하던 일과 같다", () => {
  const emptyBlock =
    /className="nx-btn nx-empty-pin"\s+onClick=\{\(\) => \{([\s\S]*?)\}\}/.exec(column)?.[1] ?? "";
  assert.match(emptyBlock, /if \(narrow\) nav\.showTab\("preview"\);/);
  assert.match(emptyBlock, /new CustomEvent\("nx:pins:toggle"\)/);
  // 입력창 칩의 핸들러는 늘 화면 탭을 앞에 세운다(좁은 창에서만 서는 칩이라) — 하는 일의 이름이 같다.
  assert.match(
    column,
    /nav\.showTab\("preview"\);\s*window\.dispatchEvent\(new CustomEvent\("nx:pins:toggle"\)\);/,
  );
});
