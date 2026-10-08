import assert from "node:assert/strict";
import { test } from "node:test";
import { toolLabel } from "@colonova-design/protocol";
// `../dist` 임포트인 이유: 형제를 `.js` 지정자로 부르는 모듈은 src 직접 로드가
// 그 지정을 못 고친다(git-guard.test.ts 와 같은 길).
import { BROWSER_TOOLS } from "../dist/browser-tools.js";
import { STATS_EDIT_TOOLS, STATS_EXEC_TOOLS, STATS_READ_TOOLS } from "../dist/tool-names.js";

// 도구 이름의 한국어 (베타 준비 분석 2026-10-07) — 허락 카드와 작업 과정 줄에 `browser_snapshot` 같은 영어가
// 그대로 떴다. 사전(protocol/tool-names.ts)은 두 곳의 표와 맞아야 한다: 앱이 올리는 도구(browser-tools.ts)와
// 통계가 아는 공급자 이름(daemon/tool-names.ts). 어느 쪽에 이름이 늘면 이 시험이 사전을 따라가게 한다.

const BROWSER_SERVER = "colonova-browser";
const FORBIDDEN = /(?<![패리])턴|경로|git|커밋|브랜치|\bPR\b|데몬/i;

/** 사용자가 읽는 한국어 이름이다 — 한글이 있고, 영어 이름의 흔적(`_` · 영문자)이 없고, 개발 어휘가 없다. */
function assertUserWords(label: string, source: string) {
  assert.notEqual(label, source, `${source} 의 한국어 이름이 없다 — 영어가 그대로 뜬다`);
  assert.match(label, /[가-힣]/, `${source} → ${label}`);
  assert.doesNotMatch(label, /[A-Za-z_]/, `${source} → ${label}: 영어가 섞였다`);
  assert.doesNotMatch(label, FORBIDDEN, `${source} → ${label}: 개발 어휘`);
}

test("앱이 올리는 도구는 전부 한국어 이름이 있다 — 맨 이름 · Claude(mcp__…) · Codex(서버/이름) 세 모양 모두", () => {
  assert.ok(BROWSER_TOOLS.length >= 23, "도구 목록이 비어 있지 않다");
  for (const tool of BROWSER_TOOLS) {
    const label = toolLabel(tool.name);
    assertUserWords(label, tool.name);
    assert.equal(
      toolLabel(`mcp__${BROWSER_SERVER}__${tool.name}`),
      label,
      `Claude 모양: ${tool.name}`,
    );
    assert.equal(toolLabel(`${BROWSER_SERVER}/${tool.name}`), label, `Codex 모양: ${tool.name}`);
  }
});

test("브라우저 게이트의 허락 카드 이름(browser_ 뒤에 op 이름)도 한국어다 — 도구 이름과 다른 op 이름까지", () => {
  // 레포 밖 화면에서는 모든 브라우저 op 가 카드를 지난다(session.decideBrowserOp(`browser_${op}`)).
  // 카드의 이름은 도구 이름이 아니라 op 이름이라 `browser_waitFor` · `browser_consoleLines` 가 따로 있다.
  const ops = BROWSER_TOOLS.filter((tool) => tool.name.startsWith("browser_")).map(
    (tool) => tool.op,
  );
  assert.ok(ops.includes("waitFor") && ops.includes("consoleLines"));
  for (const op of ops) assertUserWords(toolLabel(`browser_${op}`), `browser_${op}`);
  assert.equal(toolLabel("browser_waitFor"), toolLabel("browser_wait"));
  assert.equal(toolLabel("browser_consoleLines"), toolLabel("browser_console"));
});

test("통계가 아는 공급자 이름(Claude · Codex)은 전부 한국어 이름이 있고, 같은 일은 같은 말이다", () => {
  const groups: Array<[string, Record<string, true>]> = [
    ["읽기", STATS_READ_TOOLS],
    ["편집", STATS_EDIT_TOOLS],
    ["실행", STATS_EXEC_TOOLS],
  ];
  for (const [kind, table] of groups) {
    assert.ok(Object.keys(table).length > 0, kind);
    for (const name of Object.keys(table)) assertUserWords(toolLabel(name), name);
  }
  // Codex 가 같은 일을 다른 이름으로 부른다 — 사용자는 한 가지 말로 읽는다.
  assert.equal(toolLabel("commandExecution"), toolLabel("Bash"));
  assert.equal(toolLabel("execCommand"), toolLabel("Bash"));
  assert.equal(toolLabel("fileChange"), toolLabel("Edit"));
  assert.equal(toolLabel("applyPatch"), toolLabel("Edit"));
  assert.equal(toolLabel("webSearch"), toolLabel("WebSearch"));
  assert.equal(toolLabel("read_file"), toolLabel("Read"));
});

test("제출 도구의 이름은 AI 가 스스로 제출한다는 인상을 주지 않는다 — 사용자의 요청을 말한다", () => {
  // submit_for_review 는 사용자가 대화로 제출을 분명히 청했을 때만 불린다(도구 설명). 제출은 사용자의 일이다.
  const label = toolLabel("submit_for_review");
  assert.ok(label.includes("제출"), "사용자 어휘는 제출이다");
  assert.ok(label.includes("요청"), "누구의 요청을 처리하는 줄인지 보인다");
  assert.doesNotMatch(label, /하기$/, "「제출하기」 는 AI 가 직접 하는 말처럼 읽힌다");
  assert.equal(toolLabel("notify_developer"), "개발자에게 알리기");
});

test("모르는 도구는 지금처럼 원문 그대로 지난다 — 이름을 지어내지 않는다", () => {
  for (const name of [
    "mystery_tool",
    "mcp__other-server__mystery_tool",
    "other-server/mystery_tool",
    "plain",
    // 사전의 상속 칸(Object.prototype)에 걸리면 함수가 돌아온다 — 이름은 문자열 그대로여야 한다.
    "constructor",
    "toString",
    "__proto__",
    "mcp__x__constructor",
  ]) {
    assert.equal(toolLabel(name), name, name);
  }
});
