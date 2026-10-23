import { matchRange } from "../../components/shell/palette-match.ts";
import { timeAgo } from "../../lib/format.ts";
import { L } from "../labels.ts";

/**
 * 기획서 칸의 순수 조립(2026-10-18 기획서 동기화 1단계 · M4, 같은 날 개선 패스) — 원장의
 * 납작한 문서 행을 화면의 목록 · 찾기 · 본문으로 세운다. 시험은 리액트 없이 이 조립을 잰다.
 */

/** 원장이 아는 문서 한 행 — doc.list 의 docs 와 같은 모양. */
export interface PlanDoc {
  pageId: string;
  title: string;
  version: number;
  path: string;
}

/** 원장이 아는 Confluence 폴더 한 행 — doc.list 의 folders 와 같은 모양. */
export interface PlanFolder {
  folderId: string;
  title: string;
  path: string;
}

/** 이 앱이 열지 못하는 Confluence 전용 항목 한 행 — doc.list 의 unsupported 와 같은 모양. */
export interface PlanUnsupported {
  contentId: string;
  title: string;
  path: string;
  type: string;
}

/** 목록의 한 행 — 폴더 계층이 곧 들여쓰기고, 아래에 줄이 달린 줄은 접을 수 있다. */
export interface PlanListRow {
  /** 줄의 열쇠 — 문서는 pageId, 폴더는 folderId, 전용 항목은 contentId 다. */
  pageId: string;
  title: string;
  version: number;
  /** 줄의 종류 — 문서 · 폴더 · 이 앱이 열지 못하는 Confluence 전용 항목. */
  kind: "doc" | "folder" | "unsupported";
  /** 전용 항목의 Confluence 종류(화이트보드 등) — 문서 · 폴더는 null 이다. */
  type: string | null;
  depth: number;
  /** 바로 아래에 줄이 달려 있는가 — 접는 단추가 서는 줄(폴더 줄도 아래 줄이 있으면 참이다). */
  hasChildren: boolean;
  /** 바로 위 폴더의 이름 — 찾기 결과의 둘째 줄이 된다(뿌리는 빈 글). */
  folder: string;
}

/** 본문에 선 문서가 선택 줄이다. 새 문서 초안이면 문서 트리는 비운다(2026-10-24 RS 3). */
export function selectedPlanPage(
  openId: string | null,
  draftKey: string | null,
  draftPageId: string | null,
  drafts: ReadonlyArray<{ docKey: string; pageId: string | null }>,
): string | null {
  if (draftKey === null) return openId;
  const draft = drafts.find((one) => one.docKey === draftKey);
  if (draft !== undefined) return draft.pageId;
  // 요약이 아직 오지 않았어도 기존 문서 초안의 열쇠는 문서 번호를 안다.
  return draftPageId ?? (draftKey.startsWith("p-") ? draftKey.slice(2) || null : null);
}

/** 마지막 문서 → 원장의 기준 페이지 → 첫 문서. 방금 휴지통에 넣은 것은 제외한다(2026-10-24 RS 4). */
export function initialPlanPage(
  rows: readonly PlanListRow[],
  roots: readonly string[],
  lastViewed: string | null,
  excluded: string | null = null,
): string | null {
  const docs = rows.filter((row) => row.kind === "doc" && row.pageId !== excluded);
  const available = new Set(docs.map((row) => row.pageId));
  if (lastViewed !== null && available.has(lastViewed)) return lastViewed;
  return roots.find((id) => available.has(id)) ?? docs[0]?.pageId ?? null;
}

/** 숫자는 숫자로 센다 — `v2` 가 `v10` 앞에, `02.` 가 `10.` 앞에. */
const collator = new Intl.Collator("ko", { numeric: true });

/**
 * 경로를 걸음 단위로 견준다 — 글자 통째로 견주면 `정책서 v2` 처럼 이름이 앞 폴더 이름으로 시작하는 형제가
 * 폴더와 그 아래 문서 사이로 끼어든다(공백이 `/` 보다 앞이라). 걸음 단위면 폴더 아래가 늘 이어서 선다.
 */
function comparePaths(a: string, b: string): number {
  const left = a.split("/");
  const right = b.split("/");
  const shared = Math.min(left.length, right.length);
  for (let at = 0; at < shared; at += 1) {
    const order = collator.compare(left[at] ?? "", right[at] ?? "");
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

/**
 * 목록 조립 — 문서 · 폴더 · Confluence 전용 항목을 한 목록으로 세운다. 경로의 걸음 순서로 서고(폴더 아래가
 * 이어서 선다) 깊이를 잰다. 깊이는 가장 짧은 경로(공간과 뿌리 문서가 같은 자리다)를 0 으로 한 걸음 수 차이다.
 * 폴더 줄은 folders 에서만 만든다 — 문서 경로에서 폴더를 추리지 않는다(2026-10-23 최종 구현 계획 F0).
 * 그래서 아래 문서가 없는 폴더도 줄로 선다.
 */
export function planRows(
  docs: PlanDoc[],
  folders: PlanFolder[] = [],
  unsupported: PlanUnsupported[] = [],
): PlanListRow[] {
  // 깊이 · 아래 달림은 모든 줄을 모은 뒤에 재는 것 — 줄 모양에서 열쇠와 경로만 먼저 모은다.
  type Entry = Pick<PlanListRow, "pageId" | "title" | "version" | "kind" | "type"> & {
    path: string;
  };
  const entries: Entry[] = [
    ...docs.map((doc): Entry => ({ ...doc, kind: "doc", type: null })),
    ...folders.map(
      (folder): Entry => ({
        pageId: folder.folderId,
        title: folder.title,
        version: 0,
        kind: "folder",
        type: null,
        path: folder.path,
      }),
    ),
    ...unsupported.map(
      (item): Entry => ({
        pageId: item.contentId,
        title: item.title,
        version: 0,
        kind: "unsupported",
        type: item.type,
        path: item.path,
      }),
    ),
  ];
  const sorted = [...entries].sort((a, b) => comparePaths(a.path, b.path));
  const shallowest = sorted.reduce(
    (least, entry) => Math.min(least, entry.path.split("/").length),
    Infinity,
  );
  // 바로 위 경로의 집합 — 모든 줄의 경로에서 마지막 걸음을 떼고 모은다. 폴더 줄도 그 자리에
  // 아래 줄이 서면 접는 단추가 필요하다.
  const parents = new Set<string>();
  for (const entry of sorted) {
    const cut = entry.path.lastIndexOf("/");
    if (cut > 0) parents.add(entry.path.slice(0, cut));
  }
  return sorted.map((entry) => {
    const parts = entry.path.split("/");
    const depth = Math.max(parts.length - shallowest, 0);
    return {
      pageId: entry.pageId,
      title: entry.title,
      version: entry.version,
      kind: entry.kind,
      type: entry.type,
      depth,
      hasChildren: parents.has(entry.path),
      folder: depth === 0 ? "" : (parts[parts.length - 2] ?? ""),
    };
  });
}

/**
 * 접힌 폴더 아래를 가린 줄들 — 줄은 폴더 아래가 이어서 서므로(위 `planRows`) 접힌 줄 뒤로 더 깊은 줄이 이어지는
 * 동안이 그 폴더의 자손이다.
 */
export function visiblePlanRows(
  rows: PlanListRow[],
  collapsed: ReadonlySet<string>,
): PlanListRow[] {
  const shown: PlanListRow[] = [];
  let hiddenBelow: number | null = null;
  for (const row of rows) {
    if (hiddenBelow !== null) {
      if (row.depth > hiddenBelow) continue;
      hiddenBelow = null;
    }
    shown.push(row);
    if (row.hasChildren && collapsed.has(row.pageId)) hiddenBelow = row.depth;
  }
  return shown;
}

/** 찾는 말의 조각들 — 공백으로 나눈 조각이 모두 들어 있어야 맞는다. 대소문자 · 한글 조합 방식은 가리지 않는다. */
function searchTokens(query: string): string[] {
  return query.normalize("NFC").toLowerCase().split(/\s+/u).filter(Boolean);
}

/**
 * 찾기 — 제목과 바로 위 폴더 이름에서 찾고, 순서는 목록의 순서를 지킨다. 찾는 말이 비면 그대로다.
 * 폴더 줄은 결과에서 뺀다 — 찾는 것은 문서와 Confluence 전용 항목뿐이다(2026-10-23 최종 구현 계획 F0).
 */
export function filterPlanRows(rows: PlanListRow[], query: string): PlanListRow[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return rows;
  return rows.filter((row) => {
    if (row.kind === "folder") return false;
    const haystack = `${row.title} ${row.folder}`.normalize("NFC").toLowerCase();
    return tokens.every((token) => matchRange(token, haystack) !== null);
  });
}

/**
 * 매크로가 든 절의 머리말만 가린다 — 뷰어는 이 자리를 `Confluence 에서만 온전히 보이는 부분` 상자로
 * 알리고, 본문의 자리 표시는 원문이 대신한다.
 */
export function macroHeadings(sections: Array<{ heading: string; macro: boolean }>): string[] {
  return sections.filter((section) => section.macro).map((section) => section.heading);
}

// ── 본문 — 머리말을 떼고, 자리 표시를 읽히는 말로

/** 문서 머리말이 알리는 것 — 본문 위의 한 줄(판 · 고친 때)과 제목이 쓴다. */
export interface PlanMeta {
  title: string | null;
  version: number | null;
  updatedAt: string | null;
}

const NO_META: PlanMeta = { title: null, version: null, updatedAt: null };

/** 따옴표 값 — 데몬이 `"` · `\` · 줄바꿈을 역슬래시로 감싼다. 따옴표가 없으면 그대로. */
function unquote(value: string): string {
  const text = value.trim();
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"')) return text;
  return text.slice(1, -1).replace(/\\(["\\n])/gu, (_whole, mark: string) => {
    return mark === "n" ? "\n" : mark;
  });
}

/**
 * 파생 마크다운의 머리말을 뗀다 — 데몬은 문서 맨 위에 `---` · `confluence:` · 들여 쓴 키들 · `---` 를 남긴다.
 * 그대로 그리면 마크다운이 이를 가로줄 + 큰 제목으로 읽어 모든 문서가 깨진 제목으로 열린다. 머리말이 없거나
 * 닫히지 않으면 본문 전체를 돌려준다.
 */
export function splitFrontmatter(markdown: string): { meta: PlanMeta; body: string } {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== "---" || lines[1]?.trim() !== "confluence:") {
    return { meta: NO_META, body: markdown };
  }
  const close = lines.findIndex((line, at) => at > 1 && line.trim() === "---");
  if (close === -1) return { meta: NO_META, body: markdown };
  const meta: PlanMeta = { title: null, version: null, updatedAt: null };
  for (const line of lines.slice(2, close)) {
    const match = /^\s*(title|version|updatedAt):\s*(.*)$/u.exec(line);
    if (match === null) continue;
    const value = unquote(match[2] ?? "");
    if (match[1] === "title") meta.title = value === "" ? null : value;
    else if (match[1] === "updatedAt") meta.updatedAt = value === "" ? null : value;
    else if (/^\d+$/u.test(value)) meta.version = Number(value);
  }
  return {
    meta,
    body: lines
      .slice(close + 1)
      .join("\n")
      .replace(/^\n+/u, ""),
  };
}

/** 정규식 조각으로 쓸 글자 — 마커에 든 특수 문자를 문자 그대로 맞춘다. */
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** 데몬의 자리 표시 `[<마커>: <이름>]` — 한 줄 전체가 그것이면 상자, 문장 속이면 알약 글이다. */
function placeholder(marker: string): { whole: RegExp; inline: RegExp } {
  const core = `\\[${escapeRegExp(marker)}: ([^\\]\\n]+)\\]`;
  return { whole: new RegExp(`^\\s*${core}\\s*$`, "u"), inline: new RegExp(core, "gu") };
}

const MACRO = placeholder(L.plans.macroMarker);
const ATTACH = placeholder(L.plans.attachMarker);

/** 본문 덩어리 — 마크다운 글, 아니면 Confluence 에서만 보이는 자리의 상자. */
export type PlanBodyBlock = { kind: "md"; text: string } | { kind: "note"; text: string };

/** 코드 칸의 안에 못 들어가는 글자 — 역따옴표(\u0060)는 홑따옴표로. */
const TICK = "\u0060";
const inCode = (text: string) => TICK + text.replaceAll(TICK, "'") + TICK;

/** 울타리 코드의 여는 줄 — 역따옴표나 물결 셋 이상. */
const FENCE = /^\s*([~\u0060]{3,})/u;

/**
 * 본문 조립 — 데몬이 매크로 · 첨부를 남기는 자리 표시를 읽히는 말로 바꾼다. 한 줄 전체가 자리 표시면
 * 본문에서 떼어 상자로 세우고, 문장이나 표 칸 속이면 코드 칸 알약으로 바꾼다. 울타리 코드 안은 건드리지
 * 않는다(코드 매크로의 본문은 이미 그대로 들어 있다).
 */
export function planBodyBlocks(body: string): PlanBodyBlock[] {
  const blocks: PlanBodyBlock[] = [];
  let pending: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    const text = pending.join("\n").replace(/^\n+|\n+$/gu, "");
    if (text !== "") blocks.push({ kind: "md", text });
    pending = [];
  };
  for (const line of body.split("\n")) {
    const mark = FENCE.exec(line)?.[1] ?? null;
    if (fence !== null) {
      // 같은 글자로 같거나 더 길게 닫힌다.
      if (mark !== null && mark[0] === fence[0] && mark.length >= fence.length) fence = null;
      pending.push(line);
      continue;
    }
    if (mark !== null) {
      fence = mark;
      pending.push(line);
      continue;
    }
    const macro = MACRO.whole.exec(line)?.[1];
    const attach = macro === undefined ? ATTACH.whole.exec(line)?.[1] : undefined;
    if (macro !== undefined || attach !== undefined) {
      flush();
      blocks.push({
        kind: "note",
        text: macro !== undefined ? L.plans.macroInline(macro) : L.plans.attachInline(attach ?? ""),
      });
      continue;
    }
    pending.push(
      line
        .replace(MACRO.inline, (_whole, name: string) => inCode(L.plans.macroInline(name)))
        .replace(ATTACH.inline, (_whole, name: string) => inCode(L.plans.attachInline(name))),
    );
  }
  flush();
  return blocks;
}

// ── 코멘트 · 가져오기 · 바깥 링크

/** doc.read 의 코멘트 한 행 — 화면이 바로 그리는 모양으로 세운다. */
export interface PlanCommentRow {
  /** 줄의 열쇠 — id 가 있으면 `c-<id>`, 없을 때만 자리 번호다(2026-10-23 · R3 의심 1). */
  key: string;
  author: string;
  anchor: string | null;
  when: string | null;
  body: string;
  /** 코멘트 쓰기의 재료(2026-10-23 · 최종 구현 계획 F4) — id 나 version 이 없는 줄은 옛 데몬의 것이다. */
  id: string | null;
  kind: "footer" | "inline" | null;
  version: number | null;
  parentId: string | null;
  /** 앱에서 고쳐도 잃는 것이 없는가 — 내 코멘트이고 문단 · 줄바꿈 · 글뿐일 때다. */
  editable: boolean;
}

/** 코멘트 줄 조립 — 작성자의 이름이 없으면 `이름 없음` 으로, 시각은 문장으로 잰다. */
export function planCommentRows(
  comments: Array<{
    author: string;
    body: string;
    createdAt: string | null;
    anchorText: string | null;
    id?: string;
    kind?: "footer" | "inline" | null;
    version?: number | null;
    parentId?: string | null;
    editable?: boolean;
  }>,
): PlanCommentRow[] {
  return comments.map((comment, index) => ({
    // id 있으면 그것 — 조용한 다시 읽기로 줄이 끼어들어도 열려 있는 답글 · 고치기 입력이 다른
    // 코멘트 아래로 옮겨 붙지 않게(2026-10-23 · R3 의심 1). id 없는 옛 줄만 자리 번호다.
    key: comment.id === undefined ? String(index) : `c-${comment.id}`,
    author: comment.author === "" ? L.plans.commentNoAuthor : comment.author,
    anchor: comment.anchorText === null ? null : L.plans.commentAnchor(comment.anchorText),
    when: comment.createdAt === null ? null : timeAgo(Date.parse(comment.createdAt)),
    body: comment.body,
    id: comment.id ?? null,
    kind: comment.kind ?? null,
    version: comment.version ?? null,
    parentId: comment.parentId ?? null,
    editable: comment.editable === true,
  }));
}

/**
 * 가져오기의 끝 한 줄 — 바뀐 것이 없으면 그렇게, 한 번에 가져올 수 있는 상한에 닿았으면 더 눌러야 한다고
 * 말한다(데몬이 한 바퀴에 가져오는 수에 상한이 있다).
 */
export function importLine(result: { imported: number; capped: boolean }): string {
  if (result.capped) return L.plans.importCapped(result.imported);
  return result.imported === 0 ? L.plans.importUpToDate : L.plans.importChanged(result.imported);
}

/** 마지막 가져오기의 끝 — 잠깐 보였다 걷힌다. */
export type PlanImportEnd =
  | { kind: "done"; imported: number; capped: boolean }
  | { kind: "failed" };

/** 위 막대 아래 한 줄이 지금 말하는 것 — 색은 뜻의 보조일 뿐이고 말이 따로 선다. */
export interface PlanSyncLine {
  tone: "plain" | "warn" | "bad";
  text: string;
}

/**
 * 가져오기 줄 — 지금 가져오는 중이면 그것이, 아니면 연결이 끊긴 것이(가져오기가 진 이유이므로) 앞서고, 그다음이
 * 방금 끝난 가져오기의 결과 · 마지막으로 가져온 때 · 아직 없음 순서다.
 */
export function syncLine(
  summary: { expired: boolean; lastImportAt: string | null; pages: number } | undefined,
  importing: boolean,
  end: PlanImportEnd | null,
): PlanSyncLine {
  if (importing) return { tone: "plain", text: L.plans.importing };
  if (summary?.expired) return { tone: "warn", text: L.plans.statusExpired };
  if (end?.kind === "failed") return { tone: "bad", text: L.plans.importFailed };
  if (end?.kind === "done") return { tone: "plain", text: importLine(end) };
  if (summary?.lastImportAt != null) {
    const when = timeAgo(Date.parse(summary.lastImportAt));
    return { tone: "plain", text: L.plans.statusImported(when, summary.pages) };
  }
  return { tone: "plain", text: L.plans.syncNever };
}

/**
 * 문서를 Confluence 에서 여는 주소 — 사이트가 호스트로 읽히지 않으면 링크를 세우지 않는다. 페이지 번호만으로
 * 여는 형식이라 폴더 · 제목이 바뀌어도 같은 문서로 간다.
 */
export function docUrl(site: string, pageId: string): string | null {
  const host = site
    .trim()
    .replace(/^https?:\/\//iu, "")
    .replace(/[/?#].*$/u, "");
  if (!/^[a-z0-9.-]+$/iu.test(host) || pageId === "") return null;
  return `https://${host}/wiki/pages/viewpage.action?pageId=${encodeURIComponent(pageId)}`;
}
