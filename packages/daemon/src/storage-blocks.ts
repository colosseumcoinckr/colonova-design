/**
 * 저장 포맷 블록 엔진(2026-10-23 · 최종 구현 계획 F1 · D1) — Confluence 저장 포맷(XHTML 비슷한 글)을
 * 블록으로 나누고, 블록을 사람이 고칠 투영(DraftBlockView)으로 보이고, 고친 투영을 다시 저장 포맷으로
 * 되돌린다. 핵심 약속: 바뀌지 않은 블록 · 셀 · 목록 항목 · 글은 원문 바이트 그대로 남는다.
 * 엔티티(&nbsp; · 숫자 엔티티)와 CDATA 때문에 엄격한 XML 파서는 쓰지 않고, 원문 위치를 기억하는
 * 작은 토크나이저를 직접 쓴다. 파일도 네트워크도 쓰지 않는 순수 모듈이다.
 */
import { createHash } from "node:crypto";
import type { DraftBlockView, DraftTableCell, DraftTableRow } from "@colonova-design/protocol";

export type StorageBlockKind = "heading" | "paragraph" | "list" | "table" | "preserved";

export interface StorageBlock {
  /** 기준 원문의 순번 `b<n>`(0부터, 문서 순서). 새 블록은 `n<12자 소문자 16진>`. */
  id: string;
  /** "main" 은 최상위. ac:layout 안이면 "L<섹션 순번>.<셀 순번>"(0부터). */
  slot: string;
  kind: StorageBlockKind;
  /** 이 블록의 원문(앞의 공백 · 줄바꿈 포함). 바꾸지 않은 블록은 바이트까지 같다. */
  xml: string;
}

export interface StorageDoc {
  /** 원문을 되살리는 틀 — 글 조각과 칸 자리가 번갈아 선다. */
  frame: Array<{ raw: string } | { slot: string }>;
  /** slot 별로 문서 순서. */
  blocks: StorageBlock[];
}

export interface BlockProjection {
  view: DraftBlockView;
  editable: boolean;
  tokens: Record<string, string>;
}

type HeadingView = Extract<DraftBlockView, { kind: "heading" }>;
type ParagraphView = Extract<DraftBlockView, { kind: "paragraph" }>;
type ListView = Extract<DraftBlockView, { kind: "list" }>;
type TableView = Extract<DraftBlockView, { kind: "table" }>;

// ---------- 원문 토크나이저 — 요소 · 글 · 주석 · CDATA 의 원문 조각을 기억한다 ----------

interface ScanAttr {
  name: string;
  rawValue: string;
}

interface ScanElem {
  kind: "elem";
  name: string;
  attrs: ScanAttr[];
  openSrc: string;
  closeSrc: string;
  selfClosing: boolean;
  children: ScanNode[];
  src: string;
}

interface ScanText {
  kind: "text";
  src: string;
}

/** 주석 · CDATA · 문서 타입 · 어긋난 닫기 태그 — 내용을 보존만 한다. */
interface ScanRaw {
  kind: "raw";
  src: string;
}

type ScanNode = ScanElem | ScanText | ScanRaw;

const VOID_ELEMENTS: Record<string, true> = {
  br: true,
  hr: true,
  img: true,
  col: true,
  input: true,
  meta: true,
  link: true,
};

/** 공백 판정 — U+00A0(&nbsp;) 는 내용 글자라 공백으로 세지 않는다. */
function isWs(src: string): boolean {
  return /^[\t\n\r ]*$/.test(src);
}

function isElem(node: ScanNode, name: string): node is ScanElem {
  return node.kind === "elem" && node.name.toLowerCase() === name;
}

function scanContent(
  src: string,
  pos: number,
  end: number,
  closer: string | null,
): { nodes: ScanNode[]; pos: number; closeSrc: string } {
  const nodes: ScanNode[] = [];
  const closeSrc = "";
  let at = pos;
  while (at < end) {
    if (src.startsWith("<!--", at)) {
      const stop = src.indexOf("-->", at + 4);
      const stopAt = stop === -1 ? end : stop + 3;
      nodes.push({ kind: "raw", src: src.slice(at, stopAt) });
      at = stopAt;
    } else if (src.startsWith("<![CDATA[", at)) {
      const stop = src.indexOf("]]>", at + 9);
      const stopAt = stop === -1 ? end : stop + 3;
      nodes.push({ kind: "raw", src: src.slice(at, stopAt) });
      at = stopAt;
    } else if (src.startsWith("<!", at) || src.startsWith("<?", at)) {
      const stop = src.indexOf(">", at);
      const stopAt = stop === -1 ? end : stop + 1;
      nodes.push({ kind: "raw", src: src.slice(at, stopAt) });
      at = stopAt;
    } else if (src.startsWith("</", at)) {
      const gt = src.indexOf(">", at);
      if (gt === -1) {
        nodes.push({ kind: "raw", src: src.slice(at, end) });
        return { nodes, pos: end, closeSrc };
      }
      const name = src
        .slice(at + 2, gt)
        .trim()
        .toLowerCase();
      const tagSrc = src.slice(at, gt + 1);
      at = gt + 1;
      if (closer !== null && name === closer) return { nodes, pos: at, closeSrc: tagSrc };
      nodes.push({ kind: "raw", src: tagSrc }); // 어긋난 닫기 태그는 조각으로 보존한다
    } else if (src.charAt(at) === "<" && /[A-Za-z]/.test(src.charAt(at + 1))) {
      // 여는 태그 — 이름 · 속성의 원문을 그대로 남긴다.
      const openStart = at;
      let i = at + 1;
      while (i < end && !/[\t\n\r />]/.test(src.charAt(i))) i += 1;
      const name = src.slice(at + 1, i);
      const attrs: ScanAttr[] = [];
      let selfClosing = false;
      while (i < end) {
        const attrStart = i;
        while (i < end && /[\t\n\r ]/.test(src.charAt(i))) i += 1;
        if (i >= end) break;
        const c = src.charAt(i);
        if (c === ">") {
          i += 1;
          break;
        }
        if (c === "/" && src.charAt(i + 1) === ">") {
          selfClosing = true;
          i += 2;
          break;
        }
        let j = i;
        while (j < end && !/[\t\n\r /=>]/.test(src.charAt(j))) j += 1;
        const attrName = src.slice(i, j);
        let k = j;
        while (k < end && /[\t\n\r ]/.test(src.charAt(k))) k += 1;
        let rawValue = "";
        if (src.charAt(k) === "=") {
          k += 1;
          while (k < end && /[\t\n\r ]/.test(src.charAt(k))) k += 1;
          const quote = src.charAt(k);
          if (quote === '"' || quote === "'") {
            const closeQuote = src.indexOf(quote, k + 1);
            const valueEnd = closeQuote === -1 ? end : closeQuote;
            rawValue = src.slice(k + 1, valueEnd);
            k = closeQuote === -1 ? end : closeQuote + 1;
          } else {
            let valueEnd = k;
            while (valueEnd < end && !/[\t\n\r >]/.test(src.charAt(valueEnd))) valueEnd += 1;
            rawValue = src.slice(k, valueEnd);
            k = valueEnd;
          }
        }
        if (attrName !== "") attrs.push({ name: attrName, rawValue });
        if (k <= attrStart) i = attrStart + 1;
        else i = k;
      }
      const openEnd = Math.min(i, end);
      const openSrc = src.slice(openStart, openEnd);
      const lower = name.toLowerCase();
      let elemEnd = openEnd;
      const children: ScanNode[] = [];
      let elemCloseSrc = "";
      const structuralSelfClose = selfClosing || VOID_ELEMENTS[lower] === true;
      if (!structuralSelfClose) {
        const inner = scanContent(src, openEnd, end, lower);
        children.push(...inner.nodes);
        elemCloseSrc = inner.closeSrc;
        elemEnd = inner.pos;
      }
      nodes.push({
        kind: "elem",
        name,
        attrs,
        openSrc,
        closeSrc: elemCloseSrc,
        selfClosing: structuralSelfClose,
        children,
        src: src.slice(openStart, elemEnd),
      });
      at = elemEnd;
    } else {
      let j = at;
      while (j < end && src.charAt(j) !== "<") j += 1;
      if (j === at) j += 1; // 태그로 읽지 못한 낱개 `<` 는 글 취급한다
      nodes.push({ kind: "text", src: src.slice(at, j) });
      at = j;
    }
  }
  return { nodes, pos: at, closeSrc };
}

function firstElem(nodes: ScanNode[]): ScanElem | null {
  for (const node of nodes) {
    if (node.kind === "elem") return node;
  }
  return null;
}

function leadingOf(nodes: ScanNode[], el: ScanElem | null): string {
  let out = "";
  for (const node of nodes) {
    if (node === el) break;
    out += node.src;
  }
  return out;
}

function elementChildren(node: ScanElem): ScanElem[] {
  return node.children.filter((child): child is ScanElem => child.kind === "elem");
}

function hasElementChild(node: ScanElem): boolean {
  return node.children.some((child) => child.kind === "elem");
}

function attrOf(node: ScanElem, name: string): string | null {
  const found = node.attrs.find((attr) => attr.name.toLowerCase() === name);
  return found === undefined ? null : decodeEntities(found.rawValue);
}

function hasBlockDescendant(node: ScanElem): boolean {
  for (const child of elementChildren(node)) {
    if (BLOCK_ELEMENTS[child.name.toLowerCase()] === true || hasBlockDescendant(child)) return true;
  }
  return false;
}

function hasTableDescendant(node: ScanElem): boolean {
  for (const child of elementChildren(node)) {
    if (child.name.toLowerCase() === "table" || hasTableDescendant(child)) return true;
  }
  return false;
}

// ---------- 엔티티 · 이스케이프 ----------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  trade: "™",
  deg: "°",
  plusmn: "±",
  middot: "·",
  bull: "•",
  sect: "§",
  para: "¶",
  times: "×",
  divide: "÷",
  frac12: "½",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
};

function decodeEntities(src: string): string {
  if (!src.includes("&")) return src;
  return src.replace(
    /&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);/g,
    (whole, body: string) => {
      if (body.startsWith("#")) {
        const code =
          body.charAt(1) === "x" || body.charAt(1) === "X"
            ? Number.parseInt(body.slice(2), 16)
            : Number.parseInt(body.slice(1), 10);
        if (Number.isFinite(code) && code >= 0 && code <= 0x10ffff)
          return String.fromCodePoint(code);
        return whole;
      }
      return NAMED_ENTITIES[body] ?? whole;
    },
  );
}

/** 투영의 마크다운 특수 글자 — 앞에 `\` 를 붙인다(2026-10-23 · F1). */
const SPECIAL_CHARS: Record<string, true> = {
  "\\": true,
  "*": true,
  "`": true,
  "[": true,
  "]": true,
  "⟦": true,
  "⟧": true,
};

function projectText(raw: string): string {
  const decoded = decodeEntities(raw).replace(/[\r\n]/g, " ");
  let out = "";
  for (const ch of decoded) out += SPECIAL_CHARS[ch] === true ? `\\${ch}` : ch;
  return out;
}

function trimProjection(src: string): string {
  return src.replace(/^[\t\n\r ]+/, "").replace(/[\t\n\r ]+$/, "");
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s: string): string {
  return escapeXml(s).replace(/"/g, "&quot;");
}

/** 여는 태그 원문에서 이름 뒤의 속성 조각(`<p style="x">` → ` style="x"`). */
function attrPart(openSrc: string, name: string): string {
  return openSrc.endsWith("/>")
    ? openSrc.slice(1 + name.length, -2)
    : openSrc.slice(1 + name.length, -1);
}

// ---------- 토큰 — 투영이 못 담는 인라인 조각의 자리 ----------

interface TokenInfo {
  name: string;
  label: string;
  single: boolean;
  /** 홑 토큰의 요소 원문. 쌍 토큰은 openSrc · closeSrc 를 쓴다. */
  source: string;
  openSrc: string;
  closeSrc: string;
}

interface TokenCollector {
  list: TokenInfo[];
  single(label: string, src: string): string;
  pair(kind: "p" | "c", label: string, openSrc: string, closeSrc: string): string;
}

function newCollector(): TokenCollector {
  const list: TokenInfo[] = [];
  const count = { t: 0, p: 0, c: 0 };
  return {
    list,
    single(label, tokenSrc) {
      count.t += 1;
      const name = `t${count.t}`;
      list.push({ name, label, single: true, source: tokenSrc, openSrc: "", closeSrc: "" });
      return name;
    },
    pair(kind, label, openSrc, closeSrc) {
      count[kind] += 1;
      const name = `${kind}${count[kind]}`;
      list.push({ name, label, single: false, source: "", openSrc, closeSrc });
      return name;
    },
  };
}

// ---------- 인라인 투영 ----------

/** 문단 · 제목 안에서 토큰으로 지켜야 할 요소들(2026-10-23 · F1). */
const ATOMIC_INLINE: Record<string, true> = {
  "ac:structured-macro": true,
  "ac:image": true,
  "ac:link": true,
  "ac:emoticon": true,
  time: true,
  "ac:placeholder": true,
};

/** 이 요소가 문단 · 제목 안에 보이면 투영을 포기한다(heading:complex · paragraph:complex). */
const BLOCK_ELEMENTS: Record<string, true> = {
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
  "ac:layout": true,
  "ac:task-list": true,
};

function linkLabel(node: ScanElem): string {
  const stack = elementChildren(node);
  while (stack.length > 0) {
    const cur = stack.shift();
    if (cur === undefined) break;
    const n = cur.name.toLowerCase();
    if (n === "ri:page") return "link:page";
    if (n === "ri:user") return "link:user";
    if (n === "ri:attachment") return "link:attachment";
    stack.push(...elementChildren(cur));
  }
  return "link";
}

function atomicLabel(node: ScanElem): string {
  const n = node.name.toLowerCase();
  if (n === "ac:structured-macro") {
    const name = attrOf(node, "ac:name");
    return name !== null && name !== "" ? `macro:${name}` : "element:ac:structured-macro";
  }
  if (n === "ac:image") return "image";
  if (n === "ac:link") return linkLabel(node);
  if (n === "ac:emoticon") return "emoticon";
  if (n === "time") return "date";
  if (n === "ac:placeholder") return "placeholder";
  return `element:${node.name}`;
}

/** 이탤릭 · 굵게 표지 — 경계 공백은 표지 밖으로 옮긴다(2026-10-23 · A1 후속 2). 고친 블록에서만
 * 공백이 표지 밖으로 나가는 정규화가 일어나고, 고치지 않은 블록은 원문 바이트 그대로다. */
function wrapDelims(inner: string, count: 1 | 2): string {
  let body = inner;
  let lead = "";
  let tail = "";
  while (body !== "" && isWsChar(body.charAt(0))) {
    lead += body.charAt(0);
    body = body.slice(1);
  }
  while (body !== "" && isWsChar(body.charAt(body.length - 1))) {
    tail = body.charAt(body.length - 1) + tail;
    body = body.slice(0, -1);
  }
  if (body === "") return lead + tail; // 빈 굵게 · 기울임은 표지 없이는 되읽을 수 없다
  const delim = "*".repeat(count);
  return `${lead}${delim}${body}${delim}${tail}`;
}

function projectInlineNodes(nodes: ScanNode[], tok: TokenCollector): string {
  let out = "";
  for (const node of nodes) {
    if (node.kind === "text") {
      out += projectText(node.src);
      continue;
    }
    if (node.kind !== "elem") continue; // 주석 · CDATA 는 투영에 보내지 않는다
    const n = node.name.toLowerCase();
    const only = node.attrs.length === 1 ? node.attrs[0] : undefined;
    if (n === "br") {
      out += "\n";
    } else if (n === "strong" || n === "b") {
      out += wrapDelims(projectInlineNodes(node.children, tok), 2);
    } else if (n === "em" || n === "i") {
      out += wrapDelims(projectInlineNodes(node.children, tok), 1);
    } else if (n === "code" && !hasElementChild(node)) {
      out += `\`${projectInlineNodes(node.children, tok)}\``;
    } else if (
      n === "a" &&
      only !== undefined &&
      only.name.toLowerCase() === "href" &&
      !hasElementChild(node)
    ) {
      // 주소의 괄호 · 공백 · 밑줄(\) 은 낱글자로 지켜낸다 — 되읽을 때 균형 잡힌 괄호까지 허용한다.
      const href = decodeEntities(only.rawValue).replace(/[\\()\t\n\r ]/g, (ch) => `\\${ch}`);
      out += `[${projectInlineNodes(node.children, tok)}](${href})`;
    } else if (n === "ac:inline-comment-marker") {
      const name = tok.pair("c", "comment-anchor", node.openSrc, node.closeSrc);
      out += `⟦${name}⟧${projectInlineNodes(node.children, tok)}⟦/${name}⟧`;
    } else if (ATOMIC_INLINE[n] === true) {
      out += `⟦${tok.single(atomicLabel(node), node.src)}⟧`;
    } else if (
      !hasElementChild(node) &&
      node.children.every((c) => c.kind !== "text" || isWs(c.src))
    ) {
      out += `⟦${tok.single(atomicLabel(node), node.src)}⟧`; // 글이 없는 요소
    } else {
      const name = tok.pair("p", `format:${node.name}`, node.openSrc, node.closeSrc);
      out += `⟦${name}⟧${projectInlineNodes(node.children, tok)}⟦/${name}⟧`;
    }
  }
  return out;
}

// ---------- 블록 투영 ----------

function preservedLabel(el: ScanElem | null): string {
  if (el === null) return "text";
  const n = el.name.toLowerCase();
  if (n === "ac:structured-macro") {
    const name = attrOf(el, "ac:name");
    return name !== null && name !== "" ? `macro:${name}` : "element:ac:structured-macro";
  }
  if (n === "ac:image") return "image";
  if (n === "hr") return "hr";
  if (n === "pre") return "pre";
  if (n === "blockquote") return "blockquote";
  return `element:${el.name}`;
}

interface TableCellSrc {
  ws: string;
  node: ScanElem;
}

interface TableRowSrc {
  ws: string;
  node: ScanElem;
  cells: TableCellSrc[];
  /** 마지막 셀 닫기와 행 닫기 사이의 조각 — 되돌릴 때까지 지킨다. */
  tail: string;
}

interface TableGroupSrc {
  wrap: "thead" | "tbody" | null;
  ws: string;
  openSrc: string;
  closeSrc: string;
  rows: TableRowSrc[];
  tail: string;
}

interface TableSrc {
  colgroupWs: string;
  colgroupSrc: string | null;
  groups: TableGroupSrc[];
  tail: string;
}

interface ListSrc {
  openSrc: string;
  closeSrc: string;
  entries: { ws: string; node: ScanElem }[];
  tail: string;
}

interface BlockInternals {
  view: DraftBlockView;
  editable: boolean;
  tokens: TokenInfo[];
  leading: string;
  elem: ScanElem | null;
  list: ListSrc | null;
  table: TableSrc | null;
}

function listSourcesFrom(el: ScanElem): ListSrc {
  const entries: { ws: string; node: ScanElem }[] = [];
  let ws = "";
  for (const child of el.children) {
    if (isElem(child, "li")) {
      entries.push({ ws, node: child });
      ws = "";
    } else {
      ws += child.src;
    }
  }
  return { openSrc: el.openSrc, closeSrc: el.closeSrc, entries, tail: ws };
}

function collectCells(tr: ScanElem): { cells: TableCellSrc[]; tail: string } {
  const cells: TableCellSrc[] = [];
  let ws = "";
  for (const child of tr.children) {
    if (child.kind !== "elem") {
      ws += child.src;
      continue;
    }
    const n = child.name.toLowerCase();
    if (n === "td" || n === "th") {
      cells.push({ ws, node: child });
      ws = "";
    } else {
      ws += child.src;
    }
  }
  return { cells, tail: ws };
}

function collectRows(parent: ScanElem): { rows: TableRowSrc[]; tail: string } {
  const rows: TableRowSrc[] = [];
  let ws = "";
  for (const child of parent.children) {
    if (child.kind !== "elem") {
      ws += child.src;
      continue;
    }
    if (child.name.toLowerCase() === "tr") {
      const { cells, tail } = collectCells(child);
      rows.push({ ws, node: child, cells, tail });
      ws = "";
    } else {
      ws += child.src;
    }
  }
  return { rows, tail: ws };
}

function tableSourcesFrom(el: ScanElem): TableSrc {
  let colgroupWs = "";
  let colgroupSrc: string | null = null;
  const groups: TableGroupSrc[] = [];
  let ws = "";
  for (const child of el.children) {
    if (child.kind !== "elem") {
      ws += child.src;
      continue;
    }
    const n = child.name.toLowerCase();
    if (n === "colgroup") {
      colgroupWs = ws;
      colgroupSrc = child.src;
      ws = "";
    } else if (n === "thead" || n === "tbody") {
      const { rows, tail } = collectRows(child);
      groups.push({ wrap: n, ws, openSrc: child.openSrc, closeSrc: child.closeSrc, rows, tail });
      ws = "";
    } else if (n === "tr") {
      const { cells, tail } = collectCells(child);
      groups.push({
        wrap: null,
        ws,
        openSrc: "",
        closeSrc: "",
        rows: [{ ws: "", node: child, cells, tail }],
        tail: "",
      });
      ws = "";
    } else {
      ws += child.src;
    }
  }
  return { colgroupWs, colgroupSrc, groups, tail: ws };
}

interface CellProj {
  header: boolean;
  text: string;
  complex: boolean;
  merged: boolean;
  nested: boolean;
}

function projectCell(node: ScanElem, tok: TokenCollector): CellProj {
  const header = node.name.toLowerCase() === "th";
  const spanOf = (name: string): number => {
    const v = attrOf(node, name);
    const num = v === null ? 1 : Number.parseInt(v, 10);
    return Number.isFinite(num) ? num : 1;
  };
  const merged = spanOf("rowspan") > 1 || spanOf("colspan") > 1;
  const nested = hasTableDescendant(node);
  const elems = elementChildren(node);
  const bareText = node.children.some((c) => c.kind === "text" && !isWs(c.src));
  let text = "";
  let complex = false;
  if (elems.length === 0) {
    text = bareText ? trimProjection(projectInlineNodes(node.children, tok)) : "";
  } else if (
    !bareText &&
    elems.every((e) => e.name.toLowerCase() === "p" && !hasBlockDescendant(e))
  ) {
    text = elems.map((e) => trimProjection(projectInlineNodes(e.children, tok))).join("\n\n");
  } else {
    complex = true;
    text = `⟦${tok.single("cell:complex", node.src)}⟧`;
  }
  return { header, text, complex, merged, nested };
}

function projectXml(xml: string, kind: StorageBlockKind): BlockInternals {
  const nodes = scanContent(xml, 0, xml.length, null).nodes;
  const tok = newCollector();
  const el = firstElem(nodes);
  const leading = leadingOf(nodes, el);
  const preserved = (label: string): BlockInternals => ({
    view: { kind: "preserved", label },
    editable: false,
    tokens: [],
    leading,
    elem: el,
    list: null,
    table: null,
  });
  if (kind === "preserved") return preserved(preservedLabel(el));
  if (kind === "heading" || kind === "paragraph") {
    const complexLabel = kind === "heading" ? "heading:complex" : "paragraph:complex";
    if (el === null) return preserved(complexLabel);
    const name = el.name.toLowerCase();
    if (kind === "heading" && !/^h[1-6]$/.test(name)) return preserved(complexLabel);
    if (kind === "paragraph" && name !== "p") return preserved(complexLabel);
    if (hasBlockDescendant(el)) return preserved(complexLabel);
    const text = trimProjection(projectInlineNodes(el.children, tok));
    const view: DraftBlockView =
      kind === "heading"
        ? { kind: "heading", level: Number(name.charAt(1)) as 1 | 2 | 3 | 4 | 5 | 6, text }
        : { kind: "paragraph", text };
    return { view, editable: true, tokens: tok.list, leading, elem: el, list: null, table: null };
  }
  if (kind === "list") {
    if (el === null || !/^(?:ul|ol)$/.test(el.name.toLowerCase())) return preserved("list:nested");
    const items: string[] = [];
    let ok = true;
    for (const child of el.children) {
      if (child.kind === "text") {
        if (!isWs(child.src)) ok = false;
        continue;
      }
      if (child.kind !== "elem") continue; // 주석 따위는 무시한다
      if (child.name.toLowerCase() !== "li") {
        ok = false;
        continue;
      }
      const elems = elementChildren(child);
      const bare = child.children.some((c) => c.kind === "text" && !isWs(c.src));
      const only = elems.length === 1 ? elems[0] : undefined;
      if (elems.length === 0) {
        items.push(trimProjection(projectInlineNodes(child.children, tok)));
      } else if (
        only !== undefined &&
        only.name.toLowerCase() === "p" &&
        !bare &&
        !hasBlockDescendant(only)
      ) {
        items.push(trimProjection(projectInlineNodes(only.children, tok)));
      } else {
        ok = false; // 중첩 목록 · 여러 블록 — 목록 투영을 포기한다
      }
    }
    if (!ok) return preserved("list:nested");
    const view: ListView = { kind: "list", ordered: el.name.toLowerCase() === "ol", items };
    return {
      view,
      editable: true,
      tokens: tok.list,
      leading,
      elem: el,
      list: listSourcesFrom(el),
      table: null,
    };
  }
  // table
  if (el === null || el.name.toLowerCase() !== "table") return preserved("table:complex");
  const src = tableSourcesFrom(el);
  const rows: DraftTableRow[] = [];
  let merged = false;
  let nested = false;
  for (const group of src.groups) {
    for (const row of group.rows) {
      const cells: DraftTableCell[] = [];
      for (const cell of row.cells) {
        const proj = projectCell(cell.node, tok);
        if (proj.merged) merged = true;
        if (proj.nested) nested = true;
        cells.push({ header: proj.header, text: proj.text });
      }
      rows.push({ cells });
    }
  }
  if (merged) return preserved("table:merged");
  if (nested) return preserved("table:nested");
  return {
    view: { kind: "table", rows },
    editable: true,
    tokens: tok.list,
    leading,
    elem: el,
    list: null,
    table: src,
  };
}

// ---------- 나누기 · 되살리기 ----------

export function parseStorage(xml: string): StorageDoc {
  const nodes = scanContent(xml, 0, xml.length, null).nodes;
  const frame: StorageDoc["frame"] = [];
  const blocks: StorageBlock[] = [];
  let lastSlot: string | null = null;
  let section = 0; // layout 이 여러 번 나와도 칸 이름이 겹치지 않게 문서 전체로 센다
  const pushSlot = (slot: string): void => {
    if (lastSlot === slot) return;
    frame.push({ slot });
    lastSlot = slot;
  };
  const addBlock = (src: string, slot: string, blockKind: StorageBlockKind): void => {
    pushSlot(slot);
    blocks.push({ id: `b${blocks.length}`, slot, kind: blockKind, xml: src });
  };
  const kindOf = (name: string): StorageBlockKind => {
    const n = name.toLowerCase();
    if (/^h[1-6]$/.test(n)) return "heading";
    if (n === "p") return "paragraph";
    if (n === "ul" || n === "ol") return "list";
    if (n === "table") return "table";
    return "preserved";
  };
  // 자식 노드를 한 칸의 블록으로 나눈다. 요소 사이의 공백은 다음 블록 앞부분이 되고, 마지막 공백은 돌려준다.
  const splitBlocks = (children: ScanNode[], slot: string): string => {
    let ws = "";
    for (const child of children) {
      if (child.kind === "text") {
        if (isWs(child.src)) {
          ws += child.src;
          continue;
        }
        addBlock(ws + child.src, slot, "preserved"); // 맨 글
        ws = "";
      } else if (child.kind === "elem") {
        addBlock(ws + child.src, slot, kindOf(child.name));
        ws = "";
      } else {
        ws += child.src; // 주석 · CDATA · 어긋난 닫기 태그는 틀 조각으로 섞는다
      }
    }
    return ws;
  };
  // ac:layout 은 블록이 아니라 틀이다 — 감싸는 태그는 raw 로, 셀 안만 칸으로 나눈다(2026-10-23 · F1).
  const splitLayout = (layout: ScanElem): void => {
    let raw = layout.openSrc;
    for (const child of layout.children) {
      if (isElem(child, "ac:layout-section")) {
        const s = section;
        section += 1;
        raw += child.openSrc;
        let c = -1;
        for (const cell of child.children) {
          if (isElem(cell, "ac:layout-cell")) {
            c += 1;
            raw += cell.openSrc;
            if (raw !== "") frame.push({ raw });
            const slot = `L${s}.${c}`;
            pushSlot(slot);
            raw = splitBlocks(cell.children, slot) + cell.closeSrc;
          } else {
            raw += cell.src;
          }
        }
        raw += child.closeSrc;
      } else {
        raw += child.src;
      }
    }
    raw += layout.closeSrc;
    if (raw !== "") frame.push({ raw });
  };
  let pending = "";
  let group = 0;
  for (const node of nodes) {
    if (node.kind === "text") {
      if (isWs(node.src)) {
        pending += node.src;
        continue;
      }
      addBlock(pending + node.src, group === 0 ? "main" : `main.${group}`, "preserved");
      pending = "";
    } else if (node.kind === "elem") {
      if (node.name.toLowerCase() === "ac:layout") {
        if (pending !== "") frame.push({ raw: pending });
        pending = "";
        splitLayout(node);
        group += 1; // layout 뒤의 최상위 묶음은 main.1, main.2 … 로 이름 붙인다
      } else {
        addBlock(pending + node.src, group === 0 ? "main" : `main.${group}`, kindOf(node.name));
        pending = "";
      }
    } else {
      pending += node.src;
    }
  }
  if (pending !== "") frame.push({ raw: pending });
  return { frame, blocks };
}

export function serializeStorage(doc: StorageDoc): string {
  // slot 별로 한 번만 모은다 — 칸마다 전체 블록을 거르면 블록 수의 제곱이 된다(2026-10-23 · 작업 P1).
  const bySlot = new Map<string, string[]>();
  for (const block of doc.blocks) {
    const list = bySlot.get(block.slot);
    if (list === undefined) bySlot.set(block.slot, [block.xml]);
    else list.push(block.xml);
  }
  return doc.frame
    .map((piece) => {
      if ("raw" in piece) return piece.raw;
      return (bySlot.get(piece.slot) ?? []).join("");
    })
    .join("");
}

export function projectBlock(block: StorageBlock): BlockProjection {
  const proj = projectXml(block.xml, block.kind);
  const tokens: Record<string, string> = {};
  for (const token of proj.tokens) tokens[token.name] = token.label;
  return { view: proj.view, editable: proj.editable, tokens };
}

export function blockFingerprint(xml: string): string {
  return createHash("sha256").update(xml, "utf8").digest("hex").slice(0, 16);
}

// ---------- 되돌리기 — 토큰 검사 · 리치 글 해석 · 종류별 재건 ----------

const TOKEN_REF = /^⟦(\/?)([tpc]\d+)⟧/;

type RefScan = { ok: true; names: string[] } | { ok: false; reason: string };

/** 하나의 글 안에서 토큰 표지를 검증한다 — 모르는 이름 · 짝 안 맞는 쌍 · 두 번 나온 토큰은 거절이다. */
function scanRefs(text: string, arity: Map<string, TokenInfo>, unknownReason: string): RefScan {
  const names: string[] = [];
  const openStack: string[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.charAt(i) === "\\") {
      i += 2;
      continue;
    }
    if (text.charAt(i) === "⟦") {
      const m = TOKEN_REF.exec(text.slice(i));
      if (m !== null && m[2] !== undefined) {
        const name = m[2];
        const info = arity.get(name);
        if (info === undefined) return { ok: false, reason: `${unknownReason}: ${name}` };
        if (m[1] === "/") {
          if (info.single) return { ok: false, reason: `홑 토큰 ${name} 에 닫는 표지가 있다` };
          if (openStack[openStack.length - 1] !== name) {
            return { ok: false, reason: `쌍 토큰 ${name} 의 짝이 맞지 않거나 엇갈렸다` };
          }
          openStack.pop();
        } else {
          if (names.includes(name))
            return { ok: false, reason: `토큰 ${name} 이(가) 두 번 나왔다` };
          names.push(name);
          if (!info.single) openStack.push(name);
        }
        i += m[0].length;
        continue;
      }
    }
    i += 1;
  }
  if (openStack.length > 0) {
    const name = openStack[openStack.length - 1] ?? "";
    return { ok: false, reason: `쌍 토큰 ${name} 의 짝이 맞지 않는다` };
  }
  return { ok: true, names };
}

function viewTexts(view: DraftBlockView): string[] {
  if (view.kind === "heading" || view.kind === "paragraph") return [view.text];
  if (view.kind === "list") return [...view.items];
  if (view.kind === "table") return view.rows.flatMap((row) => row.cells.map((cell) => cell.text));
  return [];
}

function sameView(a: DraftBlockView, b: DraftBlockView): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "heading" && b.kind === "heading") return a.level === b.level && a.text === b.text;
  if (a.kind === "paragraph" && b.kind === "paragraph") return a.text === b.text;
  if (a.kind === "list" && b.kind === "list") {
    return (
      a.ordered === b.ordered &&
      a.items.length === b.items.length &&
      a.items.every((x, i) => x === b.items[i])
    );
  }
  if (a.kind === "table" && b.kind === "table") {
    return (
      a.rows.length === b.rows.length &&
      a.rows.every((row, i) => {
        const other = b.rows[i];
        return (
          other !== undefined &&
          row.cells.length === other.cells.length &&
          row.cells.every((cell, j) => {
            const otherCell = other.cells[j];
            return (
              otherCell !== undefined &&
              cell.header === otherCell.header &&
              cell.text === otherCell.text
            );
          })
        );
      })
    );
  }
  return a.kind === "preserved" && b.kind === "preserved" && a.label === b.label;
}

// 리치 글 — 투영의 좁은 마크다운을 해석해 조각으로 쌓는다

type Seg =
  | { t: "text"; s: string }
  | { t: "br" }
  | { t: "strong"; inner: Seg[] }
  | { t: "em"; inner: Seg[] }
  | { t: "code"; s: string }
  | { t: "link"; inner: Seg[]; href: string }
  | { t: "tok"; name: string }
  | { t: "pair"; name: string; inner: Seg[] };

// ---------- 리치 글 읽기 — CommonMark 강조 규칙을 줄인 구분자 스택(2026-10-23 · A1 후속) ----------
//
// 투영의 좁은 마크다운을 단위로 쪼개고, 별표 구분자 열을 왼쪽/오른쪽 붙음과 3의 배수 규칙으로
// 짝짓는다. *** 는 안쪽부터 닫는다. 투영 쪽(wrapDelims · joinInline · href 이스케이프)은
// 되읽었을 때 같은 구조가 나오게 경계의 모호함을 미리 지켜낸다.

type EdgeClass = "ws" | "punct" | "letter";

/** 강조 규칙이 문장부호로 보는 글자 — ASCII 문장부호에 ⟦⟧ 와 `\` 를 더했다. */
const RICH_PUNCT: Record<string, true> = {
  "!": true,
  '"': true,
  "#": true,
  $: true,
  "%": true,
  "&": true,
  "'": true,
  "(": true,
  ")": true,
  "*": true,
  "+": true,
  ",": true,
  "-": true,
  ".": true,
  "/": true,
  ":": true,
  ";": true,
  "<": true,
  "=": true,
  ">": true,
  "?": true,
  "@": true,
  "[": true,
  "\\": true,
  "]": true,
  "^": true,
  _: true,
  "`": true,
  "{": true,
  "|": true,
  "}": true,
  "~": true,
  "⟦": true,
  "⟧": true,
};

function charClass(ch: string): EdgeClass {
  if (isWsChar(ch)) return "ws";
  return RICH_PUNCT[ch] === true ? "punct" : "letter";
}

function isWsChar(ch: string): boolean {
  return ch === "\t" || ch === "\n" || ch === "\r" || ch === " ";
}

interface CharsUnit {
  u: "chars";
  s: string;
  firstClass: EdgeClass;
  lastClass: EdgeClass;
}
interface RunUnit {
  u: "run";
  rem: number;
  orig: number;
  canOpen: boolean;
  canClose: boolean;
}
interface CodeUnit {
  u: "code";
  s: string;
}
interface LinkUnit {
  u: "link";
  inner: Unit[];
  href: string;
}
interface TokUnit {
  u: "tok";
  name: string;
}
interface PairOpenUnit {
  u: "pairOpen";
  name: string;
}
interface PairCloseUnit {
  u: "pairClose";
  name: string;
}
interface BrUnit {
  u: "br";
}
interface WrapUnit {
  u: "wrap";
  strong: boolean;
  inner: Unit[];
}
type Unit =
  | BrUnit
  | CharsUnit
  | CodeUnit
  | LinkUnit
  | PairCloseUnit
  | PairOpenUnit
  | RunUnit
  | TokUnit
  | WrapUnit;

interface ScanPart {
  ch: string;
  escaped: boolean;
}

/** 낱글자의 부착 클래스 — 이스케이프한 공백은 글자로, 나머지 이스케이프는 문장부호로 본다. */
function scanPartClass(part: ScanPart): EdgeClass {
  if (part.escaped) return isWsChar(part.ch) ? "letter" : "punct";
  return charClass(part.ch);
}

function charsUnitOf(parts: ScanPart[]): CharsUnit {
  const first = parts[0];
  const last = parts[parts.length - 1];
  return {
    u: "chars",
    s: parts.map((part) => part.ch).join(""),
    firstClass: first !== undefined ? scanPartClass(first) : "ws",
    lastClass: last !== undefined ? scanPartClass(last) : "ws",
  };
}

function edgeClass(unit: Unit, side: "first" | "last"): EdgeClass {
  if (unit.u === "chars") return side === "first" ? unit.firstClass : unit.lastClass;
  if (unit.u === "br") return "ws";
  return "punct"; // run · code · link · tok · 쌍 표지 · 강조 감싸기는 문장부호로 본다
}

function scanUnits(text: string, arity: Map<string, TokenInfo>): Unit[] {
  const units: Unit[] = [];
  let parts: ScanPart[] = [];
  const flush = (): void => {
    if (parts.length > 0) {
      units.push(charsUnitOf(parts));
      parts = [];
    }
  };
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (ch === "\\" && i + 1 < text.length) {
      parts.push({ ch: text.charAt(i + 1), escaped: true });
      i += 2;
      continue;
    }
    if (ch === "\n") {
      flush();
      units.push({ u: "br" });
      i += 1;
      continue;
    }
    if (ch === "*") {
      flush();
      let n = 0;
      while (text.charAt(i) === "*") {
        n += 1;
        i += 1;
      }
      units.push({ u: "run", rem: n, orig: n, canOpen: false, canClose: false });
      continue;
    }
    if (ch === "⟦") {
      const m = TOKEN_REF.exec(text.slice(i));
      const name = m !== null && m[2] !== undefined ? m[2] : null;
      const info = name !== null ? arity.get(name) : undefined;
      if (
        name !== null &&
        info !== undefined &&
        m !== null &&
        m[0] !== undefined &&
        m[1] !== undefined
      ) {
        flush();
        if (m[1] === "/") units.push({ u: "pairClose", name });
        else units.push(info.single ? { u: "tok", name } : { u: "pairOpen", name });
        i += m[0].length;
        continue;
      }
      parts.push({ ch, escaped: false });
      i += 1;
      continue;
    }
    if (ch === "`") {
      let j = i + 1;
      let found = -1;
      while (j < text.length) {
        if (text.charAt(j) === "\\") {
          j += 2;
          continue;
        }
        if (text.charAt(j) === "`") {
          found = j;
          break;
        }
        j += 1;
      }
      if (found !== -1) {
        flush();
        const raw = text.slice(i + 1, found);
        let s = "";
        for (let k = 0; k < raw.length; k += 1) {
          if (raw.charAt(k) === "\\" && k + 1 < raw.length) {
            s += raw.charAt(k + 1);
            k += 1;
          } else {
            s += raw.charAt(k);
          }
        }
        units.push({ u: "code", s });
        i = found + 1;
        continue;
      }
      parts.push({ ch, escaped: false });
      i += 1;
      continue;
    }
    if (ch === "[") {
      const link = scanLink(text, i);
      if (link !== null) {
        flush();
        units.push({ u: "link", inner: scanUnits(link.inner, arity), href: link.href });
        i = link.next;
        continue;
      }
      parts.push({ ch, escaped: false });
      i += 1;
      continue;
    }
    parts.push({ ch, escaped: false });
    i += 1;
  }
  flush();
  return units;
}

/** `[글](주소)` — 주소는 균형 잡힌 괄호를 허용하고 이스케이프를 푼다. 날 공백이면 링크가 아니다. */
function scanLink(
  text: string,
  start: number,
): { inner: string; href: string; next: number } | null {
  let j = start + 1;
  let bracket = -1;
  while (j < text.length) {
    if (text.charAt(j) === "\\") {
      j += 2;
      continue;
    }
    if (text.charAt(j) === "]" && text.charAt(j + 1) === "(") {
      bracket = j;
      break;
    }
    j += 1;
  }
  if (bracket === -1) return null;
  let k = bracket + 2;
  let href = "";
  let depth = 0;
  let closed = -1;
  while (k < text.length) {
    const ch = text.charAt(k);
    if (ch === "\\" && k + 1 < text.length) {
      href += text.charAt(k + 1);
      k += 2;
      continue;
    }
    if (ch === "(") {
      depth += 1;
    } else if (ch === ")") {
      if (depth === 0) {
        closed = k;
        break;
      }
      depth -= 1;
    } else if (isWsChar(ch)) {
      return null;
    }
    href += ch;
    k += 1;
  }
  if (closed === -1) return null;
  return { inner: text.slice(start + 1, bracket), href, next: closed + 1 };
}

/** 구분자 열의 짝짓기 — 닫는 쪽 순서로 가장 가까운 여는 쪽을 찾고, 3의 배수 규칙을 적용한다.
 * 이웃을 알아내는 indexOf 와 가운데를 떼는 splice 는 열의 길이 제곱이라 연결 고리로 대신한다
 * (2026-10-23 · 작업 P1 — 짝짓기의 순서와 결과는 그대로다). */
function resolveEmphasis(list: Unit[]): void {
  interface Link {
    unit: Unit;
    prev: Link | null;
    next: Link | null;
  }
  let head: Link | null = null;
  let tail: Link | null = null;
  const nodeOf = new Map<RunUnit, Link>();
  const runs: RunUnit[] = [];
  for (const unit of list) {
    const link: Link = { unit, prev: tail, next: null };
    if (tail === null) head = link;
    else tail.next = link;
    tail = link;
    if (unit.u === "run") {
      runs.push(unit);
      nodeOf.set(unit, link);
    }
  }
  for (const run of runs) {
    const link = nodeOf.get(run);
    const prevUnit = link?.prev?.unit;
    const nextUnit = link?.next?.unit;
    const before = prevUnit !== undefined ? edgeClass(prevUnit, "last") : "ws";
    const after = nextUnit !== undefined ? edgeClass(nextUnit, "first") : "ws";
    run.canOpen = after !== "ws" && !(after === "punct" && before === "letter");
    run.canClose = before !== "ws" && !(before === "punct" && after === "letter");
  }
  for (const closer of runs) {
    if (!closer.canClose) continue;
    const closerLink = nodeOf.get(closer);
    if (closerLink === undefined) continue;
    while (closer.rem > 0) {
      let openerLink: Link | null = null;
      for (let cur: Link | null = closerLink.prev; cur !== null; cur = cur.prev) {
        const cand = cur.unit;
        if (cand.u !== "run" || cand.rem === 0 || !cand.canOpen) continue;
        if (cand.canClose && closer.canOpen) {
          const sum = cand.orig + closer.orig;
          if (sum % 3 === 0 && !(cand.orig % 3 === 0 && closer.orig % 3 === 0)) continue;
        }
        openerLink = cur;
        break;
      }
      if (openerLink === null) break;
      const opener = openerLink.unit;
      if (opener.u !== "run") break; // 열에 있는 여는 쪽은 언제나 run 이다
      const inner: Unit[] = [];
      for (let cur: Link | null = openerLink.next; cur !== closerLink; cur = cur.next) {
        if (cur === null) break;
        inner.push(cur.unit);
      }
      const strong = closer.rem >= 2 && opener.rem >= 2;
      const wrap: Link = { unit: { u: "wrap", strong, inner }, prev: openerLink, next: closerLink };
      openerLink.next = wrap;
      closerLink.prev = wrap;
      opener.rem -= strong ? 2 : 1;
      closer.rem -= strong ? 2 : 1;
      if (opener.rem === 0) {
        if (openerLink.prev === null) head = openerLink.next;
        else openerLink.prev.next = openerLink.next;
        if (openerLink.next !== null) openerLink.next.prev = openerLink.prev;
      }
    }
  }
  const out: Unit[] = [];
  for (let cur = head; cur !== null; cur = cur.next) {
    const unit = cur.unit;
    if (unit.u === "run") {
      out.push({ u: "chars", s: "*".repeat(unit.rem), firstClass: "punct", lastClass: "punct" });
    } else {
      out.push(unit);
    }
  }
  list.length = 0;
  for (const unit of out) list.push(unit);
}

function parseRegion(list: Unit[], arity: Map<string, TokenInfo>, resolve: boolean): Seg[] {
  if (resolve) resolveEmphasis(list);
  const segs: Seg[] = [];
  let buf = "";
  const flush = (): void => {
    if (buf !== "") {
      segs.push({ t: "text", s: buf });
      buf = "";
    }
  };
  for (let i = 0; i < list.length; i += 1) {
    const unit = list[i];
    if (unit === undefined) break;
    if (unit.u === "chars") {
      buf += unit.s;
    } else if (unit.u === "run") {
      buf += "*".repeat(unit.rem); // 짝을 못 찾은 별표는 글자로 남는다
    } else if (unit.u === "br") {
      flush();
      segs.push({ t: "br" });
    } else if (unit.u === "code") {
      flush();
      segs.push({ t: "code", s: unit.s });
    } else if (unit.u === "tok") {
      flush();
      segs.push({ t: "tok", name: unit.name });
    } else if (unit.u === "link") {
      flush();
      segs.push({ t: "link", inner: parseRegion(unit.inner, arity, true), href: unit.href });
    } else if (unit.u === "wrap") {
      flush();
      const inner = parseRegion(unit.inner, arity, false); // 안은 이미 짝짓기를 거쳤다
      segs.push(unit.strong ? { t: "strong", inner } : { t: "em", inner });
    } else if (unit.u === "pairOpen") {
      let depth = 0;
      let close = -1;
      for (let k = i + 1; k < list.length; k += 1) {
        const u = list[k];
        if (u === undefined) break;
        if (u.u === "pairOpen" && u.name === unit.name) depth += 1;
        else if (u.u === "pairClose" && u.name === unit.name) {
          if (depth === 0) {
            close = k;
            break;
          }
          depth -= 1;
        }
      }
      flush();
      if (close === -1) {
        segs.push({ t: "tok", name: unit.name }); // 방어적 — 검증이 먼저 막는다
        continue;
      }
      const inner = parseRegion(list.slice(i + 1, close), arity, false); // 쌍 안도 이미 거쳤다
      segs.push({ t: "pair", name: unit.name, inner });
      i = close;
    } else {
      buf += `⟦/${unit.name}⟧`; // 방어적 — 짝 검증이 막는다
    }
  }
  flush();
  return segs;
}

function parseSegments(text: string, arity: Map<string, TokenInfo>): Seg[] {
  return parseRegion(scanUnits(text, arity), arity, true);
}

function emitSegments(segs: Seg[], arity: Map<string, TokenInfo>): string {
  let out = "";
  for (const seg of segs) {
    switch (seg.t) {
      case "text": {
        out += escapeXml(seg.s);
        break;
      }
      case "br": {
        out += "<br/>";
        break;
      }
      case "strong": {
        out += `<strong>${emitSegments(seg.inner, arity)}</strong>`;
        break;
      }
      case "em": {
        out += `<em>${emitSegments(seg.inner, arity)}</em>`;
        break;
      }
      case "code": {
        out += `<code>${escapeXml(seg.s)}</code>`;
        break;
      }
      case "link": {
        out += `<a href="${escapeAttr(seg.href)}">${emitSegments(seg.inner, arity)}</a>`;
        break;
      }
      case "tok": {
        out += (arity.get(seg.name) ?? { source: "" }).source;
        break;
      }
      case "pair": {
        const info = arity.get(seg.name);
        if (info === undefined) break;
        out += info.openSrc + emitSegments(seg.inner, arity) + info.closeSrc;
        break;
      }
    }
  }
  return out;
}

function renderInline(text: string, arity: Map<string, TokenInfo>): string {
  return emitSegments(parseSegments(text, arity), arity);
}

/** `\n\n` 마다 문단으로 나눈 셀 안 — 빈 글은 `<p />` 다(2026-10-23 · F1). */
function cellInner(text: string, arity: Map<string, TokenInfo>): string {
  if (text === "") return "<p />";
  return text
    .split("\n\n")
    .map((p) => `<p>${renderInline(p, arity)}</p>`)
    .join("");
}

function freshXml(view: DraftBlockView, arity: Map<string, TokenInfo>): string | null {
  switch (view.kind) {
    case "heading":
      return `<h${view.level}>${renderInline(view.text, arity)}</h${view.level}>`;
    case "paragraph":
      return view.text
        .split("\n\n")
        .map((p) => `<p>${renderInline(p, arity)}</p>`)
        .join("\n");
    case "list": {
      const tag = view.ordered ? "ol" : "ul";
      return `<${tag}>${view.items.map((item) => `<li>${renderInline(item, arity)}</li>`).join("\n")}</${tag}>`;
    }
    case "table":
      return `<table>${view.rows
        .map(
          (row) =>
            `<tr>${row.cells
              .map(
                (cell) =>
                  `<${cell.header ? "th" : "td"}>${cellInner(cell.text, arity)}</${cell.header ? "th" : "td"}>`,
              )
              .join("")}</tr>`,
        )
        .join("\n")}</table>`;
    case "preserved":
      return null;
  }
}

function renderHeading(
  int: BlockInternals,
  view: HeadingView,
  arity: Map<string, TokenInfo>,
  lead: string,
): string {
  const el = int.elem;
  const sameKind = int.view.kind === "heading" && el !== null && !el.selfClosing;
  if (!sameKind || el === null)
    return `${lead}<h${view.level}>${renderInline(view.text, arity)}</h${view.level}>`;
  if (int.view.kind === "heading" && int.view.level !== view.level) {
    return `${lead}<h${view.level}${attrPart(el.openSrc, el.name)}>${renderInline(view.text, arity)}</h${view.level}>`;
  }
  return `${lead}${el.openSrc}${renderInline(view.text, arity)}${el.closeSrc}`;
}

function renderParagraph(
  int: BlockInternals,
  view: ParagraphView,
  arity: Map<string, TokenInfo>,
  lead: string,
): string {
  const el = int.elem;
  const sameKind = int.view.kind === "paragraph" && el !== null && !el.selfClosing;
  const paras = view.text.split("\n\n");
  if (!sameKind || el === null) {
    return lead + paras.map((p) => `<p>${renderInline(p, arity)}</p>`).join("\n");
  }
  if (paras.length === 1)
    return `${lead}${el.openSrc}${renderInline(view.text, arity)}${el.closeSrc}`;
  const sep = lead !== "" ? lead : "\n";
  const attrs = attrPart(el.openSrc, el.name);
  return lead + paras.map((p) => `<p${attrs}>${renderInline(p, arity)}</p>`).join(sep);
}

function renderList(
  int: BlockInternals,
  view: ListView,
  arity: Map<string, TokenInfo>,
  lead: string,
): string {
  const src = int.list;
  const fullRebuild =
    int.view.kind !== "list" ||
    src === null ||
    (int.view.kind === "list" && int.view.ordered !== view.ordered) ||
    int.elem?.selfClosing === true;
  if (fullRebuild || src === null) {
    const tag = view.ordered ? "ol" : "ul";
    const sep = src !== null && src.entries[0] !== undefined ? src.entries[0].ws : "\n";
    return `${lead}<${tag}>${view.items.map((item) => `<li>${renderInline(item, arity)}</li>`).join(sep)}</${tag}>`;
  }
  const origItems = int.view.kind === "list" ? int.view.items : [];
  const lastEntry = src.entries[src.entries.length - 1];
  const appendWs = lastEntry !== undefined ? lastEntry.ws : "\n";
  let out = lead + src.openSrc;
  view.items.forEach((text, i) => {
    const entry = src.entries[i];
    if (entry !== undefined && origItems[i] === text) {
      out += entry.ws + entry.node.src;
      return;
    }
    const ws = entry !== undefined ? entry.ws : appendWs;
    const entryElems = entry !== undefined ? elementChildren(entry.node) : [];
    const firstEntryElem = entryElems[0];
    const wrapsP =
      entryElems.length === 1 &&
      firstEntryElem !== undefined &&
      firstEntryElem.name.toLowerCase() === "p";
    out +=
      ws +
      (wrapsP
        ? `<li><p>${renderInline(text, arity)}</p></li>`
        : `<li>${renderInline(text, arity)}</li>`);
  });
  return out + src.tail + src.closeSrc;
}

function sameRow(projCells: CellProj[], vRow: DraftTableRow): boolean {
  if (projCells.length !== vRow.cells.length) return false;
  return projCells.every((cell, j) => {
    const vc = vRow.cells[j];
    return vc !== undefined && vc.header === cell.header && vc.text === cell.text;
  });
}

function rebuildRow(
  row: TableRowSrc,
  vRow: DraftTableRow,
  projCells: CellProj[],
  arity: Map<string, TokenInfo>,
): string {
  const cells = vRow.cells.map((vc, ci) => {
    const orig = row.cells[ci];
    const proj = projCells[ci];
    if (orig !== undefined && proj !== undefined) {
      if (proj.header === vc.header && proj.text === vc.text) return orig.ws + orig.node.src;
      const tag = vc.header ? "th" : "td";
      return `${orig.ws}<${tag}${attrPart(orig.node.openSrc, orig.node.name)}>${cellInner(vc.text, arity)}</${tag}>`;
    }
    return `<td>${cellInner(vc.text, arity)}</td>`;
  });
  return `${row.node.openSrc}${cells.join("")}${row.tail}${row.node.closeSrc}`;
}

/** 표를 되돌린다. 복잡한 셀(cell:complex)의 글이 바뀌면 null — 거절이다. */
function renderTable(
  int: BlockInternals,
  view: TableView,
  arity: Map<string, TokenInfo>,
  lead: string,
): string | null {
  const src = int.table;
  if (int.view.kind !== "table" || src === null) {
    const fresh = freshXml(view, arity);
    return fresh === null ? null : lead + fresh;
  }
  const origRows = src.groups.flatMap((group) => group.rows);
  const origCells = origRows.map((row) =>
    row.cells.map((cell) => projectCell(cell.node, newCollector())),
  );
  for (let i = 0; i < view.rows.length && i < origCells.length; i += 1) {
    const vRow = view.rows[i];
    if (vRow === undefined) continue;
    for (const [j, cell] of (origCells[i] ?? []).entries()) {
      const vc = vRow.cells[j];
      if (cell.complex && vc !== undefined && vc.text !== cell.text) return null;
    }
  }
  const newCols = view.rows.reduce((max, row) => Math.max(max, row.cells.length), 0);
  const origCols = origCells.reduce((max, cells) => Math.max(max, cells.length), 0);
  const dropColgroup = src.colgroupSrc !== null && newCols !== origCols;
  let out = lead + (int.elem?.openSrc ?? "<table>");
  if (src.colgroupSrc !== null && !dropColgroup) out += src.colgroupWs + src.colgroupSrc;
  let flat = 0;
  src.groups.forEach((group, gi) => {
    if (group.wrap !== null) out += group.ws + group.openSrc;
    for (const row of group.rows) {
      const idx = flat;
      flat += 1;
      const vRow = view.rows[idx];
      if (vRow === undefined) continue; // 줄어든 행은 뺀다
      const projCells = origCells[idx] ?? [];
      if (sameRow(projCells, vRow)) {
        out += row.ws + row.node.src;
        continue;
      }
      out += row.ws + rebuildRow(row, vRow, projCells, arity);
    }
    if (gi === src.groups.length - 1 && view.rows.length > origRows.length) {
      const lastOrig = origRows[origRows.length - 1];
      const ws = lastOrig !== undefined ? lastOrig.ws : "\n";
      for (let i = origRows.length; i < view.rows.length; i += 1) {
        const vRow = view.rows[i];
        if (vRow === undefined) continue;
        const cells = vRow.cells.map((cell) => `<td>${cellInner(cell.text, arity)}</td>`).join("");
        out += `${ws}<tr>${cells}</tr>`;
      }
    }
    out += group.tail;
    if (group.wrap !== null) out += group.closeSrc;
  });
  return out + src.tail + (int.elem?.closeSrc ?? "</table>");
}

export function renderBlock(
  block: StorageBlock,
  view: DraftBlockView,
): { ok: true; xml: string; removedTokens: string[] } | { ok: false; reason: string } {
  const int = projectXml(block.xml, block.kind);
  if (sameView(int.view, view)) return { ok: true, xml: block.xml, removedTokens: [] };
  if (!int.editable) {
    const label = int.view.kind === "preserved" ? int.view.label : int.view.kind;
    return { ok: false, reason: `보존 블록(${label})은 같은 투영일 때만 받는다` };
  }
  const arity = new Map(int.tokens.map((token) => [token.name, token]));
  const seen = new Set<string>();
  for (const text of viewTexts(view)) {
    const scanned = scanRefs(text, arity, "모르는 토큰이다");
    if (!scanned.ok) return scanned;
    for (const name of scanned.names) {
      if (seen.has(name)) return { ok: false, reason: `토큰 ${name} 이(가) 두 번 나왔다` };
      seen.add(name);
    }
  }
  const removedTokens = int.tokens
    .filter((token) => !seen.has(token.name))
    .map((token) => token.name);
  const lead = int.leading;
  // 종류가 바뀌면 통째로 새로 만든다 — 토큰은 원래 표에서 되살린다(2026-10-23 · F1).
  if (view.kind !== int.view.kind) {
    const fresh = freshXml(view, arity);
    if (fresh === null) return { ok: false, reason: "보존 종류의 블록은 새로 만들 수 없다" };
    return { ok: true, xml: lead + fresh, removedTokens };
  }
  if (view.kind === "heading") {
    return { ok: true, xml: renderHeading(int, view, arity, lead), removedTokens };
  }
  if (view.kind === "paragraph") {
    return { ok: true, xml: renderParagraph(int, view, arity, lead), removedTokens };
  }
  if (view.kind === "list") {
    return { ok: true, xml: renderList(int, view, arity, lead), removedTokens };
  }
  if (view.kind !== "table") return { ok: false, reason: "표가 아닌 종류다" };
  const xml = renderTable(int, view, arity, lead);
  if (xml === null) {
    return { ok: false, reason: "복잡한 셀(cell:complex)의 글은 그 토큰 그대로일 때만 받는다" };
  }
  return { ok: true, xml, removedTokens };
}

export function newBlockXml(
  view: DraftBlockView,
): { ok: true; xml: string } | { ok: false; reason: string } {
  if (view.kind === "preserved")
    return { ok: false, reason: "새 블록을 만들 수 없는 종류다: preserved" };
  const arity = new Map<string, TokenInfo>();
  for (const text of viewTexts(view)) {
    const scanned = scanRefs(text, arity, "새 블록에는 토큰을 쓸 수 없다");
    if (!scanned.ok) return scanned;
  }
  const fresh = freshXml(view, arity);
  return fresh === null
    ? { ok: false, reason: "새 블록을 만들 수 없는 종류다" }
    : { ok: true, xml: fresh };
}
