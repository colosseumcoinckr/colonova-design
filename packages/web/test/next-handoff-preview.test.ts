import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-making.test.ts 와 같은 모양).
import {
  firstSubjectOf,
  handoffPreviewOf,
  previewSummary,
  previewTitle,
  SUMMARY_MAX_CHARS,
} from "../src/next/lib/handoff-preview.ts";

/**
 * 제출 확인의 「개발자에게는 이렇게 보여요」(2026-10-07 UX 점검 3단계). 개발자가 읽는 제목에는 종류 접두어와 작성자
 * 꼬리가 붙는데 둘 다 개발자 쪽 형식이다 — 사용자의 화면에는 문장만 선다.
 */

test("previewTitle: 종류 접두어와 작성자 꼬리를 뗀다", () => {
  assert.equal(
    previewTitle("feat(members): 회원 목록에 이름 검색 추가 (작성: 김기획)"),
    "회원 목록에 이름 검색 추가",
  );
  assert.equal(previewTitle("fix: 중복 제출 방지"), "중복 제출 방지");
  assert.equal(previewTitle("chore!: 설정 정리"), "설정 정리");
});

test("previewTitle: 종류가 아닌 앞말은 건드리지 않는다 — 문장의 콜론을 접두어로 읽지 않는다", () => {
  assert.equal(previewTitle("결제: 영수증 화면"), "결제: 영수증 화면");
  assert.equal(previewTitle("Feature: 검색"), "Feature: 검색");
  assert.equal(previewTitle("feat 검색창 추가"), "feat 검색창 추가");
});

test("previewTitle: 첫 의미 줄만 쓰고, 빈 글은 빈 글이다", () => {
  assert.equal(previewTitle("\n\nfix: 첫 줄\n둘째 줄"), "첫 줄");
  assert.equal(previewTitle(""), "");
  assert.equal(previewTitle("   "), "");
});

test("previewTitle: 작성자 꼬리는 끝에 있을 때만 뗀다", () => {
  assert.equal(previewTitle("feat: 괄호 (작성: 이름) 가운데"), "괄호 (작성: 이름) 가운데");
});

test("previewSummary: 첫 문단만, 마크다운 기호는 걷는다", () => {
  const body = [
    "회원 목록 맨 위에 **검색창**을 넣고 `MemberList` 를 이름으로 거른다.",
    "",
    "- 둘째 문단은 쓰지 않는다",
  ].join("\n");
  assert.equal(
    previewSummary(body),
    "회원 목록 맨 위에 검색창을 넣고 MemberList 를 이름으로 거른다.",
  );
});

test("previewSummary: 항목만 있는 문단은 항목을 이어 붙인다", () => {
  assert.equal(
    previewSummary("- 검색창 추가\n- 빈 결과 문구\n1. 휴대폰 폭 맞춤"),
    "검색창 추가 빈 결과 문구 휴대폰 폭 맞춤",
  );
});

test("previewSummary: 링크는 글자만, 제목 기호는 걷는다", () => {
  assert.equal(
    previewSummary("## 변경\n[회원 목록](http://127.0.0.1:5173/members) 을 고쳤다"),
    "변경 회원 목록 을 고쳤다",
  );
});

test("previewSummary: 읽을 글이 없으면 null", () => {
  assert.equal(previewSummary(""), null);
  assert.equal(previewSummary("\n\n  \n"), null);
  assert.equal(previewSummary("###"), null);
});

test("previewSummary: 너무 길면 말줄임으로 닫는다 — 글자 수는 코드 포인트로 센다", () => {
  const long = "가".repeat(SUMMARY_MAX_CHARS + 30);
  const out = previewSummary(long);
  assert.ok(out);
  assert.equal(Array.from(out).length, SUMMARY_MAX_CHARS);
  assert.ok(out.endsWith("…"));
  // 한도 안은 그대로다.
  assert.equal(previewSummary("가".repeat(SUMMARY_MAX_CHARS)), "가".repeat(SUMMARY_MAX_CHARS));
  // 이모지처럼 두 칸을 차지하는 글자가 잘려 깨지지 않는다.
  const emoji = previewSummary("😀".repeat(SUMMARY_MAX_CHARS + 5));
  assert.ok(emoji);
  assert.equal(Array.from(emoji).length, SUMMARY_MAX_CHARS);
});

test("firstSubjectOf: 기록은 새것부터라 맨 끝이 첫 보관이다 — 첫 의미 줄만", () => {
  assert.equal(
    firstSubjectOf([
      { message: "검색창 위치 조정" },
      { message: "\n회원 목록 맨 위에 검색창을 넣어 줘\n덧붙임" },
    ]),
    "회원 목록 맨 위에 검색창을 넣어 줘",
  );
  assert.equal(firstSubjectOf([]), null);
  assert.equal(firstSubjectOf([{ message: "  " }]), null);
});

test("handoffPreviewOf: 초안의 제목과 설명과 사진 수를 한 모습으로 모은다", () => {
  const preview = handoffPreviewOf(
    {
      title: "feat(members): 회원 목록에 이름 검색 추가 (작성: 김기획)",
      body: "회원 목록에서 이름으로 찾을 수 있다.\n\n- 세부",
      extras: {
        commentsSection: null,
        filesSection: null,
        shotCount: 3,
        checks: { total: 5, checked: 4, phone: true },
      },
    },
    "첫 보관 제목",
  );
  assert.deepEqual(preview, {
    title: "회원 목록에 이름 검색 추가",
    summary: "회원 목록에서 이름으로 찾을 수 있다.",
    photos: 3,
    checks: { total: 5, checked: 4 },
    by: "ai",
  });
});

test("handoffPreviewOf: AI 가 제목을 못 낸 초안은 첫 보관의 제목을 대신 쓴다 — 데몬이 같은 대신을 쓴다", () => {
  const preview = handoffPreviewOf({ title: "", body: "" }, "회원 목록 맨 위에 검색창을 넣어 줘");
  assert.deepEqual(preview, {
    title: "회원 목록 맨 위에 검색창을 넣어 줘",
    summary: null,
    photos: 0,
    checks: null,
    by: "request",
  });
});

test("handoffPreviewOf: 보여 줄 글이 하나도 없으면 null — 빈 상자를 세우지 않는다", () => {
  assert.equal(handoffPreviewOf({ title: "", body: "" }, null), null);
  assert.equal(handoffPreviewOf({ title: "feat: ", body: "  " }, "   "), null);
});

test("handoffPreviewOf: 제목은 없고 설명만 있어도 설명은 보여 준다", () => {
  const preview = handoffPreviewOf({ title: "", body: "화면 두 곳을 고쳤다." }, null);
  assert.deepEqual(preview, {
    title: "",
    summary: "화면 두 곳을 고쳤다.",
    photos: 0,
    checks: null,
    by: "ai",
  });
});

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("제출 확인은 첫 제출에만 초안을 읽고, 보관의 끝 표식이 바뀌면 다시 읽는다", () => {
  const popover = read("../src/next/status/SubmitPopover.tsx");
  assert.match(
    popover,
    /useHandoffDraft\(\s*loadDraft,\s*view\.showList && !moreAtOpen && snapshot !== null,\s*snapshot\?\.head \?\? null,\s*\)/,
  );
  // 열릴 때의 값을 쥔다 — 제출이 성공해 요청이 열려도 닫히는 동안 상자가 바뀌지 않는다.
  assert.match(popover, /const \[moreAtOpen\] = useState\(more\);/);
  assert.match(popover, /more=\{moreAtOpen\}/);
  // 더하는 제출은 개발자의 글이 그대로라 지금 제목만 말한다.
  assert.match(popover, /openTitle=\{openTitle === null \? null : previewTitle\(openTitle\)\}/);
});

test("초안 훅은 지난 읽기의 답을 버리고 못 읽으면 조용히 실패로 둔다", () => {
  const hook = read("../src/next/lib/use-handoff-draft.ts");
  assert.match(hook, /let alive = true;/);
  assert.match(hook, /alive = false;/);
  assert.match(hook, /setState\(\{ status: "failed" \}\)/);
});

test("상자는 읽는 중에도 제출을 막지 않는다 — 단추를 잠그는 말이 없다", () => {
  const box = read("../src/next/status/HandoffPreviewBox.tsx");
  assert.doesNotMatch(box, /disabled|aria-disabled|onClick/);
  assert.match(box, /aria-busy="true"/);
});
