import type {
  DocOpPreview,
  DocOpResult,
  DraftBlock,
  DraftSnapshot,
} from "@colonova-design/protocol";
import { L } from "../../labels.ts";

/**
 * 문서 관리 · 근거 보내기의 순수 도우미(2026-10-23 · 최종 구현 계획 F3 · F4) — 창과 판이 보이는
 * 문장과 첨부의 모양을 판정한다. 시험이 src 에서 곧장 읽으므로 형제를 부르지 않고, 문장은
 * `labels.ts` 를 확장자와 함께 읽는다(publish-model.ts 와 같은 모양).
 */

/** 입력창 첨부 한 장 — `nx:composer:attach` 이벤트의 detail 이 바로 이 모양이다. */
export interface ComposerAttachDetail {
  attachments: Array<{ kind: "file"; name: string; mediaType: string; data: string }>;
}

/** 스냅샷의 첨부를 입력창의 첨부 모양으로 옮긴다 — 마크다운 한 장은 파일 첨부로 실린다. */
export function attachEventDetail(snapshot: DraftSnapshot): ComposerAttachDetail {
  const { name, mediaType, data } = snapshot.attachment;
  return { attachments: [{ kind: "file", name, mediaType, data }] };
}

/** 막는 이유의 사람 말 — 미리보기가 세운 순서 그대로다. */
export function docOpBlockerLines(preview: DocOpPreview): string[] {
  return (
    preview.blockers
      // 초안 안내(has-draft)는 막는 이유가 아니라 창의 안내 줄(nx-da-note)이 말한다(2026-10-23 화면 확인 ·
      // R2 검토 7) — 확인 단추를 여는 이유 목록에서는 뺀다.
      .filter((name) => name !== "has-draft")
      .map((name) => L.docOps.blocker[name])
  );
}

/** 결과 처지의 한 줄 — 마쳤음 · 모름 · 실패가 같은 문장을 쓴다(발행의 resultLine 과 같은 자리다). */
export function docOpResultLine(result: DocOpResult): string {
  if (result.state === "applied") return L.docOps.applied(result.op);
  if (result.state === "unknown") return L.docOps.unknown;
  return result.detail.trim() === "" ? L.docOps.failed : result.detail;
}

/** 복제의 처음 제목 — `<제목> 사본`, 이미 사본이면 사본 2 … 로 이어 붙인다. */
export function defaultCopyTitle(title: string): string {
  const suffix = L.docOps.copySuffix;
  const match = new RegExp(`^(.*) ${suffix}(?: (\\d+))?$`).exec(title.trim());
  if (match === null) return `${title} ${suffix}`;
  const base = match[1] ?? "";
  const round = Number.parseInt(match[2] ?? "1", 10);
  return `${base} ${L.docOps.copyRound(Number.isFinite(round) ? round + 1 : 2)}`;
}

/**
 * 초안 블록 중 제목 블록의 글 — 근거로 보낼 절의 목록. 토큰(`⟦…⟧`)을 벗기고, 벗긴 뒤 빈 제목은
 * 절의 이름이 아니므로 뺀다.
 */
export function headingSections(blocks: DraftBlock[]): string[] {
  const sections: string[] = [];
  for (const block of blocks) {
    if (block.view.kind !== "heading") continue;
    const text = block.view.text.replace(/⟦\/?[^⟧]*⟧/g, "").trim();
    if (text !== "") sections.push(text);
  }
  return sections;
}
