import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * 기능 제안 CSS 의 조용한 실패를 지킨다(2026-10-06 겹판 손질). 화면에는 오류가 없는데 모션이 사라지거나
 * 겹판의 옷이 덮이는 것들이다 — 접수의 체크는 다른 파일(onboarding.css)의 키프레임을 이름으로 빌려 쓴다.
 */
const root = join(import.meta.dirname, "../src/next");
const css = readFileSync(join(root, "feedback/feedback.css"), "utf8");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return name.endsWith(".css") ? [full] : [];
  });
}

/** 선택자 하나짜리 규칙의 몸 — 중첩이 없는 규칙만 읽는다. */
function body(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `${selector} 규칙이 없다`);
  return match[1] ?? "";
}

test("기능 제안: 쓰는 애니메이션의 키프레임이 어딘가에 있다 — 빌려 온 이름이 사라지면 모션이 말없이 죽는다", () => {
  const used = new Set(
    [...css.matchAll(/animation(?:-name)?:([^;]*);/g)].flatMap((match) =>
      // `var(--nx-t-move)` 같은 변수 이름은 애니메이션 이름이 아니다 — 앞에 `-` 가 붙지 않은 것만.
      [...(match[1] ?? "").matchAll(/(?<![\w-])nx-[\w-]+/g)].map((name) => name[0]),
    ),
  );
  assert.ok(used.size >= 3, `쓰는 애니메이션이 너무 적다: ${[...used].join(", ")}`);
  const defined = new Set(
    cssFiles(root).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/@keyframes\s+([\w-]+)/g)].map((name) => name[1]),
    ),
  );
  const missing = [...used].filter((name) => !defined.has(name));
  assert.deepEqual(missing, []);
});

test("기능 제안: 판의 옷은 overlay.css 의 것이다 — 폭만 정하고 스크림 · 그림자 · 모션은 다시 선언하지 않는다", () => {
  const panel = body(".nx-modal.nx-fb");
  assert.match(panel, /width:\s*min\(480px/);
  for (const forbidden of ["box-shadow", "border-radius", "background", "animation", "z-index"]) {
    assert.doesNotMatch(
      panel,
      new RegExp(`${forbidden}\\s*:`),
      `${forbidden} 는 겹판 뼈대의 몫이다`,
    );
  }
});

test("기능 제안: 사이드바 바닥의 `기능 제안` 단추 규칙이 남아 있다", () => {
  assert.match(body(".nx .nx-fb-row"), /width:\s*100%/);
});

test("기능 제안: 글자는 12px 이상이다", () => {
  const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1]));
  assert.ok(sizes.length > 10, `글자 크기 선언이 너무 적다: ${sizes.length}`);
  assert.deepEqual(
    sizes.filter((size) => size < 12),
    [],
  );
  // 줄임 표기(`font: 500 12px …`)도 같다.
  const shorthand = [...css.matchAll(/font:\s*\d+\s+([\d.]+)px/g)].map((match) => Number(match[1]));
  assert.deepEqual(
    shorthand.filter((size) => size < 12),
    [],
  );
});

test("기능 제안: 접수의 체크는 끝난 뒤에 남는 transform 애니메이션을 쓰지 않는다(backwards 만)", () => {
  const rule = body(".nx-fb-ok");
  assert.match(rule, /animation:[^;]*\bbackwards\b/);
  assert.doesNotMatch(rule, /animation:[^;]*\b(?:forwards|both)\b/);
});
