import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * 미리보기 칸의 겹판(비교 · 작업 기록 서랍 · 말풍선 · 준비 덮개)의 조용한 실패를 지킨다(2026-10-06 겹판 손질).
 * 모두 화면에 오류가 나지 않는다 — 단축키가 말없이 꺼지거나, 닫힌 서랍의 그림자가 가장자리에 비치거나,
 * 막대 높이가 어긋난다.
 */
const dir = join(import.meta.dirname, "../src/next/preview");
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const css = strip(readFileSync(join(dir, "preview.css"), "utf8"));
const drawer = strip(readFileSync(join(dir, "HistoryDrawer.tsx"), "utf8"));
const compare = strip(readFileSync(join(dir, "ComparisonDialog.tsx"), "utf8"));

/** 선택자 하나짜리 규칙의 몸 — 중첩이 없는 규칙만 읽는다. */
function body(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `${selector} 규칙이 없다`);
  return match[1] ?? "";
}

test("서랍의 스크림은 `.nx-modal-back` 이 아니다 — 그 이름을 쓰면 모든 단축키 · Esc 가 겹판이 열린 줄로 알고 꺼진다", () => {
  assert.match(drawer, /nx-hist-scrim/);
  assert.doesNotMatch(drawer, /className=[^>]*nx-modal-back/);
  assert.doesNotMatch(body(".nx-hist-scrim"), /nx-modal-back/);
});

test("비교 대화상자는 겹판 뼈대(ModalFrame)를 쓰고 스크림에 비교 배치만 덧붙인다", () => {
  assert.match(compare, /<ModalFrame[\s\S]*backClassName="nx-compare-back"/);
  // 닫는 모션 · 초점 가두기 · 층 판정을 다시 복붙하지 않는다.
  assert.doesNotMatch(compare, /useModalEscape|useModalFocus/);
});

test("서랍은 막대 높이를 변수로 읽고(48px 를 베끼지 않는다) 닫힌 동안 감춰진다", () => {
  const hist = body(".nx-hist");
  assert.match(hist, /top:\s*var\(--pv-bar-h\)/);
  assert.doesNotMatch(hist, /top:\s*48px/);
  // `.nx-preview` 는 뿌리 규칙과 이 변수의 규칙, 둘 이상이다 — 어느 몸에든 값이 있으면 된다.
  const roots = [...css.matchAll(/(?:^|\n)\.nx-preview\s*\{([^}]*)\}/g)].map((m) => m[1] ?? "");
  assert.ok(
    roots.some((rule) => /--pv-bar-h:\s*48px/.test(rule)),
    "--pv-bar-h 가 없다",
  );
  assert.match(body(".nx-hist-scrim"), /top:\s*var\(--pv-bar-h\)/);
  // 닫힌 서랍은 눈에도 낭독에도 없고, 열린 때만 그림자가 선다(닫힌 서랍의 그림자가 가장자리에 비치지 않게).
  assert.match(hist, /visibility:\s*hidden/);
  assert.doesNotMatch(hist, /(?:^|[;\s])box-shadow\s*:/);
  // 열린 서랍은 `visible` 이 아니라 조상을 따른다(`inherit`) — `visible` 은 숨은 조상(홈 · 가려진 탭)의 hidden 을 이겨 눈에
  // 안 보이는 서랍이 Tab 초점을 붙들었다.
  assert.match(body(".nx-hist--open"), /visibility:\s*inherit/);
  assert.match(body(".nx-hist--open"), /box-shadow:/);
});

test("서랍과 말풍선의 그림자는 테마의 토큰이다 — 어두운 테마에서 안 보이는 고정 색이 아니다", () => {
  for (const selector of [".nx-hist--open", ".nx-pinbub", ".nx-pin-intro"]) {
    const shadow = /box-shadow:\s*([^;]+);/.exec(body(selector))?.[1] ?? "";
    assert.match(shadow, /var\(--/, `${selector}: ${shadow}`);
    assert.doesNotMatch(shadow, /#0001|rgba\(0,\s*0,\s*0/, `${selector}: ${shadow}`);
  }
});

test("말풍선은 높이 제한 아래 안쪽이 굴러가고 메모는 자란다", () => {
  assert.match(body(".nx-pinbub"), /display:\s*flex/);
  assert.match(body(".nx-pinbub-body"), /overflow-y:\s*auto/);
  assert.match(body(".nx-pinbub-body"), /min-height:\s*0/);
  assert.match(body(".nx .nx-pinbub-note"), /field-sizing:\s*content/);
});

// ── 작업 기록 서랍의 열고 닫는 길(2026-10-06 작업 기록 손질) — 모두 화면에 오류가 나지 않는 조용한 실패다.

/** 전환 한 줄에서 `transform` 의 길이(ms). */
function transformMs(rule: string): number {
  const match = /transform\s+(\d+)ms/.exec(rule);
  assert.ok(match, `transform 전환이 없다: ${rule}`);
  return Number(match[1]);
}

test("서랍: 나갈 때가 들어올 때보다 짧다 — 전환은 도착하는 쪽 상태의 것이 쓰인다", () => {
  // 닫힘(.nx-hist)과 열림(--open)이 각자 전환을 선언해야 나감 200 · 들어옴 280 처럼 따로 선다.
  const leave = transformMs(body(".nx-hist"));
  const enter = transformMs(body(".nx-hist--open"));
  assert.ok(leave < enter, `나감 ${leave}ms 가 들어옴 ${enter}ms 보다 짧아야 한다`);
});

test("서랍 스크림: 닫힐 때도 불투명도로 걷힌다 — 마운트는 시트일 때뿐, 열림에 묶지 않는다", () => {
  // 닫는 순간 스크림이 사라지면 서랍이 아직 나가는 동안 뒤 화면이 번쩍 밝아졌다(측정: 닫은 지 46ms 에 불투명도 1 → 없음).
  assert.match(drawer, /\{sheet && \(\s*<div\s+className=\{`nx-hist-scrim/);
  assert.doesNotMatch(drawer, /sheet && open/);
  const scrim = body(".nx-hist-scrim");
  assert.match(scrim, /opacity:\s*0/);
  assert.match(scrim, /pointer-events:\s*none/);
  assert.match(scrim, /transition:[^;]*opacity/);
  const on = body(".nx-hist-scrim--on");
  assert.match(on, /opacity:\s*1/);
  assert.match(on, /pointer-events:\s*auto/);
});

test("서랍 줄: 날의 머리는 위에 붙고(sticky) 바탕이 불투명하며 마디보다 위에 선다", () => {
  const head = body(".nx-hday");
  assert.match(head, /position:\s*sticky/);
  assert.match(head, /top:\s*0/);
  // 투명이면 밑으로 들어가는 줄 글자가 비친다.
  assert.match(head, /background:\s*var\(--card\)/);
  const headZ = Number(/z-index:\s*(\d+)/.exec(head)?.[1]);
  const nodeZ = Number(/z-index:\s*(\d+)/.exec(body(".nx-hnode"))?.[1]);
  assert.ok(headZ > nodeZ, `머리(${headZ})가 마디(${nodeZ})보다 위에 서야 한다`);
});

test("서랍 줄: 타임라인의 선은 줄마다 한 토막씩 긋는다 — 줄 사이에 margin 이 있으면 선이 끊긴다", () => {
  assert.doesNotMatch(body(".nx-hitem"), /(?:^|[;\s])margin\s*:/);
  assert.doesNotMatch(body(".nx-hsubmit"), /(?:^|[;\s])margin\s*:/);
  // 선은 줄 · 날의 머리 · 제출 구분선이 같은 자리(left)에서 긋는다.
  const line = /\.nx-hitem::before,\s*\.nx-hday::before,\s*\.nx-hsubmit::before\s*\{([^}]*)\}/.exec(
    css,
  );
  assert.ok(line, "세 곳이 함께 긋는 선 규칙이 없다");
  assert.match(line[1] ?? "", /left:\s*10px/);
});

test("서랍: 움직임을 줄인 창은 서랍 · 스크림의 전환을 쓰지 않는다", () => {
  const block = /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.nx-hist,[\s\S]*?\n\}/.exec(css);
  assert.ok(block, "서랍의 동작 줄이기 블록이 없다");
  for (const selector of [".nx-hist", ".nx-hist--open", ".nx-hist-scrim", ".nx-hist-scrim--on"]) {
    assert.ok(block[0].includes(selector), `${selector} 가 동작 줄이기 블록에 없다`);
  }
  assert.match(block[0], /transition:\s*none/);
});

test("서랍: 숨은 칸에서 열린 채 있지 않고 · 지난 프로젝트의 줄이 비치지 않고 · 되돌린 뒤 접힌다", () => {
  // ① 칸이 숨는 순간(홈 · 좁은 창의 대화 탭) 열린 서랍은 `visibility: visible` 로 숨은 조상을 이겨 Tab 초점을 눈에 안 보이는
  //    곳으로 끌어갔다 — 숨는 순간에 접고, 숨은 동안은 가두기도 돌지 않는다(숨은 칸에서 여는 길은 접지 않는다).
  assert.match(drawer, /const hid = offstage && !wasOffstage\.current/);
  assert.match(drawer, /if \(open && \(hid \|\| moved\)\) onClose\(\)/);
  assert.match(
    drawer,
    /useModalFocus\(panel, open && !offstage, returnRef, \{ reenter: false \}\)/,
  );
  // ② 읽어 온 줄은 프로젝트와 함께 든다 — 옮긴 직후(열려 있는 동안) 지난 프로젝트의 줄이 비치지 않게.
  assert.match(drawer, /loaded\.slug === slug/);
  // ③ 되돌리기가 성공하면 서랍이 접혀 되돌린 화면이 곧바로 보인다(실패면 열린 채 카드에 알림). 오래 걸린 되돌리기가 끝났을
  //    때 그사이 서랍을 닫았다 열었거나 프로젝트를 옮겼다면(판이 달라졌다면) 지금 보는 서랍을 닫지 않는다.
  assert.match(
    drawer,
    /api\.restore\([\s\S]*?stage === "failed"[\s\S]*?onRestored\(\)[\s\S]*?if \(here\) onClose\(\)/,
  );
  assert.match(drawer, /const here = session\.current === started/);
});

test("서랍: 게스트가 다시 쏜 Esc(대상이 문서)도 서랍을 닫고, 제목 초점은 두 프레임 뒤에 선다", () => {
  // 대상이 문서면 target 이 null — `undefined !== null` 이 참이라 입력 중으로 읽혀 게스트에 초점이 있을 때의 Esc 가 서랍을
  // 닫지 못했다.
  assert.match(drawer, /const typing =\s*target !== null && target\.closest\(/);
  // 동작을 줄인 창은 자식마다 `visibility` 전환(0.01ms)이 있어 효과가 도는 순간 제목이 아직 hidden 이다.
  assert.match(
    drawer,
    /requestAnimationFrame\([\s\S]*?requestAnimationFrame\([\s\S]*?title\.current\?\.focus/,
  );
  // 이 칸을 가린 옆 서랍(main 이 inert)의 Esc 는 그 서랍의 몫이다.
  assert.match(drawer, /panel\.current\?\.closest\("\[inert\]"\)/);
});
