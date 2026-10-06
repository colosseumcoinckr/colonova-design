import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * 찾기(⌘K) · 사이드바 팝 · 좁은 창 서랍의 CSS 가 조용히 어긋나는 일을 지킨다(2026-10-06 겹판 조사).
 * 화면에는 오류가 없는 실패들이다 — 찾기가 곧바로 사라지고, 서랍의 그림자가 어두운 팔레트에서 안
 * 보이고, 11px 글자가 다시 들어온다. 파일을 글자로 읽는다(`next-status-css.test.ts` 와 같은 모양).
 */
const root = join(import.meta.dirname, "../src");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const palette = read("next/palette.css");
const sidebar = read("next/sidebar/sidebar.css");
const shell = read("next/shell.css");
const overlay = read("next/ui/overlay.css");
const ui = read("next/ui/ui.css");
const sheet = read("next/ui/sheet.css");
const workspace = read("next/Workspace.tsx");
const modalFocus = read("hooks/use-modal-focus.ts");

/** 주석을 걷은 CSS — 설명 속의 숫자가 규칙으로 잡히지 않게. */
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

test("찾기: 물러나는 모션은 스크림과 판 모두 겹판과 같은 키프레임이다", () => {
  const css = strip(overlay);
  assert.match(css, /\.nx\.nx-pal\.nx-pal--out\s*\{[^}]*animation:\s*nx-scrim-out/);
  assert.match(css, /\.nx-pal--out\s+\.nx-pal-panel\s*\{[^}]*animation:\s*nx-panel-out/);
  // 찾기 쪽 파일이 스크림 · 그림자 · 애니메이션을 다시 선언하면 통일이 깨진다(overlay.css 의 약속).
  assert.doesNotMatch(strip(palette), /box-shadow:\s*(?!none)\S/);
  assert.doesNotMatch(strip(palette), /backdrop-filter:/);
});

test("셸: 겹판이 열려 있나의 질의는 한 곳(overlayOpen)이고 물러나는 판(--out)을 막는 판으로 세지 않는다", () => {
  // 예전에는 네 곳이 서로 다른 목록(`.nx-set` 이 빠진 곳 · 나가는 판을 못 거르는 곳)을 복붙해 들고 있었다.
  for (const [name, source] of [
    ["Workspace.tsx", workspace],
    ["preview/HistoryDrawer.tsx", read("next/preview/HistoryDrawer.tsx")],
    ["preview/PreviewColumn.tsx", read("next/preview/PreviewColumn.tsx")],
  ] as const) {
    assert.doesNotMatch(source, /querySelector\(\s*"\.modal/, `${name}: 겹판 질의가 다시 복붙됐다`);
    assert.match(source, /overlayOpen\(\)/, `${name}: overlayOpen() 을 부르지 않는다`);
  }
  // 판정 자체 — 모든 겹판 뿌리에서 `…--out`(닫는 모션 중) 을 뺀다.
  assert.match(modalFocus, /OPEN_OVERLAY_SELECTOR[\s\S]*?:not\(\[class\*="--out"\]\)/);
});

test("키캡은 ui.css 한 곳에 산다 — 시트 · 찾기 · 비교가 함께 쓴다", () => {
  assert.match(strip(ui), /\.nx kbd\.nx-kc\s*\{/);
  assert.doesNotMatch(strip(sheet), /\.nx kbd\.nx-kc\s*\{/);
});

test("위험한 메뉴 줄(.nx-mi--dng)은 ui.css 에 산다", () => {
  assert.match(strip(ui), /\.nx \.nx-mi--dng\s*\{[^}]*color:\s*var\(--red\)/);
  assert.doesNotMatch(strip(sidebar), /\.nx \.nx-mi--dng\s*\{/);
});

test("서랍: 스크림 · 그림자는 테마 토큰이고 닫힐 때 불투명도로 걷힌다", () => {
  const css = strip(shell);
  const scrim = /\.nx--narrow \.nx-scrim\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(scrim, /background:\s*var\(--scrim\)/, "스크림은 테마가 정한 색이다");
  assert.match(scrim, /backdrop-filter:\s*blur\(var\(--nx-blur\)\)/, "겹판과 같은 흐림이다");
  assert.match(scrim, /opacity:\s*0/, "닫힌 동안은 투명하다");
  // 보이지 않게 되는 순간(visibility)은 불투명도 전환이 끝난 뒤여야 한다 — 아니면 스크림이 곧바로 사라진다.
  assert.match(scrim, /visibility 0s linear var\(--nx-t-move\)/);
  const drawer = /\.nx--drawer \.nx-sidebar\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
  assert.match(drawer, /var\(--shadow-float\)/, "서랍의 그림자는 겹판의 토큰이다");
  assert.doesNotMatch(css, /rgba\(24, 22, 19/, "고정 검정의 스크림이 돌아오지 않는다");
  // 서랍 안의 닫는 단추를 숨기던 규칙이 돌아오면 서랍에 닫는 길이 스크림 · Esc 뿐이다.
  assert.doesNotMatch(css, /\.nx--narrow \.nx-collapse-btn\s*\{[^}]*display:\s*none/);
});

/** 선언된 글자 크기 가운데 12px 밑인 것 — 새로 11px 이하를 만들지 않는다. */
function smallFonts(css: string): string[] {
  return [...strip(css).matchAll(/font-size:\s*([\d.]+)px/g)]
    .filter((match) => Number(match[1]) < 12)
    .map((match) => match[0]);
}

test("글자는 12px 이상이다 — 찾기 · 사이드바", () => {
  assert.deepEqual(smallFonts(palette), []);
  assert.deepEqual(smallFonts(sidebar), []);
});
