import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

// 2026-11-12 UI 조사 U-092 · U-163 · U-166 — 전역 · 팔레트 · 셸 선언을 함께 센다.
const root = join(import.meta.dirname, "../src");
function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? cssFiles(path) : entry.name.endsWith(".css") ? [path] : [];
  });
}
const sources = cssFiles(root).map((file) => ({
  file,
  text: readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""),
}));
const declared = new Set(
  sources.flatMap(({ text }) => [...text.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1])),
);
// Hero 의 원형 진행 그림이 각 조각의 길이를 인라인으로 건넨다.
const inline = new Map([["--ring-dash", "next/onboarding/Hero.tsx"]]);
function missing(text: string, definitions: ReadonlySet<string>): string[] {
  return [...text.matchAll(/var\(\s*(--[\w-]+)\s*([,)])/g)].flatMap((match) =>
    match[2] === "," || definitions.has(match[1]) ? [] : [match[1]],
  );
}

test("CSS 변수: 대체값 없는 참조는 전역 · 테마 · 인라인 중 한 곳에서 선언한다", () => {
  for (const [name, file] of inline) {
    assert.ok(
      readFileSync(join(root, file), "utf8").includes(`"${name}"`),
      `${name} 인라인 선언이 없어졌다`,
    );
  }
  const known = new Set([...declared, ...inline.keys()]);
  const failures = sources.flatMap(({ file, text }) =>
    missing(text, known).map((name) => `${relative(root, file)}: ${name}`),
  );
  assert.deepEqual(failures, []);
});

test("CSS 변수: 대체값은 허용하되 대체값 안의 미선언 참조도 잡는다", () => {
  assert.deepEqual(missing("var(--missing)", new Set()), ["--missing"]);
  assert.deepEqual(missing("var(--optional, transparent)", new Set()), []);
  assert.deepEqual(missing("var(--optional, var(--missing))", new Set()), ["--missing"]);
  assert.deepEqual(missing("var(--defined)", new Set(["--defined"])), []);
});

test("U-185 · NOTE-1: 글자는 전역보다 높고 상자는 단일 클래스보다 낮다", () => {
  const css = readFileSync(join(root, "next/next.css"), "utf8");
  const text = css.match(/\.nx button,\s*\.nx textarea,\s*\.nx input\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(text, /font: inherit/);
  assert.match(text, /color: inherit/);
  const box = css.match(/:where\(\.nx\) button\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(box, /background: none/);
  assert.match(box, /padding: 0/);
  assert.doesNotMatch(box, /font:|color:/);
  assert.doesNotMatch(text, /background:|padding:/);
  // 글자 0-1-1 > 전역 button 0-0-1, 상자 0-0-1 < 부품 클래스 0-1-0.
  assert.ok(css.includes(".nx button,"));
  assert.ok(css.includes(":where(.nx) button {"));
});
