import type { DocBlock, DocInline, DocSearchHit } from "@colonova-design/protocol";
import { L } from "../../labels.ts";

/**
 * 기획서 보기의 순수 판정(2026-10-30 사용자 요청 — 기획서 칸에서 Confluence 기능을 가능한 한 온전히).
 * 시험은 리액트 없이 src 에서 곧장 읽는다 — 그래서 형제 import 는 `.ts` 를 붙인다.
 */

/** 나무를 걷는다 — 목록 · 표 · 상자 · 펼치기 · 단의 안까지. */
export function eachDocBlock(blocks: readonly DocBlock[], visit: (block: DocBlock) => void): void {
  for (const one of blocks) {
    visit(one);
    if (one.t === "list") for (const item of one.items) eachDocBlock(item, visit);
    else if (one.t === "table") {
      for (const row of one.rows) for (const cell of row.cells) eachDocBlock(cell.blocks, visit);
    } else if (one.t === "quote" || one.t === "panel" || one.t === "expand") {
      eachDocBlock(one.blocks, visit);
    } else if (one.t === "columns") {
      for (const column of one.columns) eachDocBlock(column, visit);
    }
  }
}

/** 글 속 조각까지 걷는다. */
function eachDocInline(blocks: readonly DocBlock[], visit: (inline: DocInline) => void): void {
  const walk = (list: readonly DocInline[]): void => {
    for (const item of list) {
      visit(item);
      if (item.t === "mark" || item.t === "link" || item.t === "page") walk(item.children);
    }
  };
  eachDocBlock(blocks, (one) => {
    if (one.t === "heading" || one.t === "p") walk(one.children);
    else if (one.t === "tasks") for (const item of one.items) walk(item.children);
  });
}

/**
 * 이 앱이 그리지 못한 매크로의 이름 — 본문 위 알림 상자가 말한다(같은 이름은 한 번, 이름 없는 끊김 표시는
 * 빼다). 비면 알림 상자가 서지 않는다.
 */
export function unknownMacros(blocks: readonly DocBlock[]): string[] {
  const names = new Set<string>();
  eachDocBlock(blocks, (one) => {
    if (one.t === "macro" && one.name !== "") names.add(one.name);
  });
  eachDocInline(blocks, (item) => {
    if (item.t === "macro" && item.name !== "") names.add(item.name);
  });
  return [...names];
}

/** 조각들의 맨 글 — 목차 이름 · 제목 찾기에 쓴다. */
export function docInlineText(list: readonly DocInline[]): string {
  let out = "";
  for (const item of list) {
    if (item.t === "text") out += item.text;
    else if (item.t === "mark" || item.t === "link" || item.t === "page")
      out += docInlineText(item.children);
    else if (item.t === "status" || item.t === "emoji") out += item.text;
    else if (item.t === "date") out += item.value;
    else if (item.t === "mention") out += `@${item.name ?? ""}`;
  }
  return out;
}

/** 목차 줄의 들여쓰기 — 목차에서 가장 얕은 제목을 0 으로 센다. */
export function tocDepths(entries: ReadonlyArray<{ level: number }>): number[] {
  const least = entries.reduce((min, entry) => Math.min(min, entry.level), 7);
  return entries.map((entry) => Math.max(0, entry.level - least));
}

/** 그림으로 그릴 수 있는 종류인가 — 받은 바이트를 img 로 그리는 종류만(svg 는 빼다 — 글자 속 스크립트를 들이지 않는다). */
export function isImageType(mediaType: string): boolean {
  return /^image\/(?:png|jpe?g|gif|webp|bmp|avif)$/iu.test(mediaType.trim());
}

/** 첨부 그림의 기억 열쇠 — 같은 문서의 같은 파일은 한 번만 받는다. */
export function attachmentKey(pageId: string, filename: string): string {
  return `${pageId}\u0000${filename.normalize("NFC")}`;
}

/** 라벨 이름의 문제 — 데몬의 labelNameProblem 과 같은 규칙에 이미 있는 라벨을 더한다. */
export type LabelProblem = "empty" | "too-long" | "invalid-char" | "duplicate";

const LABEL_FORBIDDEN = /[\s:;,.?&[\]()#^*@!<>"'\\|{}%$+=~`]/u;

export function labelProblem(name: string, existing: readonly string[]): LabelProblem | null {
  const trimmed = name.trim();
  if (trimmed === "") return "empty";
  if (trimmed.length > 255) return "too-long";
  if (LABEL_FORBIDDEN.test(trimmed)) return "invalid-char";
  const lowered = trimmed.toLowerCase();
  if (existing.some((label) => label.toLowerCase() === lowered)) return "duplicate";
  return null;
}

/** 라벨 쓰기의 결과 → 한 줄. 적용됨은 null(알림은 부르는 쪽이 세운다). */
export function labelResultLine(result: { state: string; detail: string }): string | null {
  if (result.state === "applied") return null;
  if (result.state === "unknown") return L.confluence.labelUnknown;
  const reason = L.confluence.labelReason[result.detail as keyof typeof L.confluence.labelReason];
  return reason ?? L.confluence.labelFailed;
}

/** 본문 찾기의 결과 가운데 제목 찾기가 이미 보인 문서는 뺀다 — 같은 문서가 두 번 서지 않게. */
export function bodyOnlyHits(
  hits: readonly DocSearchHit[],
  titleIds: ReadonlySet<string>,
): DocSearchHit[] {
  return hits.filter((hit) => !titleIds.has(hit.pageId));
}

/** 미리 보기 글을 맞은 조각마다 갈라 강조한다 — 대소문자를 가리지 않는다. */
export function highlightParts(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const tokens = query.normalize("NFC").toLowerCase().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0 || text === "") return [{ text, hit: false }];
  const lowered = text.normalize("NFC").toLowerCase();
  const marks = new Array<boolean>(text.length).fill(false);
  // NFC 로 길이가 바뀌는 글(조합형 한글)은 강조 없이 그대로 둔다.
  if (lowered.length !== text.length) return [{ text, hit: false }];
  for (const token of tokens) {
    let from = 0;
    for (;;) {
      const at = lowered.indexOf(token, from);
      if (at === -1) break;
      for (let i = at; i < at + token.length; i += 1) marks[i] = true;
      from = at + token.length;
    }
  }
  const parts: Array<{ text: string; hit: boolean }> = [];
  for (let i = 0; i < text.length; i += 1) {
    const hit = marks[i] === true;
    const last = parts[parts.length - 1];
    if (last !== undefined && last.hit === hit) last.text += text.charAt(i);
    else parts.push({ text: text.charAt(i), hit });
  }
  return parts;
}

/** 울타리 코드 — 몸에 역따옴표가 있으면 울타리를 한 칸 더 길게(공용 마크다운이 그린다). */
export function fencedCode(text: string, language: string | null): string {
  let longest = 0;
  for (const run of text.matchAll(/`+/gu)) longest = Math.max(longest, run[0].length);
  const fence = "`".repeat(Math.max(3, longest + 1));
  const label = language === null ? "" : language.replace(/[^\w+#.-]/gu, "");
  return `${fence}${label}\n${text}\n${fence}`;
}
