/**
 * 기획서 칸 견본 — 데몬 없이 `PlansColumn`(원장 목록 · 문서 뷰어 · 코멘트)을 여러 상태로 눈으로 보는
 * 페이지. 앱과 같은 CSS(테마 · styles.css · next.css)를 올린다. `vite build` 의 입력은 index.html
 * 뿐이라 제품에 실리지 않고, tsconfig 가 dev/ 를 보지 않는다.
 *
 *   ./node_modules/.bin/vite --port 29181 --strictPort --host 127.0.0.1   (packages/web 에서)
 *   → http://127.0.0.1:29181/dev/plans-fixture.html
 *
 * 주소 끝의 `?case=list` 처럼 보일 상태를(쉼표로 이으면 나란히), `?theme=dark` 로 테마를, `?w=1000&h=760`
 * 으로 틀의 크기를, `?narrow=1` 로 좁은 창(900px 아래 — 대화 칸이 숨는다)을 고른다. 상태는 눌러 볼 수 있다 —
 * 문서 행을 누르면 본문이 서고, `새로 가져오기` 는 1.2초 뒤 끝난다. 새 상태는 여기에 더한다. 틀은 사이드바를 뺀
 * 본문이다 — 1440 창(사이드바 264px)은 `w=1176`. 대화 칸 자리는 400px 이고 초안이 열리면 비켜선다(셸의 집중 배치).
 * 발행 게이트는 데몬처럼 기본 꺼짐이고(발행 단추의 `꺼짐` · 코멘트 절의 안내), `?writable=1` 이면 켜진 모습이다.
 *   · none        — 아직 연결하지 않은 프로젝트(원장 없음)
 *   · empty       — 연결했지만 가져온 문서가 없다
 *   · list        — 가져온 문서 28개(중첩 경로 · 판 번호)
 *   · list-loading · list-failed — 목록 읽기가 끝나지 않거나 실패
 *   · doc-slow · doc-failed      — 문서 읽기가 6초 걸리거나 실패
 *   · import-slow · import-failed — `새로 가져오기` 가 오래 걸리거나 실패
 *   · expired     — 만료된 연결(토큰이 끊겨 다시 연결이 필요)
 *   · expired-empty — 만료된 연결 + 가져온 문서 없음(안내 한 장이 `설정 열기` 로 길을 건넨다)
 *   · big         — 문서 500개 · 폴더 깊이 6 · 아주 긴 제목(상한 규모의 목록 — 말줄임 · 들여쓰기 · 접기가 버티는지)
 *   · (모든 목록 상태) 문서를 열고 `고치기` → 초안 편집기(제목 · 토큰 · 목록 · 표 · 보존 상자 · 고침 · 새 블록)
 *   · draft-conflict — 같은 편집기에 충돌 블록 하나(내 것 · Confluence 것 고르기)
 *   · publish-blocked — 초안의 발행 확인 창이 막힌 이유 둘(발행 꺼짐 · 원격이 더 새 판)
 *   · publish-closed — 발행 확인 창의 개정 발행(표기가 1.0 이상 — 새 표기와 사유를 묻는다)
 *   · publish-unknown — 발행을 보냈지만 결과를 못 받은 초안(편집기의 `결과 확인 필요` 띠 — 다시 확인 · 재전송 없이 종료)
 *   · op-blocked — 문서 관리 창이 막힌 이유 둘(권한 없음 · 범위 밖)
 *   · op-unknown · op-failed — 문서 관리(복제 · 위치 옮기기 · 휴지통 · 복구)의 결과 모름 · 실패
 *   · comment-failed · comment-unknown — 코멘트 쓰기의 실패(닻이 애매) · 결과 모름
 *
 *   눌러 볼 수 있는 흐름 — 문서 → 머리의 ⋯ 메뉴(복제 · 위치 옮기기 · 휴지통) · 목록 머리의 휴지통 단추(복구) ·
 *   `화면 작업에 근거로 보내기`(입력창이 없어 `noComposer` 로 끝난다) · 목록의 초안 칩 → 편집기의 `발행` ·
 *   문서 발밑의 코멘트(바닥글 둘 · 답글 · 인라인 둘 — 남기기 · 답글 · 고치기 · 해결의 손잡이는 가짜 데몬에 있다).
 */

import type {
  DocCommentResult,
  DocOpKind,
  DocOpPreview,
  DocOpResult,
  DocTrashEntry,
  DraftEdit,
  DraftPublishPreview,
  DraftPublishResult,
  DraftSnapshot,
  DraftSummary,
  DraftView,
  ProjectSummary,
} from "@colonova-design/protocol";
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Daemon, PlanDocComment } from "../src/lib/daemon-client";
import { applyStoredTheme, applyStoredTypeScale } from "../src/lib/settings";
import { PlansColumn } from "../src/next/plans/PlansColumn";
import type { ShellNav } from "../src/next/slots";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "../src/styles.css";
import "../src/next/next.css";

applyStoredTheme();
applyStoredTypeScale();
const query = new URLSearchParams(location.search);
const theme = query.get("theme");
if (theme) document.documentElement.dataset.theme = theme;
const FRAME_W = Number(query.get("w")) || 1180;
const FRAME_H = Number(query.get("h")) || 760;
const NARROW = query.get("narrow") === "1";
const CASES = (query.get("case") ?? "list").split(",");

const MIN = 60_000;
const ago = (min: number) => new Date(Date.now() - min * MIN).toISOString();

interface Doc {
  pageId: string;
  title: string;
  version: number;
  path: string;
}

/** 원장의 납작한 행 — 경로의 걸음 수가 곧 계층이다(공간 · 뿌리는 같은 자리). */
const DOCS: Doc[] = [
  { pageId: "1000", title: "8.8 ColoNova", version: 12, path: "COLO/8.8 ColoNova" },
  { pageId: "1010", title: "01.시스템분석", version: 3, path: "COLO/8.8 ColoNova/01.시스템분석" },
  {
    pageId: "1011",
    title: "시스템 분석 개요",
    version: 5,
    path: "COLO/8.8 ColoNova/01.시스템분석/시스템 분석 개요",
  },
  {
    pageId: "1012",
    title: "현행 업무 흐름(AS-IS)",
    version: 2,
    path: "COLO/8.8 ColoNova/01.시스템분석/현행 업무 흐름(AS-IS)",
  },
  { pageId: "1020", title: "02.정책서", version: 4, path: "COLO/8.8 ColoNova/02.정책서" },
  {
    pageId: "2001",
    title: "[정책서] 주문 접수",
    version: 7,
    path: "COLO/8.8 ColoNova/02.정책서/[정책서] 주문 접수",
  },
  {
    pageId: "2002",
    title: "[정책서] 주문 취소 · 부분 취소",
    version: 4,
    path: "COLO/8.8 ColoNova/02.정책서/[정책서] 주문 취소 · 부분 취소",
  },
  {
    pageId: "2003",
    title: "[정책서] 재고 차감과 예약",
    version: 9,
    path: "COLO/8.8 ColoNova/02.정책서/[정책서] 재고 차감과 예약",
  },
  {
    pageId: "2004",
    title: "[정책서] 대행 마스터 승인 구조",
    version: 3,
    path: "COLO/8.8 ColoNova/02.정책서/[정책서] 대행 마스터 승인 구조",
  },
  { pageId: "1030", title: "03.기능설계서", version: 6, path: "COLO/8.8 ColoNova/03.기능설계서" },
  {
    pageId: "3001",
    title: "[기능설계서] 주문 목록 · 검색",
    version: 11,
    path: "COLO/8.8 ColoNova/03.기능설계서/[기능설계서] 주문 목록 · 검색",
  },
  {
    pageId: "3002",
    title: "[기능설계서] 주문 상세",
    version: 8,
    path: "COLO/8.8 ColoNova/03.기능설계서/[기능설계서] 주문 상세",
  },
  {
    pageId: "3003",
    title: "[기능설계서] 입고 예정 등록",
    version: 2,
    path: "COLO/8.8 ColoNova/03.기능설계서/[기능설계서] 입고 예정 등록",
  },
  { pageId: "1040", title: "04.데이터 모델", version: 2, path: "COLO/8.8 ColoNova/04.데이터 모델" },
  {
    pageId: "4001",
    title: "ColoNova 데이터 모델 — 기획 참조용",
    version: 21,
    path: "COLO/8.8 ColoNova/04.데이터 모델/ColoNova 데이터 모델 — 기획 참조용",
  },
  { pageId: "1050", title: "05.화면 표준", version: 5, path: "COLO/8.8 ColoNova/05.화면 표준" },
  {
    pageId: "5001",
    title: "목록 화면 표준",
    version: 6,
    path: "COLO/8.8 ColoNova/05.화면 표준/목록 화면 표준",
  },
  {
    pageId: "5002",
    title: "입력 폼 표준",
    version: 3,
    path: "COLO/8.8 ColoNova/05.화면 표준/입력 폼 표준",
  },
  {
    pageId: "5003",
    title: "상태 배지 · 색 규칙",
    version: 4,
    path: "COLO/8.8 ColoNova/05.화면 표준/상태 배지 · 색 규칙",
  },
  { pageId: "1060", title: "06.회의록", version: 1, path: "COLO/8.8 ColoNova/06.회의록" },
  {
    pageId: "6001",
    title: "2026-09-15 PnE 회의록",
    version: 1,
    path: "COLO/8.8 ColoNova/06.회의록/2026-09-15 PnE 회의록",
  },
  {
    pageId: "6002",
    title: "2026-10-02 CDP 구현 완료 리뷰",
    version: 3,
    path: "COLO/8.8 ColoNova/06.회의록/2026-10-02 CDP 구현 완료 리뷰",
  },
  { pageId: "1099", title: "99.Archive", version: 1, path: "COLO/8.8 ColoNova/99.Archive" },
  {
    pageId: "9001",
    title: "옛 주문 정책 초안(폐기)",
    version: 14,
    path: "COLO/8.8 ColoNova/99.Archive/옛 주문 정책 초안(폐기)",
  },
  {
    pageId: "9002",
    title: "옛 화면 목록(2026-06)",
    version: 6,
    path: "COLO/8.8 ColoNova/99.Archive/옛 화면 목록(2026-06)",
  },
  {
    pageId: "9003",
    title: "초기 용어집",
    version: 2,
    path: "COLO/8.8 ColoNova/99.Archive/초기 용어집",
  },
  {
    pageId: "9004",
    title: "시안 모음 — 홈 · 목록",
    version: 3,
    path: "COLO/8.8 ColoNova/99.Archive/시안 모음 — 홈 · 목록",
  },
];

/** 상한 규모(500)의 목록 — 폴더 깊이 6 · 긴 제목 · 숫자 이름이 섞인다. 경로는 폴더마다 하나씩 걸음이 는다. */
function bigDocs(): Doc[] {
  const rows: Doc[] = [
    { pageId: "b0", title: "8.8 ColoNova", version: 30, path: "COLO/8.8 ColoNova" },
  ];
  let serial = 1;
  const walk = (path: string, depth: number) => {
    for (let at = 1; at <= (depth === 0 ? 8 : 5); at += 1) {
      const title =
        depth >= 3 && at % 3 === 0
          ? `[기능설계서] ${"아주 긴 제목의 문서 ".repeat(6)}${at}`
          : `${String(at).padStart(2, "0")}.${depth < 2 ? "폴더" : "문서"} ${depth}-${at}`;
      const next = `${path}/${title}`;
      rows.push({ pageId: `b${serial}`, title, version: 1 + (serial % 40), path: next });
      serial += 1;
      if (depth < 5 && rows.length < 500) walk(next, depth + 1);
      if (rows.length >= 500) return;
    }
  };
  walk("COLO/8.8 ColoNova", 0);
  return rows.slice(0, 500);
}

const POLICY = (doc: Doc) => `---
confluence:
  pageId: "${doc.pageId}"
  space: "COLO"
  title: "${doc.title}"
  version: ${doc.version}
  updatedAt: "${ago(60 * 26)}"
---

## 1. 목적

주문이 들어오는 순간부터 재고가 잡히는 순간까지의 규칙을 한곳에 정한다. 화면과 API 가 같은 말을 쓰게 하는 것이 목적이다.

## 2. 적용 범위

- 웹 주문 · 대행 주문 · 일괄 등록 주문
- 취소와 부분 취소는 별도 정책서를 따른다
- 반품 · 교환은 이 문서의 범위가 아니다

## 3. 용어

| 용어 | 뜻 | 비고 |
| --- | --- | --- |
| 접수 | 주문이 시스템에 들어와 번호를 받은 상태 | 취소 가능 |
| 확정 | 재고가 잡히고 출고 지시가 가능한 상태 | 취소는 승인 필요 |
| 대행 마스터 | 고객사를 대신해 주문을 넣는 운영 계정 | [Confluence 매크로: status] |

## 4. 정책 원칙

1. 같은 주문 번호는 한 번만 받는다 — 중복은 거절하고 기존 번호를 알려준다.
2. 재고가 모자라도 접수는 받고 확정만 막는다.
3. 모든 상태 변경은 누가 · 언제 · 왜 를 남긴다.

[Confluence 매크로: info]

## 5. 세부 규칙

### 5-1. 접수 조건

- 수량은 1 이상의 정수
- 배송지는 필수, 연락처는 선택
- 요청 메모는 200자 이내

### 5-2. 예외

| 상황 | 처리 | 담당 |
| --- | --- | --- |
| 재고 부족 | 접수는 받고 확정을 보류한다 | 시스템 |
| 주소 오류 | 접수 보류, 고객사 확인 요청 | 운영 |
| 중복 번호 | 거절, 기존 번호 안내 | 시스템 |

\`\`\`json
{ "orderNo": "ORD-20261016-0042", "status": "RECEIVED" }
\`\`\`

[첨부: 접수 흐름도.png]

## 6. 미결

- 대행 주문의 접수 번호 체계 — TBD
- 야간 접수분의 확정 시각 — 운영 합의 필요
`;

/** 연결한 계정의 이름표 — 코멘트의 `내 것` 이 이 이름으로 선다. */
const MINE = "한기획";

/**
 * docRead 의 코멘트(2026-10-23 · 최종 구현 계획 F4) — 바닥글 둘(내 것 · 남의 것)과 남의 것 아래 답글 하나,
 * 인라인 둘. 내 인라인은 서식이 있어 고칠 수 없고, 남의 인라인의 닻 문장은 견본 본문에 한 번만 나온다.
 */
const COMMENTS: PlanDocComment[] = [
  {
    id: "c-1",
    kind: "footer",
    version: 1,
    parentId: null,
    resolved: false,
    mine: true,
    editable: true,
    author: MINE,
    body: "3절의 승인 기준 문장을 운영 정책과 맞췄어요.",
    createdAt: ago(45),
    anchorText: null,
  },
  {
    id: "c-2",
    kind: "footer",
    version: 2,
    parentId: null,
    resolved: false,
    mine: false,
    editable: false,
    author: "김기획",
    body: "6절 미결 두 줄은 언제까지 정해지나요? 일정 확정에 필요해요.",
    createdAt: ago(60 * 26),
    anchorText: null,
  },
  {
    id: "c-3",
    kind: "footer",
    version: 1,
    parentId: "c-2",
    resolved: false,
    mine: true,
    editable: true,
    author: MINE,
    body: "이번 주 안에 운영 합의를 받아 반영하겠습니다.",
    createdAt: ago(40),
    anchorText: null,
  },
  {
    id: "c-4",
    kind: "inline",
    version: 3,
    parentId: null,
    resolved: false,
    mine: true,
    editable: false,
    author: MINE,
    body: "0 수량 주문도 **대행 마스터**는 받을 수 있다는 규칙을 더할까요?",
    createdAt: ago(60 * 5),
    anchorText: "수량은 1 이상의 정수",
  },
  {
    id: "c-5",
    kind: "inline",
    version: 1,
    parentId: null,
    resolved: false,
    mine: false,
    editable: false,
    author: "박운영",
    body: "야간 접수는 재고 확인이 늦어요 — 예외 절에 담아 주세요.",
    createdAt: ago(60 * 30),
    anchorText: "재고가 모자라도 접수는 받고 확정만 막는다.",
  },
];

/** 휴지통의 문서 둘 — 옮긴 때가 다르다. 원장 목록에는 없는 문서다(복구하면 목록에 다시 난다). */
const TRASHED: DocTrashEntry[] = [
  { pageId: "9101", title: "옛 지표 대시보드 메모", parentId: "1099", trashedAt: ago(60 * 26) },
  { pageId: "9102", title: "2026-05 정책 잔여 이슈", parentId: "1099", trashedAt: ago(90) },
];

/** 결과를 못 받은 발행 명령 — `result-unknown` 초안의 띠가 다시 확인 · 재전송 없이 종료에 쓴다. */
const PENDING_COMMAND = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";

/** 문서 관리의 누른 종류를 아래 줄에 남기는 말 — 화면의 단추와 같은 어휘다. */
const OP_WORDS: Record<DocOpKind, string> = {
  trash: "휴지통으로 옮기기",
  restore: "복구",
  copy: "복제",
  move: "위치 옮기기",
};

const never = <T,>() => new Promise<T>(() => undefined);
const later = <T,>(ms: number, value: T) =>
  new Promise<T>((resolve) => window.setTimeout(() => resolve(value), ms));
const failLater = <T,>(ms: number) =>
  new Promise<T>((_resolve, reject) => window.setTimeout(() => reject(new Error("fixture")), ms));

function projectFor(id: string): ProjectSummary {
  const base = { name: "colonova-cdp", slug: "colonova-cdp" };
  if (id === "none") return base as unknown as ProjectSummary;
  const confluence =
    id === "expired"
      ? {
          site: "colosseum.atlassian.net",
          connected: true,
          expired: true,
          rootTitle: "8.8 ColoNova",
          lastImportAt: ago(60 * 30),
          pages: DOCS.length,
        }
      : id === "expired-empty"
        ? {
            site: "colosseum.atlassian.net",
            connected: true,
            expired: true,
            rootTitle: "8.8 ColoNova",
            lastImportAt: null,
            pages: 0,
          }
        : id === "empty"
          ? {
              site: "colosseum.atlassian.net",
              connected: true,
              expired: false,
              rootTitle: "8.8 ColoNova",
              lastImportAt: null,
              pages: 0,
            }
          : {
              site: "colosseum.atlassian.net",
              connected: true,
              expired: false,
              rootTitle: "8.8 ColoNova",
              lastImportAt: ago(3),
              pages: DOCS.length,
            };
  // 발행 게이트 — 기본은 데몬처럼 꺼짐이다(발행 단추의 `꺼짐` · 코멘트 절의 안내). `?writable=1` 이면 켜진 모습.
  const writable = query.get("writable") === "1";
  return { ...base, confluence: { ...confluence, writable } } as unknown as ProjectSummary;
}

/**
 * 초안 편집기 견본(2026-10-23 · 최종 구현 계획 F1) — 문서를 열고 `고치기` 를 누르면 서는 초안. 제목 · 문단(토큰 ·
 * 코멘트 닻) · 목록 · 표 · 보존 상자 · 고친 블록 · 새 블록을 담고, `draft-conflict` 면 충돌 블록이 하나 더 선다.
 * 고치기는 메모리 안에서만 돈다(개정이 오른다).
 */
function sampleDraft(pageId: string, conflict: boolean): DraftView {
  const doc = DOCS.find((row) => row.pageId === pageId) ?? DOCS[5];
  const blocks: DraftView["blocks"] = [
    {
      id: "b0",
      view: { kind: "heading", level: 2, text: "1. 목적" },
      editable: true,
      tokens: {},
      status: "same",
    },
    {
      id: "b1",
      view: {
        kind: "paragraph",
        text: "출고 지시는 **재고 확정** 뒤에만 만든다. 상태는 ⟦t1⟧ 로 보이고, ⟦c1⟧예외 처리⟦/c1⟧는 5절을 따른다.",
      },
      editable: true,
      tokens: { t1: "macro:status", c1: "comment-anchor" },
      status: "changed",
    },
    {
      id: "b2",
      view: {
        kind: "list",
        ordered: false,
        items: [
          "주문 접수 후 *30분* 안에 배정한다",
          "배정이 실패하면 [운영 안내](https://example.com/guide)를 띄운다",
        ],
      },
      editable: true,
      tokens: {},
      status: "same",
    },
    {
      id: "b3",
      view: {
        kind: "table",
        rows: [
          {
            cells: [
              { header: true, text: "상태" },
              { header: true, text: "다음 행동" },
              { header: true, text: "권한" },
            ],
          },
          {
            cells: [
              { header: false, text: "배정 대기" },
              { header: false, text: "재고 확인 후 배정" },
              { header: false, text: "WA" },
            ],
          },
          {
            cells: [
              { header: false, text: "배정 완료" },
              { header: false, text: "피킹 지시\n\n지연 시 알림" },
              { header: false, text: "⟦t1⟧" },
            ],
          },
        ],
      },
      editable: true,
      tokens: { t1: "cell:complex" },
      status: "same",
    },
    {
      id: "b4",
      view: { kind: "preserved", label: "macro:info" },
      editable: false,
      tokens: {},
      status: "same",
    },
    {
      id: "nabc123def456",
      view: { kind: "paragraph", text: "새로 더한 문단 — 반품 출고는 별도 정책을 따른다." },
      editable: true,
      tokens: {},
      status: "new",
    },
  ];
  if (conflict) {
    blocks.splice(3, 0, {
      id: "b5",
      view: { kind: "paragraph", text: "배정은 *창고 관리자*가 확정한다." },
      editable: true,
      tokens: {},
      status: "conflict",
      theirs: { kind: "paragraph", text: "배정은 **운영 담당자**가 확정한다(10월 결정)." },
    });
  }
  return {
    docKey: `p-${doc.pageId}`,
    kind: "existing",
    pageId: doc.pageId,
    site: "colosseum.atlassian.net",
    title: `${doc.title} v0.8`,
    baseTitle: `${doc.title} v0.8`,
    baseVersion: doc.version,
    revision: 3,
    state: conflict ? "conflict" : "editing",
    blocks,
    parent: null,
    stage: { notation: "0.8", closed: false },
    observedVersion: null,
    pendingCommandId: null,
    updatedAt: ago(2),
  };
}

/** 프로젝트 한 칸의 가짜 데몬 — 누른 손잡이의 종류를 아래 줄에 남긴다(검사 · 콘솔에서도 쓴다). */
export function daemonFor(id: string, log: (line: string) => void): Daemon {
  // 초안 편집기의 메모리 상태 — 열쇠별로 하나를 캐시하고, 고치기 · 발행이 여기에 쌓인다.
  let draftKey: string | null = null;
  let draft: DraftView | null = null;
  let copySerial = 1;
  let commentSeq = COMMENTS.length + 1;
  const comments = COMMENTS.map((row) => ({ ...row }));

  /** 열쇠의 초안 — 문서 초안은 처음 열리면 견본을 만들고, 만들어진 적 없는 새 문서 초안은 없다. */
  const openDraft = (key: string): DraftView | null => {
    if (draft !== null && draftKey === key) return draft;
    if (!key.startsWith("p-")) return null;
    const base = sampleDraft(key.slice(2), id === "draft-conflict");
    // 목록의 `result-unknown` 초안 — 편집기의 결과 띠(다시 확인 · 재전송 없이 종료)가 서도록 연다.
    draft =
      base.pageId === "3001"
        ? {
            ...base,
            state: "result-unknown",
            revision: 5,
            observedVersion: 12,
            pendingCommandId: PENDING_COMMAND,
          }
        : base;
    draftKey = key;
    return draft;
  };

  /** 코멘트 쓰기의 결과 — 실패 · 모름은 코멘트 목록을 바꾸지 않는다. */
  const commentResult = (commandId: string): DocCommentResult | null => {
    if (id === "comment-failed")
      return { commandId, state: "failed", commentId: null, detail: "anchor-ambiguous" };
    if (id === "comment-unknown")
      return { commandId, state: "unknown", commentId: null, detail: "" };
    return null;
  };

  /** 문서 관리의 결과 — 복제만 적용 뒤 새 문서 id 를 채운다. */
  const applyDocOp = (op: DocOpKind, commandId: string): DocOpResult => {
    if (id === "op-unknown") return { commandId, op, state: "unknown", pageId: null, detail: "" };
    if (id === "op-failed")
      return {
        commandId,
        op,
        state: "failed",
        pageId: null,
        detail: "Confluence 요청이 실패했어요",
      };
    return { commandId, op, state: "applied", pageId: null, detail: "" };
  };

  const draftApi = {
    // 초안 목록 — 고치는 중 하나와 결과를 못 받은 하나(2026-10-23 · 최종 구현 계획 F2).
    draftList: () =>
      later(120, [
        {
          docKey: "p-2001",
          pageId: "2001",
          title: "[정책서] 주문 접수 v0.8",
          revision: 3,
          state: "editing",
          changedBlocks: 2,
          baseVersion: 7,
          observedVersion: null,
          updatedAt: ago(2),
        },
        {
          docKey: "p-3001",
          pageId: "3001",
          title: "[기능설계서] 주문 목록 · 검색 v0.8",
          revision: 5,
          state: "result-unknown",
          changedBlocks: 3,
          baseVersion: 11,
          observedVersion: 12,
          updatedAt: ago(40),
        },
      ] satisfies DraftSummary[]),
    draftOpen: (pageId: string) => {
      const view = openDraft(`p-${pageId}`);
      return view === null ? failLater(150) : later(300, view);
    },
    // 데몬의 `draft.get` 처럼 이미 있는 초안의 열쇠만 연다(목록의 둘 · 이번에 열거나 만든 것) — 없는 열쇠는 데몬의 말로
    // 거절한다. 아무 열쇠에나 초안을 돌려주던 흉내가 처음 `고치기` 의 틈(문서로 열어야 초안이 생긴다)을 가렸다(2026-10-23).
    draftGet: (docKey: string) => {
      const known = docKey === "p-2001" || docKey === "p-3001" || draftKey === docKey;
      if (!known) {
        return new Promise<DraftView>((_resolve, reject) =>
          window.setTimeout(
            () => reject(new Error("열려 있는 초안이 없습니다 — 목록에서 다시 열어 주세요.")),
            120,
          ),
        );
      }
      const view = openDraft(docKey);
      return view === null ? failLater(120) : later(120, view);
    },
    draftCreate: (input: { title: string; parentId: string; parentType: "page" | "folder" }) => {
      log("새 문서 초안");
      const parentTitle =
        DOCS.find((row) => row.pageId === input.parentId)?.title ?? input.parentId;
      const base = sampleDraft(DOCS[5].pageId, false);
      draft = {
        ...base,
        docKey: "n-c0ffee0011223344556677889900aabb",
        kind: "new",
        pageId: null,
        title: input.title,
        baseTitle: null,
        baseVersion: null,
        revision: 1,
        state: "editing",
        parent: { id: input.parentId, type: input.parentType, title: parentTitle },
        stage: { notation: null, closed: false },
        observedVersion: null,
        pendingCommandId: null,
        updatedAt: ago(0),
      };
      draftKey = draft.docKey;
      return later(300, draft);
    },
    draftEdit: (_docKey: string, _revision: number, edits: DraftEdit[]) => {
      if (draft === null) return failLater(100);
      let blocks = [...draft.blocks];
      for (const edit of edits) {
        if (edit.type === "set") {
          blocks = blocks.map((block) =>
            block.id === edit.blockId ? { ...block, view: edit.view, status: "changed" } : block,
          );
        } else if (edit.type === "delete") {
          blocks = blocks.filter((block) => block.id !== edit.blockId);
        }
      }
      log(`초안 고치기 ${edits.length}걸음`);
      draft = { ...draft, blocks, revision: draft.revision + 1 };
      return later(200, draft);
    },
    draftResolve: (_docKey: string, blockId: string, choice: "mine" | "theirs") => {
      if (draft === null) return failLater(100);
      log(`충돌 고르기 ${choice}`);
      const blocks = draft.blocks.map((block) =>
        block.id === blockId
          ? {
              ...block,
              view: choice === "theirs" && block.theirs ? block.theirs : block.view,
              status: "changed" as const,
              theirs: undefined,
            }
          : block,
      );
      draft = { ...draft, blocks, state: "editing", revision: draft.revision + 1 };
      return later(200, draft);
    },
    draftDiscard: () => {
      log("초안 버리기");
      draft = null;
      return later(150, { discarded: true });
    },
    // 기획 대화 견본 — 사람의 요청 하나와 AI 의 답(변경안 세 걸음)이 선다.
    draftThread: (docKey: string) =>
      later(200, {
        docKey,
        threadId: "t-1",
        running: false,
        messages: [
          {
            messageId: "m-1",
            role: "user",
            text: "배정 실패 때의 예외를 정책에 더해 줘. 운영 담당 확인을 거치게.",
            at: ago(6),
            refs: [
              {
                pageId: DOCS[2].pageId,
                title: DOCS[2].title,
                version: 4,
                sections: ["5. 세부 규칙"],
              },
            ],
          },
          {
            messageId: "m-2",
            role: "assistant",
            text: "배정 실패의 예외를 **5절**에 맞춰 두 군데에 더했어요. 표의 권한 칸도 운영 담당(OP)으로 고쳤어요.",
            at: ago(5),
            proposalId: "pr-1",
            reads: [{ pageId: DOCS[3].pageId, title: DOCS[3].title, version: 7 }],
          },
        ],
        proposals: [
          {
            proposalId: "pr-1",
            createdAt: ago(5),
            draftRevision: 3,
            summary: "배정 실패 예외와 확인 권한을 더한다",
            ops: [
              {
                opId: "op-1",
                type: "replace",
                blockId: "b1",
                view: {
                  kind: "paragraph",
                  text: "출고 지시는 **재고 확정** 뒤에만 만든다. 배정이 실패하면 운영 담당이 확인한 뒤 다시 배정한다.",
                },
                state: "open",
              },
              {
                opId: "op-2",
                type: "insert",
                afterBlockId: "b2",
                view: {
                  kind: "paragraph",
                  text: "예외: 긴급 출고는 확인 없이 먼저 배정하고 사후에 기록한다.",
                },
                state: "open",
              },
              { opId: "op-3", type: "delete", blockId: "b4", state: "rejected" },
            ],
          },
        ],
      }),
    draftAdopt: (docKey: string) => {
      log("변경안 채택");
      return later(200, draft ?? sampleDraft(docKey.slice(2), false));
    },
    draftReject: (docKey: string) => {
      log("변경안 거절");
      return later(150, { docKey, threadId: "t-1", running: false, messages: [], proposals: [] });
    },
    draftAsk: () => {
      log("AI 에게 보내기");
      return later(150, { threadId: "t-1", messageId: "m-3" });
    },
    draftCancel: () => later(100, { cancelled: true }),
    // 발행 확인 창의 손(2026-10-23 · 최종 구현 계획 F2) — 미리보기는 상태마다, 보내기는 기본 닿음.
    draftPublishPreview: (docKey: string) => {
      const view = openDraft(docKey);
      if (view === null) return failLater(250);
      const closed = id === "publish-closed";
      const ahead = closed || id === "publish-blocked";
      return later(250, {
        docKey: view.docKey,
        kind: "update",
        pageId: view.pageId,
        title: view.title,
        titleChanged: view.title !== view.baseTitle,
        parent: view.parent,
        baseVersion: view.baseVersion,
        remoteVersion: view.baseVersion === null ? null : view.baseVersion + (ahead ? 2 : 0),
        draftRevision: view.revision,
        changes: { changed: 2, inserted: 1, deleted: 0, protectedRemoved: [] },
        stage: closed
          ? { current: "1.01", closed: true, required: true }
          : { current: view.stage.notation, closed: false, required: false },
        blockers:
          id === "publish-blocked" ? [...(["publish-disabled", "remote-newer"] as const)] : [],
        checkedAt: ago(0),
      } satisfies DraftPublishPreview);
    },
    draftPublish: (
      docKey: string,
      commandId: string,
      _expectedRevision: number,
      _stage?: { notation: string; reason: string },
    ) => {
      const view = openDraft(docKey);
      if (view === null || draft === null) return failLater(150);
      log("초안 발행");
      const unknown = id === "publish-unknown";
      // 결과를 못 받으면 편집기가 다시 읽을 때 `결과 확인 필요` 띠가 선다.
      draft = unknown
        ? { ...view, state: "result-unknown", pendingCommandId: commandId }
        : { ...view, state: "published", pendingCommandId: null };
      return later(900, {
        commandId,
        docKey,
        state: unknown ? "unknown" : "applied",
        pageId: view.pageId,
        version: unknown || view.pageId === null ? null : (view.baseVersion ?? 0) + 1,
        detail: "",
      } satisfies DraftPublishResult);
    },
    draftPublishRecheck: (commandId: string) => {
      log("발행 결과 다시 확인");
      const view = draft;
      if (view !== null) draft = { ...view, state: "published", pendingCommandId: null };
      return later(600, {
        commandId,
        docKey: view?.docKey ?? "p-2001",
        state: "applied",
        pageId: view?.pageId ?? "2001",
        version: (view?.baseVersion ?? 0) + 2,
        detail: "",
      } satisfies DraftPublishResult);
    },
    draftPublishClose: (commandId: string) => {
      log("발행 종료");
      const view = draft;
      if (view !== null) draft = { ...view, state: "closed-unconfirmed", pendingCommandId: null };
      return later(300, {
        commandId,
        docKey: view?.docKey ?? "p-2001",
        state: "closed-unconfirmed",
        pageId: view?.pageId ?? null,
        version: null,
        detail: "",
      } satisfies DraftPublishResult);
    },
    draftRebase: (docKey: string) => {
      const view = openDraft(docKey);
      if (view === null) return failLater(150);
      log("원격 최신본에 맞추기");
      draft = {
        ...view,
        state: "editing",
        baseVersion: (view.baseVersion ?? 0) + 2,
        observedVersion: null,
        revision: view.revision + 1,
      };
      return later(500, draft);
    },
    // 근거 스냅샷(2026-10-23 · 최종 구현 계획 F3) — 첫 줄 표식이 있는 합성 마크다운을 첨부로 실는다.
    draftSnapshot: (input: { pageId?: string; docKey?: string; sections?: string[] }) => {
      log("근거 스냅샷");
      const view = input.docKey === undefined ? null : openDraft(input.docKey);
      const doc = DOCS.find((row) => row.pageId === input.pageId) ?? DOCS[5];
      const scope =
        input.sections === undefined || input.sections.length === 0
          ? "문서 전체"
          : input.sections.join(" · ");
      const body = [
        `<!-- colonova-design:plan-ref pageId="${doc.pageId}" version="${doc.version}" -->`,
        `# ${doc.title}`,
        "",
        `범위: ${scope}`,
        "",
        "## 1. 목적",
        "",
        "주문이 들어오는 순간부터 재고가 잡히는 순간까지의 규칙을 한곳에 정한다.",
        "",
        "## 3. 용어",
        "",
        "| 용어 | 뜻 |",
        "| --- | --- |",
        "| 접수 | 주문이 시스템에 들어와 번호를 받은 상태 |",
        "| 확정 | 재고가 잡히고 출고 지시가 가능한 상태 |",
      ].join("\n");
      const pageId = input.pageId ?? view?.pageId ?? null;
      return later(400, {
        attachment: {
          name: `${doc.title}.md`,
          mediaType: "text/markdown",
          data: btoa(String.fromCharCode(...new TextEncoder().encode(body))),
        },
        ref: {
          title: doc.title,
          pageId,
          docKey: input.docKey ?? null,
          url: pageId === null ? null : `https://colosseum.atlassian.net/pages/${pageId}`,
          version: pageId === null ? null : doc.version,
          revision: view?.revision ?? null,
          published: input.docKey === undefined,
          sections: input.sections ?? [],
        },
      } satisfies DraftSnapshot);
    },
  };
  const api = {
    ...draftApi,
    docList: () => {
      if (id === "list-loading") return never();
      if (id === "list-failed") return failLater(500);
      if (id === "none") return later(80, { docs: null });
      if (id === "empty" || id === "expired-empty") return later(80, { docs: [] });
      if (id === "big") return later(160, { docs: bigDocs() });
      return later(160, { docs: DOCS });
    },
    docRead: (pageId: string) => {
      if (id === "doc-failed") return failLater(700);
      const doc = DOCS.find((row) => row.pageId === pageId) ?? DOCS[5];
      const reply = {
        markdown: POLICY(doc),
        sections: [
          { heading: "1. 목적", macro: false },
          { heading: "3. 용어", macro: true },
          { heading: "4. 정책 원칙", macro: true },
          { heading: "5. 세부 규칙", macro: false },
        ],
        // 코멘트 쓰기가 더한 것까지 보이게 — 견본 안의 목록을 그대로 읽는다.
        comments,
      };
      return later(id === "doc-slow" ? 6000 : 450, reply);
    },
    confluenceImportNow: () => {
      log("새로 가져오기");
      if (id === "import-failed") return failLater(1200);
      return later(id === "import-slow" ? 60_000 : 1200, {
        imported: 3,
        skipped: 25,
        capped: false,
      });
    },
    // 문서 관리(2026-10-23 · 최종 구현 계획 F4) — 미리보기는 아래 문서와 초안을 알리고, 누르면 적용.
    docOpPreview: (op: DocOpKind, pageId: string, parentId?: string) => {
      const trashed = TRASHED.find((row) => row.pageId === pageId);
      const doc = DOCS.find((row) => row.pageId === pageId);
      const parent =
        parentId === undefined ? undefined : DOCS.find((row) => row.pageId === parentId);
      return later(250, {
        op,
        pageId,
        title: trashed?.title ?? doc?.title ?? "문서",
        childCount: 3,
        hasDraft: pageId === "2001",
        target:
          parent === undefined
            ? null
            : { id: parent.pageId, type: "page" as const, title: parent.title },
        blockers: id === "op-blocked" ? [...(["no-permission", "out-of-scope"] as const)] : [],
        checkedAt: ago(0),
      } satisfies DocOpPreview);
    },
    docTrash: (_pageId: string, commandId: string) => {
      log(OP_WORDS.trash);
      return later(700, applyDocOp("trash", commandId));
    },
    docRestore: (_pageId: string, commandId: string) => {
      log(OP_WORDS.restore);
      return later(700, applyDocOp("restore", commandId));
    },
    docCopy: (_pageId: string, commandId: string, _title: string, _parentId: string) => {
      log(OP_WORDS.copy);
      const result = applyDocOp("copy", commandId);
      return later(
        900,
        result.state === "applied"
          ? { ...result, pageId: `7${String(copySerial++).padStart(3, "0")}` }
          : result,
      );
    },
    docMove: (_pageId: string, commandId: string, _parentId: string) => {
      log(OP_WORDS.move);
      return later(700, applyDocOp("move", commandId));
    },
    docTrashed: () => later(200, { entries: TRASHED }),
    // 코멘트 쓰기(2026-10-23 · 최종 구현 계획 F4) — 적용 뒤 다시 읽으면 목록에 선다.
    docCommentCreate: (input: {
      pageId: string;
      commandId: string;
      text: string;
      anchor?: { selection: string; index: number };
    }) => {
      log("코멘트 남기기");
      const settled = commentResult(input.commandId);
      if (settled !== null) return later(500, settled);
      const commentId = `c-${commentSeq++}`;
      comments.push({
        id: commentId,
        kind: input.anchor === undefined ? "footer" : "inline",
        version: 1,
        parentId: null,
        resolved: false,
        mine: true,
        editable: true,
        author: MINE,
        body: input.text,
        createdAt: ago(0),
        anchorText: input.anchor?.selection ?? null,
      });
      return later(500, {
        commandId: input.commandId,
        state: "applied",
        commentId,
        detail: "",
      });
    },
    docCommentReply: (input: {
      pageId: string;
      commandId: string;
      parentId: string;
      kind: "footer" | "inline";
      text: string;
    }) => {
      log("답글 달기");
      const settled = commentResult(input.commandId);
      if (settled !== null) return later(500, settled);
      const commentId = `c-${commentSeq++}`;
      comments.push({
        id: commentId,
        kind: input.kind,
        version: 1,
        parentId: input.parentId,
        resolved: false,
        mine: true,
        editable: true,
        author: MINE,
        body: input.text,
        createdAt: ago(0),
        anchorText: null,
      });
      return later(500, {
        commandId: input.commandId,
        state: "applied",
        commentId,
        detail: "",
      });
    },
    docCommentUpdate: (input: {
      pageId: string;
      commandId: string;
      commentId: string;
      kind: "footer" | "inline";
      version: number;
      text: string;
    }) => {
      log("코멘트 고치기");
      const settled = commentResult(input.commandId);
      if (settled !== null) return later(500, settled);
      const row = comments.find((one) => one.id === input.commentId);
      if (row !== undefined) {
        row.body = input.text;
        row.version = (row.version ?? 1) + 1;
      }
      return later(500, {
        commandId: input.commandId,
        state: "applied",
        commentId: input.commentId,
        detail: "",
      });
    },
    docCommentResolve: (input: {
      pageId: string;
      commandId: string;
      commentId: string;
      version: number;
      resolved: boolean;
    }) => {
      log(input.resolved ? "코멘트 해결" : "코멘트 다시 열기");
      const settled = commentResult(input.commandId);
      if (settled !== null) return later(500, settled);
      const row = comments.find((one) => one.id === input.commentId);
      if (row !== undefined) {
        row.resolved = input.resolved;
        row.version = (row.version ?? 1) + 1;
      }
      return later(500, {
        commandId: input.commandId,
        state: "applied",
        commentId: input.commentId,
        detail: "",
      });
    },
  };
  return { api, connection: "open", onDraftEvent: () => () => {} } as unknown as Daemon;
}

function Frame({ id }: { id: string }) {
  const [line, setLine] = useState("—");
  const daemon = useMemo(() => daemonFor(id, setLine), [id]);
  const project = useMemo(() => projectFor(id), [id]);
  const nav = {
    openSettings: () => setLine("설정 열기"),
    showPane: (pane: string) => setLine(`오른쪽 칸 → ${pane}`),
    showTab: (tab: string) => setLine(`오른쪽 칸 → ${tab}`),
    openPlans: () => setLine("기획서 열기"),
    toast: (text: string) => setLine(`토스트: ${text}`),
  } as unknown as ShellNav;
  // 셸의 집중 배치를 따른다(2026-10-23 기획자 화면 손질 D2) — 초안 편집기가 열리면 대화 칸 자리가 비켜서고 기획서 칸이 본문
  // 폭을 다 쓴다. 대화 칸의 폭은 셸의 처음 값(400px · `Workspace` 의 CHAT_DEFAULT)이다.
  const [draftOpen, setDraftOpen] = useState(false);
  const focus = !NARROW && draftOpen;
  const columns = NARROW || focus ? "minmax(0, 1fr)" : "400px minmax(0, 1fr)";
  return (
    <div id={`fixture-${id}`} style={{ width: FRAME_W }}>
      <div
        style={{ font: "11.5px/1.45 monospace", color: "#888", margin: "0 0 4px", minHeight: 34 }}
      >
        {id}
        <br />→ {line}
      </div>
      <div
        className="nx"
        style={{
          display: "flex",
          flexDirection: "column",
          height: FRAME_H,
          width: FRAME_W,
          overflow: "hidden",
          border: "1px dashed #8884",
        }}
      >
        <main className="nx-main" style={{ flex: 1 }}>
          <div className="nx-view nx-work">
            <div className="nx-body" style={{ gridTemplateColumns: columns }}>
              {!NARROW && (
                <section
                  className={`nx-chat${focus ? " nx-offstage" : ""}`}
                  style={{ padding: 24, font: "12px monospace", color: "#888" }}
                >
                  대화 칸 자리
                </section>
              )}
              <PlansColumn daemon={daemon} project={project} nav={nav} onDraftOpen={setDraftOpen} />
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <div
      style={{
        background: "var(--bg)",
        minHeight: "100vh",
        padding: 20,
        display: "flex",
        gap: 24,
        alignItems: "flex-start",
        flexWrap: "wrap",
      }}
    >
      {CASES.map((id) => (
        <Frame key={id} id={id} />
      ))}
    </div>
  </StrictMode>,
);
