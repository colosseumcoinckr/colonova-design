import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * 셸의 크기 토큰 계약(2026-10-23 화면 전면 재설계 §5). 글자 크기 시험들이 `var(--fs-*)` 를 세어 12px 하한을 믿으므로,
 * 토큰 값 자체가 하한을 지키는지 여기서 본다(2026-10-24 F 검토 — 토큰이 11px 로 내려가도 그쪽 시험은 모른다).
 */
const tokens = readFileSync(join(import.meta.dirname, "../src/next/ui/tokens.css"), "utf8");
const value = (name: string): number => {
  const match = tokens.match(new RegExp(`--${name}:\\s*([0-9.]+)px;`));
  assert.ok(match, `토큰 --${name} 이 px 값으로 있어야 한다`);
  return Number(match[1]);
};

test("글자 토큰은 모두 정수 px 이고 12px 아래로 내려가지 않는다", () => {
  const names = [...tokens.matchAll(/--(fs-[a-z0-9]+):/g)].map((m) => m[1]);
  assert.ok(names.length >= 9, "글자 토큰이 아홉 개 이상 있어야 한다");
  for (const name of names) {
    const px = value(name);
    assert.ok(Number.isInteger(px), `--${name} 은 정수 px 여야 한다(반 픽셀 금지): ${px}`);
    assert.ok(px >= 12, `--${name} 은 12px 이상이어야 한다: ${px}`);
  }
});

test("글자 토큰은 작은 것부터 차례로 커진다", () => {
  const order = [
    "fs-cap",
    "fs-sm",
    "fs-ui",
    "fs-read",
    "fs-lg",
    "fs-h3",
    "fs-h2",
    "fs-h1",
    "fs-hero",
  ];
  const sizes = order.map(value);
  for (let i = 1; i < sizes.length; i += 1) {
    assert.ok(
      sizes[i] > sizes[i - 1],
      `--${order[i]}(${sizes[i]}) 는 --${order[i - 1]}(${sizes[i - 1]}) 보다 커야 한다`,
    );
  }
});

test("단추 · 입력 · 줄 높이 토큰은 설계 값이다", () => {
  assert.deepEqual(
    ["h-sm", "h-md", "h-input", "h-lg", "h-row", "h-bar"].map(value),
    [28, 32, 36, 40, 32, 52],
  );
});
