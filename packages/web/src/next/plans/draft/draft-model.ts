import type {
  DraftBlockStatus,
  DraftBlockView,
  DraftTableCell,
  DraftTableRow,
} from "@colonova-design/protocol";
import { L } from "../../labels.ts";

/**
 * 초안 블록의 순수 도우미(2026-10-23 · 최종 구현 계획 F1) — 편집기의 읽기 화면과 고치는 칸이 쓰는
 * 판정만 산다. 시험이 src 에서 곧장 읽으므로 형제를 부르지 않고, 문장은 `labels.ts` 를 확장자와 함께
 * 읽는다(plans-list.ts 와 같은 모양).
 */

/** 토큰 안내의 한 줄 — 편집 칸 아래에 선다. */
export interface TokenLegendItem {
  name: string;
  label: string;
}

/** 표의 파이프 마크다운 — 셀 안의 줄바꿈은 ` / ` 로 한 줄에 눕힌다. */
function tableToMarkdown(rows: DraftTableRow[]): string {
  const head = rows[0]?.cells ?? [];
  if (head.length === 0) return "";
  const line = (cells: DraftTableCell[]) =>
    // 셀의 문단 경계(`\n\n`)와 줄바꿈(`\n`)은 읽기 표에서 ` / ` 하나로 잇는다 — 두 번 찍히지 않게(2026-10-23 화면 확인).
    `| ${cells.map((cell) => cell.text.replace(/\n+/g, " / ")).join(" | ")} |`;
  const body = rows.slice(1).map((row) => line(row.cells));
  return [line(head), `| ${head.map(() => "---").join(" | ")} |`, ...body].join("\n");
}

/**
 * 토큰을 사람의 말로 바꾼다. 혼자 오는 토큰(`⟦t1⟧`)은 `〔이름〕` 이 되고, 쌍 토큰
 * (`⟦c1⟧…⟦/c1⟧`)은 여닫는 표시를 빼고 안 글만 남는다 — 화면이 그 조각을 따로 그린다.
 */
function inlineWords(text: string, tokens: Record<string, string>): string {
  return text.replace(/⟦\/?([^⟧]+)⟧/g, (whole: string, name: string) => {
    if (whole.startsWith("⟦/")) return "";
    if (text.includes(`⟦/${name}⟧`)) return "";
    // 기계 이름을 모르면 막연한 Confluence 요소로 본다.
    return `〔${L.drafts.tokenLabel(tokens[name] ?? "element")}〕`;
  });
}

/** 읽기 화면의 마크다운 — preserved 는 화면이 따로 그리므로 빈 글이다. */
export function viewToMarkdown(view: DraftBlockView, tokens: Record<string, string>): string {
  if (view.kind === "preserved") return "";
  const raw =
    view.kind === "heading"
      ? `${"#".repeat(view.level)} ${view.text}`
      : view.kind === "paragraph"
        ? view.text
        : view.kind === "list"
          ? view.items.map((item, at) => (view.ordered ? `${at + 1}. ` : "- ") + item).join("\n")
          : tableToMarkdown(view.rows);
  return inlineWords(raw, tokens);
}

/** 글 안에 있는 토큰들 — 나타난 순서대로, 겹치는 이름은 한 번만. */
export function tokenLegend(text: string, tokens: Record<string, string>): TokenLegendItem[] {
  const seen = new Set<string>();
  const items: TokenLegendItem[] = [];
  for (const match of text.matchAll(/⟦\/?([^⟧]+)⟧/g)) {
    const name = match[1];
    if (name === undefined || name === "" || name.startsWith("/")) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    items.push({ name, label: L.drafts.tokenLabel(tokens[name] ?? "element") });
  }
  return items;
}

/** 목록 편집 칸의 값 — 항목마다 한 줄. */
export function listToText(items: string[]): string {
  return items.join("\n");
}

/** 목록 편집 칸의 값 — 한 줄에 한 항목, 빈 줄은 무시한다. */
export function textToList(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** 새 행 — 칸 수는 자리의 행에 맞추고, 머리가 아니라 빈 글이다. */
export function tableAddRow(rows: DraftTableRow[], at: number): DraftTableRow[] {
  const index = Math.max(0, Math.min(at, rows.length));
  const width = rows[index]?.cells.length ?? rows.at(-1)?.cells.length ?? 2;
  const cells = Array.from({ length: width }, () => ({ header: false, text: "" }));
  return [...rows.slice(0, index), { cells }, ...rows.slice(index)];
}

/** 행 빼기 — 마지막 한 줄은 표의 몸통이라 남긴다. */
export function tableRemoveRow(rows: DraftTableRow[], at: number): DraftTableRow[] {
  if (rows.length <= 1) return rows;
  return rows.filter((_, index) => index !== at);
}

/** 새 열 — 모든 행에 더하고, 머리 여부는 그 행의 첫 칸을 따른다. */
export function tableAddColumn(rows: DraftTableRow[]): DraftTableRow[] {
  if (rows.length === 0) {
    return [
      {
        cells: [
          { header: true, text: "" },
          { header: false, text: "" },
        ],
      },
    ];
  }
  return rows.map((row) => ({
    cells: [...row.cells, { header: row.cells[0]?.header ?? false, text: "" }],
  }));
}

/** 열 빼기 — 마지막 한 칸은 표의 몸통이라 남긴다. */
export function tableRemoveColumn(rows: DraftTableRow[], at: number): DraftTableRow[] {
  if ((rows[0]?.cells.length ?? 0) <= 1) return rows;
  return rows.map((row) => ({ cells: row.cells.filter((_, index) => index !== at) }));
}

/** 블록의 처지 배지 글 — `L.drafts.status*`. */
export function blockStatusLabel(status: DraftBlockStatus): string {
  if (status === "changed") return L.drafts.statusChanged;
  if (status === "new") return L.drafts.statusNew;
  if (status === "conflict") return L.drafts.statusConflict;
  return L.drafts.statusSame;
}
