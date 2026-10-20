import assert from "node:assert/strict";
import { test } from "node:test";
import { toolLabel } from "@colonova-design/protocol";
import { STATS_EDIT_TOOLS, STATS_EXEC_TOOLS, STATS_READ_TOOLS } from "../dist/tool-names.js";

// 공급자 도구와 과거 대화의 한국어 이름을 확인한다.
const BROWSER_SERVER = "colonova-browser";
const FORBIDDEN = /(?<![패리])턴|경로|git|커밋|브랜치|\bPR\b|데몬/i;

/** 사용자가 읽는 한국어 이름이다 — 한글이 있고, 영어 이름의 흔적(`_` · 영문자)이 없고, 개발 어휘가 없다. */
function assertUserWords(label: string, source: string) {
  assert.notEqual(label, source, `${source} 의 한국어 이름이 없다 — 영어가 그대로 뜬다`);
  assert.match(label, /[가-힣]/, `${source} → ${label}`);
  assert.doesNotMatch(label, /[A-Za-z_]/, `${source} → ${label}: 영어가 섞였다`);
  assert.doesNotMatch(label, FORBIDDEN, `${source} → ${label}: 개발 어휘`);
}

test("통계가 아는 공급자 이름(Claude)은 전부 한국어 이름이 있다", () => {
  const groups: Array<[string, Record<string, true>]> = [
    ["읽기", STATS_READ_TOOLS],
    ["편집", STATS_EDIT_TOOLS],
    ["실행", STATS_EXEC_TOOLS],
  ];
  for (const [kind, table] of groups) {
    assert.ok(Object.keys(table).length > 0, kind);
    for (const name of Object.keys(table)) assertUserWords(toolLabel(name), name);
  }
  // 같은 일은 같은 말이다 — Windows 의 PowerShell 도 명령 실행이다.
  assert.equal(toolLabel("PowerShell"), toolLabel("Bash"));
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
