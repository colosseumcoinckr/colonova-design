import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * 빈 화면의 찍기는 시작점 칩 줄의 첫 칸이다(2026-10-31 화면 자리 개선안 S5 — 옛 `수정할 곳 선택` 단추가 칩 줄로 합쳐졌다).
 * 2026-10-24 QA 15 의 「하나만 선다」 규칙은 그대로다 — 빈 화면의 칩이 서 있는 동안 입력창의 좁은 창 칩은 감춰지고, 첫 말이
 * 올라와 빈 화면이 빠지면 입력창의 칩이 그 자리를 잇는다. 마크업을 글로 읽는다.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const column = read("../src/next/chat/ChatColumn.tsx");
const composer = read("../src/next/chat/Composer.tsx");

test("찍기: 빈 화면의 칩이 서 있는 동안 입력창의 같은 칩은 서지 않는다", () => {
  // 한 이름의 조건 — 빈 화면 칩을 세우는 자리와 입력창 칩을 감추는 자리가 같은 값을 읽는다(어긋나면 둘이 서거나 둘 다 빠진다).
  assert.match(
    column,
    /onPinMode=\{\s*\(empty \|\| emptyFade\) && project !== null && !preparing\s*\?\s*undefined\s*:/,
  );
  // 빈 화면의 찍기는 시작점 칩 줄의 첫 칸이다 — 옛 단독 단추(`nx-empty-pin`)가 돌아오지 않는다.
  assert.doesNotMatch(column, /nx-empty-pin/);
  const starters = /<Starters[\s\S]*?onPin=\{[\s\S]*?\}\s*\/>/.exec(column)?.[0] ?? "";
  assert.match(starters, /nx:pins:toggle/);
  // 입력창의 좁은 창 칩은 `onPinMode` 가 있을 때만 선다 — 비우면 칩이 빠진다.
  assert.match(composer, /\{narrow && onPinMode && \(/);
  assert.match(composer, /onPinMode\?: \(\) => void;/);
});

test("찍기: 빈 화면 칩은 좁은 창에서 화면 탭으로 가고 곧 핀 켜기를 청한다 — 입력창 칩이 하던 일과 같다", () => {
  const emptyBlock = /onPin=\{\s*[\s\S]*?\(\) => \{([\s\S]*?)\}\s*\}/.exec(column)?.[1] ?? "";
  assert.match(emptyBlock, /nav\.showTab\("preview"\)/);
  assert.match(emptyBlock, /new CustomEvent\("nx:pins:toggle"\)/);
  // 입력창 칩의 핸들러는 늘 화면 탭을 앞에 세운다(좁은 창에서만 서는 칩이라) — 하는 일의 이름이 같다.
  assert.match(
    column,
    /nav\.showTab\("preview"\);\s*window\.dispatchEvent\(new CustomEvent\("nx:pins:toggle"\)\);/,
  );
});
