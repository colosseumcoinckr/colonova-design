import assert from "node:assert/strict";
import { test } from "node:test";
import type { DraftBlock, DraftMessage, DraftOp, DraftProposal } from "@colonova-design/protocol";
import { L } from "../src/next/labels.ts";
// 순수 모듈 — src 에서 곧장 읽는다(next-drafts.test.ts 와 같은 모양).
import {
  blockHead,
  opCompare,
  openOpIds,
  opSummary,
  parseRefSections,
  reaskRefs,
  refChoices,
  selectableOpIds,
} from "../src/next/plans/draft/thread-model.ts";
import { planRows } from "../src/next/plans/plans-list.ts";

/**
 * 기획 대화 도우미의 순수 시험(2026-10-23 · 최종 구현 계획 F1) — 변경안 걸음의 한 줄 요약, 채택 대상
 * 판정, 근거 후보의 찾기가 리액트 없이 잡힌다.
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

const proposal = (ops: DraftOp[]): DraftProposal => ({
  proposalId: "pr1",
  createdAt: "2026-10-23T09:00:00Z",
  draftRevision: 3,
  summary: "둘째 절을 다듬었어요",
  ops,
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
    L.drafts.opReplace("앞 〔정보 상자〕 뒤"),
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

test("채택 대상 — 열린 걸음만 손에 닿고, 채택함 · 거절함 · 오래됨 은 빠진다", () => {
  const mixed = proposal([
    { opId: "o1", type: "delete", blockId: "b0", state: "open" },
    { opId: "o2", type: "delete", blockId: "b1", state: "adopted" },
    { opId: "o3", type: "delete", blockId: "b2", state: "rejected" },
    { opId: "o4", type: "delete", blockId: "b3", state: "stale" },
    { opId: "o5", type: "delete", blockId: "b4", state: "open" },
  ]);
  assert.deepEqual(openOpIds(mixed), ["o1", "o5"]);
  assert.deepEqual(selectableOpIds(mixed), ["o1", "o5"]);
  const done = proposal([
    { opId: "o1", type: "title", title: "제목", state: "adopted" },
    { opId: "o2", type: "title", title: "제목", state: "stale" },
  ]);
  assert.deepEqual(openOpIds(done), []);
  assert.deepEqual(selectableOpIds(done), []);
});

test("견주기 두 쪽 — 고침의 앞은 원래 블록 · 뒤는 바꾼 블록의 투영 글이다", () => {
  const blocks = [paragraph("b0", "원래 문장이다.")];
  const replaced = opCompare(
    op({
      opId: "o1",
      blockId: "b0",
      state: "open",
      view: { kind: "paragraph", text: "새 문장이다." },
    }),
    blocks,
    "옛 제목",
  );
  assert.equal(replaced.before, "원래 문장이다.");
  assert.equal(replaced.after, "새 문장이다.");
});

test("견주기 두 쪽 — 고침의 새 글은 갈아 끼울 블록의 토큰 이름으로 그린다", () => {
  const blocks = [
    {
      id: "b0",
      view: { kind: "paragraph", text: "원본" },
      editable: true,
      tokens: { t1: "macro:info" },
      status: "same",
    } satisfies DraftBlock,
  ];
  const replaced = opCompare(
    op({
      opId: "o1",
      blockId: "b0",
      state: "open",
      view: { kind: "paragraph", text: "앞 ⟦t1⟧ 뒤" },
    }),
    blocks,
    "제목",
  );
  assert.equal(replaced.after, "앞 〔정보 상자〕 뒤");
});

test("견주기 두 쪽 — 더하기의 앞은 없음, 지우기의 뒤는 지운다는 말, 제목은 앞뒤가 제목이다", () => {
  const insert = opCompare(
    {
      opId: "o1",
      type: "insert",
      afterBlockId: null,
      state: "open",
      view: { kind: "paragraph", text: "새 문단" },
    },
    [],
    "제목",
  );
  assert.equal(insert.before, "");
  assert.equal(insert.beforeEmpty, L.drafts.noBlock);
  assert.equal(insert.after, "새 문단");
  const gone = opCompare({ opId: "o2", type: "delete", blockId: "b9", state: "open" }, [], "제목");
  assert.equal(gone.before, "");
  assert.equal(gone.beforeEmpty, L.drafts.opMissing);
  assert.equal(gone.after, "");
  assert.equal(gone.afterEmpty, L.drafts.removedBlock);
  const title = opCompare(
    { opId: "o3", type: "title", title: "새 제목", state: "open" },
    [],
    "옛 제목",
  );
  assert.equal(title.before, "옛 제목");
  assert.equal(title.after, "새 제목");
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

test("절 이름 나누기 — 쉼표로 나누고 빈 조각은 빼며, 빈 글은 문서 전체다", () => {
  assert.deepEqual(parseRefSections("배경, 목표"), { sections: ["배경", "목표"] });
  assert.deepEqual(parseRefSections(" 배경 ,,목표 "), { sections: ["배경", "목표"] });
  assert.deepEqual(parseRefSections(""), { sections: [] });
  assert.deepEqual(parseRefSections(" , ,"), { sections: [] });
});

test("절 이름의 한계 — 절 20개 · 이름 200자를 넘으면 목록 대신 이유를 돌려준다", () => {
  const twenty = Array.from({ length: 21 }, (_, at) => `절${at + 1}`);
  assert.deepEqual(parseRefSections(twenty.join(",")), { error: L.drafts.limitSectionCount });
  // 스무 개까지는 목록이다.
  assert.deepEqual(parseRefSections(twenty.slice(0, 20).join(",")).sections.length, 20);
  const long = "가".repeat(201);
  assert.deepEqual(parseRefSections(`배경, ${long}`), { error: L.drafts.limitSectionLength });
  // 이백 자까지는 목록이다.
  assert.deepEqual(parseRefSections("가".repeat(200)).sections, ["가".repeat(200)]);
});

test("다시 요청의 근거 — 변경안을 낳은 앞의 사람 메시지에서 근거를 다시 찾는다", () => {
  const user = (messageId: string, refs: DraftMessage["refs"]): DraftMessage => ({
    messageId,
    role: "user",
    text: "부탁",
    at: "2026-10-23T09:00:00.000Z",
    ...(refs === undefined ? {} : { refs }),
  });
  const assistant = (messageId: string): DraftMessage => ({
    messageId,
    role: "assistant",
    text: "답",
    at: "2026-10-23T09:00:01.000Z",
    proposalId: "p1",
  });
  const messages: DraftMessage[] = [
    user("m1", [{ pageId: "1", title: "기획서", version: 3, sections: ["배경"] }]),
    assistant("m2"),
    user("m3", []),
    assistant("m4"),
  ];
  // AI 의 말에는 근거가 없다 — 그 앞의 사람 메시지의 근거를 다시 채운다(2026-10-23 화면 확인 · R2 검토 6).
  assert.deepEqual(reaskRefs(messages, "m2"), [
    { pageId: "1", title: "기획서", version: 3, sections: ["배경"] },
  ]);
  // 앞의 사람 메시지에 근거가 없으면 빈 목록이다.
  assert.deepEqual(reaskRefs(messages, "m4"), []);
  // 사람 메시지가 앞에 없으면 빈 목록이다.
  assert.deepEqual(reaskRefs([assistant("m2")], "m2"), []);
  // 모르는 메시지 번호여도 빈 목록이다.
  assert.deepEqual(reaskRefs(messages, "없는 것"), []);
});

test("새 기획 대화 문장이 모두 살아 있다", () => {
  assert.equal(L.drafts.threadTitle, "기획 대화");
  assert.equal(L.drafts.aiWorking, "AI 가 쓰는 중…");
  assert.equal(L.drafts.adoptSelected, "고른 것 채택");
  assert.equal(L.drafts.adoptAll, "모두 채택");
  assert.equal(L.drafts.reject, "거절");
  assert.equal(L.drafts.reask, "다시 요청");
  assert.equal(L.drafts.reaskPrompt, "앞 변경안을 다시 써 줘");
  assert.equal(L.drafts.opStale, "초안이 바뀌어 오래된 걸음이에요");
  assert.equal(L.drafts.readBy(2), "AI 가 문서 2개를 읽었어요");
  assert.equal(L.drafts.addRef, "근거 더하기");
  assert.equal(L.drafts.startWithAi, "AI 와 시작하기");
  // 견주기 크게 보기(2026-10-25 UX 심화 사용) — 좁은 칸에서 접히는 걸음을 큰 판으로 펼친다.
  assert.equal(L.drafts.compareBig, "크게 보기");
  assert.equal(
    L.drafts.compareBigOf("“말 · 뜻” 블록을 고쳐 써요"),
    "“말 · 뜻” 블록을 고쳐 써요 크게 보기",
  );
  assert.equal(L.drafts.compareBigTitle, "변경안 크게 보기");
  assert.equal(L.drafts.compareBigSub, "바뀌기 전과 바뀐 뒤를 나란히 펼쳐 봐요.");
  // 근거 칩 — 제목 · 판 · 절이 남고, 없는 자리는 빠진다.
  assert.equal(
    L.drafts.refChip("로그인 개선", 3, ["배경", "목표"]),
    "로그인 개선 · 판 3 · 배경, 목표",
  );
  assert.equal(L.drafts.refChip("알림 정책", null, []), "알림 정책");
});
