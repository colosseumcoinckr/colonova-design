import assert from "node:assert/strict";
import { test } from "node:test";
import type { DraftBlock, DraftOp } from "@colonova-design/protocol";
import { L } from "../src/next/labels.ts";
// 순수 모듈 — src 에서 곧장 읽는다(next-drafts.test.ts 와 같은 모양).
import {
  blockHead,
  opSummary,
  refChoices,
  refSectionOptions,
  toggleRefSection,
} from "../src/next/plans/draft/thread-model.ts";
import { planRows } from "../src/next/plans/plans-list.ts";

/**
 * 기획 대화 도우미의 순수 시험(2026-10-23 · 최종 구현 계획 F1) — 남은 걸음의 한 줄 요약과 근거 후보의
 * 찾기가 리액트 없이 잡힌다. 채택 판정 · 견주기 두 쪽 · 다시 요청의 근거 되찾기는 채택 걸음과 함께
 * 걷혔으므로(2026-10-31 · 2026-11-02 D11 정리) 시험도 함께 걷는다.
 */

const paragraph = (id: string, text: string): DraftBlock => ({
  id,
  view: { kind: "paragraph", text },
  editable: true,
  tokens: {},
  status: "same",
});

const op = (rest: Omit<Extract<DraftOp, { type: "replace" }>, "type">): DraftOp => ({
  type: "replace",
  ...rest,
});

test("걸음 한 줄 요약 — 고침 · 지우기 · 제목이 블록의 머리 글로 선다", () => {
  const blocks = [
    paragraph("b0", "첫 문단이다."),
    {
      id: "b1",
      view: { kind: "heading", level: 2, text: "계획의 바탕" },
      editable: true,
      tokens: {},
      status: "same",
    } satisfies DraftBlock,
  ];
  assert.equal(
    opSummary(
      op({ opId: "o1", blockId: "b1", state: "open", view: { kind: "paragraph", text: "" } }),
      blocks,
    ),
    L.drafts.opReplace("계획의 바탕"),
  );
  assert.equal(
    opSummary({ opId: "o2", type: "delete", blockId: "b0", state: "open" }, blocks),
    L.drafts.opDelete("첫 문단이다."),
  );
  assert.equal(
    opSummary({ opId: "o3", type: "title", title: "로그인 개선 v0.9", state: "open" }, blocks),
    L.drafts.opTitle("로그인 개선 v0.9"),
  );
});

test("걸음 한 줄 요약 — 더하기는 앞 블록의 머리 글을, 맨 앞은 맨 앞이라고 말한다", () => {
  const blocks = [paragraph("b0", "첫 문단이다."), paragraph("b1", "둘째 문단이다.")];
  const insert = (opId: string, afterBlockId: string | null): DraftOp => ({
    opId,
    type: "insert",
    afterBlockId,
    state: "open",
    view: { kind: "paragraph", text: "새 문단" },
  });
  assert.equal(opSummary(insert("o1", "b0"), blocks), L.drafts.opInsert("첫 문단이다."));
  assert.equal(opSummary(insert("o2", null), blocks), L.drafts.opInsert(null));
  // 앞 블록이 목록이면 표시 문자를 벗긴 첫 항목이 머리 글이다.
  const listed = [
    {
      id: "b0",
      view: { kind: "list", ordered: false, items: ["가", "나"] },
      editable: true,
      tokens: {},
      status: "same",
    } satisfies DraftBlock,
  ];
  assert.equal(opSummary(insert("o3", "b0"), listed), L.drafts.opInsert("가"));
});

test("걸음 한 줄 요약 — 토큰은 사람의 말로, 길면 마흔 자에서 끊는다", () => {
  const tokened = [
    {
      id: "b0",
      view: { kind: "paragraph", text: "앞 ⟦t1⟧ 뒤" },
      editable: true,
      tokens: { t1: "macro:info" },
      status: "same",
    } satisfies DraftBlock,
  ];
  assert.equal(
    opSummary(
      op({ opId: "o1", blockId: "b0", state: "open", view: { kind: "paragraph", text: "" } }),
      tokened,
    ),
    // 칩의 링크 표지(2026-11-03 실앱 감사) — 요약은 칩의 글만 남긴다.
    L.drafts.opReplace("앞 정보 상자 뒤"),
  );
  const long = "가".repeat(50);
  const head = blockHead(paragraph("b0", long));
  assert.equal(head, `${"가".repeat(40)}…`);
});

test("걸음 한 줄 요약 — 원래 자리의 블록이 사라졌으면 그 사실을 말한다", () => {
  assert.equal(
    opSummary(
      op({ opId: "o1", blockId: "b9", state: "stale", view: { kind: "paragraph", text: "" } }),
      [],
    ),
    L.drafts.opReplace(L.drafts.opMissing),
  );
});

test("근거 후보 — 문서 줄만 후보가 되고 폴더 · Confluence 전용 항목은 빠진다", () => {
  const rows = planRows(
    [
      { pageId: "1", title: "로그인 개선 기획", version: 3, path: "서비스/로그인 개선 기획" },
      { pageId: "2", title: "알림 정책", version: 1, path: "서비스/알림 정책" },
    ],
    [{ folderId: "f1", title: "서비스", path: "서비스" }],
    [{ contentId: "u1", title: "팀 화이트보드", path: "서비스/팀 화이트보드", type: "whiteboard" }],
  );
  const all = refChoices(rows, "");
  assert.deepEqual(all, [
    { pageId: "1", title: "로그인 개선 기획", version: 3, folder: "서비스" },
    { pageId: "2", title: "알림 정책", version: 1, folder: "서비스" },
  ]);
  // 제목으로 찾는다.
  assert.deepEqual(
    refChoices(rows, "로그인").map((choice) => choice.pageId),
    ["1"],
  );
  // 폴더 이름으로도 찾는다 — 조각이 모두 들어야 맞다.
  assert.equal(refChoices(rows, "서비스").length, 2);
  assert.equal(refChoices(rows, "서비스 알림").length, 1);
  // 폴더 줄과 전용 항목은 후보가 아니다.
  assert.equal(refChoices(rows, "화이트보드").length, 0);
  assert.deepEqual(refChoices(rows, "없는 말"), []);
});

test("절 체크목록의 머리말 — 빈 머리 · 200자보다 긴 머리는 빼고 같은 머리는 한 번만 남는다", () => {
  const long = "가".repeat(201);
  assert.deepEqual(
    refSectionOptions([
      { heading: "배경" },
      { heading: " " },
      { heading: long },
      { heading: "배경" },
      { heading: "목표" },
    ]),
    ["배경", "목표"],
  );
});

test("절 체크목록 한 걸음 — 문서의 머리말 순서를 지키고 다시 누르면 뺀다", () => {
  const headings = ["배경", "목표", "규칙"];
  assert.deepEqual(toggleRefSection(headings, [], "목표"), { sections: ["목표"] });
  assert.deepEqual(toggleRefSection(headings, ["목표"], "배경"), {
    sections: ["배경", "목표"],
  });
  assert.deepEqual(toggleRefSection(headings, ["배경", "목표"], "목표"), {
    sections: ["배경"],
  });
});

test("절 체크목록의 한계 — 절 20개를 넘으면 목록 대신 이유를 돌려준다", () => {
  const headings = Array.from({ length: 21 }, (_, at) => `절${at + 1}`);
  assert.deepEqual(toggleRefSection(headings, headings.slice(0, 20), "절21"), {
    error: L.drafts.limitSectionCount,
  });
  // 스무 개까지는 문서 순서 그대로 늘어난다.
  assert.deepEqual(toggleRefSection(headings, headings.slice(0, 19), "절20"), {
    sections: headings.slice(0, 20),
  });
});

test("새 기획 대화 문장이 모두 살아 있다", () => {
  assert.equal(L.drafts.threadTitle, "기획 대화");
  assert.equal(L.drafts.aiWorking, "AI 가 쓰는 중…");
  // 채택 걸음은 걷었다(2026-10-31 2단계) — 대신 바로 반영의 문서 카드와 되돌리기가 선다.
  assert.equal(L.drafts.appliedCard, "초안을 고쳤어요");
  assert.equal(L.drafts.appliedOps(2), "고침 2");
  assert.equal(L.drafts.appliedKept(1), "1곳은 직접 고르세요");
  // 2026-11-02 D 개선 — 남은 고침 손 · 떠 있는 단추 · ⋯ 메뉴.
  assert.equal(L.drafts.appliedKeptHint, "문서 판의 남은 고침으로 가요");
  assert.equal(L.drafts.toBottom, "맨 아래로");
  assert.equal(L.drafts.newContent, "새 내용");
  assert.equal(L.drafts.convMenu, "대화 메뉴");
  assert.equal(L.drafts.viewInDoc, "문서에서 보기");
  assert.equal(L.drafts.undoDone(2, 0), "2곳을 되돌렸어요");
  assert.equal(L.drafts.undoDone(1, 1), "1곳을 되돌렸어요 — 1곳은 직접 고친 채 남았어요");
  assert.equal(L.drafts.reask, "다시 요청");
  assert.equal(L.drafts.reaskPrompt, "앞 변경안을 다시 써 줘");
  assert.equal(
    L.drafts.opStale,
    "초안이 바뀌어 이 고침은 더 이상 맞지 않아요 — 다시 부탁하면 바뀐 초안에 맞게 다시 써 줘요",
  );
  assert.equal(L.drafts.readBy(2), "AI 가 문서 2개를 읽었어요");
  assert.equal(L.drafts.addRef, "근거 더하기");
  assert.equal(L.drafts.startWithAi, "AI 와 시작하기");
  // 대화 목록과 시작 문장(2026-10-31 3단계) — Claude 앱의 대화 목록과 같은 말이다.
  assert.equal(L.drafts.convList, "기획 대화");
  assert.equal(L.drafts.convNew, "새 기획 대화");
  assert.equal(L.drafts.starter1, "새 정책서 초안을 같이 써 줘");
  assert.equal(L.drafts.starter2, "이 문서의 빈 곳을 찾아 줘");
  assert.equal(L.drafts.starter3, "화면과 다른 곳을 찾아 줘");
  assert.equal(L.drafts.editResend, "고쳐 보내기");
  assert.equal(L.drafts.copyText, "복사");
  // Confluence 판과 견주기 · 판 고르기(2026-10-31 2단계).
  assert.equal(L.drafts.compareConfluence, "Confluence 판과 견주기");
  assert.equal(L.drafts.revPicker(4), "초안 판 4");
  assert.equal(L.drafts.revConfluence(7), "Confluence 판 7");
  assert.equal(L.drafts.revAi("노쇼 규칙 정리"), "AI · 노쇼 규칙 정리");
  assert.equal(L.drafts.revRestore(3), "3판으로 되돌리기");
  assert.equal(L.drafts.writeOff, "Confluence 쓰기 꺼짐");
  // 근거 칩 — 제목 · 판 · 절이 남고, 없는 자리는 빠진다.
  assert.equal(
    L.drafts.refChip("로그인 개선", 3, ["배경", "목표"]),
    "로그인 개선 · 판 3 · 배경, 목표",
  );
  assert.equal(L.drafts.refChip("알림 정책", null, []), "알림 정책");
});
