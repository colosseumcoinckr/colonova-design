import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/**
 * 사진 위의 달라진 곳 윤곽 · 한 장 복사의 소스 계약(2026-10-08 베타 준비 분석 · 겹판 점검 E). 순수 계산은
 * `next-photo-diff` · `next-photo-share` 가 지키고, 여기서는 화면 쪽에서 빠지면 오류 없이 어긋나는 약속을 지킨다 —
 * 클립보드의 사용자 허락 · 윤곽이 사진과 같은 자리에 서는 조건 · 경고가 거짓으로 서지 않는 길. 눈으로 보는 확인은
 * `dev/thread-fixture.html?scene=diff` 다.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
/** 주석을 걷는다 — 설명 속의 낱말이 계약으로 읽히지 않게. */
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const canvas = strip(read("../src/next/lib/photo-canvas.ts"));
const tools = strip(read("../src/next/lib/use-photo-tools.ts"));
const dialog = strip(read("../src/next/preview/ComparisonDialog.tsx"));
const card = strip(read("../src/next/chat/ResultScreens.tsx"));
const outlines = strip(read("../src/next/ui/PhotoOutlines.tsx"));
const sharedCss = strip(read("../src/next/ui/photo-diff.css"));
const previewCss = strip(read("../src/next/preview/preview.css"));
const thread = strip(read("../src/next/chat/Thread.tsx"));

/** 선택자 하나짜리 규칙의 몸 — 중첩이 없는 규칙만 읽는다. */
function body(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `${selector} 규칙이 없다`);
  return match[1] ?? "";
}

test("클립보드: 합성의 약속(Promise)을 눌림의 손짓 안에서 곧바로 건넨다 — 기다린 뒤에 부르면 허락이 만료된다", () => {
  // ClipboardItem 은 Blob 이 아니라 Blob 의 약속을 받는다.
  assert.match(canvas, /copyPhoto\(blob: Promise<Blob>\)/);
  assert.match(canvas, /new ClipboardItem\(\{ "image\/png": blob \}\)/);
  // 부르는 쪽: 합성을 시작하고(약속) 곧바로 복사로 — 그 사이에 await 도, async 콜백도 없다.
  const copy = /const copy = useCallback\(([\s\S]*?)\n {2}\}, \[\]\);/.exec(tools)?.[1] ?? "";
  assert.ok(copy.includes("composeShare("), "복사 콜백이 합성을 시작한다");
  assert.doesNotMatch(copy, /\bawait\b|\basync\b/);
  assert.ok(copy.indexOf("composeShare(") < copy.indexOf("copyPhoto("));
  // 합성이 던져도 처리되지 않은 거절로 남지 않는다.
  assert.match(copy, /blob\.catch\(\(\) => undefined\)/);
});

test("합성: 사진을 못 읽으면 던진다 — 수정 전이 없는 것처럼 거짓 한 장을 만들지 않는다", () => {
  assert.match(canvas, /if \(!after \|\| \(input\.before && !before\)\) throw new Error/);
  // 윤곽의 색은 앱의 토큰에서 읽는다(캔버스는 CSS 변수를 모른다).
  for (const token of ["--font", "--accent", "--warn"]) {
    assert.ok(canvas.includes(`"${token}"`), `${token} 을 읽는다`);
  }
});

test("윤곽 계산: 사진 쌍마다 한 번 · 한 번에 하나씩 · 한가할 때 — 실패는 조용히 윤곽 없음이고 캐시에 남기지 않는다", () => {
  assert.match(canvas, /requestIdleCallback/);
  assert.match(canvas, /chain\s*\.then\(idle\)/);
  assert.match(canvas, /if \(!value\) forget\(before, after\)/);
  // 두 사진을 같은 배율로 줄여 건넨다 — 같은 그림이 같게 줄어야 윤곽이 거짓으로 서지 않는다.
  assert.match(canvas, /const scale = Math\.min\(1, DIFF_DEFAULTS\.width \/ after\.naturalWidth\)/);
  assert.match(canvas, /pixelsOf\(after, scale\)[\s\S]*pixelsOf\(before, scale\)/);
});

test("프로덕션은 아직 핀의 위치를 넘기지 않는다 — 요청 기록에 없고, 있어도 미리보기 칸의 좌표다", () => {
  // 핀 위치(`pins`)를 넘기는 길을 열려면 좌표를 사진의 정규화 좌표로 옮기는 근거부터 세워야 한다
  // (docs/DEVELOPERS.md 의 「달라진 곳 윤곽과 한 장 복사」). 그 전에 이 시험이 먼저 읽게 한다.
  assert.doesNotMatch(thread, /\bpins=/);
  const openers = [
    "../src/next/chat/Thread.tsx",
    "../src/next/status/StatusLine.tsx",
    "../src/next/preview/HistoryDrawer.tsx",
  ].map((path) => strip(read(path)));
  for (const source of openers) {
    for (const call of source.match(/openComparison\(\{[\s\S]*?\}\)/g) ?? []) {
      assert.doesNotMatch(call, /\bpins\b/);
    }
  }
});

test("윤곽의 SVG: 사진의 칸 규칙으로 앉고, 손을 가로채지 않고, 선은 확대해도 굵어지지 않는다", () => {
  assert.match(outlines, /viewBox=\{`0 0 \$\{VIEW\} \$\{height\}`\}/);
  assert.match(outlines, /aria-hidden="true"/);
  const svg = body(sharedCss, ".nx-diff-svg");
  assert.match(svg, /pointer-events: none;/);
  assert.match(svg, /animation: nx-diff-in [\w\s.-]+backwards;/, "채움은 backwards 만");
  const box = body(sharedCss, ".nx-diff-box");
  assert.match(box, /vector-effect: non-scaling-stroke;/);
  // 색은 테마의 토큰이다 — 고정 색은 윤곽 둘레의 어두운 띠 하나뿐.
  assert.match(box, /var\(--accent\)/);
  assert.match(body(sharedCss, ".nx-diff-box--warn"), /var\(--warn\)/);
  assert.doesNotMatch(box + body(sharedCss, ".nx-diff-box--warn"), /#[0-9a-f]{3,8}\b|rgba?\(/i);
});

test("비교 대화상자: 윤곽은 수정 후 사진의 좌표로 — 나란히는 수정 후 칸에만, 겹쳐서는 두 사진 위에, 번갈아는 수정 후에서만", () => {
  // 나란히: 수정 후 칸에만.
  assert.match(dialog, /which === "after" && outline && \(/);
  // 겹쳐서: 위 겹(clip)보다 뒤 — 같은 z 에서 DOM 순서로 위에 선다.
  assert.match(dialog, /clip=\{split\}[\s\S]*?<OutlineLayer plan=\{outline\}/);
  // 번갈아: 수정 전 쪽에서는 감춘다.
  assert.match(dialog, /<OutlineLayer[^>]*off=\{side !== "after"\}/);
  // 사진과 같은 크기 · 같은 변환을 입는다.
  assert.match(dialog, /const fit = fitSize\(plan\.size, stage\)/);
  assert.match(dialog, /clampPan\(view\.pan, fit, view\.zoom, stage\)/);
  const layer = body(previewCss, ".nx-cv-layer--outline");
  assert.match(layer, /pointer-events: none;/);
  assert.match(layer, /z-index: 1;/);
  // 번갈아에서 수정 전을 보던 중에 켜면 수정 후로 넘어간다.
  assert.match(dialog, /if \(!tools\.on && layout === "flip"\) setSide\("after"\)/);
});

test("비교 대화상자: 한 장뿐이면 윤곽도 없고 복사는 그 한 장만 — 켠 윤곽의 말은 낭독 칸이 읽는다", () => {
  assert.match(dialog, /before: null,\s*after: \{ src: solo\.src/);
  assert.match(dialog, /both && tools\.on && tools\.diff && tools\.boxes\.length > 0/);
  // 눈에 보이는 줄(.nx-diff-note)은 role 이 없다 — 같은 말을 낭독이 두 번 읽지 않게 한 칸(.nx-sr 의 status)만 읽는다.
  assert.doesNotMatch(dialog, /nx-diff-note[^>]*role=/);
  assert.match(dialog, /\[diffLine, warnLine\]\.filter\(Boolean\)\.join/);
});

test("카드와 대화상자는 같은 말을 쓴다 — 문장은 L.photo 에서만", () => {
  for (const [name, source] of [
    ["카드", card],
    ["대화상자", dialog],
  ] as const) {
    assert.ok(source.includes("L.photo.showDiff"), `${name}: 달라진 곳 표시`);
    assert.ok(source.includes("L.photo.copy"), `${name}: 사진 복사`);
  }
  assert.ok(tools.includes("L.photo.copied") && tools.includes("L.photo.copyFailed"));
  assert.ok(dialog.includes("L.photo.diffOutside") && card.includes("L.photo.diffOutside"));
});
