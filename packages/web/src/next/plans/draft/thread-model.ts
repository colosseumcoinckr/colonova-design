import type {
  DraftBlock,
  DraftMessage,
  DraftOp,
  DraftProposal,
  DraftReadRef,
} from "@colonova-design/protocol";
import { L } from "../../labels.ts";
import type { PlanListRow } from "../plans-list.ts";
import { viewToMarkdown } from "./draft-model.ts";
import { DRAFT_LIMITS } from "./limits.ts";

/**
 * 기획 대화의 순수 도우미(2026-10-23 · 최종 구현 계획 F1) — 변경안 걸음의 한 줄 요약과 채택 대상 판정,
 * 근거 고르기의 후보를 리액트 없이 잰다. 시험은 src 에서 곧장 읽으므로 문장은 `labels.ts` 를 확장자와
 * 함께 읽는다(draft-model.ts 와 같은 모양).
 */

/** 요약 줄이 끊는 글자 수 — 블록의 투영 글에서 머리만 보인다. */
const HEAD_LIMIT = 40;

/**
 * 블록의 머리 글 — 투영 마크다운의 첫 줄에서 표시 문자(제목 · 목록)를 벗기고 끊는다. 토큰은 사람의
 * 말로 바꾸고(예: ⟦t1⟧ → 〔정보 상자〕), 보존 조각은 이름표 하나로 대신한다.
 */
export function blockHead(block: DraftBlock): string {
  const line =
    block.view.kind === "preserved"
      ? L.drafts.tokenLabel(block.view.label)
      : (
          viewToMarkdown(block.view, block.tokens)
            .split("\n")
            .find((part) => part.trim() !== "") ?? ""
        )
          .replace(/^#{1,6}\s+/u, "")
          .replace(/^[-*]\s+/u, "")
          .replace(/^\d+\.\s+/u, "")
          // 요약 줄에서는 글 모양 표지(굵게 · 기울임 · 코드 · 링크)를 벗긴다 — 기호가 그대로 보이지 않게(2026-10-23 화면 확인).
          // 역따옴표는 유니코드 이스케이프로 쓴다(검사기가 정규식 속 역따옴표를 문자열의 시작으로 읽는다).
          .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
          .replace(/\*\*|\*|\u0060/gu, "")
          .replace(/\\(.)/gu, "$1");
  return line.length > HEAD_LIMIT ? `${line.slice(0, HEAD_LIMIT)}…` : line;
}

/** 걸음이 가리키는 블록의 머리 글 — 빈 글이면 `빈 블록` 으로 부른다. */
function namedHead(block: DraftBlock | undefined): string {
  if (block === undefined) return L.drafts.opMissing;
  const head = blockHead(block);
  return head === "" ? L.drafts.opBlank : head;
}

/**
 * 걸음 한 줄 요약 — 고침 · 더하기(앞 블록 또는 맨 앞) · 지우기 · 제목. 요약의 주인공은 블록의 머리 글이다.
 * 원래 자리의 블록이 사라졌으면(대개 오래된 걸음) 그 사실을 말한다.
 */
export function opSummary(op: DraftOp, blocks: readonly DraftBlock[]): string {
  if (op.type === "title") return L.drafts.opTitle(op.title);
  if (op.type === "insert") {
    const at =
      op.afterBlockId === null ? -1 : blocks.findIndex((block) => block.id === op.afterBlockId);
    const anchor = at < 0 ? undefined : blocks[at];
    return L.drafts.opInsert(anchor === undefined ? null : namedHead(anchor));
  }
  const head = namedHead(blocks.find((block) => block.id === op.blockId));
  return op.type === "replace" ? L.drafts.opReplace(head) : L.drafts.opDelete(head);
}

/** 아직 결정되지 않은 걸음 — `모두 채택` · `거절` 단추가 한 번에 싣는다. */
export function openOpIds(proposal: DraftProposal): string[] {
  return proposal.ops.filter((op) => op.state === "open").map((op) => op.opId);
}

/** 지금 체크할 수 있는 걸음 — 열린 것뿐이다(채택함 · 거절함 · 오래됨 은 체크칸이 꺼진다). */
export function selectableOpIds(proposal: DraftProposal): string[] {
  return proposal.ops.filter((op) => op.state === "open").map((op) => op.opId);
}

/** 견주기의 두 쪽 — 투영 글과, 그 글이 빈 자리일 때 대신 서는 말(2026-10-25 UX 심화 사용). */
export interface OpCompare {
  before: string;
  after: string;
  /** 앞 쪽이 빈 자리일 때의 말 — 더하기는 새 자리라 `없음`, 원래 블록이 사라졌으면 그 이유를 말한다. */
  beforeEmpty: string;
  /** 뒤 쪽이 빈 자리일 때의 말 — 지우기는 `이 블록을 지워요`. */
  afterEmpty: string;
}

/**
 * 걸음의 견주기 두 쪽 — 카드의 짧은 견주기와 `크게 보기`의 큰 판이 같은 글을 쓴다(2026-10-25 UX 심화
 * 사용 · 칸이 좁아 접히는 견주기를 큰 판에서 나란히 본다). 토큰은 갈아 끼울 블록의 것을 쓰고 새 자리는
 * 이름을 모른다.
 */
export function opCompare(
  op: DraftOp,
  blocks: readonly DraftBlock[],
  currentTitle: string,
): OpCompare {
  const beforeBlock =
    op.type === "replace" || op.type === "delete"
      ? blocks.find((block) => block.id === op.blockId)
      : undefined;
  const tokens = op.type === "replace" ? (beforeBlock?.tokens ?? {}) : {};
  const before =
    op.type === "title"
      ? currentTitle
      : beforeBlock === undefined
        ? ""
        : viewToMarkdown(beforeBlock.view, beforeBlock.tokens);
  const after =
    op.type === "title"
      ? op.title
      : op.type === "replace" || op.type === "insert"
        ? viewToMarkdown(op.view, tokens)
        : "";
  return {
    before,
    after,
    beforeEmpty: op.type === "insert" ? L.drafts.noBlock : L.drafts.opMissing,
    afterEmpty: L.drafts.removedBlock,
  };
}

/** 근거 고르기의 후보 한 줄 — 목록의 문서 줄에서 제목 · 판 · 바로 위 폴더를 옮긴다. */
export interface DraftRefChoice {
  pageId: string;
  title: string;
  version: number;
  /** 바로 위 폴더의 이름 — 뿌리는 빈 글이다. */
  folder: string;
}

/**
 * 근거 후보 — 목록 줄에서 문서만 남기고(폴더 · Confluence 전용 항목은 빠진다), 찾는 말의 조각이
 * 제목과 폴더에 모두 맞는 줄을 고른다. 찾는 말이 비면 전부다.
 */
export function refChoices(rows: readonly PlanListRow[], query: string): DraftRefChoice[] {
  const tokens = query.normalize("NFC").toLowerCase().split(/\s+/u).filter(Boolean);
  return rows
    .filter((row) => row.kind === "doc")
    .filter((row) => {
      if (tokens.length === 0) return true;
      const hay = `${row.title}\n${row.folder}`.normalize("NFC").toLowerCase();
      return tokens.every((token) => hay.includes(token));
    })
    .map((row) => ({
      pageId: row.pageId,
      title: row.title,
      version: row.version,
      folder: row.folder,
    }));
}

/** 근거 절 고르기의 결과 — 절 목록 또는 선로의 한계를 말하는 이유 한 줄. */
export type RefSectionsParse = { sections: string[] } | { error: string };

/**
 * 절 이름 칸의 글을 절 목록으로 — 쉼표로 나누고 빈 조각은 뺀다. 선로의 한계(절 20개 · 이름 200자)를
 * 넘으면 목록 대신 이유를 돌려준다(2026-10-23 화면 확인 · R2 검토 3).
 */
export function parseRefSections(text: string): RefSectionsParse {
  const sections = text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (sections.length > DRAFT_LIMITS.sectionCount) return { error: L.drafts.limitSectionCount };
  if (sections.some((section) => section.length > DRAFT_LIMITS.sectionLength))
    return { error: L.drafts.limitSectionLength };
  return { sections };
}

/**
 * 다시 요청의 근거 — 변경안을 낳은 앞의 사람 메시지에서 근거를 다시 찾는다(2026-10-23 화면 확인 ·
 * R2 검토 6). AI 의 말에는 근거가 없으므로 같은 대화에서 그 앞의 사람 메시지를 본다. 사람 메시지가
 * 앞에 없거나 근거가 비었으면 빈 목록이다.
 */
export function reaskRefs(
  messages: readonly DraftMessage[],
  messageId: string,
): Array<DraftReadRef & { sections?: string[] }> {
  const at = messages.findIndex((message) => message.messageId === messageId);
  for (let index = at - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return (message.refs ?? []).map((ref) => ({ ...ref }));
  }
  return [];
}
