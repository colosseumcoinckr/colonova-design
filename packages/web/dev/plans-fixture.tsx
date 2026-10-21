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
 * 문서 행을 누르면 본문이 서고, `새로 가져오기` 는 1.2초 뒤 끝난다. 새 상태는 여기에 더한다.
 *   · none        — 아직 연결하지 않은 프로젝트(원장 없음)
 *   · empty       — 연결했지만 가져온 문서가 없다
 *   · list        — 가져온 문서 28개(중첩 경로 · 판 번호)
 *   · list-loading · list-failed — 목록 읽기가 끝나지 않거나 실패
 *   · doc-slow · doc-failed      — 문서 읽기가 6초 걸리거나 실패
 *   · import-slow · import-failed — `새로 가져오기` 가 오래 걸리거나 실패
 *   · expired     — 만료된 연결(토큰이 끊겨 다시 연결이 필요)
 *   · expired-empty — 만료된 연결 + 가져온 문서 없음(안내 한 장이 `설정 열기` 로 길을 건넨다)
 *   · big         — 문서 500개 · 폴더 깊이 6 · 아주 긴 제목(상한 규모의 목록 — 말줄임 · 들여쓰기 · 접기가 버티는지)
 */

import type { ProjectSummary } from "@colonova-design/protocol";
import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Daemon } from "../src/lib/daemon-client";
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

const COMMENTS = [
  {
    author: "김기획",
    body: "7일 이내로 정해진 근거가 어디 있나요? 운영 쪽 기준과 다른 것 같아요.",
    createdAt: ago(60 * 5),
    anchorText: "취소는 승인 필요",
  },
  {
    author: "",
    body: "표의 비고 칸이 비어 있어요. 확정 전 취소는 누가 승인하나요?",
    createdAt: ago(60 * 30),
    anchorText: null,
  },
  {
    author: "박운영",
    body: "야간 접수분은 다음 영업일 09시에 확정으로 합의했어요. 미결에서 지워도 됩니다.",
    createdAt: ago(60 * 24 * 3),
    anchorText: "야간 접수분의 확정 시각",
  },
];

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
  return { ...base, confluence } as unknown as ProjectSummary;
}

function daemonFor(id: string, log: (line: string) => void): Daemon {
  const api = {
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
        comments: COMMENTS,
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
  };
  return { api, connection: "open" } as unknown as Daemon;
}

function Frame({ id }: { id: string }) {
  const [line, setLine] = useState("—");
  const daemon = useMemo(() => daemonFor(id, setLine), [id]);
  const project = useMemo(() => projectFor(id), [id]);
  const nav = {
    openSettings: () => setLine("설정 열기"),
    showPane: (pane: string) => setLine(`오른쪽 칸 → ${pane}`),
    openPlans: () => setLine("기획서 열기"),
    toast: (text: string) => setLine(`토스트: ${text}`),
  } as unknown as ShellNav;
  const columns = NARROW ? "minmax(0, 1fr)" : "340px minmax(0, 1fr)";
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
                  className="nx-chat"
                  style={{ padding: 24, font: "12px monospace", color: "#888" }}
                >
                  대화 칸 자리
                </section>
              )}
              <PlansColumn daemon={daemon} project={project} nav={nav} />
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
