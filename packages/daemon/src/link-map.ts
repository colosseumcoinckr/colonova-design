/**
 * 연결 지도(2026-10-24 연결 지도 계획): 기획서 문서와 연결 레포 화면을 한 지도에
 * 올리는 읽기와, 사람이 만드는 연결의 쓰기. 문서는 원장에서, 화면은 클론의 page 파일과
 * 관찰 지도에서, 연결은 연결 레포의 뿌리 `plans-map.json` 에서 읽는다. 연결의 정본이
 * 연결 레포 파일인 까닭에 지도는 팀이 보관·제출로 공유한다(같은 날 사용자 결정).
 * 쓰기는 파일만 고친다 — git 은 보관의 차선이 지나고, AI 의 쓰기는 가드가 막는다.
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { collectCodeFiles } from "./code-files.js";
import { readConfluenceLedger } from "./confluence-ledger.js";
import { confluenceMirrorLedger } from "./confluence-mirror.js";
import { confluenceSiteKey } from "./confluence-sync.js";
import { nextRoutePattern, type PatternSegment } from "./route-index.js";
import { normalizeRoute, readScreenMap } from "./screen-map.js";

/** 지도의 문서 노드 — 원장 그대로(doc.list 와 같은 모양). */
export interface MapDocNode {
  pageId: string;
  title: string;
  version: number;
  path: string;
}

/** 지도의 폴더 노드 — 원장 그대로. */
export interface MapFolderNode {
  folderId: string;
  title: string;
  path: string;
}

/** 지도의 화면 노드 — 라우트가 신원이다. 제목은 관찰이 있을 때만 붙는다. */
export interface MapScreenNode {
  route: string;
  title: string | null;
  /** 관찰 지도(screen-map.jsonl)에 한 번이라도 오른 라우트인가. */
  observed: boolean;
}

/** 연결 한 줄 — 연결 레포 뿌리 `plans-map.json` 의 행. */
export interface MapLink {
  pageId: string;
  route: string;
  section: string | null;
  note: string | null;
  createdAt: string | null;
}

/** map.read 의 답. 연결이 없어도 화면·연결은 빈 배열로 나간다(linked 로 구분). */
export interface MapReadResult {
  linked: boolean;
  docs: MapDocNode[];
  folders: MapFolderNode[];
  screens: MapScreenNode[];
  links: MapLink[];
}

/** mapRead 가 필요로 하는 협력자 — 문서 목록(docList)과 같은 관문의 재료. */
export interface LinkMapDeps {
  registry: {
    activeSlug(): string | null;
    paths(slug: string): { root: string; repoRoot: string };
  };
  machineSetting: { get(key: string): string | null };
}

/** 연결 파일의 자리 — 클론의 뿌리 `plans-map.json`(연결 레포마다 하나 · 2026-10-24 사용자 결정). */
export const PLAN_MAP_FILE = ["plans-map.json"] as const;

/** 연결 파일 규격 — 2026-10-24 연결 지도 계획 §2. 같은 열쇠는 한 줄이다. */
const PLAN_MAP_FORMAT = 1;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/**
 * 연결 파일 읽기 — 순수한 판독. 파일이 없으면 빈 연결이다. 깨진 파일(JSON 이
 * 아님 · 규격 1 이 아님 · `links` 가 배열 아님 · 한 줄이라도 모양이 틀림)은 통째로
 * 빈 연결로 읽는다(`broken`). 지도가 깨진 줄만 조용히 빼고 줄어드는 일은 없다 —
 * 사람이 파일을 고쳐 다시 보관한다.
 */
export async function readPlanMap(repoRoot: string): Promise<{
  links: MapLink[];
  broken: boolean;
}> {
  let text: string;
  try {
    text = await readFile(join(repoRoot, ...PLAN_MAP_FILE), "utf8");
  } catch {
    return { links: [], broken: false };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { links: [], broken: true };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { links: [], broken: true };
  }
  const { format, links: rows } = parsed as { format?: unknown; links?: unknown };
  if (format !== PLAN_MAP_FORMAT || !Array.isArray(rows)) {
    return { links: [], broken: true };
  }
  const seen = new Set<string>();
  const links: MapLink[] = [];
  for (const row of rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      return { links: [], broken: true };
    }
    const { pageId, route, section, note, createdAt } = row as Record<string, unknown>;
    if (typeof pageId !== "string" || pageId === "") return { links: [], broken: true };
    if (typeof route !== "string") return { links: [], broken: true };
    if (route.trim() === "") return { links: [], broken: true };
    for (const field of [section, note, createdAt]) {
      if (field !== undefined && field !== null && typeof field !== "string") {
        return { links: [], broken: true };
      }
    }
    const normalized = normalizeRoute(route);
    if (normalized === "") return { links: [], broken: true };
    const key = `${pageId}\n${normalized}\n${asString(section) ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({
      pageId,
      route: normalized,
      section: asString(section),
      note: asString(note),
      createdAt: asString(createdAt),
    });
  }
  return { links, broken: false };
}

/** Next.js page 패턴을 지도에 올릴 라우트 글자로 — 동적 조각은 `[…]` 한 모양. */
function patternRoute(pattern: PatternSegment[]): string {
  const parts: string[] = [];
  for (const segment of pattern) {
    if (segment.kind === "fixed") parts.push(segment.raw);
    else if (segment.kind === "one" || segment.kind === "many") parts.push("[…]");
    // opt(0개 이상)는 붙이지 않는다 — 없는 조각으로도 주소가 성립한다.
  }
  return `/${parts.join("/")}`;
}

/**
 * 화면 인벤토리 — 클론의 page 파일이 만드는 라우트 전부와 관찰 지도에 오른
 * 라우트를 합친다. 관찰 제목은 가장 최근 행의 것을 입힌다(빈 제목은 덮지
 * 않는다). 클론이 없으면 관찰만 산다(collectCodeFiles 가 빈 목록을 준다).
 */
export async function screenInventory(
  projectRoot: string,
  repoRoot: string,
): Promise<MapScreenNode[]> {
  const routes = new Map<string, { title: string | null; observed: boolean }>();
  for (const row of await readScreenMap(projectRoot)) {
    for (const screen of row.screens ?? []) {
      const route = normalizeRoute(screen.route);
      if (route === "") continue;
      const known = routes.get(route);
      const title = screen.title.trim() === "" ? null : screen.title;
      routes.set(route, { title: title ?? known?.title ?? null, observed: true });
    }
  }
  for (const file of await collectCodeFiles(repoRoot)) {
    const rel = relative(repoRoot, file).split(sep).join("/");
    const pattern = nextRoutePattern(rel);
    if (pattern === null) continue;
    const route = patternRoute(pattern);
    const known = routes.get(route);
    if (known === undefined) routes.set(route, { title: null, observed: false });
  }
  return [...routes.entries()]
    .map(([route, { title, observed }]) => ({ route, title, observed }))
    .sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : 0));
}

/**
 * 연결 지도 읽기 — 문서 목록(docList)과 같은 관문(활성 프로젝트 · 연결 확인)을
 * 지난다. 연결이 없으면 문서·폴더가 비고 화면 인벤토리와 연결은 그대로 나간다.
 * 지도는 문서가 없어도 화면만으로 선다.
 */
export async function mapRead(deps: LinkMapDeps): Promise<MapReadResult> {
  const slug = deps.registry.activeSlug();
  const site = slug === null ? null : deps.machineSetting.get(confluenceSiteKey(slug));
  const linked = slug !== null && site !== null;
  const docs: MapDocNode[] = [];
  const folders: MapFolderNode[] = [];
  if (linked && slug !== null) {
    const ledger = readConfluenceLedger(confluenceMirrorLedger(deps.registry.paths(slug).root));
    for (const [pageId, page] of Object.entries(ledger.pages)) {
      docs.push({ pageId, title: page.title, version: page.version, path: page.path });
    }
    for (const [folderId, folder] of Object.entries(ledger.folders)) {
      folders.push({ folderId, title: folder.title, path: folder.path });
    }
  }
  const paths = slug === null ? null : deps.registry.paths(slug);
  const screens = paths === null ? [] : await screenInventory(paths.root, paths.repoRoot);
  const links = paths === null ? [] : (await readPlanMap(paths.repoRoot)).links;
  return { linked, docs, folders, screens, links };
}

/** 연결 쓰기 한 건 — 사람의 조작. `add` 는 잇기, `remove` 는 끊기다. */
export type MapChange =
  | { op: "add"; pageId: string; route: string; section?: string; note?: string }
  | { op: "remove"; pageId: string; route: string; section?: string };

const linkKey = (pageId: string, route: string, section: string | null): string =>
  `${pageId}\n${route}\n${section ?? ""}`;

/**
 * 연결 파일 쓰기 — 현재 파일에 변경을 얹어 규격 1 로 다시 쓴다. 임시 파일 → 바꿔치기
 * 원자 쓰기다(writeConfluenceLedger 와 같은 길). 같은 열쇠의 add 는 메모만 갈아 얹고,
 * remove 는 그 열쇠를 지운다. 모양이 틀린 변경 하나에 요청 전체가 거절된다(부분 반영
 * 없음). 답은 쓴 뒤의 연결 목록 — 정렬은 (문서 · 화면 · 절) 로 해 diff 가 잡다.
 */
export async function writePlanMap(repoRoot: string, changes: MapChange[]): Promise<MapLink[]> {
  const current = await readPlanMap(repoRoot);
  const links = current.links.map((link) => ({ ...link }));
  const byKey = new Map(
    links.map((link) => [linkKey(link.pageId, link.route, link.section), link]),
  );
  for (const change of changes) {
    const pageId = change.pageId.trim();
    if (pageId === "") throw new Error("연결할 문서가 비어 있어요 — 다시 골라 주세요.");
    if (change.route.trim() === "") {
      throw new Error("연결할 화면 주소가 빈 칸이에요 — 화면을 다시 골라 주세요.");
    }
    const route = normalizeRoute(change.route);
    const section = change.section?.trim() === "" ? null : (change.section?.trim() ?? null);
    const key = linkKey(pageId, route, section);
    if (change.op === "add") {
      const known = byKey.get(key);
      if (known === undefined) {
        const link: MapLink = {
          pageId,
          route,
          section,
          note: change.note?.trim() === "" ? null : (change.note?.trim() ?? null),
          createdAt: new Date().toISOString(),
        };
        byKey.set(key, link);
        links.push(link);
      } else {
        // 같은 연결을 다시 잇면 메모만 갈아 얹는다 — 만든 날은 첫 연결을 지킨다.
        known.note = change.note?.trim() === "" ? null : (change.note?.trim() ?? known.note);
      }
    } else if (byKey.delete(key)) {
      const at = links.findIndex((link) => linkKey(link.pageId, link.route, link.section) === key);
      if (at >= 0) links.splice(at, 1);
    }
  }
  links.sort((a, b) =>
    a.pageId < b.pageId
      ? -1
      : a.pageId > b.pageId
        ? 1
        : a.route < b.route
          ? -1
          : a.route > b.route
            ? 1
            : (a.section ?? "") < (b.section ?? "")
              ? -1
              : 1,
  );
  const file = join(repoRoot, ...PLAN_MAP_FILE);
  // 클론의 뿌리에 바로 쓴다(2026-10-24 사용자 결정) — 폴더를 만들 필요가 없다.
  const temporary = `${file}.colonova-design-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify({ format: 1, links }, null, 2)}\n`, "utf8");
  await rename(temporary, file);
  return links;
}

/** map.write 의 답 조립 — 쓴 뒤의 연결 목록만 돌려준다. */
export async function mapWrite(deps: LinkMapDeps, changes: MapChange[]): Promise<MapLink[]> {
  const slug = deps.registry.activeSlug();
  if (slug === null) throw new Error("프로젝트를 먼저 골라 주세요 — 연결은 프로젝트마다 있어요.");
  return writePlanMap(deps.registry.paths(slug).repoRoot, changes);
}
