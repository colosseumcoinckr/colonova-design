/**
 * 기획서 문서의 보기 모양과 Confluence 기능 확장의 선로(2026-10-30 사용자 요청 — 기획서 칸에서
 * Confluence 기능을 가능한 한 온전히). 데몬이 저장 포맷을 읽어 화면이 곧장 그리는 블록 나무로 내린다 —
 * 정보 상자 · 상태 알약 · 펼치기 · 코드 · 목차 · 그림 · 단 나눔이 그 안에 산다. 모르는 매크로는
 * `macro` 블록으로 자리만 남는다(기존 `Confluence 전용` 자리 표시).
 *
 * 첨부 바이트는 데몬이 앱의 Confluence 자격으로 받아 건넨다 — 토큰은 웹 · AI 어디에도 가지 않는다.
 * 라벨 쓰기는 발행 게이트(COLONOVA_DESIGN_CONFLUENCE_PUBLISH=1)가 켜졌을 때만 열리고, 같은 명령
 * 아이디의 재전송은 저장된 결과로 답한다(결과를 모르면 다시 보내지 않는다). 영구 삭제 길은 없다.
 * 프로토콜 판은 올리지 않는다 — 요청은 새 종류로, 답은 선택 필드로 더한다.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// 보기 블록 — 데몬 → 웹(평범한 타입)
// ---------------------------------------------------------------------------

/** 상태 알약의 색 — Confluence 의 status 매크로 색(모르면 grey). */
export type DocStatusColor = "grey" | "red" | "yellow" | "green" | "blue" | "purple";

/** 그림이 가리키는 곳 — 이 문서의 첨부이거나 바깥 주소다. 다른 문서의 첨부는 `other: true` 로 자리만. */
export type DocImageSource =
  | { kind: "attachment"; filename: string; other?: boolean }
  | { kind: "url"; url: string };

export interface DocImage {
  source: DocImageSource;
  alt: string | null;
  /** 저장 포맷의 `ac:width` — 화면 폭을 넘으면 화면이 줄인다. */
  width: number | null;
}

/** 한 줄 안의 조각. */
export type DocInline =
  | { t: "text"; text: string }
  | { t: "mark"; mark: "b" | "i" | "u" | "s" | "code" | "sub" | "sup"; children: DocInline[] }
  /** 바깥 링크 — href 는 http(s) · mailto 만 실린다. */
  | { t: "link"; href: string; children: DocInline[] }
  /** 다른 기획 문서로 가는 링크 — 제목으로 목록에서 찾는다. */
  | { t: "page"; title: string; children: DocInline[] }
  | { t: "attachment"; filename: string }
  /** 멘션 — 데몬이 이름을 풀어 싣는다(못 풀면 null). id 는 이름을 풀기 전의 계정 id 다. */
  | { t: "mention"; name: string | null; id?: string }
  | { t: "status"; text: string; color: DocStatusColor; subtle: boolean }
  | { t: "image"; image: DocImage }
  | { t: "date"; value: string }
  | { t: "emoji"; text: string }
  | { t: "br" }
  /** 이 앱이 모르는 인라인 매크로 — 자리만(`Confluence 전용 · 이름`). */
  | { t: "macro"; name: string };

/** 패널의 결 — info · note · warning · tip 과 무색 panel, 새 편집기의 success · error. */
export type DocPanelTone = "info" | "note" | "warning" | "tip" | "success" | "error" | "panel";

export interface DocTableCell {
  header: boolean;
  colspan?: number;
  rowspan?: number;
  blocks: DocBlock[];
}

/** 한 덩어리. */
export type DocBlock =
  | { t: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: DocInline[] }
  | { t: "p"; children: DocInline[] }
  | { t: "list"; ordered: boolean; items: DocBlock[][] }
  | { t: "tasks"; items: Array<{ done: boolean; children: DocInline[] }> }
  | { t: "table"; rows: Array<{ cells: DocTableCell[] }> }
  | { t: "quote"; blocks: DocBlock[] }
  | { t: "hr" }
  | { t: "code"; language: string | null; title: string | null; text: string }
  | { t: "panel"; tone: DocPanelTone; title: string | null; blocks: DocBlock[] }
  | { t: "expand"; title: string | null; blocks: DocBlock[] }
  /** 목차 — 데몬이 문서의 제목을 모아 싣는다(minLevel · maxLevel 매개변수를 지킨다). */
  | { t: "toc"; entries: Array<{ level: number; text: string }> }
  | { t: "image"; image: DocImage }
  /** ac:layout — 칸마다 블록 줄. 좁은 화면은 위아래로 선다. */
  | { t: "columns"; columns: DocBlock[][] }
  /** 이 앱이 모르는 블록 매크로 — 자리만(`Confluence 전용 · 이름`). */
  | { t: "macro"; name: string };

// ---------------------------------------------------------------------------
// 문서의 곁 — 라벨 · 첨부 · 판 기록 · 본문 찾기
// ---------------------------------------------------------------------------

export interface DocLabel {
  name: string;
  /** global · my · team — 화면은 global 만 고친다. */
  prefix: string;
}

export interface DocAttachment {
  id: string;
  title: string;
  mediaType: string | null;
  /** 바이트 수 — 모르면 null. */
  size: number | null;
  createdAt: string | null;
}

export interface DocVersion {
  number: number;
  /** 쓴 사람의 이름 — 모르면 빈 글. */
  author: string;
  createdAt: string | null;
  message: string;
  minorEdit: boolean;
}

/** 본문 찾기의 한 줄 — 가져온 사본에서 찾는다. snippet 은 맞은 자리 앞뒤의 짧은 글이다. */
export interface DocSearchHit {
  pageId: string;
  title: string;
  snippet: string;
}

/** 첨부 한 벌 — base64 로 실린 바이트. 상한을 넘으면 tooLarge 이고 data 는 빈 글이다. */
export interface DocAttachmentData {
  filename: string;
  mediaType: string;
  size: number;
  tooLarge: boolean;
  data: string;
}

/** 라벨 쓰기의 결과 — `unknown` 은 적용됐는지 모른다(자동 재전송 없음 — 코멘트와 같은 약속). */
export interface DocLabelResult {
  commandId: string;
  state: "applied" | "failed" | "unknown";
  detail: string;
}

/** 옛 판 한 장 — 읽기 전용. */
export interface DocVersionBody {
  version: number;
  title: string;
  view: DocBlock[];
}

/** 첨부 바이트의 상한 — 선로 한 번에 싣는 크기(10MB). 넘으면 Confluence 에서 받게 한다. */
export const DOC_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// 선로 요청의 검사(2026-10-30) — 소켓 입구에서 모양과 한계값을 좁힌다.
// ---------------------------------------------------------------------------

const withId = { id: z.string().min(1) };

/** Confluence 페이지의 id — 숫자 1~20자(doc-ops.ts 의 검사와 같은 모양). */
const pageIdSchema = z.string().regex(/^\d{1,20}$/);

/** 쓰기 명령의 열쇠 — 소문자 UUID(재전송이 두 번 쓰지 않게 하는 멱등 키). */
const commandIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

/** 라벨 이름 — 빈칸 없이 1~255자. 글자 규칙은 데몬이 한 번 더 본다(labelNameProblem). */
const labelSchema = z.string().min(1).max(255).regex(/^\S+$/u);

/**
 * Confluence 기능 확장의 요청 스키마 — messages.ts 의 클라이언트 합집합 끝에 펼쳐 넣는다.
 */
export const docViewClientMessageSchemas = [
  /** 이 문서의 첨부 한 벌 — 파일 이름으로 고른다. 그림 · 내려받기가 같은 문이다. */
  z.object({
    ...withId,
    type: z.literal("doc.attachment.read"),
    pageId: pageIdSchema,
    filename: z.string().min(1).max(255),
  }),
  z.object({
    ...withId,
    type: z.literal("doc.label.add"),
    pageId: pageIdSchema,
    commandId: commandIdSchema,
    label: labelSchema,
  }),
  z.object({
    ...withId,
    type: z.literal("doc.label.remove"),
    pageId: pageIdSchema,
    commandId: commandIdSchema,
    label: labelSchema,
  }),
  /** 판 기록 — 최근 것부터. */
  z.object({ ...withId, type: z.literal("doc.versions"), pageId: pageIdSchema }),
  /** 옛 판 한 장 읽기 — 읽기 전용 보기 블록으로 답한다. */
  z.object({
    ...withId,
    type: z.literal("doc.version.read"),
    pageId: pageIdSchema,
    version: z.number().int().min(1),
  }),
  /** 본문 찾기 — 가져온 사본(프로젝트 데이터의 confluence/)에서 찾는다. */
  z.object({
    ...withId,
    type: z.literal("doc.search"),
    query: z.string().min(1).max(200),
  }),
  /**
   * 초안의 보존 블록 그림 — 이 앱이 고치지 못하는 블록(정보 상자 · 병합 표 …)을 편집기가 읽기 전용으로
   * 그린다. 답은 블록 id → 보기 블록이다. 초안을 바꾸지 않는다.
   */
  z.object({
    ...withId,
    type: z.literal("doc.blockPreview"),
    docKey: z.string().regex(/^(?:p-\d{1,20}|n-[0-9a-f]{32})$/),
  }),
] as const;

/** 보존 블록 그림의 답 — 블록 id → 보기 블록. */
export interface DocBlockPreviews {
  previews: Record<string, DocBlock[]>;
}
