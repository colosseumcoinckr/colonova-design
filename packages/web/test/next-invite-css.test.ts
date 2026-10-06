import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * 초대 확인판 CSS 의 조용한 실패를 지킨다(2026-10-06 겹판 손질). 화면에는 오류가 없는데 모션이 사라지거나
 * 겹판의 옷이 덮이거나, 옛 규칙이 남아 새 규칙과 불러오는 순서에 따라 다투는 것들이다.
 * 판의 안쪽은 `invite.css`, 판의 공용 배치(`.nx-modal` · `.nx-mhd` · `.nx-mfoot`)는 `onboarding.css` 의 몫이다.
 */
const root = join(import.meta.dirname, "../src/next");
const invite = readFileSync(join(root, "onboarding/invite.css"), "utf8");
const onboarding = readFileSync(join(root, "onboarding/onboarding.css"), "utf8");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return cssFiles(full);
    return name.endsWith(".css") ? [full] : [];
  });
}

/** 선택자 하나짜리 규칙의 몸 — 중첩이 없는 규칙만 읽는다. */
function body(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(match, `${selector} 규칙이 없다`);
  return match[1] ?? "";
}

test("초대 확인판: 쓰는 애니메이션의 키프레임이 어딘가에 있다 — 빌려 온 이름이 사라지면 모션이 말없이 죽는다", () => {
  const used = new Set(
    [...invite.matchAll(/animation(?:-name)?:([^;]*);/g)].flatMap((match) =>
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
  assert.deepEqual(
    [...used].filter((name) => !defined.has(name)),
    [],
  );
});

test("초대 확인판: 판의 옷은 overlay.css 의 것이다 — 폭만 정하고 스크림 · 그림자 · 모션은 다시 선언하지 않는다", () => {
  const panel = body(invite, ".nx-modal.nx-inv");
  assert.match(panel, /width:\s*min\(620px/);
  for (const forbidden of ["box-shadow", "border-radius", "background", "animation", "z-index"]) {
    assert.doesNotMatch(
      panel,
      new RegExp(`${forbidden}\\s*:`),
      `${forbidden} 는 겹판 뼈대의 몫이다`,
    );
  }
});

test("초대 확인판: 옛 안쪽 규칙이 onboarding.css 에 남아 있지 않다 — 새 규칙과 순서로 다투지 않게", () => {
  // 실패 때 파일 전체가 출력에 쏟아지지 않게 불리언으로 가른다.
  for (const old of [
    ".nx-inv-head",
    ".nx-inv-h",
    ".nx-inv-list",
    ".nx-inv-row",
    ".nx-inv-row--new",
    ".nx-inv-warn",
    // 이름 칸의 초점 고리만 FirstRun 의 입력칸과 한 선택자 목록으로 onboarding.css 에 남는다.
    ".nx-inv-author(?! input:focus-visible)",
  ]) {
    const rule = new RegExp(`(?:^|\\n)${old.replace(/\.nx/g, "\\.nx")}[\\s,{]`);
    assert.equal(rule.test(onboarding), false, `${old} 는 invite.css 로 옮겼다`);
  }
  // 판의 공용 배치는 그대로 onboarding.css 에 있다 — 다른 겹판(기능 제안 · 단축키 · 비교)이 기댄다.
  for (const shared of [".nx-modal", ".nx-mhd", ".nx-mbody", ".nx-mfoot", ".nx-fill"]) {
    const rule = new RegExp(`(?:^|\\n)${shared.replace(/\./g, "\\.")}\\s*\\{`);
    assert.equal(rule.test(onboarding), true, `${shared} 가 사라졌다`);
  }
});

test("초대 확인판: 이 파일의 모든 선택자는 판의 뿌리(.nx-inv)를 앞세운다 — 불러오는 순서와 상관없이 이긴다", () => {
  const selectors = [...invite.matchAll(/(?:^|\n)([^\s@/}][^{]*)\{/g)]
    .flatMap((match) => (match[1] ?? "").split(","))
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0 && !/^(?:from|to|\d+%)$/.test(selector));
  assert.ok(selectors.length > 40, `선택자가 너무 적다: ${selectors.length}`);
  const bare = selectors.filter((selector) => !selector.includes(".nx-inv"));
  // 바닥(`.nx-modal--frame …nx-inv-foot`)은 꼬리표 클래스가 있어 `.nx-inv` 를 앞세운 것과 같다.
  assert.deepEqual(bare, []);
});

test("초대 확인판: 글자는 12px 이상이다", () => {
  const sizes = [...invite.matchAll(/font-size:\s*([\d.]+)px/g)].map((match) => Number(match[1]));
  assert.ok(sizes.length > 10, `글자 크기 선언이 너무 적다: ${sizes.length}`);
  assert.deepEqual(
    sizes.filter((size) => size < 12),
    [],
  );
});

test("초대 확인판: 결과의 체크는 끝난 뒤에 남는 transform 애니메이션을 쓰지 않는다(backwards 만)", () => {
  const rule = body(invite, ".nx-inv .nx-inv-ok");
  assert.match(rule, /animation:[^;]*\bbackwards\b/);
  assert.doesNotMatch(rule, /animation:[^;]*\b(?:forwards|both)\b/);
});
