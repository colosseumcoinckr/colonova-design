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
 * 문서 행을 누르면 본문이 서고, `새로 가져오기` 는 1.2초 뒤 끝난다. 새 상태는 여기에 더한다. 틀은 320px 트리와 문서 본문이다. 문서를 열어도 트리는 남는다(2026-10-23 화면 전면 재설계 §4 C).
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
 *   · mismatch-doc — 읽는 문서 곁 `화면과 맞춰 보기` 의 어긋남 카드(누르면 선다, 2026-11-03 A안)
 *   · mismatch-chat · mismatch-failed — 기획 대화 답 아래의 화면 제안 카드 · 판정 실패 줄(곧장 그린다)
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
  DraftCompareResult,
  DraftEdit,
  DraftMessage,
  DraftPublishPreview,
  DraftPublishResult,
  DraftSnapshot,
  DraftSummary,
  DraftView,
  ProjectSummary,
} from "@colonova-design/protocol";
import { type CSSProperties, StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Daemon, PlanDocComment } from "../src/lib/daemon-client";
import { applyStoredTheme, applyStoredTypeScale, useSettings } from "../src/lib/settings";
import { PlanChat } from "../src/next/plans/draft/PlanChat";
import { useDraftThread } from "../src/next/plans/draft/use-draft-thread";
import { PlanDocView } from "../src/next/plans/PlanDocView";
import { PlansColumn } from "../src/next/plans/PlansColumn";
import { PlansSidebar } from "../src/next/plans/PlansSidebar";
import { PlansContext, usePlansWorkspace } from "../src/next/plans/PlansWorkspace";
import type { ShellNav } from "../src/next/slots";
import { Workspace } from "../src/next/Workspace";
import { mockDaemon, PROJECTS, REPO, STATUS } from "./overlay-mocks";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "../src/styles.css";
import "../src/next/next.css";

applyStoredTheme();
applyStoredTypeScale();
const query = new URLSearchParams(location.search);
const theme = query.get("theme");
if (theme) document.documentElement.dataset.theme = theme;
const FRAME_W = Number(query.get("w")) || window.innerWidth - 40;
const FRAME_H = Number(query.get("h")) || window.innerHeight - 78;
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
/**
 * 어긋남 카드의 견본 줄(2026-11-03 A안 부품 사진) — `?case=mismatch-doc` 의 `화면과 맞춰 보기` 가 돌려주는
 * 판정과 `?case=mismatch-chat` 의 기획 대화 답 아래 카드가 함께 쓴다.
 */
const MISMATCH: DraftCompareResult = {
  docKey: "p-2001",
  pageId: "2001",
  title: "[정책서] 주문 접수",
  source: "초안(3판)",
  rows: [
    {
      section: "5-2. 예외",
      plan: "배정이 실패하면 운영 담당 확인을 거친다",
      screen: "확인 없이 실패 안내만 보여 준다",
      screenName: "주문 목록",
    },
    {
      section: "5-1. 접수 조건",
      plan: "요청 메모는 200자 이내",
      screen: "메모 500자까지 받는다",
      screenName: "주문 입력",
    },
  ],
  note: null,
};

/**
 * 기획 대화의 견본 말(2026-11-03 A안 부품 사진) — `?case=mismatch-chat` 은 AI 답 아래에 화면 제안 카드
 * (`mismatch`)를, `?case=mismatch-failed` 는 판정 실패 한 줄과 `다시 시도` (`mismatchFailed`)를 세운다.
 */
function mismatchMessages(kind: string): DraftMessage[] {
  const answer: DraftMessage = {
    messageId: "m-2",
    role: "assistant",
    text: "배정 실패의 예외를 **5절**에 맞춰 두 군데에 더했어요. 표의 권한 칸도 운영 담당(OP)으로 고쳤어요.",
    at: ago(5),
    proposalId: "pr-1",
    reads: [{ pageId: "2001", title: "[정책서] 주문 접수", version: 7 }],
    ...(kind === "mismatch-chat" ? { mismatch: { rows: MISMATCH.rows } } : {}),
    ...(kind === "mismatch-failed" ? { mismatchFailed: true as const } : {}),
  };
  return [
    {
      messageId: "m-1",
      role: "user",
      text: "배정 실패 때의 예외를 정책에 더해 줘. 운영 담당 확인을 거치게.",
      at: ago(6),
    },
    answer,
  ];
}

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
              pages: id === "big" ? bigDocs().length : DOCS.length,
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
  // 새 문서 초안의 선택 줄도 실제 셸에서 확인한다(2026-10-24 RS 3).
  if (new URLSearchParams(location.search).has("newDraft")) {
    draft = {
      ...sampleDraft("2001", false),
      docKey: "n-c0ffee0011223344556677889900aabb",
      kind: "new",
      pageId: null,
      title: "RS 새 문서 초안",
      baseTitle: null,
      baseVersion: null,
      parent: { id: "1000", type: "page", title: DOCS[0].title },
    };
    draftKey = draft.docKey;
  }
  let copySerial = 1;
  let commentSeq = COMMENTS.length + 1;
  const comments = COMMENTS.map((row) => ({ ...row }));
  // 이 견본에서 지워진 기획 대화의 이름표 — draftThreads 가 목록에서 거둔다(2026-11-03).
  const goneConvs = new Set<string>();
  // 고른 이름 바꾸기(2026-11-03) — 줄의 `···` 이름 바꾸기가 목록의 제목을 갈아 낀다.
  const convTitles = new Map<string, string>();

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
        ...(draft?.kind === "new" ? [{ ...draft, changedBlocks: 0 }] : []),
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
    // 골라 읽기(2026-11-03) — threadId 를 골랐으면 그 대화를 돌려준다(문서의 최신 대화 t-1 과 옛 대화 t-3).
    draftThread: (docKey: string, threadId?: string) =>
      threadId === "t-3"
        ? later(200, {
            docKey,
            threadId: "t-3",
            running: false,
            messages: [
              {
                messageId: "m-10",
                role: "user",
                text: "반품 창고 규칙을 6절에 정리해 줘.",
                at: ago(40),
                refs: [],
              },
              {
                messageId: "m-11",
                role: "assistant",
                text: "반품 입고 · 검수 · 재고 반영의 세 걸음으로 **6절**에 정리했어요.",
                at: ago(39),
                proposalId: "pr-3",
                reads: [],
              },
            ],
            proposals: [],
          })
        : id === "mismatch-chat" || id === "mismatch-failed"
          ? // A안 부품 사진(2026-11-03) — 화면 제안 카드와 판정 실패 줄은 대화 판이 아니라 곧장 그리는 장면으로 본다.
            later(200, {
              docKey,
              threadId: "t-1",
              running: false,
              messages: mismatchMessages(id),
              proposals: [],
            })
          : later(200, {
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
                  // 바로 반영(2026-10-31 2단계) — 채택 없이 초안에 들어간 고침의 문서 카드다.
                  proposalId: "pr-1",
                  createdAt: ago(5),
                  draftRevision: 3,
                  summary: "배정 실패 예외와 확인 권한을 더한다",
                  appliedAt: ago(5),
                  appliedOps: 2,
                  // 남은 고침 하나(2026-11-02 D9) — 사람이 고치던 블록에 남은 걸음이 있어 알약이 서는 견본.
                  keptOps: 1,
                  undoable: true,
                  ops: [
                    {
                      opId: "op-1",
                      type: "replace",
                      blockId: "b1",
                      view: {
                        kind: "paragraph",
                        text: "출고 지시는 **재고 확정** 뒤에만 만든다. 배정이 실패하면 운영 담당이 확인한 뒤 다시 배정한다.",
                      },
                      state: "adopted",
                    },
                    {
                      opId: "op-2",
                      type: "insert",
                      afterBlockId: "b2",
                      view: {
                        kind: "paragraph",
                        text: "예외: 긴급 출고는 확인 없이 먼저 배정하고 사후에 기록한다.",
                      },
                      state: "adopted",
                    },
                    { opId: "op-3", type: "delete", blockId: "b4", state: "stale" },
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
    // 화면과 맞춰 보기(2026-11-02 C7) · 같이 고치기 게이트 · 판정 다시 시도(2026-11-03 A안)의 손 —
    // 견본에서는 로그만 남기고 카드의 바쁨/실패 모양이 사는지만 본다.
    draftCompare: () =>
      id === "mismatch-doc"
        ? later(300, { ...MISMATCH })
        : later(300, { ...MISMATCH, docKey: null, rows: [] }),
    draftCompareDecline: () => {
      log("어긋남 안 받기");
      return later(150, { ok: true });
    },
    draftSyncApply: () => {
      log("같이 고침 적용");
      return later(150, { ok: true });
    },
    draftSyncSkip: () => {
      log("같이 고침 건너뛰기");
      return later(150, { ok: true });
    },
    draftSyncRetry: () => {
      log("같이 고침 다시 시도");
      return later(150, { ok: true });
    },
    draftMismatchRetry: () => {
      log("어긋남 판정 다시 시도");
      return later(150, { ok: true });
    },
    // 기획 대화 목록 · 판 고르기 · 되돌리기(2026-10-31 2·3단계) — 견본의 가짜 데몬이 같은 모양으로 답한다.
    // 지운 대화는 목록에서 거둔다(2026-11-03) — 줄의 `···` 지우기가 실제로 사라지는 것을 눈으로 본다.
    draftThreads: () =>
      later(
        150,
        [
          {
            threadId: "t-1",
            title: convTitles.get("t-1") ?? "배정 실패 때의 예외를 정책에 더해 줘...",
            docKey: draftKey ?? "p-2001",
            docTitle: "[정책서] 주문 접수 v0.8",
            at: ago(5),
            messageCount: 2,
            running: false,
          },
          {
            threadId: "t-2",
            title: convTitles.get("t-2") ?? "노쇼 규칙을 정리해 줘",
            docKey: "p-3001",
            docTitle: "[기능설계서] 주문 목록 · 검색 v0.8",
            at: ago(30),
            messageCount: 4,
            running: false,
          },
          {
            // 같은 문서의 옛 대화(2026-11-03) — 줄을 누르면 그 대화가 판에 다시 서는 것을 눈으로 본다.
            threadId: "t-3",
            title: convTitles.get("t-3") ?? "반품 창고 규칙을 6절에 정리해 줘.",
            docKey: "p-2001",
            docTitle: "[정책서] 주문 접수 v0.8",
            at: ago(40),
            messageCount: 2,
            running: false,
          },
        ].filter((one) => !goneConvs.has(one.threadId)),
      ),
    draftThreadMove: () => {
      log("대화 옮기기");
      return later(150, {
        threadId: "t-1",
        title: "배정 실패 때의 예외를 정책에 더해 줘...",
        docKey: "p-3001",
        docTitle: "[기능설계서] 주문 목록 · 검색 v0.8",
        at: ago(0),
        messageCount: 2,
        running: false,
      });
    },
    draftThreadDelete: (threadId: string) => {
      goneConvs.add(threadId);
      log("대화 지우기");
      return later(120, { deleted: true });
    },
    draftThreadRename: (threadId: string, title: string) => {
      convTitles.set(threadId, title);
      log("대화 이름 바꾸기");
      return later(120, {
        threadId,
        title,
        docKey: draftKey ?? "p-2001",
        docTitle: "[정책서] 주문 접수 v0.8",
        at: ago(0),
        messageCount: 2,
        running: false,
      });
    },
    draftRevisions: () =>
      later(150, [
        {
          revision: 3,
          at: ago(5),
          origin: "ai",
          label: "배정 실패 예외",
          changes: { changed: 1, inserted: 1, deleted: 0 },
          state: "editing",
        },
        {
          revision: 2,
          at: ago(20),
          origin: "person",
          label: null,
          changes: { changed: 1, inserted: 0, deleted: 0 },
          state: "editing",
        },
      ]),
    draftRevision: (_docKey: string, revision: number) => {
      const view = openDraft(draftKey ?? "p-2001");
      if (view === null) return failLater(120);
      if (revision === 0) {
        return later(200, {
          ...view,
          revision: 0,
          blocks: view.blocks.map((b) => ({ ...b, status: "same" as const })),
        });
      }
      return later(200, {
        ...view,
        revision,
        blocks: view.blocks.map((b) => ({ ...b, status: "same" as const })),
      });
    },
    draftUndo: () => {
      log("AI 고침 되돌리기");
      return later(200, { restored: 2, kept: 0 });
    },
    draftRevisionRestore: () => {
      log("고른 판으로 되돌리기");
      if (draft === null) return failLater(120);
      draft = { ...draft, revision: draft.revision + 1 };
      return later(200, draft);
    },
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
    // 읽는 문서 곁의 `이 문서의 화면`(2026-10-30)이 읽는다 — 견본은 이어진 화면 하나를 보인다.
    mapRead: () =>
      later(120, {
        links: [{ pageId: "1006", route: "/signup", section: null }],
        screens: [{ route: "/signup", title: "회원가입" }],
      }),
    mapWrite: () => later(120, []),
    docList: () => {
      if (id === "list-loading") return never();
      if (id === "list-failed") return failLater(500);
      if (id === "none") return later(80, { docs: null });
      if (id === "empty" || id === "expired-empty") return later(80, { docs: [] });
      if (id === "big") return later(160, { docs: bigDocs() });
      return later(160, {
        docs: DOCS,
        roots: [new URLSearchParams(location.search).get("root") ?? "1000"],
      });
    },
    docRead: (pageId: string) => {
      if (id === "doc-failed") return failLater(700);
      const doc = (id === "big" ? bigDocs() : DOCS).find((row) => row.pageId === pageId) ?? DOCS[5];
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
        // Confluence 기능 확장(2026-10-30) — 상자 · 상태 · 목차 · 펼치기 · 코드 · 라벨 · 첨부의 견본.
        view: FIXTURE_VIEW,
        labels: fixtureLabels,
        attachments: [
          {
            id: "a1",
            title: "흐름도.png",
            mediaType: "image/png",
            size: 48_213,
            createdAt: "2026-10-20T09:00:00Z",
          },
          { id: "a2", title: "정책표.xlsx", mediaType: null, size: 1_204_331, createdAt: null },
        ],
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
    // Confluence 기능 확장(2026-10-30) — 흐름도 그림은 진짜 한 장을 늦게 주고, 그 밖의 첨부는
    // 받지 못함으로 둔다. 라벨은 바로 적용, 판 기록은 셋.
    docAttachment: (_pageId: string, filename: string) =>
      filename === "흐름도.png"
        ? later(600, { data: FLOW_PNG, mediaType: "image/png", filename })
        : failLater(400),
    docLabelAdd: (input: { commandId: string; label: string }) => {
      log("라벨 더하기");
      fixtureLabels = [...fixtureLabels, { name: input.label, prefix: "global" }];
      return later(400, { commandId: input.commandId, state: "applied", detail: "" });
    },
    docLabelRemove: (input: { commandId: string; label: string }) => {
      log("라벨 빼기");
      fixtureLabels = fixtureLabels.filter((one) => one.name !== input.label);
      return later(400, { commandId: input.commandId, state: "applied", detail: "" });
    },
    docVersions: () =>
      later(300, {
        versions: [
          {
            number: 3,
            author: "김기획",
            createdAt: "2026-10-29T09:00:00Z",
            message: "정책 원칙 고침",
            minorEdit: false,
          },
          {
            number: 2,
            author: "이디자인",
            createdAt: "2026-10-25T09:00:00Z",
            message: "",
            minorEdit: true,
          },
          {
            number: 1,
            author: "김기획",
            createdAt: "2026-10-20T09:00:00Z",
            message: "처음",
            minorEdit: false,
          },
        ],
      }),
    docVersionRead: (_pageId: string, version: number) =>
      later(300, { version, title: "옛 판", view: FIXTURE_VIEW.slice(0, 3) }),
    docSearch: (query: string) =>
      later(300, {
        results: [
          {
            pageId: DOCS[5]?.pageId ?? "1",
            title: DOCS[5]?.title ?? "",
            snippet: `…본문 속 ${query} 이(가) 맞은 자리…`,
          },
        ],
      }),
    docBlockPreview: () => later(200, { previews: {} }),
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

/** 라벨 견본 — 더하기 · 빼기가 바꾼다(2026-10-30). */
let fixtureLabels = [
  { name: "정책", prefix: "global" },
  { name: "v0-8", prefix: "global" },
];

/** 견본 그림 한 장(960×420 와이어프레임 PNG) — 첨부 그림이 실제로 그려지고 크게 보기를 눈으로 본다. */
const FLOW_PNG =
  "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";

/** 보기 블록 견본(2026-10-30) — 데몬의 confluence-view 가 내는 모양. */
const FIXTURE_VIEW = [
  {
    t: "toc",
    entries: [
      { level: 2, text: "1. 목적" },
      { level: 2, text: "2. 정책 원칙" },
      { level: 3, text: "2.1 예외" },
    ],
  },
  { t: "heading", level: 2, children: [{ t: "text", text: "1. 목적" }] },
  {
    t: "p",
    children: [
      { t: "text", text: "이 문서는 " },
      { t: "status", text: "검토 중", color: "yellow", subtle: false },
      { t: "text", text: " 상태다. 담당 " },
      { t: "mention", name: "김기획" },
    ],
  },
  {
    t: "panel",
    tone: "info",
    title: null,
    blocks: [{ t: "p", children: [{ t: "text", text: "정보 상자의 글이 그대로 보인다." }] }],
  },
  {
    t: "panel",
    tone: "warning",
    title: "주의",
    blocks: [{ t: "p", children: [{ t: "text", text: "노쇼 정책은 법무 검토가 필요하다." }] }],
  },
  { t: "heading", level: 2, children: [{ t: "text", text: "2. 정책 원칙" }] },
  {
    t: "expand",
    title: "자세히",
    blocks: [{ t: "p", children: [{ t: "text", text: "펼치면 보이는 글." }] }],
  },
  { t: "code", language: "json", title: "예시", text: '{ "noShow": 3 }' },
  { t: "heading", level: 3, children: [{ t: "text", text: "2.1 예외" }] },
  { t: "macro", name: "jira" },
  // 그림 — Confluence 표시 폭이 있든(320) 없든 문서 판에서는 칸 폭에 맞게 그려진다(2026-11-03).
  {
    t: "image",
    image: { source: { kind: "attachment", filename: "흐름도.png" }, alt: null, width: 320 },
  },
  {
    t: "p",
    children: [
      { t: "text", text: "문장 속 작은 그림 " },
      {
        t: "image",
        image: { source: { kind: "attachment", filename: "흐름도.png" }, alt: null, width: 72 },
      },
      { t: "text", text: " 은 표시 폭을 그대로 믿어 줄을 흐른다." },
    ],
  },
  {
    t: "image",
    image: {
      source: { kind: "attachment", filename: "흐름도.png" },
      alt: "예약 흐름도",
      width: null,
    },
  },
];

/**
 * `?case=mismatch-doc` — 읽는 문서 곁의 `화면과 맞춰 보기`(C7)로 서는 어긋남 카드(2026-11-03 A안 부품
 * 사진). 진짜 `PlanDocView` 를 견본 본문과 함께 올리고, 누르면 가짜 `draftCompare` 의 판정이 카드로 선다.
 */
function MismatchDocFrame({ id }: { id: string }) {
  const [line, setLine] = useState("—");
  const daemon = useMemo(() => daemonFor(id, setLine), [id]);
  const nav = {
    openSettings: () => setLine("설정 열기"),
    showPane: (pane: string) => setLine(`오른쪽 칸 → ${pane}`),
    showTab: (tab: string) => setLine(`오른쪽 칸 → ${tab}`),
    openPlans: () => setLine("기획서 열기"),
    toast: (text: string) => setLine(`토스트: ${text}`),
  } as unknown as ShellNav;
  const doc = DOCS[5];
  return (
    <div id={`fixture-${id}`} style={{ width: FRAME_W }}>
      <div style={{ font: "12px/1.45 monospace", color: "#888", margin: "0 0 4px", minHeight: 34 }}>
        {id} — 머리의 `화면과 맞춰 보기` 를 누르면 카드가 선다
        <br />→ {line}
      </div>
      {/* .nx 는 셸의 두 열 격자(사이드바 + 본문)다 — 부품 한 장 견본은 평범한 문서로 푼다(다른 견본과 같다). */}
      <div
        className="nx"
        style={{
          display: "block",
          height: FRAME_H,
          width: FRAME_W,
          overflow: "auto",
          border: "1px dashed #8884",
        }}
      >
        <PlanDocView
          pageId={doc.pageId}
          row={null}
          site="colosseum.atlassian.net"
          phase="ready"
          docError={null}
          doc={{
            markdown: POLICY(doc),
            sections: [
              { heading: "1. 목적", macro: false },
              { heading: "3. 용어", macro: true },
              { heading: "4. 정책 원칙", macro: true },
              { heading: "5. 세부 규칙", macro: false },
            ],
            comments: COMMENTS,
            view: FIXTURE_VIEW,
            labels: fixtureLabels,
            attachments: [],
          }}
          draft={{
            docKey: "p-2001",
            pageId: doc.pageId,
            title: `${doc.title} v0.8`,
            revision: 3,
            state: "editing",
            changedBlocks: 2,
            baseVersion: 7,
            observedVersion: null,
            updatedAt: ago(2),
          }}
          daemon={daemon}
          nav={nav}
          rows={[]}
          writable
          onRetry={() => {}}
          onBack={() => setLine("뒤로")}
          onRefresh={() => {}}
          onEdit={() => setLine("고치기")}
          onApplied={() => {}}
          onOpenPage={(pageId) => setLine(`문서 열기 ${pageId}`)}
          onSelectionAsk={(text) => setLine(`AI 에게 묻기: ${text.slice(0, 20)}`)}
        />
      </div>
    </div>
  );
}

/**
 * `?case=mismatch-chat` · `?case=mismatch-failed` — 기획 대화의 AI 답 아래(2026-11-03 A안 1A-2): 화면 제안
 * 카드의 두 손(으뜸 `화면을 기획서대로` · ghost `고쳐서 보내기`)과 판정 실패 한 줄의 `다시 시도`. 진짜
 * `PlanChat` + 진짜 `useDraftThread` 를 대화 칸 폭에 올린다.
 */
function MismatchChatFrame({ id }: { id: string }) {
  const [line, setLine] = useState("—");
  const daemon = useMemo(() => daemonFor(id, setLine), [id]);
  const nav = {
    openSettings: () => setLine("설정 열기"),
    showPane: (pane: string) => setLine(`오른쪽 칸 → ${pane}`),
    showTab: (tab: string) => setLine(`오른쪽 칸 → ${tab}`),
    openPlans: () => setLine("기획서 열기"),
    toast: (text: string) => setLine(`토스트: ${text}`),
  } as unknown as ShellNav;
  const thread = useDraftThread(daemon, "p-2001", null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  return (
    <div id={`fixture-${id}`} style={{ width: FRAME_W }}>
      <div style={{ font: "12px/1.45 monospace", color: "#888", margin: "0 0 4px", minHeight: 34 }}>
        {id}
        <br />→ {line}
      </div>
      {/* .nx 는 셸의 두 열 격자(사이드바 + 본문)다 — 대화 칸만 보이는 견본은 평범한 문서로 푼다(다른 견본과 같다). */}
      <div
        className="nx"
        style={{ display: "block", height: FRAME_H, overflow: "auto", border: "1px dashed #8884" }}
      >
        <div
          className="nx-pl-view"
          data-chat="on"
          data-tab="chat"
          style={{ "--nx-pl-chat-w": `${FRAME_W}px` } as CSSProperties}
        >
          <PlanChat
            daemon={daemon}
            nav={nav}
            docKey="p-2001"
            pageId="2001"
            docTitle="[정책서] 주문 접수"
            thread={thread}
            draft={null}
            inputRef={inputRef}
            conversation={null}
            pickedThreadId={null}
            pickThread={() => {}}
            onShowInDoc={(ids) => setLine(`문서에서 보기 ${ids.join(",")}`)}
            onConversationsChanged={() => {}}
          />
        </div>
      </div>
    </div>
  );
}

function Frame({ id }: { id: string }) {
  // A안 부품 사진(2026-11-03) — 어긋남 카드와 판정 실패 줄은 전체 칸이 아니라 곧장 그리는 장면으로 본다.
  if (id === "mismatch-doc") return <MismatchDocFrame id={id} />;
  if (id === "mismatch-chat" || id === "mismatch-failed") return <MismatchChatFrame id={id} />;
  return <PlansFrame id={id} />;
}

function PlansFrame({ id }: { id: string }) {
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
  const plans = usePlansWorkspace({ daemon, project, active: true });
  return (
    <PlansContext.Provider value={plans}>
      <div id={`fixture-${id}`} style={{ width: FRAME_W }}>
        <div
          style={{ font: "12px/1.45 monospace", color: "#888", margin: "0 0 4px", minHeight: 34 }}
        >
          {id}
          <br />→ {line}
        </div>
        <div
          className="nx"
          style={{
            display: "grid",
            gridTemplateColumns: NARROW ? "minmax(0, 1fr)" : "320px minmax(0, 1fr)",
            height: FRAME_H,
            width: FRAME_W,
            overflow: "hidden",
            border: "1px dashed #8884",
          }}
        >
          {!NARROW && (
            <aside className="nx-sidebar" style={{ width: 320 }}>
              <PlansSidebar nav={nav} daemon={daemon} />
            </aside>
          )}
          <main className="nx-main">
            <PlansColumn daemon={daemon} project={project} nav={nav} />
          </main>
        </div>
      </div>
    </PlansContext.Provider>
  );
}

/** 실제 셸의 이동·마운트·지연 읽기 확인(2026-10-23 화면 전면 재설계 §9). */
function WorkspaceCase() {
  const { settings, update } = useSettings();
  const [slug, setSlug] = useState("colonova-cdp");
  const daemon = useMemo(() => {
    const requests: string[] = [];
    const plan = daemonFor("list", (line) => requests.push(line));
    const projects = [
      { ...PROJECTS[0], ...projectFor("list"), pendingCount: 0, threads: [], working: false },
      { ...PROJECTS[1], confluence: undefined, pendingCount: 0, threads: [], working: false },
    ];
    const base = mockDaemon({
      projects,
      activeSlug: slug,
      repo: { ...REPO, pendingChanges: 0, cycleScreens: [] },
      status: { ...STATUS, projects, activeProject: slug },
      onDraftEvent: plan.onDraftEvent,
    });
    const api = new Proxy(base.api, {
      get(target, key: keyof Daemon["api"]) {
        if (key === "projectActivate") return async (next: string) => setSlug(next);
        if (key === "listSessions" || key === "history") return async () => [];
        if (key in plan.api)
          return (...args: unknown[]) => {
            requests.push(String(key));
            return (plan.api[key] as (...input: unknown[]) => unknown)(...args);
          };
        return target[key];
      },
    });
    return { ...base, api, fixtureRequests: requests };
  }, [slug]);
  useEffect(() => {
    (window as unknown as { __plansFixture: { requests: string[] } }).__plansFixture = {
      requests: daemon.fixtureRequests,
    };
  }, [daemon]);
  return (
    <Workspace
      daemon={daemon}
      settings={settings}
      onChatChange={(patch) => update({ chat: { ...settings.chat, ...patch } })}
      onLayoutChange={(patch) => update({ layout: { ...settings.layout, ...patch } })}
      onSettingsChange={update}
      onRenameSession={() => {}}
      discardableInvitePath="/fixture/invite.json"
    />
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    {query.get("workspace") === "1" ? (
      <WorkspaceCase />
    ) : (
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
    )}
  </StrictMode>,
);
