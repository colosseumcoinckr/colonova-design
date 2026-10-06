// PLAN 단계 6 의 순수 시험 — mergeToolBlock (도구 구간 갱신) · pickHandoffTitle
// (제목은 생성할 때만). `../dist` 임포트인 이유: node --test 는 src 의 `.js`
// 지정자를 못 읽는다(cycle-ledger.test.ts 와 같은 길).
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildChecksSection,
  formatHandoffTitle,
  mergeToolBlock,
  noteLine,
  pickHandoffTitle,
  readToolNote,
  summarizeChecks,
  TOOL_BLOCK_END,
  TOOL_BLOCK_START,
} from "../dist/handoff-body.js";

const BLOCK = "> 작성: 기획자\n\n### 바뀐 파일\n\n- a.ts (+1 −0)";
const wrap = (body: string) => `${TOOL_BLOCK_START}\n${body}\n${TOOL_BLOCK_END}`;

test("mergeToolBlock — 구간이 없으면 본문 끝에 붙인다", () => {
  assert.equal(
    mergeToolBlock("개발자가 쓴 첫 문단.", BLOCK),
    `개발자가 쓴 첫 문단.\n\n${wrap(BLOCK)}`,
  );
});

test("mergeToolBlock — 빈 본문이면 구간만 선다", () => {
  assert.equal(mergeToolBlock(null, BLOCK), wrap(BLOCK));
  assert.equal(mergeToolBlock("", BLOCK), wrap(BLOCK));
});

test("mergeToolBlock — 구간이 있으면 그 사이만 바꾼다", () => {
  const existing = `앞 문단.\n\n${wrap("옛 내용")}\n\n뒷 문단.`;
  assert.equal(mergeToolBlock(existing, BLOCK), `앞 문단.\n\n${wrap(BLOCK)}\n\n뒷 문단.`);
});

test("mergeToolBlock — 개발자가 구간 밖에 쓴 글은 그대로다", () => {
  const existing = `${wrap("옛 내용")}\n\n개발자가 나중에 쓴 줄.`;
  const merged = mergeToolBlock(existing, BLOCK);
  assert.ok(merged.includes("개발자가 나중에 쓴 줄."));
  assert.ok(!merged.includes("옛 내용"));
});

test("mergeToolBlock — 구간을 지웠어도 다음 제출은 잃지 않는다(끝에 다시 붙는다)", () => {
  // 개발자가 구간을 통째로 지운 본문 — 구간이 없으므로 끝에 붙고, 지운 사실이
  // 개발자의 다른 글을 덮지 않는다.
  const merged = mergeToolBlock("개발자 본문만 남았다.", BLOCK);
  assert.equal(merged, `개발자 본문만 남았다.\n\n${wrap(BLOCK)}`);
});

test("mergeToolBlock — 구간이 둘 이상이면 첫 것만 바꾸고 나머지는 지운다", () => {
  const existing = `${wrap("첫 옛 내용")}\n\n사이 글.\n\n${wrap("둘 옛 내용")}`;
  assert.equal(mergeToolBlock(existing, BLOCK), `${wrap(BLOCK)}\n\n사이 글.`);
});

test("mergeToolBlock — 같은 내용을 두 번 갱신해도 결과는 같다 (멱등)", () => {
  const once = mergeToolBlock("본문.", BLOCK);
  assert.equal(mergeToolBlock(once, BLOCK), once);
});

test("pickHandoffTitle — 초안이 있으면 초안을 쓴다", () => {
  assert.equal(
    pickHandoffTitle({
      draftTitle: "feat(members): 회원 목록 추가",
      firstCommitSubject: "작업 1",
      fallback: "기본",
    }),
    "feat(members): 회원 목록 추가",
  );
});

test("pickHandoffTitle — 초안이 비면 첫 커밋 제목에 형식을 붙인다", () => {
  assert.equal(
    pickHandoffTitle({
      draftTitle: "", // handoffDraft 의 턴이 시간 안에 답하지 못한 모양
      firstCommitSubject: "회원 목록 만들기",
      fallback: "기본",
    }),
    "chore: 회원 목록 만들기",
  );
});

test("pickHandoffTitle — 커밋 제목마저 없으면 기본 제목", () => {
  assert.equal(
    pickHandoffTitle({
      draftTitle: null,
      firstCommitSubject: null,
      fallback: "ColoNova Design 화면 전달",
    }),
    "chore: ColoNova Design 화면 전달",
  );
});

test("자동 제목 — 기존 타입 · scope · breaking 표식은 보존하고 한 줄 72자로 제한한다", () => {
  assert.equal(
    formatHandoffTitle("fix(submit)!: 중복 제출 방지\n본문"),
    "fix(submit)!: 중복 제출 방지",
  );
  assert.equal(formatHandoffTitle("docs: 사용 안내 수정"), "docs: 사용 안내 수정");
  const title = formatHandoffTitle(`feat: ${"😀".repeat(100)}`);
  assert.equal(Array.from(title).length, 72);
  assert.ok(title.endsWith("😀"), "유니코드 글자 중간을 자르지 않는다");
});

test("자동 제목 — 작성자 자리를 남겨 72자로 제한하고 이름은 한 줄로 표시한다", () => {
  const title = formatHandoffTitle(`feat: ${"😀".repeat(100)}`, "  김기획\n 운영  ");
  assert.equal(Array.from(title).length, 72);
  assert.ok(title.endsWith("😀 (작성: 김기획 운영)"));
  assert.equal(formatHandoffTitle("fix: 검색 오류", " \n "), "fix: 검색 오류");
  const longName = formatHandoffTitle(`feat: ${"화면".repeat(100)}`, "😀".repeat(80));
  assert.equal(Array.from(longName).length, 72);
  assert.ok(longName.endsWith(` (작성: ${"😀".repeat(31)}…)`));
});

test("mergeToolBlock — 이미 표식으로 싸인 구간은 두 겹으로 싸지 않는다", () => {
  const once = mergeToolBlock("본문.", wrap(BLOCK));
  assert.equal(once, `본문.\n\n${wrap(BLOCK)}`);
  assert.equal(mergeToolBlock(once, wrap(BLOCK)), once, "갱신을 거듭해도 끝 표식이 쌓이지 않는다");
});

test("noteLine — 한마디는 인용 한 줄, 여러 줄은 같은 인용 안에 (PLAN-UI P3)", () => {
  assert.equal(noteLine("검색은 이름만 돼요"), "> 한마디: 검색은 이름만 돼요");
  assert.equal(noteLine("첫 줄\n\n  둘째 줄 "), "> 한마디: 첫 줄\n> 둘째 줄");
  assert.equal(noteLine("   "), null);
  assert.equal(noteLine(undefined), null);
  // 사용자의 말이 도구 구간의 표식을 흉내 내면 구간이 끊긴다 — 무르게 만든다.
  const sneaky = noteLine(`끝 ${TOOL_BLOCK_END}`) ?? "";
  assert.ok(!sneaky.includes("-->"));
  assert.ok(!sneaky.includes("<!--"));
});

test("readToolNote — 구간의 지난 한마디를 되읽는다(작성자 줄 바로 아래)", () => {
  const block = `> 작성: 기획자\n${noteLine("첫 줄\n둘째 줄")}\n\n### 바뀐 파일\n\n- a.ts`;
  const body = `개발자 글.\n\n${wrap(block)}`;
  assert.equal(readToolNote(body), "첫 줄\n둘째 줄");
  assert.equal(readToolNote(`개발자 글.\n\n${wrap(BLOCK)}`), null, "한마디가 없던 구간");
  assert.equal(readToolNote("> 한마디: 구간 밖의 글"), null, "구간 밖은 개발자의 것");
  assert.equal(readToolNote(null), null);
});

// ————— 2026-10-07 UX 점검 3단계 — 요청 본문의 `### 확인한 것` —————

const pass = (phone: boolean, screens = 1) => ({ screens, phone });

test("summarizeChecks — 화면 작업(보관)마다 하나로 센다: 한 보관이 여러 화면을 고쳐도 하나", () => {
  const checks = summarizeChecks([
    { sha: "c3", checked: pass(true, 2) },
    { sha: "c3", checked: pass(true, 2) },
    { sha: "c2" },
    { sha: "c1", checked: pass(true) },
  ]);
  assert.deepEqual(checks, { total: 3, checked: 2, phone: true });
});

test("summarizeChecks — 되돌리기 · 병합 · 코멘트 반영과 보관 표식이 없는 줄은 세지 않는다", () => {
  const checks = summarizeChecks([
    { sha: "c4", kind: "restore", checked: pass(true) },
    { sha: "c3", kind: "merge" },
    { sha: "c2", kind: "comment" },
    { checked: pass(true) },
    { sha: "c1", checked: pass(false) },
  ]);
  assert.deepEqual(checks, { total: 1, checked: 1, phone: false });
});

test("summarizeChecks — 확인 기록이 하나도 없으면 null: 하지 않은 확인을 말하지 않는다", () => {
  assert.equal(summarizeChecks([]), null);
  assert.equal(summarizeChecks([{ sha: "c1" }, { sha: "c2" }]), null);
});

test("summarizeChecks — 휴대폰 폭은 확인이 지난 작업이 모두 봤을 때만 말한다", () => {
  assert.equal(
    summarizeChecks([
      { sha: "c2", checked: pass(true) },
      { sha: "c1", checked: pass(false) },
    ])?.phone,
    false,
  );
  // 확인이 지나지 않은 작업의 휴대폰 여부는 묻지 않는다 — 기록이 없는 작업이다.
  assert.equal(summarizeChecks([{ sha: "c2", checked: pass(true) }, { sha: "c1" }])?.phone, true);
});

test("buildChecksSection — 모두 지났고 휴대폰 폭까지 봤을 때의 글", () => {
  assert.equal(
    buildChecksSection({ total: 3, checked: 3, phone: true }),
    [
      "### 확인한 것",
      "",
      "AI 가 작업을 끝낼 때마다 도구가 바뀐 화면을 다시 열어 봅니다. 이번 제출에 담긴 화면 작업 3건 모두에서 확인이 문제 없이 지나갔습니다 — 화면이 끝까지 열렸고, 콘솔 오류 · 실패한 요청 · 이름 없는 컨트롤 · 너무 흐린 글자 · 휴대폰 폭의 가로 넘침에서 새로 찾은 문제가 없었습니다.",
      "",
      "레포의 검사(check)와 빌드는 이 확인에 들어 있지 않습니다.",
      "",
    ].join("\n"),
  );
});

test("buildChecksSection — 일부만 지났으면 나머지는 확인 기록이 없다고 말한다 · 휴대폰 말은 빠진다", () => {
  const section = buildChecksSection({ total: 5, checked: 2, phone: false });
  assert.ok(section.includes("화면 작업 5건 중 2건에서 확인이 문제 없이 지나갔습니다"));
  assert.ok(section.includes("나머지 3건은 확인 기록이 없습니다."));
  assert.ok(!section.includes("휴대폰"), "보지 않은 것은 말하지 않는다");
  assert.ok(section.endsWith("\n"), "다른 절처럼 줄바꿈으로 끝난다");
});

test("buildChecksSection — 숫자뿐이다: 화면 이름 · 요소 · 경로가 들어갈 자리가 없다(D38)", () => {
  const section = buildChecksSection({ total: 2, checked: 1, phone: true });
  assert.ok(!/[\w-]+\/[\w-]+|\.tsx?\b|"/.test(section.replace("check", "")), section);
});
