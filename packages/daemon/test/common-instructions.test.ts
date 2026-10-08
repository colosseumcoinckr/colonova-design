// 공통 지침의 모양 시험 (PLAN-MCP M-11) — 새 불릿이 `- ` 한 줄 형식을 지키는지와
// 지침이 새 도구 이름을 말하는지 본다. src 임포트인 이유는 turn-subject.test.ts 와 같다.
import assert from "node:assert/strict";
import { test } from "node:test";
import { BROWSER_TOOLS } from "../dist/browser-tools.js";
import { COMMON_INSTRUCTIONS, stripCommonInstructions } from "../src/common-instructions.ts";

test("공통 지침은 도구의 쓰임새를 되풀이하지 않는다 — 인자 · 언제 부르는지는 도구 설명의 몫이다", () => {
  // claude.dev 「context engineering for Claude 5」(2026-10-02): 도구 사용법은 도구 설명 한 곳에만.
  // 지침은 화면 확인의 고리(screen_check)와 락파일의 길(notify_developer)만 이름으로 가리킨다.
  for (const name of ["screen_check", "notify_developer"]) {
    assert.ok(COMMON_INSTRUCTIONS.includes(name), `지침이 ${name} 을 언급한다`);
  }
  for (const name of [
    "browser_find",
    "browser_inspect",
    "browser_snapshot",
    "screen_files",
    "repo_diagnostics",
    "submit_for_review",
  ]) {
    assert.ok(
      !COMMON_INSTRUCTIONS.includes(name),
      `${name} 의 쓰임새는 도구 설명이 말한다 — 지침에서 되풀이하지 않는다`,
    );
  }
  for (const param of ["routes", "viewport", "capture", "a11y: true", "colorScheme"]) {
    assert.ok(
      !COMMON_INSTRUCTIONS.includes(param),
      `screen_check 의 인자 ${param} 는 도구 설명의 몫이다`,
    );
  }
  const screenCheck = BROWSER_TOOLS.find((tool) => tool.name === "screen_check");
  assert.ok(screenCheck !== undefined);
  for (const param of ["routes", "viewport", "a11y", "colorScheme", "capture"]) {
    assert.ok(param in screenCheck.properties, `screen_check 의 인자 ${param} 가 도구 설명에 있다`);
  }
  assert.ok(COMMON_INSTRUCTIONS.includes("되풀이하지 않는다"), "지침이 그 분담을 스스로 말한다");
});

test("블록의 줄은 헤더 · 설명 · 빈 줄 · `- ` 불릿뿐이다 — 줄 걸음이 그 모양만 규칙으로 센다", () => {
  // stripCommonInstructions 의 줄 걸음 경로는 이 네 모양만 지나고 첫 벗어난 줄에서 멈춘다.
  // 새 불릿이 이 모양을 깨면 옛 저장본의 규칙 떼어내기가 사용자의 말을 삼킨다.
  const rows = COMMON_INSTRUCTIONS.split("\n").slice(1);
  for (const row of rows) {
    const trimmed = row.trim();
    assert.ok(
      trimmed === "" || trimmed.startsWith("- ") || trimmed.startsWith("이 규칙은"),
      `규칙 블록의 줄은 불릿 · 빈 줄 · 설명뿐이어야 한다: ${trimmed.slice(0, 40)}`,
    );
  }
});

test("새 불릿도 규칙 블록으로 걷힌다 — 블록 뒤에는 사용자의 말만 남는다", () => {
  const turn = `${COMMON_INSTRUCTIONS}\n회원 목록에 검색창을 넣어 줘`;
  assert.equal(stripCommonInstructions(turn), "회원 목록에 검색창을 넣어 줘");
});

test("줄 걸음 경로도 새 불릿을 걷는다 — 저장본의 불릿이 달라도 `- ` 모양이면 충분하다", () => {
  // 지침이 바뀌기 전에 저장된 턴은 상수와 정확히 같지 않다 — 이때는 헤더로
  // 시작하는 줄 걸음이 걷는다. 새 불릿이 한 줄 형식을 지키는 것이 이 길의 전제다.
  const elementBullet = COMMON_INSTRUCTIONS.split("\n").find((row) =>
    row.startsWith("- 화면의 모든 컨트롤"),
  );
  assert.ok(elementBullet !== undefined, "풀 인터랙션 불릿이 실려 있다");
  const stored = [
    "# ColoNova Design 공통 규칙",
    "",
    "이 규칙은 어떤 레포를 연결했는지와 무관하게 모든 대화에 함께 간다.",
    "",
    "- 옛 불릿",
    elementBullet,
    "",
    "회원 목록에 검색창을 넣어 줘",
  ].join("\n");
  assert.equal(stripCommonInstructions(stored), "회원 목록에 검색창을 넣어 줘");
});

// 2026-10-07 베타 준비 분석 — 세 구절을 새 불릿이 아니라 기존 불릿에 합쳤다(슬림화의 결과물이다:
// 24 → 12 불릿, 1,998자). 총량이 다시 부풀지 않도록 불릿 수와 글자 수에 천장을 둔다.
const bullets = COMMON_INSTRUCTIONS.split("\n").filter((row) => row.startsWith("- "));
const bulletWith = (needle: string) => bullets.find((row) => row.includes(needle));

test("공통 규칙의 총량 — 불릿은 열둘에 새 불릿 둘까지, 글자 수는 2,400자 안", () => {
  assert.ok(bullets.length <= 14, `불릿 ${bullets.length}개 — 겹치는 것은 합친다`);
  assert.ok(
    COMMON_INSTRUCTIONS.length <= 2_400,
    `${COMMON_INSTRUCTIONS.length}자 — 슬림화를 되돌리지 않는다`,
  );
});

test("서버 · 로그인이 필요한 기능은 목 데이터로 만들되 예시라고 밝힌다 — 서버 이야기 금지와 부딪히지 않게 그 말 없이", () => {
  const mock = bulletWith("목 데이터와 실제로 동작한다");
  assert.ok(mock !== undefined, "목 데이터 불릿이 있다");
  assert.ok(
    mock.includes("서버 · 로그인이 필요한 기능도 목 데이터로 만들고"),
    "서버 · 로그인이 필요한 기능도 목 데이터가 된다 — 조용히가 아니라",
  );
  const line = /"([^"]*예시 데이터[^"]*)"/.exec(mock)?.[1];
  assert.equal(line, "예시 데이터로 보여 드려요", "답변에 남길 한 줄이 따옴표로 정해져 있다");
  assert.ok(!line.includes("서버"), "답변에 쓰는 말에는 서버가 없다");
  assert.ok(
    COMMON_INSTRUCTIONS.includes("서버 이야기를 쓰지 않"),
    "답변에서 서버 이야기를 하지 않는 규칙은 그대로다",
  );
});

test("확인이 로그인 · 오류 화면에서 멈췄으면 확인했다고 하지 않는다 — 기존 `확인을 마치지 못했으면` 에 합쳤다", () => {
  const answer = bulletWith("확인을 마치지 못했으면");
  assert.ok(answer !== undefined);
  assert.match(
    answer,
    /확인을 마치지 못했으면\(로그인 · 오류 화면에서 멈춘 것도\) 확인했다고 하지 말고/,
  );
  assert.ok(answer.includes("무엇을 확인하지 못했는지 쉬운 말로 밝힌다"), "밝히는 말은 그대로다");
});

test("요청이 모호하면 되묻기 전에 한 갈래로 해 보이고 이해한 바를 한 줄 밝힌다 — 되묻기는 여전히 하나", () => {
  const answer = bulletWith("되묻기 전에");
  assert.ok(answer !== undefined);
  assert.match(
    answer,
    /어느 화면 · 요소인지 갈려 모호하면 되묻기 전에 가장 그럴듯한 한 갈래로 해 보이고/,
  );
  assert.ok(answer.includes("이해한 바를 한 줄로 밝히며"), "이해한 바를 말한다");
  assert.ok(
    answer.includes("물어볼 것이 있으면 하나만 묻는다"),
    "되묻기는 하나만 — 기존 규칙에 합쳤다",
  );
  // 두 구절은 한 불릿(답변의 틀)에 산다 — 같은 곳을 따로 두 번 가르치지 않는다.
  assert.equal(bulletWith("확인을 마치지 못했으면"), answer);
});
