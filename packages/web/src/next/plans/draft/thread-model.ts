import type { DraftBlock, DraftOp } from "@colonova-design/protocol";
import { L } from "../../labels.ts";
import type { PlanListRow } from "../plans-list.ts";
import { viewToMarkdown } from "./draft-model.ts";
import { DRAFT_LIMITS } from "./limits.ts";

/**
 * 기획 대화의 순수 도우미(2026-10-23 · 최종 구현 계획 F1) — 남은 걸음의 한 줄 요약과 근거 고르기의
 * 후보 · 절 나누기를 리액트 없이 잰다. 채택 판정(openOpIds · selectableOpIds)과 견주기 두 쪽(opCompare),
 * 다시 요청의 근거 되찾기(reaskRefs)는 채택 걸음과 함께 걷혔다(2026-10-31 · 2026-11-02 D11 정리).
 * 시험은 src 에서 곧장 읽으므로 문장은 `labels.ts` 를 확장자와 함께 읽는다(draft-model.ts 와 같은 모양).
 */

/** 요약 줄이 끊는 글자 수 — 블록의 투영 글에서 머리만 보인다. */
const HEAD_LIMIT = 40;

/**
 * 블록의 머리 글 — 투영 마크다운의 첫 줄에서 표시 문자(제목 · 목록)를 벗기고 끊는다. 토큰은 사람의
 * 말로 바꾸고(예: ⟦t1⟧ → 정보 상자), 보존 조각은 이름표 하나로 대신한다.
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
export type RefSectionsPick = { sections: string[] } | { error: string };

/**
 * 절 체크목록에 올릴 머리말(2026-11-12 근거 절 체크목록) — 고른 문서의 실제 절 머리에서 빈 머리와
 * 선로 이름 한계(200자)보다 긴 머리를 빼고 같은 머리는 한 번만 남긴다.
 */
export function refSectionOptions(sections: ReadonlyArray<{ heading: string }>): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const { heading } of sections) {
    const name = heading.trim();
    if (name === "" || name.length > DRAFT_LIMITS.sectionLength || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * 절 체크목록의 한 걸음(같은 날) — 절이 문서에서 서 있는 순서를 지키고, 절 20개 한계를 넘으면
 * 목록 대신 이유를 돌려준다(옛 자유 입력의 눈금을 그대로 잇는다).
 */
export function toggleRefSection(
  headings: readonly string[],
  picked: readonly string[],
  heading: string,
): RefSectionsPick {
  if (picked.includes(heading)) return { sections: picked.filter((one) => one !== heading) };
  if (picked.length >= DRAFT_LIMITS.sectionCount) return { error: L.drafts.limitSectionCount };
  return { sections: headings.filter((one) => one === heading || picked.includes(one)) };
}
