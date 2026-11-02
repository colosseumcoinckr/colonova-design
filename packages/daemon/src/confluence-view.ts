/**
 * 저장 포맷 → 보기 블록(2026-10-30 사용자 요청 — 기획서 칸에서 Confluence 기능을 가능한 한 온전히).
 *
 * 파생 마크다운(confluence-markdown.ts)은 AI 와 화면 세션이 읽는 사본이라 그대로 둔다. 이 변환은
 * 사람이 읽는 화면만을 위한 블록 나무다 — 정보 상자(info · note · warning · tip · panel) · 상태 알약 ·
 * 펼치기 · 코드 · 목차 · 그림 · 단 나눔 · 할 일 목록 · 병합 셀이 산다. 모르는 매크로는 `macro` 블록 ·
 * 조각으로 자리만 남는다(기존 `Confluence 전용` 자리 표시). 링크는 http(s) · mailto 만 주소로 싣는다.
 *
 * 순수 모듈이다 — 관용 XML 파서만 형제(confluence-markdown.ts)에서 빌린다. 아주 큰 문서는 블록 수
 * 상한에서 멈추고 끝에 이름 없는 `macro` 하나를 남긴다(화면은 「나머지는 Confluence 에서」 로 읽는다).
 */
import type {
  DocBlock,
  DocImage,
  DocInline,
  DocPanelTone,
  DocStatusColor,
} from "@colonova-design/protocol";
import { parseXml, textContent, type XmlElement, type XmlNode } from "./confluence-markdown.js";

/** 한 문서가 내놓는 요소의 상한 — 넘으면 멈춘다(선로 한 번의 크기를 지킨다). */
const MAX_NODES = 20_000;
/** 겹침의 상한 — 패널 안의 표 안의 목록 … 이 이보다 깊으면 자리만 남긴다. */
const MAX_DEPTH = 24;

/** 블록 자리에서 블록으로 서는 요소. */
const BLOCK_ELEMENTS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "table",
  "blockquote",
  "hr",
  "pre",
  "div",
  "section",
  "ac:layout",
  "ac:task-list",
  "ac:adf-extension",
  "ac:image",
]);

/** 문단 안에 있어도 블록으로 떼어 세우는 매크로 — `<p><ac:structured-macro ac:name="toc"/></p>` 꼴. */
const BLOCK_MACROS = new Set([
  "info",
  "note",
  "warning",
  "tip",
  "panel",
  "expand",
  "code",
  "noformat",
  "toc",
  "section",
  "column",
  "details",
  "excerpt",
]);

/** 글 사이에 머무는 매크로 — 블록 자리에 와도 문단의 조각으로 선다. */
const INLINE_MACROS = new Set(["status", "anchor", "jira"]);

/** 몸만 그대로 읽는 매크로 — 겉껍데기 없이 안의 블록을 잇는다. */
const TRANSPARENT_MACROS = new Set(["details", "excerpt", "div"]);

const PANEL_TONES: Record<string, DocPanelTone> = {
  info: "info",
  note: "note",
  warning: "warning",
  tip: "tip",
  success: "success",
  error: "error",
  panel: "panel",
  custom: "panel",
};

/** 옛 매크로 이름으로 서는 패널. */
const MACRO_PANELS = new Set(["info", "note", "warning", "tip", "panel"]);

const STATUS_COLORS: Record<string, DocStatusColor> = {
  grey: "grey",
  gray: "grey",
  red: "red",
  yellow: "yellow",
  green: "green",
  blue: "blue",
  purple: "purple",
};

/** 옛 이모티콘 이름 → 글자. 새 편집기는 `ac:emoji-fallback` 을 함께 싣는다. */
const EMOTICONS: Record<string, string> = {
  smile: "🙂",
  sad: "🙁",
  cheeky: "😛",
  laugh: "😀",
  wink: "😉",
  "thumbs-up": "👍",
  "thumbs-down": "👎",
  information: "ℹ️",
  tick: "✅",
  cross: "❌",
  warning: "⚠️",
  plus: "➕",
  minus: "➖",
  question: "❓",
  "light-on": "💡",
  "light-off": "💡",
  "yellow-star": "⭐",
  "red-star": "⭐",
  "green-star": "⭐",
  "blue-star": "⭐",
  heart: "❤️",
  "broken-heart": "💔",
};

interface Ctx {
  nodes: number;
  truncated: boolean;
  /** 목차 블록과 그 매개변수 — 문서 전체의 제목을 모은 뒤에 채운다. */
  tocs: Array<{ block: Extract<DocBlock, { t: "toc" }>; min: number; max: number }>;
}

/** 요소의 이름 — 네임스페이스 접두는 그대로, 대소문자는 작은 글자로 맞춘다. */
const nameOf = (node: XmlElement): string => node.name.toLowerCase();

const isElement = (node: XmlNode): node is XmlElement => node.kind === "element";

/** 공백만인 글자 — 불각 공백(U+00A0)은 내용이다. */
const isBlank = (text: string): boolean => /^[ \t\r\n]*$/u.test(text);

const collapse = (text: string): string => text.replace(/[ \t\r\n]+/gu, " ");

function childElement(node: XmlElement, name: string): XmlElement | null {
  for (const child of node.children) {
    if (isElement(child) && nameOf(child) === name) return child;
  }
  return null;
}

function findDescendant(node: XmlElement, name: string): XmlElement | null {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (nameOf(child) === name) return child;
    const found = findDescendant(child, name);
    if (found !== null) return found;
  }
  return null;
}

function macroName(node: XmlElement): string {
  return (node.attributes["ac:name"] ?? "").trim().toLowerCase();
}

/** 매크로의 매개변수 — 이름이 같은 첫 ac:parameter 의 글. */
function macroParameter(macro: XmlElement, key: string): string | null {
  for (const child of macro.children) {
    if (!isElement(child) || nameOf(child) !== "ac:parameter") continue;
    if (child.attributes["ac:name"] === key) return collapse(textContent(child)).trim();
  }
  return null;
}

/** 블록 자리에서 이 요소가 블록인가 — 매크로는 이름이 가른다. */
function isBlockNode(node: XmlNode): boolean {
  if (!isElement(node)) return false;
  const name = nameOf(node);
  if (/^h[1-6]$/u.test(name)) return true;
  if (name === "ac:structured-macro") return !INLINE_MACROS.has(macroName(node));
  return BLOCK_ELEMENTS.has(name);
}

/** 문단 안의 블록 매크로인가 — 아는 블록 매크로만 문단을 가른다(모르는 것은 글 속 자리 표시로 남는다). */
function isSplittingMacro(node: XmlNode): boolean {
  return (
    isElement(node) && nameOf(node) === "ac:structured-macro" && BLOCK_MACROS.has(macroName(node))
  );
}

/** 바깥 주소로 열어도 되는 것만 — 그 밖의 계획(javascript: 등)은 글로만 남는다. */
function safeHref(href: string | undefined): string | null {
  if (href === undefined) return null;
  const trimmed = href.trim();
  return /^(?:https?:\/\/|mailto:)/iu.test(trimmed) ? trimmed : null;
}

function headingLevel(name: string): 1 | 2 | 3 | 4 | 5 | 6 | 0 {
  const match = /^h([1-6])$/u.exec(name);
  return match === null ? 0 : (Number(match[1]) as 1 | 2 | 3 | 4 | 5 | 6);
}

// ————— 조각(인라인) —————

/** 이어진 글 조각을 하나로 — 화면이 그리는 수를 줄인다. */
function pushInline(out: DocInline[], item: DocInline): void {
  const last = out[out.length - 1];
  if (item.t === "text" && last?.t === "text") {
    last.text += item.text;
    return;
  }
  out.push(item);
}

/** 문단의 앞뒤 공백을 걷는다 — 빈 글 조각은 버린다. */
function trimInlines(list: DocInline[]): DocInline[] {
  const first = list[0];
  if (first?.t === "text") first.text = first.text.replace(/^[ \t\r\n]+/u, "");
  const last = list[list.length - 1];
  if (last?.t === "text") last.text = last.text.replace(/[ \t\r\n]+$/u, "");
  return list.filter((item) => item.t !== "text" || item.text !== "");
}

function inlines(nodes: readonly XmlNode[], ctx: Ctx, depth: number): DocInline[] {
  const out: DocInline[] = [];
  for (const node of nodes) {
    if (node.kind === "text") {
      pushInline(out, { t: "text", text: collapse(node.text) });
      continue;
    }
    for (const item of inlineElement(node, ctx, depth)) pushInline(out, item);
  }
  return out;
}

function marked(
  mark: Extract<DocInline, { t: "mark" }>["mark"],
  node: XmlElement,
  ctx: Ctx,
  depth: number,
): DocInline[] {
  const children = inlines(node.children, ctx, depth + 1);
  if (children.length === 0) return [];
  return [{ t: "mark", mark, children }];
}

function inlineElement(node: XmlElement, ctx: Ctx, depth: number): DocInline[] {
  ctx.nodes += 1;
  if (depth > MAX_DEPTH) return [{ t: "macro", name: "" }];
  const name = nameOf(node);
  switch (name) {
    case "strong":
    case "b":
      return marked("b", node, ctx, depth);
    case "em":
    case "i":
      return marked("i", node, ctx, depth);
    case "u":
      return marked("u", node, ctx, depth);
    case "s":
    case "strike":
    case "del":
      return marked("s", node, ctx, depth);
    case "sub":
      return marked("sub", node, ctx, depth);
    case "sup":
      return marked("sup", node, ctx, depth);
    case "code": {
      const text = collapse(textContent(node));
      return text.trim() === ""
        ? []
        : [{ t: "mark", mark: "code", children: [{ t: "text", text }] }];
    }
    case "br":
      return [{ t: "br" }];
    case "a": {
      const children = inlines(node.children, ctx, depth + 1);
      const href = safeHref(node.attributes.href);
      if (href === null) return children;
      return [
        { t: "link", href, children: children.length > 0 ? children : [{ t: "text", text: href }] },
      ];
    }
    case "ac:link":
      return linkInline(node, ctx, depth);
    case "ac:image": {
      const image = imageOf(node);
      return image === null ? [] : [{ t: "image", image }];
    }
    case "ri:attachment":
      return [{ t: "attachment", filename: node.attributes["ri:filename"] ?? "" }];
    case "ac:structured-macro":
      return inlineMacro(node, ctx, depth);
    case "ac:emoticon": {
      const fallback = node.attributes["ac:emoji-fallback"];
      const text = fallback ?? EMOTICONS[node.attributes["ac:name"] ?? ""] ?? "";
      return text === "" ? [] : [{ t: "emoji", text }];
    }
    case "time": {
      const value = node.attributes.datetime ?? collapse(textContent(node)).trim();
      return value === "" ? [] : [{ t: "date", value }];
    }
    case "ac:placeholder":
      // 편집기의 안내 글 — 읽는 화면에는 서지 않는다(Confluence 의 보기와 같다).
      return [];
    case "ac:parameter":
      return [];
    default:
      // 꾸밈 없는 감싸개(span · font · ac:inline-comment-marker …) — 안의 조각만 잇는다.
      return inlines(node.children, ctx, depth + 1);
  }
}

/** 글 속의 매크로 — 상태 알약은 그리고, 닻은 지우고, 나머지는 자리만. */
function inlineMacro(node: XmlElement, ctx: Ctx, depth: number): DocInline[] {
  const name = macroName(node);
  if (name === "status") {
    const text = macroParameter(node, "title") ?? "";
    const colour = (macroParameter(node, "colour") ?? macroParameter(node, "color") ?? "")
      .trim()
      .toLowerCase();
    return [
      {
        t: "status",
        text,
        color: STATUS_COLORS[colour] ?? "grey",
        subtle: macroParameter(node, "subtle") === "true",
      },
    ];
  }
  if (name === "anchor") return [];
  // 블록 매크로가 글 속에 끼었으면(표 칸 · 목록 항목의 한 줄) 몸글만 글로 잇는다.
  if (TRANSPARENT_MACROS.has(name)) {
    const body = childElement(node, "ac:rich-text-body");
    return body === null ? [] : inlines(body.children, ctx, depth + 1);
  }
  return [{ t: "macro", name }];
}

/** Confluence 링크 — 사람 · 첨부 · 문서 · 주소로 가른다. 링크 몸글이 있으면 그것이 글이다. */
function linkInline(link: XmlElement, ctx: Ctx, depth: number): DocInline[] {
  const body = childElement(link, "ac:link-body") ?? childElement(link, "ac:plain-text-link-body");
  const bodyInlines =
    body === null
      ? []
      : nameOf(body) === "ac:plain-text-link-body"
        ? [{ t: "text" as const, text: collapse(textContent(body)) }]
        : inlines(body.children, ctx, depth + 1);
  const label = trimInlines(bodyInlines);
  const user = findDescendant(link, "ri:user");
  if (user !== null) {
    const id = user.attributes["ri:account-id"] ?? user.attributes["ri:userkey"] ?? "";
    return [id === "" ? { t: "mention", name: null } : { t: "mention", name: null, id }];
  }
  const attachment = findDescendant(link, "ri:attachment");
  if (attachment !== null) {
    return [{ t: "attachment", filename: attachment.attributes["ri:filename"] ?? "" }];
  }
  const page = findDescendant(link, "ri:page");
  if (page !== null) {
    const title = page.attributes["ri:content-title"] ?? "";
    return [
      { t: "page", title, children: label.length > 0 ? label : [{ t: "text", text: title }] },
    ];
  }
  const address = safeHref(findDescendant(link, "ri:url")?.attributes["ri:value"]);
  if (address !== null) {
    return [
      {
        t: "link",
        href: address,
        children: label.length > 0 ? label : [{ t: "text", text: address }],
      },
    ];
  }
  // 공간 · 블로그 · 닻만 있는 링크 — 글로만 선다.
  if (label.length > 0) return label;
  const text = collapse(textContent(link)).trim();
  return text === "" ? [] : [{ t: "text", text }];
}

function imageOf(image: XmlElement): DocImage | null {
  const alt = image.attributes["ac:alt"] ?? image.attributes["ac:title"] ?? null;
  const widthText = image.attributes["ac:width"] ?? image.attributes["ac:original-width"];
  const width = widthText !== undefined && /^\d{1,5}$/u.test(widthText) ? Number(widthText) : null;
  const attachment = findDescendant(image, "ri:attachment");
  if (attachment !== null) {
    const filename = attachment.attributes["ri:filename"] ?? "";
    if (filename === "") return null;
    // 다른 문서 · 블로그의 첨부 — 이 문서의 첨부가 아니라 받지 않는다(자리만 선다).
    const other =
      findDescendant(attachment, "ri:page") !== null ||
      findDescendant(attachment, "ri:blog-post") !== null;
    return {
      source: other
        ? { kind: "attachment", filename, other: true }
        : { kind: "attachment", filename },
      alt,
      width,
    };
  }
  const url = safeHref(findDescendant(image, "ri:url")?.attributes["ri:value"]);
  if (url !== null && !url.toLowerCase().startsWith("mailto:")) {
    return { source: { kind: "url", url }, alt, width };
  }
  return null;
}

// ————— 블록 —————

/**
 * 섞인 몸 — 이어진 글 조각은 한 문단으로 묶고 블록 요소는 블록으로 세운다. 목록 항목 · 표 칸 ·
 * 패널 몸 · 단 칸이 모두 이 길을 탄다(글이 문단 없이 바로 오는 일이 흔하다).
 */
function flow(nodes: readonly XmlNode[], ctx: Ctx, depth: number): DocBlock[] {
  const out: DocBlock[] = [];
  let run: XmlNode[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const children = trimInlines(inlines(run, ctx, depth + 1));
    run = [];
    if (children.length > 0) out.push({ t: "p", children });
  };
  for (const node of nodes) {
    if (ctx.truncated) break;
    if (ctx.nodes > MAX_NODES) {
      ctx.truncated = true;
      break;
    }
    if (node.kind === "text") {
      if (run.length === 0 && isBlank(node.text)) continue;
      run.push(node);
      continue;
    }
    if (!isBlockNode(node)) {
      run.push(node);
      continue;
    }
    flush();
    out.push(...block(node, ctx, depth + 1));
  }
  flush();
  return out;
}

function block(node: XmlElement, ctx: Ctx, depth: number): DocBlock[] {
  ctx.nodes += 1;
  if (depth > MAX_DEPTH) return [{ t: "macro", name: "" }];
  const name = nameOf(node);
  const level = headingLevel(name);
  if (level > 0) {
    const children = trimInlines(inlines(node.children, ctx, depth + 1));
    return children.length === 0
      ? []
      : [{ t: "heading", level: level as 1 | 2 | 3 | 4 | 5 | 6, children }];
  }
  switch (name) {
    case "p":
      return paragraph(node, ctx, depth);
    case "ul":
    case "ol":
      return [listBlock(node, ctx, depth)];
    case "table":
      return [tableBlock(node, ctx, depth)];
    case "blockquote": {
      const blocks = flow(node.children, ctx, depth + 1);
      return blocks.length === 0 ? [] : [{ t: "quote", blocks }];
    }
    case "hr":
      return [{ t: "hr" }];
    case "pre":
      return [
        { t: "code", language: null, title: null, text: textContent(node).replace(/\n$/u, "") },
      ];
    case "ac:image": {
      const image = imageOf(node);
      return image === null ? [] : [{ t: "image", image }];
    }
    case "ac:structured-macro":
      return macroBlock(node, ctx, depth);
    case "ac:adf-extension":
      return adfBlock(node, ctx, depth);
    case "ac:layout":
      return layoutBlocks(node, ctx, depth);
    case "ac:task-list":
      return [tasksBlock(node, ctx, depth)];
    default:
      // div · section 같은 감싸개 — 안의 몸을 그대로 잇는다.
      return flow(node.children, ctx, depth + 1);
  }
}

/** 문단 — 안에 블록 매크로 · 홀로 선 그림이 있으면 그 자리에서 문단을 가른다. */
function paragraph(node: XmlElement, ctx: Ctx, depth: number): DocBlock[] {
  const out: DocBlock[] = [];
  let run: XmlNode[] = [];
  const flush = (): void => {
    const children = trimInlines(inlines(run, ctx, depth + 1));
    run = [];
    if (children.length === 0) return;
    // 홀로 선 그림 문단은 그림 블록으로 — 글 줄 안의 작은 그림이 아니라 본문 폭의 그림이다.
    const only = children.length === 1 ? children[0] : undefined;
    if (only?.t === "image") out.push({ t: "image", image: only.image });
    else out.push({ t: "p", children });
  };
  for (const child of node.children) {
    if (isSplittingMacro(child) && isElement(child)) {
      flush();
      out.push(...macroBlock(child, ctx, depth + 1));
      continue;
    }
    run.push(child);
  }
  flush();
  return out;
}

function listBlock(node: XmlElement, ctx: Ctx, depth: number): DocBlock {
  const items: DocBlock[][] = [];
  for (const child of node.children) {
    if (!isElement(child)) continue;
    const name = nameOf(child);
    if (name === "li") {
      items.push(flow(child.children, ctx, depth + 1));
    } else if (name === "ul" || name === "ol") {
      // 목록이 목록을 곧바로 싼 경우 — 앞 항목의 몸에 붙인다.
      const nested = listBlock(child, ctx, depth + 1);
      const last = items[items.length - 1];
      if (last === undefined) items.push([nested]);
      else last.push(nested);
    }
  }
  return { t: "list", ordered: nameOf(node) === "ol", items };
}

function spanOf(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{1,3}$/u.test(value)) return undefined;
  const number = Number(value);
  return number > 1 ? number : undefined;
}

function tableBlock(node: XmlElement, ctx: Ctx, depth: number): DocBlock {
  const rows: Extract<DocBlock, { t: "table" }>["rows"] = [];
  const take = (row: XmlElement): void => {
    const cells: Extract<DocBlock, { t: "table" }>["rows"][number]["cells"] = [];
    for (const cell of row.children) {
      if (!isElement(cell)) continue;
      const name = nameOf(cell);
      if (name !== "th" && name !== "td") continue;
      const colspan = spanOf(cell.attributes.colspan);
      const rowspan = spanOf(cell.attributes.rowspan);
      cells.push({
        header: name === "th",
        ...(colspan === undefined ? {} : { colspan }),
        ...(rowspan === undefined ? {} : { rowspan }),
        blocks: flow(cell.children, ctx, depth + 1),
      });
    }
    rows.push({ cells });
  };
  const walk = (parent: XmlElement): void => {
    for (const child of parent.children) {
      if (!isElement(child)) continue;
      const name = nameOf(child);
      if (name === "tr") take(child);
      else if (name === "thead" || name === "tbody" || name === "tfoot") walk(child);
    }
  };
  walk(node);
  return { t: "table", rows };
}

function tasksBlock(node: XmlElement, ctx: Ctx, depth: number): DocBlock {
  const items: Array<{ done: boolean; children: DocInline[] }> = [];
  for (const task of node.children) {
    if (!isElement(task) || nameOf(task) !== "ac:task") continue;
    const status = childElement(task, "ac:task-status");
    const body = childElement(task, "ac:task-body");
    items.push({
      done: status !== null && textContent(status).trim().toLowerCase() === "complete",
      children: body === null ? [] : trimInlines(inlines(body.children, ctx, depth + 1)),
    });
  }
  return { t: "tasks", items };
}

/** 단 나눔 — 칸이 하나뿐인 마디는 그냥 이어 붙이고, 둘 이상이면 단 블록이다. */
function layoutBlocks(node: XmlElement, ctx: Ctx, depth: number): DocBlock[] {
  const out: DocBlock[] = [];
  for (const section of node.children) {
    if (!isElement(section) || nameOf(section) !== "ac:layout-section") continue;
    const columns: DocBlock[][] = [];
    for (const cell of section.children) {
      if (!isElement(cell) || nameOf(cell) !== "ac:layout-cell") continue;
      columns.push(flow(cell.children, ctx, depth + 1));
    }
    const filled = columns.filter((column) => column.length > 0);
    if (filled.length === 1) out.push(...(filled[0] ?? []));
    else if (filled.length > 1) out.push({ t: "columns", columns: filled });
  }
  return out;
}

function richBody(node: XmlElement, ctx: Ctx, depth: number): DocBlock[] {
  const body = childElement(node, "ac:rich-text-body");
  return body === null ? [] : flow(body.children, ctx, depth + 1);
}

function plainBody(node: XmlElement): string {
  const plain = childElement(node, "ac:plain-text-body");
  return plain === null ? "" : textContent(plain).replace(/^\n+|\n+$/gu, "");
}

function macroBlock(node: XmlElement, ctx: Ctx, depth: number): DocBlock[] {
  ctx.nodes += 1;
  const name = macroName(node);
  // 옛 매크로의 패널 — info · note · warning · tip · panel(새 편집기의 결은 adfBlock 이 읽는다).
  const tone = MACRO_PANELS.has(name) ? PANEL_TONES[name] : undefined;
  if (tone !== undefined) {
    return [
      {
        t: "panel",
        tone,
        title: macroParameter(node, "title") || null,
        blocks: richBody(node, ctx, depth),
      },
    ];
  }
  if (name === "expand") {
    return [
      {
        t: "expand",
        title: macroParameter(node, "title") || null,
        blocks: richBody(node, ctx, depth),
      },
    ];
  }
  if (name === "code" || name === "noformat") {
    const language = macroParameter(node, "language");
    return [
      {
        t: "code",
        language: language === null || language === "" || language === "none" ? null : language,
        title: macroParameter(node, "title") || null,
        text: plainBody(node),
      },
    ];
  }
  if (name === "toc") {
    const min = Number.parseInt(macroParameter(node, "minLevel") ?? "", 10);
    const max = Number.parseInt(macroParameter(node, "maxLevel") ?? "", 10);
    const toc: Extract<DocBlock, { t: "toc" }> = { t: "toc", entries: [] };
    ctx.tocs.push({
      block: toc,
      min: Number.isFinite(min) ? min : 1,
      max: Number.isFinite(max) ? max : 7,
    });
    return [toc];
  }
  if (name === "section") {
    // 옛 단 나눔 — section 안의 column 매크로마다 한 칸.
    const body = childElement(node, "ac:rich-text-body");
    const columns: DocBlock[][] = [];
    for (const child of body?.children ?? []) {
      if (
        isElement(child) &&
        nameOf(child) === "ac:structured-macro" &&
        macroName(child) === "column"
      ) {
        columns.push(richBody(child, ctx, depth));
      }
    }
    if (columns.length > 1) return [{ t: "columns", columns }];
    return columns[0] ?? richBody(node, ctx, depth);
  }
  if (name === "column" || TRANSPARENT_MACROS.has(name)) return richBody(node, ctx, depth);
  if (INLINE_MACROS.has(name)) {
    const children = inlineMacro(node, ctx, depth);
    return children.length === 0 ? [] : [{ t: "p", children }];
  }
  return [{ t: "macro", name }];
}

/** 새 편집기의 확장 — 패널(panel-type)과 펼치기만 그린다. 그 밖은 옛 모양(fallback)이 있으면 그것을 읽는다. */
function adfBlock(node: XmlElement, ctx: Ctx, depth: number): DocBlock[] {
  const adf = childElement(node, "ac:adf-node");
  const type = adf?.attributes.type ?? "";
  if (adf !== null && type === "panel") {
    let panelType = "info";
    for (const child of adf.children) {
      if (
        isElement(child) &&
        nameOf(child) === "ac:adf-attribute" &&
        child.attributes.key === "panel-type"
      ) {
        panelType = textContent(child).trim().toLowerCase();
      }
    }
    const content = childElement(adf, "ac:adf-content");
    return [
      {
        t: "panel",
        tone: PANEL_TONES[panelType] ?? "panel",
        title: null,
        blocks: content === null ? [] : flow(content.children, ctx, depth + 1),
      },
    ];
  }
  if (adf !== null && (type === "expand" || type === "nested-expand" || type === "nestedExpand")) {
    let title: string | null = null;
    for (const child of adf.children) {
      if (
        isElement(child) &&
        nameOf(child) === "ac:adf-attribute" &&
        child.attributes.key === "title"
      ) {
        title = collapse(textContent(child)).trim() || null;
      }
    }
    const content = childElement(adf, "ac:adf-content");
    return [
      {
        t: "expand",
        title,
        blocks: content === null ? [] : flow(content.children, ctx, depth + 1),
      },
    ];
  }
  const fallback = childElement(node, "ac:adf-fallback");
  if (fallback !== null) return flow(fallback.children, ctx, depth + 1);
  return [{ t: "macro", name: type === "" ? "adf" : type }];
}

// ————— 나무 걷기 —————

function eachBlock(blocks: readonly DocBlock[], visit: (block: DocBlock) => void): void {
  for (const one of blocks) {
    visit(one);
    switch (one.t) {
      case "list":
        for (const item of one.items) eachBlock(item, visit);
        break;
      case "table":
        for (const row of one.rows) for (const cell of row.cells) eachBlock(cell.blocks, visit);
        break;
      case "quote":
      case "panel":
      case "expand":
        eachBlock(one.blocks, visit);
        break;
      case "columns":
        for (const column of one.columns) eachBlock(column, visit);
        break;
      default:
        break;
    }
  }
}

function eachInline(blocks: readonly DocBlock[], visit: (inline: DocInline) => void): void {
  const walk = (list: readonly DocInline[]): void => {
    for (const item of list) {
      visit(item);
      if (item.t === "mark" || item.t === "link" || item.t === "page") walk(item.children);
    }
  };
  eachBlock(blocks, (one) => {
    if (one.t === "heading" || one.t === "p") walk(one.children);
    else if (one.t === "tasks") for (const item of one.items) walk(item.children);
  });
}

/** 조각들의 맨 글 — 목차의 이름 · 시험의 대조가 쓴다. */
export function inlineText(list: readonly DocInline[]): string {
  let out = "";
  for (const item of list) {
    if (item.t === "text") out += item.text;
    else if (item.t === "mark" || item.t === "link" || item.t === "page")
      out += inlineText(item.children);
    else if (item.t === "status") out += item.text;
    else if (item.t === "emoji") out += item.text;
    else if (item.t === "date") out += item.value;
    else if (item.t === "br") out += " ";
  }
  return out;
}

/** 문서의 제목들 — 문서 순서로. */
export function viewHeadings(blocks: readonly DocBlock[]): Array<{ level: number; text: string }> {
  const out: Array<{ level: number; text: string }> = [];
  eachBlock(blocks, (one) => {
    if (one.t === "heading") {
      const text = collapse(inlineText(one.children)).trim();
      if (text !== "") out.push({ level: one.level, text });
    }
  });
  return out;
}

/** 멘션의 계정 id — 이름 풀기의 재료(같은 id 는 한 번). */
export function mentionAccountIds(blocks: readonly DocBlock[]): string[] {
  const ids = new Set<string>();
  eachInline(blocks, (item) => {
    if (item.t === "mention" && item.id !== undefined) ids.add(item.id);
  });
  return [...ids];
}

/** 멘션에 이름을 싣고 id 를 걷는다 — 못 푼 이름은 null 로 남는다. 나무를 그 자리에서 바꾼다. */
export function nameMentions(
  blocks: DocBlock[],
  names: ReadonlyMap<string, string | null>,
): DocBlock[] {
  eachInline(blocks, (item) => {
    if (item.t !== "mention") return;
    if (item.id !== undefined) item.name = names.get(item.id) ?? null;
    delete item.id;
  });
  return blocks;
}

/**
 * 저장 포맷 → 보기 블록. 빈 문서는 빈 줄이다. 목차는 문서 전체의 제목으로 채운다
 * (minLevel · maxLevel 을 지킨다). 상한에 닿으면 끝에 이름 없는 자리 표시가 하나 선다.
 */
export function storageView(storage: string): DocBlock[] {
  const ctx: Ctx = { nodes: 0, truncated: false, tocs: [] };
  const blocks = flow(parseXml(storage), ctx, 0);
  if (ctx.truncated) blocks.push({ t: "macro", name: "" });
  if (ctx.tocs.length > 0) {
    const headings = viewHeadings(blocks);
    for (const toc of ctx.tocs) {
      toc.block.entries = headings.filter(
        (heading) => heading.level >= toc.min && heading.level <= toc.max,
      );
    }
  }
  return blocks;
}
