import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMON_INSTRUCTIONS, stripCommonInstructions } from "../dist/common-instructions.js";

test("공통 지침은 레포의 개발 규칙을 우선하고 앱의 역할만 설명한다", () => {
  assert.match(COMMON_INSTRUCTIONS, /연결 레포의 지침·스킬·설정을 우선/);
  assert.match(COMMON_INSTRUCTIONS, /보관·되돌리기·푸시·제출은 앱이 맡는다/);
  assert.match(COMMON_INSTRUCTIONS, /제출 버튼을 안내/);
  assert.match(COMMON_INSTRUCTIONS, /확인했다고 말하지 않는다/);
  // 기획서 구절(2026-10-23 · 기획서 사본 이동 계획 §6): 사본은 참고이고 미발행 초안은 없으며,
  // 고치는 곳은 앱의 기획서 칸(초안)이나 Confluence 다. 사용자가 보낸 근거 첨부가 기준이다.
  assert.match(
    COMMON_INSTRUCTIONS,
    /함께 열린 기획서 폴더는 Confluence 에서 가져온 사본이라 참고로만 읽고 고치지 않는다/,
  );
  assert.match(COMMON_INSTRUCTIONS, /아직 발행하지 않은 초안은 거기에 없다/);
  assert.match(
    COMMON_INSTRUCTIONS,
    /기획서를 고치는 곳은 앱의 기획서 칸\(초안\)이나 Confluence 다/,
  );
  assert.match(COMMON_INSTRUCTIONS, /기획서 근거\(첨부\)가 이번 요청의 기준이다/);
  // 사본 자리는 클론 밖 프로젝트 폴더로 옮겨졌다 — 불릿에 경로를 적지 않는다(기획서 사본 이동 계획 §6).
  assert.doesNotMatch(COMMON_INSTRUCTIONS, /docs\/plans/);
  // 할 일 · 보조 작업의 글은 입력창 위 알약에 그대로 보인다(2026-10-20 사용자 요청).
  assert.match(
    COMMON_INSTRUCTIONS,
    /할 일 목록\(TodoWrite\)의 항목과 보조 작업\(Agent\)의 설명은 사용자 화면에/,
  );
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
    stripCommonInstructions(`${COMMON_INSTRUCTIONS}\n검색창을 넣어 줘`),
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

test("옛 문장의 저장본도 떼어 낸다 — 상수가 바뀌어도 헤더 걸음이 이어받는다(2026-10-23 · 기획서 사본 이동 계획 §6)", () => {
  // 2026-10-23 이전의 문서 파일 불릿 — 옛 저장본의 모양이다.
  const old = COMMON_INSTRUCTIONS.replace(
    /- 사용자가 보낸 문서 파일은[^\n]*/,
    "- 사용자가 보낸 문서 파일은 읽는 용도로만 쓴다 — 레포에 복사해 남기지 않는다. Confluence 에서 가져온 기획서(`docs/plans/`)도 읽기만 한다 — 기획서를 고치는 곳은 앱의 기획서 칸(초안)이나 Confluence 다. 사용자가 보낸 기획서 근거(첨부)는 이번 요청의 기준으로 따른다.",
  );
  assert.notEqual(old, COMMON_INSTRUCTIONS, "옛 저장본의 모양을 닮게 만들었다");
  assert.equal(stripCommonInstructions(`${old}\n검색창을 넣어 줘`), "검색창을 넣어 줘");
});
