/**
 * 저장 포맷 → 파생 마크다운 (2026-10-18 기획서 동기화 · 계획 항목 8 —
 * docs/confluence-sync-design-2026-10-18.md 「CDP 레포에 생기는 것」).
 *
 * 정본은 저장 포맷 한 벌뿐이다 — 이 변환은 보고 고치기용 파생물을 만들 뿐, 마크다운을
 * 다시 정본으로 쓰지 않는다(1단계 원칙 1). 점검된 부분집합(제목 · 문단 · 목록 · 표 ·
 * 코드 · 인용 · 수평선 · 링크 · 첨부 참조)만 담는다. 못 담는 매크로는
 * `[Confluence 매크로: …]` 자리 표시 문장으로 내려앉고, 첨부 참조는 `[첨부: …]` 자리
 * 표시 문장으로 내려앉는다 — 깨진 마크다운 링크는 절대 만들지 않는다(리스크 4).
 *
 * 순수 모듈이다 — 형제 임포트도 의존성도 없다.
 */

export interface ConfluenceMeta {
  pageId: string;
  space: string | null;
  title: string;
  version: number;
  updatedAt: string | null;
}

export interface ConfluenceSection {
  heading: string;
  macro: boolean;
}

export interface ConfluenceDerived {
  markdown: string;
  sections: ConfluenceSection[];
}

// ————— 머리말 — 설계 문서 예시 그대로의 모양 —————

/** 문서 머리말 — version 은 따옴표 없는 숫자, 정해진 키만 나간다. */
function frontmatter(meta: ConfluenceMeta, stage?: string): string {
  const lines = ["---", "confluence:", `  pageId: ${yamlString(meta.pageId)}`];
  if (meta.space !== null) lines.push(`  space: ${yamlString(meta.space)}`);
  lines.push(`  title: ${yamlString(meta.title)}`, `  version: ${meta.version}`);
  if (meta.updatedAt !== null) lines.push(`  updatedAt: ${yamlString(meta.updatedAt)}`);
  if (stage !== undefined) lines.push(`stage: ${yamlString(stage)}`);
  lines.push("---", "");
  return lines.join("\n");
}

/** YAML 이중따옴표 문자열 — `"` 와 `\` 는 역슬래시로, 줄바꿈은 `\n` 으로 감는다. */
function yamlString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r\n|\r|\n/g, "\\n");
  return `"${escaped}"`;
}

// ————— 관용 XML 파서 — 저장 포맷은 사실상 XHTML, 튀어도 멈추지 않는다 —————

interface XmlText {
  kind: "text";
  text: string;
}

interface XmlElement {
  kind: "element";
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
}

type XmlNode = XmlText | XmlElement;

/** 스스로 닫히지 않아도 덩어리로 끝나는 글자들 — 저장 포맷은 보통 스스로 닫는다. */
const VOID_TAGS = new Set(["br", "hr", "img"]);

/** 저장 포맷 한 편 → 덩어리의 나열. 여는 · 닫는 표가 어긋나도 아는 것까지만 산다. */
function parseXml(source: string): XmlNode[] {
  const root: XmlElement = { kind: "element", name: "#document", attributes: {}, children: [] };
  const stack: XmlElement[] = [root];
  const append = (text: string): void => {
    if (text === "") return;
    const parent = stack[stack.length - 1];
    if (parent !== undefined) parent.children.push({ kind: "text", text });
  };
  let at = 0;
  while (at < source.length) {
    const open = source.indexOf("<", at);
    if (open === -1) {
      append(decodeEntities(source.slice(at)));
      break;
    }
    if (open > at) append(decodeEntities(source.slice(at, open)));
    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open);
      at = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", open)) {
      const end = source.indexOf("]]>", open);
      append(source.slice(open + 9, end === -1 ? source.length : end));
      at = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith("<!", open) || source.startsWith("<?", open)) {
      const end = source.indexOf(">", open);
      at = end === -1 ? source.length : end + 1;
      continue;
    }
    const close = source.indexOf(">", open);
    if (close === -1) {
      append(source.slice(open));
      break;
    }
    const tag = source.slice(open, close + 1);
    if (tag.startsWith("</")) {
      const name = tag.slice(2, -1).trim();
      for (let depth = stack.length - 1; depth >= 1; depth -= 1) {
        if (stack[depth]?.name === name) {
          stack.length = depth;
          break;
        }
      }
      at = close + 1;
      continue;
    }
    const parent = stack[stack.length - 1];
    if (parent === undefined) break;
    const { element, selfClosed } = parseTag(tag);
    parent.children.push(element);
    if (!selfClosed && !VOID_TAGS.has(element.name)) stack.push(element);
    at = close + 1;
  }
  return root.children;
}

/** 여는 표 하나 — 이름과 속성(값의 글자 참조도 푼다)과 스스로 닫힘 여부. */
function parseTag(tag: string): { element: XmlElement; selfClosed: boolean } {
  let body = tag.slice(1, -1);
  let selfClosed = false;
  if (body.endsWith("/")) {
    selfClosed = true;
    body = body.slice(0, -1);
  }
  const nameMatch = /^[^\s/>]+/u.exec(body);
  const name = nameMatch === null ? "" : (nameMatch[0] ?? "");
  const attributes: Record<string, string> = {};
  const attributePattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/gu;
  for (const match of body.slice(name.length).matchAll(attributePattern)) {
    const key = match[1];
    if (key === undefined || key === "") continue;
    attributes[key] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return { element: { kind: "element", name, attributes, children: [] }, selfClosed };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
};

/** 글자 참조 풀기 — XML 다섯 개와 자주 섞이는 nbsp 까지. 모르는 참조는 그대로 둔다. */
function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith("#x")) return codePoint(Number.parseInt(body.slice(2), 16)) ?? whole;
    if (body.startsWith("#")) return codePoint(Number.parseInt(body.slice(1), 10)) ?? whole;
    return NAMED_ENTITIES[body] ?? whole;
  });
}

const codePoint = (code: number): string | null =>
  Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : null;

// ————— 읽기 도우미 —————

/** 안에 든 글자 전부 — 마크다운 표식 없이(원장 sections 의 제목 · 코드 칸 등). */
function textContent(node: XmlNode): string {
  if (node.kind === "text") return node.text;
  let out = "";
  for (const child of node.children) out += textContent(child);
  return out;
}

/** 줄바꿈 · 붙은 빈칫글을 한 칸으로 — 문단 글의 결을 고른다(불각 공백은 산다). */
function collapse(text: string): string {
  return text.replace(/[ \t\r\n]+/gu, " ");
}

/** h1–h6 만 절 제목이다 — 머리말의 제목은 절이 아니다. */
function headingLevel(name: string): number {
  const match = /^h([1-6])$/u.exec(name);
  return match === null ? 0 : Number.parseInt(match[1] ?? "0", 10);
}

/** 자손 중 첫 해당 요소 — 네임스페이스 접두(ac: · ri:)는 그대로 쓴다. */
function findDescendant(node: XmlElement, name: string): XmlElement | null {
  for (const child of node.children) {
    if (child.kind !== "element") continue;
    if (child.name === name) return child;
    const found = findDescendant(child, name);
    if (found !== null) return found;
  }
  return null;
}

// ————— 몸 변환 — 점검된 부분집합만 —————

/** 덩어리의 나열 → 빈 줄로 이은 몸. 빈 문서는 빈 몸이다. */
function renderBody(nodes: readonly XmlNode[]): string {
  const blocks: string[] = [];
  for (const node of nodes) {
    const block = node.kind === "text" ? collapse(node.text).trim() : renderBlock(node);
    if (block !== "") blocks.push(block);
  }
  return blocks.join("\n\n");
}

/** 덩어리 하나 — 모르는 요소는 겉껍데기만 벗긴다(cycle-ledger 관용과 같은 길). */
function renderBlock(node: XmlElement): string {
  const level = headingLevel(node.name);
  if (level > 0) {
    const text = renderInline(node.children).trim();
    return `${"#".repeat(level)} ${text}`.trimEnd();
  }
  switch (node.name) {
    case "p":
      return renderInline(node.children).trim();
    case "ul":
    case "ol":
      return renderList(node, 0);
    case "blockquote": {
      const inner = renderBody(node.children);
      if (inner === "") return "";
      return inner
        .split("\n")
        .map((line) => (line === "" ? ">" : `> ${line}`))
        .join("\n");
    }
    case "hr":
      return "---";
    case "table":
      return renderTable(node);
    case "ac:structured-macro":
      return renderMacro(node);
    case "ac:image":
      return renderImage(node);
    case "ac:link":
      return renderLink(node);
    default:
      return renderBody(node.children);
  }
}

/** 한 줄 안의 꾸밈 — 문단 · 칸 · 목록 항목의 몸에 쓴다. */
function renderInline(nodes: readonly XmlNode[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (node.kind === "text") {
      parts.push(collapse(node.text));
      continue;
    }
    parts.push(renderInlineElement(node));
  }
  return parts.join("");
}

function renderInlineElement(node: XmlElement): string {
  const inner = renderInline(node.children);
  switch (node.name) {
    case "strong":
    case "b": {
      const text = inner.trim();
      return text === "" ? "" : `**${text}**`;
    }
    case "em":
    case "i": {
      const text = inner.trim();
      return text === "" ? "" : `*${text}*`;
    }
    case "s":
    case "strike":
    case "del": {
      const text = inner.trim();
      return text === "" ? "" : `~~${text}~~`;
    }
    case "code":
      return codeSpan(collapse(textContent(node)).trim());
    case "br":
      return "\n";
    case "a": {
      const href = node.attributes.href;
      const text = inner.trim() || href || "";
      return href === undefined || href === "" ? text : `[${text}](${href})`;
    }
    case "ac:link":
      return renderLink(node);
    case "ac:image":
      return renderImage(node);
    case "ri:attachment":
      return `[첨부: ${node.attributes["ri:filename"] ?? ""}]`;
    case "ac:structured-macro":
      return renderMacro(node);
    default:
      return inner;
  }
}

/**
 * Confluence 링크 — 마크다운 링크(`[…](…)`)로 만들지 않는다. 링크가 가리키는 글
 * (ri:content-title · ri:value · 링크 몸글)을 그대로 글자로 내놓는다.
 */
function renderLink(link: XmlElement): string {
  const attachment = findDescendant(link, "ri:attachment");
  if (attachment !== null) return `[첨부: ${attachment.attributes["ri:filename"] ?? ""}]`;
  const body = findDescendant(link, "ac:plain-text-link-body");
  if (body !== null) {
    const text = textContent(body).trim();
    if (text !== "") return text;
  }
  const pageTitle = findDescendant(link, "ri:page")?.attributes["ri:content-title"];
  if (typeof pageTitle === "string" && pageTitle !== "") return pageTitle;
  const address = findDescendant(link, "ri:url")?.attributes["ri:value"];
  if (typeof address === "string" && address !== "") return address;
  return collapse(textContent(link)).trim();
}

/** 그림 · 첨부 참조 — 내려받지 않고(1단계 밖) 자리 표시 문장으로만 말한다. */
function renderImage(image: XmlElement): string {
  const attachment = findDescendant(image, "ri:attachment");
  if (attachment !== null) return `[첨부: ${attachment.attributes["ri:filename"] ?? ""}]`;
  const address = findDescendant(image, "ri:url")?.attributes["ri:value"];
  if (typeof address === "string" && address !== "") return `[첨부: ${address}]`;
  const text = collapse(textContent(image)).trim();
  return text === "" ? "" : `[첨부: ${text}]`;
}

/** 코드 칸 — 몸에 역따옴표가 있으면 구분을 한 칸 늘리고 여백을 둔다. */
function codeSpan(code: string): string {
  if (code === "") return "";
  let longest = 0;
  for (const run of code.matchAll(/`+/gu)) longest = Math.max(longest, run[0].length);
  const delimiter = "`".repeat(longest + 1);
  return code.startsWith("`") || code.endsWith("`")
    ? `${delimiter} ${code} ${delimiter}`
    : `${delimiter}${code}${delimiter}`;
}

/** 매크로 하나 — 코드는 언어 붙은 울타리로, 그 밖은 자리 표시 문장으로. */
function renderMacro(macro: XmlElement): string {
  const name = macro.attributes["ac:name"] ?? "";
  if (name === "code") return fencedCode(macroBody(macro), macroParameter(macro, "language"));
  return `[Confluence 매크로: ${name}]`;
}

function macroParameter(macro: XmlElement, key: string): string | null {
  for (const child of macro.children) {
    if (child.kind !== "element" || child.name !== "ac:parameter") continue;
    if (child.attributes["ac:name"] === key) return collapse(textContent(child)).trim();
  }
  return null;
}

/** 매크로 몸 — 코드 매크로의 CDATA 본문을 그대로 갈무리한다. */
function macroBody(macro: XmlElement): string {
  const plain = findDescendant(macro, "ac:plain-text-body");
  if (plain !== null) return textContent(plain);
  for (const child of macro.children) {
    if (child.kind === "element" && child.name.endsWith("-body")) return textContent(child);
  }
  return "";
}

/** 울타리 코드 — 몸에 울타리가 있으면 한 칸 더 길게 만든다. */
function fencedCode(body: string, language: string | null): string {
  const code = body.trim();
  let longest = 0;
  for (const run of code.matchAll(/`+/gu)) longest = Math.max(longest, run[0].length);
  const fence = "`".repeat(Math.max(3, longest + 1));
  const label = language === null || language === "" || language === "none" ? "" : language;
  return `${fence}${label}\n${code}\n${fence}`;
}

/** 목록 — 한 층 들어갈 때마다 두 칸(설계 규칙). 목록 항목의 몸은 한 줄로. */
function renderList(list: XmlElement, depth: number): string {
  const ordered = list.name === "ol";
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  let index = 0;
  for (const item of list.children) {
    if (item.kind !== "element") continue;
    if (item.name === "ul" || item.name === "ol") {
      // 목록이 목록을 곧바로 싼 경우 — 같은 층에 이어 붙인다.
      lines.push(renderList(item, depth));
      continue;
    }
    if (item.name !== "li") continue;
    index += 1;
    const marker = ordered ? `${index}. ` : "- ";
    const nested: XmlElement[] = [];
    const inlineParts: XmlNode[] = [];
    for (const part of item.children) {
      if (part.kind === "element" && (part.name === "ul" || part.name === "ol")) nested.push(part);
      else inlineParts.push(part);
    }
    const text = renderInline(inlineParts).trim();
    lines.push(`${indent}${marker}${text}`.trimEnd());
    for (const sub of nested) lines.push(renderList(sub, depth + 1));
  }
  return lines.join("\n");
}

/** 표의 줄 — thead · tbody · tr 어느 모양이든 문서 순서로. */
function tableRows(table: XmlElement): XmlElement[][] {
  const rows: XmlElement[][] = [];
  const take = (row: XmlElement): void => {
    const cells: XmlElement[] = [];
    for (const child of row.children) {
      if (child.kind === "element" && (child.name === "th" || child.name === "td")) {
        cells.push(child);
      }
    }
    rows.push(cells);
  };
  for (const child of table.children) {
    if (child.kind !== "element") continue;
    if (child.name === "tr") take(child);
    else if (child.name === "thead" || child.name === "tbody" || child.name === "tfoot") {
      for (const row of child.children) {
        if (row.kind === "element" && row.name === "tr") take(row);
      }
    }
  }
  return rows;
}

/** 칸 하나 — 줄바꿈은 한 칸으로, `|` 는 이스케이프한다(GFM 규칙). */
function cellText(cell: XmlElement): string {
  return renderInline(cell.children)
    .replace(/[ \t\r\n]+/gu, " ")
    .trim()
    .replace(/\|/gu, "\\|");
}

/** GFM 표 — 첫 줄이 머리칸이다. */
function renderTable(table: XmlElement): string {
  const rows = tableRows(table);
  const header = rows[0];
  if (header === undefined || header.length === 0) return "";
  const lines = [`| ${header.map((cell) => cellText(cell)).join(" | ")} |`];
  lines.push(`| ${header.map(() => "---").join(" | ")} |`);
  for (const row of rows.slice(1)) {
    lines.push(`| ${row.map((cell) => cellText(cell)).join(" | ")} |`);
  }
  return lines.join("\n");
}

// ————— 절 판정 — 제목마다 한 항목, 매크로가 든 절은 macro: true —————

/**
 * 절 판정 — 제목 다음 제목(무른 등급 포함)까지의 사이에 매크로(ac:structured-macro —
 * 코드 매크로도)가 하나라도 있으면 macro: true 다. 첫 제목 앞의 매크로는 아무 절에도
 * 들지 않는다. 머리말의 제목은 절이 아니다(본문의 제목만 센다).
 */
function collectSections(nodes: readonly XmlNode[]): ConfluenceSection[] {
  const sections: ConfluenceSection[] = [];
  const walk = (list: readonly XmlNode[]): void => {
    for (const node of list) {
      if (node.kind !== "element") continue;
      if (headingLevel(node.name) > 0) {
        sections.push({ heading: collapse(textContent(node)).trim(), macro: false });
        continue;
      }
      if (node.name === "ac:structured-macro") {
        const current = sections[sections.length - 1];
        if (current !== undefined) current.macro = true;
      }
      walk(node.children);
    }
  };
  walk(nodes);
  return sections;
}

/** 저장 포맷 → 파생 마크다운 + 절 목록. 빈 문서도 멈추지 않는다(머리말만 나간다). */
export function deriveMarkdown(
  storage: string,
  meta: ConfluenceMeta,
  stage?: string,
): ConfluenceDerived {
  const forest = parseXml(storage);
  const head = frontmatter(meta, stage);
  const body = renderBody(forest);
  return {
    markdown: body === "" ? head : `${head}\n${body}\n`,
    sections: collectSections(forest),
  };
}
