import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (file: string) =>
  readFileSync(new URL(`../src/next/${file}`, import.meta.url), "utf8");

test("검토 2: 링크 아이콘 단추도 링크 초기화 선택자에 맞는다", () => {
  assert.match(
    read("ui/ui.css"),
    /\.nx a\.nx-ibtn\s*\{[^}]*color: inherit;[^}]*text-decoration: none;/,
  );
  assert.doesNotMatch(read("ui/ui.css"), /\.nx a\.nx \.nx-ibtn/);
});

test("검토 6: 강조 주소의 대비 색은 미리보기 규칙보다 높은 특이도로 선다", () => {
  assert.match(
    read("next.css"),
    /\.nx \.nx-addr\.nx-addr--tint,\s*\.nx \.nx-addr\.nx-addr--tint b\s*\{\s*color: var\(--accent-ink\);/,
  );
});
