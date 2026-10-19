import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMON_INSTRUCTIONS, stripCommonInstructions } from "../dist/common-instructions.js";

test("공통 지침은 레포의 개발 규칙을 우선하고 앱의 역할만 설명한다", () => {
  assert.match(COMMON_INSTRUCTIONS, /연결 레포의 지침·스킬·설정을 우선/);
  assert.match(COMMON_INSTRUCTIONS, /보관·되돌리기·푸시·제출은 앱이 맡는다/);
  assert.match(COMMON_INSTRUCTIONS, /제출 버튼을 안내/);
  assert.match(COMMON_INSTRUCTIONS, /확인했다고 말하지 않는다/);
  assert.doesNotMatch(
    COMMON_INSTRUCTIONS,
    /notify_developer|screen_check|describe_changes|repo_diagnostics|목 데이터|락파일|package\.json|3:1|aria-label/,
  );
  assert.ok(COMMON_INSTRUCTIONS.length <= 1_000);
});

test("지침 블록은 제목·설명·한 줄 불릿으로만 쓰고 사용자의 말과 분리한다", () => {
  for (const row of COMMON_INSTRUCTIONS.split("\n").slice(1)) {
    assert.ok(row === "" || row.startsWith("- ") || row.startsWith("이 규칙은"));
  }
  assert.equal(
    stripCommonInstructions(COMMON_INSTRUCTIONS + "\n검색창을 넣어 줘"),
    "검색창을 넣어 줘",
  );
});

test("예전 지침이 담긴 대화도 사용자의 말만 제목으로 읽는다", () => {
  const stored = [
    "# ColoNova Design 공통 규칙",
    "",
    "이 규칙은 모든 대화에 함께 간다.",
    "- 옛 불릿",
    "- 화면의 모든 컨트롤은 목 데이터와 실제로 동작한다.",
    "",
    "검색창을 넣어 줘",
  ].join("\n");
  assert.equal(stripCommonInstructions(stored), "검색창을 넣어 줘");
});
