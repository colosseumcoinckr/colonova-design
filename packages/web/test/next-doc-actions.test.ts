import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  DocOpBlocker,
  DocOpPreview,
  DocOpResult,
  DraftBlock,
  DraftSnapshot,
} from "@colonova-design/protocol";
import { L } from "../src/next/labels.ts";
// 순수 모듈 — src 에서 곧장 읽는다(next-plans.test.ts 와 같은 모양).
import {
  attachEventDetail,
  defaultCopyTitle,
  docOpBlockerLines,
  docOpResultLine,
  headingSections,
} from "../src/next/plans/doc-actions/doc-actions-model.ts";

/**
 * 문서 관리 · 근거 보내기 도우미의 순수 시험(2026-10-23 · 최종 구현 계획 F3 · F4) — 입력창 첨부의 모양,
 * 막는 이유의 여섯 갈래와 초안 안내의 갈라짐, 결과의 세 처지, 복제 제목의 이어 붙임, 절 목록의 토큰
 * 벗기기가 리액트 없이 잡힌다.
 */

/** 미리보기의 표본 — 막는 이유만 바꿔 쓴다. */
const preview = (blockers: DocOpBlocker[]): DocOpPreview => ({
  op: "trash",
  pageId: "101",
  title: "기획서",
  childCount: 2,
  hasDraft: false,
  target: null,
  blockers,
  checkedAt: "2026-10-23T09:00:00.000Z",
});

const result = (state: DocOpResult["state"], detail = ""): DocOpResult => ({
  commandId: "0f0e0d0c-0b0a-4938-8765-432109876543",
  op: "trash",
  state,
  pageId: null,
  detail,
});

/** 초안 블록의 표본 — 제목 블록의 글만 바꿔 쓴다. */
const heading = (text: string): DraftBlock => ({
  id: "b1",
  view: { kind: "heading", level: 2, text },
  editable: true,
  tokens: { t1: "image", c1: "format:bold" },
  status: "same",
});

const paragraph = (text: string): DraftBlock => ({
  id: "b2",
  view: { kind: "paragraph", text },
  editable: true,
  tokens: {},
  status: "same",
});

test("근거 첨부의 모양 — 스냅샷의 한 장이 파일 첨부로 실린다", () => {
  const snapshot: DraftSnapshot = {
    attachment: { name: "기획서.md", mediaType: "text/markdown", data: "# 기획서" },
    ref: {
      title: "기획서",
      pageId: "101",
      docKey: null,
      url: null,
      version: 3,
      revision: null,
      published: true,
      sections: [],
    },
  };
  assert.deepEqual(attachEventDetail(snapshot), {
    attachments: [
      { kind: "file", name: "기획서.md", mediaType: "text/markdown", data: "# 기획서" },
    ],
  });
});

test("문서 관리의 막는 이유 — 여섯 이름이 각각 사람의 말로, 미리보기의 순서를 지킨다", () => {
  const six: DocOpBlocker[] = [
    "publish-disabled",
    "remote-missing",
    "out-of-scope",
    "no-permission",
    "not-trashed-here",
    "same-parent",
  ];
  const lines = docOpBlockerLines(preview(six));
  assert.equal(lines.length, 6);
  assert.equal(lines[0], "Confluence 에 쓰기가 아직 꺼져 있어요 — 검증을 마친 뒤 켜요");
  assert.equal(
    lines[4],
    "이 앱에서 휴지통으로 옮긴 문서가 아니에요 — 복구는 이 앱에서 옮긴 문서만 해요",
  );
  // 거꾸로 세워도 순서는 미리보기가 정한다 — 화면이 다시 배열하지 않는다.
  assert.deepEqual(docOpBlockerLines(preview([...six].reverse())), [...lines].reverse());
  assert.deepEqual(docOpBlockerLines(preview([])), []);
});

test("문서 관리의 막는 이유 — 초안 안내(has-draft)는 목록에 서지 않고 안내 줄의 몫이다", () => {
  // 데몬은 휴지통 · 옮기기에 has-draft 를 막는 이유로 싣는다 — 화면은 그것을 nx-da-note 안내로
  // 보이므로 막는 이유 목록에서는 뺀다(2026-10-23 화면 확인 · R2 검토 7).
  assert.deepEqual(docOpBlockerLines(preview(["has-draft"])), []);
  assert.deepEqual(docOpBlockerLines(preview(["has-draft", "no-permission"])), [
    L.docOps.blocker["no-permission"],
  ]);
});

test("문서 관리의 결과 — 마쳤음 · 모름 · 실패의 세 처지가 각각 한 줄로 선다", () => {
  assert.equal(docOpResultLine({ ...result("applied"), op: "copy" }), "복제했어요");
  assert.equal(docOpResultLine({ ...result("applied"), op: "move" }), "옮겼어요");
  assert.equal(docOpResultLine({ ...result("applied"), op: "restore" }), "복구했어요");
  assert.equal(docOpResultLine(result("applied")), "휴지통으로 옮겼어요");
  assert.equal(
    docOpResultLine(result("unknown")),
    "결과를 확인하지 못했어요 — 목록을 새로 가져와 확인해 주세요. 자동으로 다시 보내지 않아요.",
  );
  assert.equal(docOpResultLine(result("failed", "권한이 없어요")), "권한이 없어요");
  assert.equal(docOpResultLine(result("failed")), "Confluence 요청이 실패했어요");
  assert.equal(docOpResultLine(result("failed", "  ")), "Confluence 요청이 실패했어요");
});

test("복제의 처음 제목 — 사본이 아니면 사본을, 사본이면 그다음 수를 붙인다", () => {
  assert.equal(defaultCopyTitle("기획서"), "기획서 사본");
  assert.equal(defaultCopyTitle("기획서 사본"), "기획서 사본 2");
  assert.equal(defaultCopyTitle("기획서 사본 2"), "기획서 사본 3");
  assert.equal(defaultCopyTitle("기획서 사본 10"), "기획서 사본 11");
  // 이름 가운데 사본이 들어간 문서는 사본이 아니다 — 끝에 새로 붙는다.
  assert.equal(defaultCopyTitle("사본 정리"), "사본 정리 사본");
});

test("근거의 절 목록 — 제목 블록만 세고 토큰과 표지를 벗긴다", () => {
  const blocks: DraftBlock[] = [
    heading("배경"),
    paragraph("본문 문단은 절이 아니다"),
    heading("⟦t1⟧ 목표"), // 혼자 오는 토큰 — 벗겨진다
    heading("⟦c1⟧굵은 절 제목⟦/c1⟧"), // 쌍 토큰의 표지 — 벗기고 안 글만 남는다
    heading("⟦t1⟧"), // 토큰뿐인 제목 — 절의 이름이 아니므로 빠진다
    {
      ...heading("  판을 정해요  "),
      view: { kind: "heading", level: 3, text: "  판을 정해요  " },
    },
  ];
  assert.deepEqual(headingSections(blocks), ["배경", "목표", "굵은 절 제목", "판을 정해요"]);
  assert.deepEqual(headingSections([paragraph("제목이 하나도 없다")]), []);
});
