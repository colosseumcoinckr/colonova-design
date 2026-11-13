import type { DraftBlockView, DraftEdit, DraftTableRow } from "@colonova-design/protocol";

/**
 * 직접 고치기의 마크다운 길(2026-11-02 사용자 지시) — 문단을 고르다가 `- ` · `# ` · `1. ` 를 치면
 * 목록 · 제목으로 바꾸고, `|` 로 쓴 표 모양은 표로, 서식 있는 붙여넣기는 문단 · 제목 · 목록 · 표로
 * 나눈다. 굵게 · 기울임 · 코드 · 링크는 데몬의 투영 방언(`**` · `*` · 백틱 · `[]()`) 그대로 왕복하므로
 * 이 모듈은 그 방언의 이스케이프를 `storage-blocks.ts` 의 `projectText` 와 같은 규칙으로 감싼다.
 * 순수 모듈이다 — DOM 은 좁은 구조(DomLike)로 받아 시험은 가짜 나무로 돌린다.
 */

/** 투영의 마크다운 특수 글자 — 앞에 `\` 를 붙인다(데몬 SPECIAL_CHARS 와 같은 눈금). */
const SPECIAL_CHARS: Record<string, true> = {
  "\\": true,
  "*": true,
  "`": true,
  "[": true,
  "]": true,
  "⟦": true,
  "⟧": true,
};

/** 붙여넣은 글의 글자 — 특수 글자를 감싸고 줄바꿈은 한 칸으로 한다(텍스트 마디의 계약). */
export function escapeText(text: string): string {
  let out = "";
  for (const ch of text.replace(/[\r\n]/g, " ")) {
    out += SPECIAL_CHARS[ch] === true ? `\\${ch}` : ch;
  }
  return out;
}

/** 링크 주소의 괄호 · 공백 · 백슬래시는 낱글자로 지켜낸다(데몬과 같은 규칙). */
export function escapeHref(href: string): string {
  return href.replace(/[\\()\t\n\r ]/g, (ch) => `\\${ch}`);
}

function isWs(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

/** 강조 표지 — 경계 공백은 표지 밖으로 옮기고 빈 강조는 표지 없이 한다(데몬 wrapDelims 와 같은 결). */
function wrapDelims(inner: string, count: 1 | 2): string {
  let body = inner;
  let lead = "";
  let tail = "";
  while (body !== "" && isWs(body.charAt(0))) {
    lead += body.charAt(0);
    body = body.slice(1);
  }
  while (body !== "" && isWs(body.charAt(body.length - 1))) {
    tail = body.charAt(body.length - 1) + tail;
    body = body.slice(0, -1);
  }
  if (body === "") return lead + tail;
  const delim = "*".repeat(count);
  return `${lead}${delim}${body}${delim}${tail}`;
}

// ————— 치던 글의 표식 — 문단이 다른 종류로 바뀌는 순간 —————

export interface TypedShift {
  kind: "heading" | "list";
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  ordered?: boolean;
  rest: string;
}

/**
 * 방금 머리에 표식을 친 순간인가 — `before` 의 맨앞에 `- ` · `# ` ~ `###### ` · `1. ` 를 보태면
 * `after` 가 되는 때만 참이다. 처음부터 표식으로 시작하던 글을 고치는 때에는 치지 않는다
 * (뜻하지 않은 변환을 막는다). 글이 있는 문단의 맨앞에 한 글자씩 칠 때는 표식만 든 중간 상태(`-원문`)
 * 을 지나므로, `before` 의 맨앞 표식 뒤에 공백이 보태진 모양도 인정한다(2026-11-02 실액 검증 —
 * 한 글자씩 치는 실제 타이핑에서 변환이 실패했다).
 */
export function typedShift(before: string, after: string): TypedShift | null {
  const heading = /^(#{1,6}) /u.exec(after);
  if (heading !== null) {
    const marks = heading[1] ?? "#";
    const rest = shiftRest(marks, before, after);
    if (rest !== null) {
      const level = Math.min(6, Math.max(1, marks.length)) as 1 | 2 | 3 | 4 | 5 | 6;
      return { kind: "heading", level, rest };
    }
  }
  const bullet = /^([-*]) /u.exec(after);
  if (bullet !== null) {
    const rest = shiftRest(bullet[1] ?? "-", before, after);
    if (rest !== null) return { kind: "list", ordered: false, rest };
  }
  const ordered = /^1\. /u.exec(after);
  if (ordered !== null) {
    const rest = shiftRest("1.", before, after);
    if (rest !== null) return { kind: "list", ordered: true, rest };
  }
  return null;
}

/** 표식 뒤의 글 — `after` 가 `표식+공백+rest` 면 `before` 는 `rest` 와 같거나(통째 침) `표식+rest`
 *  이어야 한다(한 글자씩 칠 때 표식만 든 중간 상태). 그 밖은 null. */
function shiftRest(marks: string, before: string, after: string): string | null {
  const body = after.slice(marks.length + 1);
  if (before === body) return body;
  if (before === marks + body) return body;
  return null;
}

// ————— 파이프 표 — 적용할 때 표로 읽는다 —————

/** 표의 한 줄인가 — 막대로 시작하거나 막대가 둘 이상이다. */
function pipeLine(line: string): boolean {
  if (line.startsWith("|")) return true;
  let bars = 0;
  for (const ch of line) if (ch === "|") bars += 1;
  return bars >= 2;
}

function pipeCells(line: string): string[] {
  const bare = line.replace(/^\|/, "").replace(/\|$/, "");
  return bare.split(/(?<!\\)\|/u).map((cell) => cell.trim().replace(/\\\|/gu, "|"));
}

/**
 * 막대 모양의 표인가 — 모든 줄이 표의 줄이고, 줄이 둘 이상이거나 막대로 싸인 한 줄이다. 둘째 줄이
 * `---` 줄이면 첫 줄을 머리 칸으로 읽는다(마크다운의 표 모양). 짧은 줄은 빈 칸으로 맞춘다.
 */
export function pipeTable(text: string): DraftTableRow[] | null {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length === 0 || !lines.every((line) => pipeLine(line))) return null;
  if (lines.length === 1 && !(lines[0] ?? "").startsWith("|")) return null;
  const split = lines.map(pipeCells);
  const separator = split.findIndex((cells) =>
    cells.every((cell) => cell !== "" && /^:?-{2,}:?$/u.test(cell)),
  );
  const body = separator >= 0 ? split.filter((_, at) => at !== separator) : split;
  if (body.length === 0) return null;
  const width = Math.max(...body.map((cells) => cells.length));
  return body.map((cells, at) => ({
    cells: Array.from({ length: width }, (_, column) => ({
      header: separator >= 0 && at === 0,
      text: cells[column] ?? "",
    })),
  }));
}

// ————— 붙여넣기 — HTML 을 투영 방언의 블록으로 —————

/** DOM 의 좁은 구조 — 브라우저의 요소 · 텍스트 마디가 그대로 들어맞고 시험은 가짜 나무를 준다. */
export interface DomLike {
  nodeType: number;
  nodeName: string;
  childNodes: ArrayLike<DomLike>;
  textContent: string | null;
  getAttribute?(name: string): string | null;
}

const ELEMENT = 1;
const TEXT = 3;

function tagOf(node: DomLike): string {
  return node.nodeName.toLowerCase();
}

function childrenOf(node: DomLike): DomLike[] {
  return Array.from(node.childNodes);
}

function hasElementChild(node: DomLike): boolean {
  return childrenOf(node).some((child) => child.nodeType === ELEMENT);
}

/** 블록을 여는 요소인가 — 이런 요소는 안의 글을 한 덩어리로 갖는다. */
const BLOCK_TAGS: Record<string, true> = {
  h1: true,
  h2: true,
  h3: true,
  h4: true,
  h5: true,
  h6: true,
  p: true,
  ul: true,
  ol: true,
  table: true,
  div: true,
  pre: true,
  blockquote: true,
  hr: true,
};

/** 안의 글 — 투영 방언으로. 굵게 · 기울임 · 코드 · 링크만 살고 나머지 꾸밈은 글로 내려앉는다. */
export function inlineText(node: DomLike): string {
  if (node.nodeType === TEXT) return escapeText(node.textContent ?? "");
  if (node.nodeType !== ELEMENT) return "";
  const children = (): string => childrenOf(node).map(inlineText).join("");
  const tag = tagOf(node);
  if (tag === "br") return "\n";
  if (tag === "strong" || tag === "b") return wrapDelims(children(), 2);
  if (tag === "em" || tag === "i") return wrapDelims(children(), 1);
  if (tag === "code" && !hasElementChild(node)) {
    const inner = children();
    return inner === "" ? "" : `\`${inner}\``;
  }
  if (tag === "a") {
    const href = node.getAttribute?.("href") ?? "";
    const label = children();
    if (href !== "" && label.trim() !== "") return `[${label}](${escapeHref(href)})`;
    return label;
  }
  return children();
}

const HEADINGS: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = {
  h1: 1,
  h2: 2,
  h3: 3,
  h4: 4,
  h5: 5,
  h6: 6,
};

/** 목록 항목의 글 — 항목을 품은 ul · ol 은 같은 목록의 항목으로 평평하게 이어진다(중첩은 못 담는다).
 *  제 글을 먼저 밀고 중첩 항목을 잇는다 — 문서의 읽는 순서 그대로. */
function listItemText(node: DomLike, items: string[]): void {
  let own = "";
  const flushOwn = () => {
    const text = own.trim();
    if (text !== "") items.push(text);
    own = "";
  };
  for (const child of childrenOf(node)) {
    const tag = child.nodeType === ELEMENT ? tagOf(child) : "";
    if (tag === "ul" || tag === "ol") {
      flushOwn();
      for (const inner of childrenOf(child)) {
        if (inner.nodeType === ELEMENT && tagOf(inner) === "li") listItemText(inner, items);
      }
      continue;
    }
    own += inlineText(child);
  }
  flushOwn();
}

/** 한 덩어리의 자손을 블록으로 — 문단 · 제목 · 목록 · 표, 나머지 꾸밈은 글로 평평하게. */
export function blocksFromDom(root: DomLike): DraftBlockView[] {
  const blocks: DraftBlockView[] = [];
  let loose = "";
  const flush = () => {
    const text = loose.trim();
    if (text !== "") blocks.push({ kind: "paragraph", text });
    loose = "";
  };
  for (const node of childrenOf(root)) {
    if (node.nodeType === TEXT) {
      loose += escapeText(node.textContent ?? "");
      continue;
    }
    if (node.nodeType !== ELEMENT) continue;
    const tag = tagOf(node);
    const heading = HEADINGS[tag];
    if (heading !== undefined) {
      flush();
      const text = inlineText(node).trim();
      if (text !== "") blocks.push({ kind: "heading", level: heading, text });
      continue;
    }
    if (tag === "p") {
      flush();
      const text = inlineText(node).trim();
      if (text !== "") blocks.push({ kind: "paragraph", text });
      continue;
    }
    if (tag === "ul" || tag === "ol" || tag === "li") {
      flush();
      const items: string[] = [];
      if (tag === "li") {
        listItemText(node, items);
      } else {
        for (const child of childrenOf(node)) {
          if (child.nodeType === ELEMENT && tagOf(child) === "li") listItemText(child, items);
        }
      }
      if (items.length > 0) blocks.push({ kind: "list", ordered: tag === "ol", items });
      continue;
    }
    if (tag === "table") {
      flush();
      const table = tableFromDom(node);
      if (table !== null) blocks.push(table);
      continue;
    }
    // div · 묶음 요소는 안을 다시 나누고, 나머지 인라인 꾸밈은 흐르는 글에 보탠다.
    if (childrenOf(node).some((child) => child.nodeType === ELEMENT && BLOCK_TAGS[tagOf(child)])) {
      flush();
      blocks.push(...blocksFromDom(node));
      continue;
    }
    loose += inlineText(node);
  }
  flush();
  return blocks;
}

/** 표 요소 → 표 블록 — 머리 칸은 th, 병합 칸은 글로만 남는다(투영은 병합을 담지 못한다). */
function tableFromDom(node: DomLike): DraftBlockView | null {
  const rows: DraftTableRow[] = [];
  const walk = (current: DomLike) => {
    for (const child of childrenOf(current)) {
      if (child.nodeType !== ELEMENT) continue;
      const tag = tagOf(child);
      if (tag === "tr") {
        const cells = childrenOf(child)
          .filter((cell) => cell.nodeType === ELEMENT && ["th", "td"].includes(tagOf(cell)))
          .map((cell) => ({ header: tagOf(cell) === "th", text: inlineText(cell).trim() }));
        if (cells.length > 0) rows.push({ cells });
        continue;
      }
      // thead · tbody · tfoot 은 지나가서 줄을 모은다.
      if (tag === "thead" || tag === "tbody" || tag === "tfoot") walk(child);
    }
  };
  walk(node);
  if (rows.length === 0) return null;
  const width = Math.max(...rows.map((row) => row.cells.length));
  return {
    kind: "table",
    rows: rows.map((row) => ({
      cells: Array.from(
        { length: width },
        (_, column) =>
          row.cells[column] ?? {
            header: false,
            text: "",
          },
      ),
    })),
  };
}

/** 클립보드의 HTML 을 블록으로 — DOMParser 가 없는 자리(시험)는 null 을 돌려 부른 쪽이 글로 붙인다. */
export function clipboardBlocks(html: string): DraftBlockView[] | null {
  const parser = (globalThis as { DOMParser?: unknown }).DOMParser;
  if (typeof parser !== "function") return null;
  type Parsed = { parseFromString(markup: string, type: string): { body: DomLike } };
  try {
    const doc = new (parser as new () => Parsed)().parseFromString(html, "text/html");
    return blocksFromDom(doc.body);
  } catch {
    return null;
  }
}

/** 붙여넣은 여러 블록을 한 요청에 싣는 걸음 — 같은 닻의 insert 는 데몬이 닻 바로 다음에 끼우므로
 *  역순으로 쌓아야 붙은 순서 그대로 선다(두 번째 insert 가 첫 것을 밀어내기 때문). */
export function insertEdits(blockId: string, views: readonly DraftBlockView[]): DraftEdit[] {
  const edits: DraftEdit[] = [];
  for (let at = views.length - 1; at >= 0; at -= 1) {
    const view = views[at];
    if (view === undefined) continue;
    edits.push({ type: "insert", afterBlockId: blockId, view });
  }
  return edits;
}
