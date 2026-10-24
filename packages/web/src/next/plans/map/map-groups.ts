import type { MapChange } from "../../../lib/daemon-client";
import type { PlanDoc } from "../plans-list.ts";

/**
 * 연결 지도의 순수 조립(F6 2조각) — 읽어 온 문서 · 화면 · 연결을 @xyflow/react 에 얹을
 * 노드·연결 모양으로 세운다. 배치는 결정적(같은 데이터 → 같은 그림)이고 리액트를 모르므로
 * 시험은 이 조립만 잰다. 그림 그리기는 PlansMap.tsx 가 맡는다.
 */

/** 화면 인벤터리의 한 행 — map.read 의 screens 와 같은 모양. `observed` 는 관찰 제목이 있다는 뜻. */
export interface MapScreen {
  route: string;
  title: string | null;
  observed: boolean;
}

/** 연결의 한 줄 — map.read 의 links 와 같은 모양(연결 레포 파일 그대로). */
export interface MapLink {
  pageId: string;
  route: string;
  section: string | null;
  note: string | null;
  createdAt: string | null;
}

/**
 * 그래프의 한 점 — 문서·화면·묶음 이름표·없어진 끝(연결은 남았는데 원장·인벤토리에 노드가
 * 없는 것. 사람이 끊게 하려고 세운다). `pageId`·`route` 는 잇기 판정에 쓰는 실제 열쇠다.
 */
type MapNodeKind = "doc" | "screen" | "docGroup" | "screenGroup" | "goneDoc" | "goneScreen";
export interface MapNodeModel {
  id: string;
  kind: MapNodeKind;
  /** 점 위에 쓸 글자 — 없어진 끝은 종류로 문장을 고르므로 비워 둔다. */
  label: string;
  /** 이름표 아래 줄 — 화면 점에서 제목 아래 경로를 적는다(2026-10-24 사용자 요청). */
  sub?: string;
  /** 묶음 이름 — 묶음 이름표 노드의 label 이기도 하다. */
  group: string;
  x: number;
  y: number;
  observed?: boolean;
  pageId?: string;
  route?: string;
}

export interface MapEdgeModel {
  id: string;
  source: string;
  target: string;
  /** 연결의 이름표 — note, 없으면 section, 둘 다 없으면 없다. */
  label: string | null;
}

/** 문서의 묶음 이름 — 원장 path 의 둘째 마디(공간 키 다음). 둘째 마디가 없으면 첫 마디(공간 키)가 묶음이다. */
export function docGroupKey(path: string): string {
  const parts = path.split("/");
  return parts[1] ?? parts[0] ?? "";
}

/** 화면의 묶음 이름 — route 의 첫 마디(`/setting/user-management` → `/setting`). 홈(`/`)은 그 자체가 묶음. */
export function screenGroupKey(route: string): string {
  const first = route.split("/")[1] ?? "";
  return first === "" ? "/" : `/${first}`;
}

interface MapDocGroup {
  key: string;
  docs: PlanDoc[];
}

interface MapScreenGroup {
  key: string;
  screens: MapScreen[];
}

/** 문서를 묶음으로 세운다 — 묶음 이름 순서고, 묶음 안은 원장이 준 순서 그대로다. */
function groupDocs(docs: readonly PlanDoc[]): MapDocGroup[] {
  const groups = new Map<string, PlanDoc[]>();
  for (const doc of docs) {
    const key = docGroupKey(doc.path);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [doc]);
    else bucket.push(doc);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, bucket]) => ({ key, docs: bucket }));
}

/** 화면을 묶음으로 세운다 — 묶음 이름 순서고, 묶음 안은 인벤토리가 준 순서 그대로다. */
function groupScreens(screens: readonly MapScreen[]): MapScreenGroup[] {
  const groups = new Map<string, MapScreen[]>();
  for (const screen of screens) {
    const key = screenGroupKey(screen.route);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [screen]);
    else bucket.push(screen);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, bucket]) => ({ key, screens: bucket }));
}

/** 왼쪽 문서 칸 · 오른쪽 화면 칸의 x. 그림 넉넉히 240px 폭에 잇는 선이 설 자리를 둔다. */
const DOC_X = 0;
const SCREEN_X = 640;
/** 한 노드가 차하는 세로 걸음 — 화면 점은 제목 아래 경로 줄이 서므로(2026-10-24 사용자 요청) 두 줄 높이와 사이 8px. */
const ROW_STEP = 68;
/** 묶음 이름표가 차하는 세로 걸음. */
const GROUP_STEP = 36;
/** 묶음과 묶음 사이의 숨. */
const GROUP_GAP = 24;

/** 연결의 연결 지도 안 열쇠 — `${pageId}\n${route}\n${section ?? ""}`. 되돌리기는 edgeIdToChange 가 맡는다. */
export function mapEdgeId(pageId: string, route: string, section: string | null): string {
  return `${pageId}\n${route}\n${section ?? ""}`;
}

/**
 * 지도를 세운다 — 왼쪽에 문서 묶음 순서로, 오른쪽에 화면 묶음 순서로 세로 줄을 잇고 그
 * 사이를 연결로 잇는다. 원장·인벤토리에 없는 끝(없어진 문서·화면)은 각 칸 맨 아래 점으로
 * 세워 사람이 끊게 한다.
 */
export function buildMapGraph(result: {
  docs: readonly PlanDoc[];
  screens: readonly MapScreen[];
  links: readonly MapLink[];
}): { nodes: MapNodeModel[]; edges: MapEdgeModel[] } {
  const nodes: MapNodeModel[] = [];

  let y = 0;
  for (const group of groupDocs(result.docs)) {
    nodes.push({
      id: `dgroup:${group.key}`,
      kind: "docGroup",
      label: group.key,
      group: group.key,
      x: DOC_X,
      y,
    });
    y += GROUP_STEP;
    for (const doc of group.docs) {
      nodes.push({
        id: `doc:${doc.pageId}`,
        kind: "doc",
        label: doc.title,
        group: group.key,
        x: DOC_X,
        y,
        pageId: doc.pageId,
      });
      y += ROW_STEP;
    }
    y += GROUP_GAP;
  }

  y = 0;
  for (const group of groupScreens(result.screens)) {
    nodes.push({
      id: `sgroup:${group.key}`,
      kind: "screenGroup",
      label: group.key,
      group: group.key,
      x: SCREEN_X,
      y,
    });
    y += GROUP_STEP;
    for (const screen of group.screens) {
      nodes.push({
        id: `screen:${screen.route}`,
        kind: "screen",
        label: screen.title ?? screen.route,
        // 제목이 경로를 가리면 사람이 주소를 못 읽는다 — 제목 아래 줄에 경로를 적는다.
        ...(screen.title === null ? {} : { sub: screen.route }),
        group: group.key,
        x: SCREEN_X,
        y,
        ...(screen.observed ? { observed: true } : {}),
        route: screen.route,
      });
      y += ROW_STEP;
    }
    y += GROUP_GAP;
  }

  // 없어진 끝 — 연결은 남았는데 점이 없는 것. 칸마다 맨 아래에 점을 세워 끊는 길을 남긴다.
  const docIds = new Set(result.docs.map((doc) => doc.pageId));
  const screenIds = new Set(result.screens.map((screen) => screen.route));
  const goneDocs = [...new Set(result.links.map((link) => link.pageId))].filter(
    (pageId) => !docIds.has(pageId),
  );
  const goneScreens = [...new Set(result.links.map((link) => link.route))].filter(
    (route) => !screenIds.has(route),
  );
  const docBottom = Math.max(
    0,
    ...nodes
      .filter((node) => node.kind === "doc" || node.kind === "docGroup")
      .map((node) => node.y + ROW_STEP),
  );
  const screenBottom = Math.max(
    0,
    ...nodes
      .filter((node) => node.kind === "screen" || node.kind === "screenGroup")
      .map((node) => node.y + ROW_STEP),
  );
  let docY = docBottom;
  for (const pageId of goneDocs) {
    nodes.push({
      id: `gonedoc:${pageId}`,
      kind: "goneDoc",
      label: "",
      group: "",
      x: DOC_X,
      y: docY,
      pageId,
    });
    docY += ROW_STEP;
  }
  let screenY = screenBottom;
  for (const route of goneScreens) {
    nodes.push({
      id: `gonescreen:${route}`,
      kind: "goneScreen",
      label: "",
      group: "",
      x: SCREEN_X,
      y: screenY,
      route,
    });
    screenY += ROW_STEP;
  }

  const edges: MapEdgeModel[] = result.links.map((link) => ({
    id: mapEdgeId(link.pageId, link.route, link.section),
    source: docIds.has(link.pageId) ? `doc:${link.pageId}` : `gonedoc:${link.pageId}`,
    target: screenIds.has(link.route) ? `screen:${link.route}` : `gonescreen:${link.route}`,
    label: link.note ?? link.section,
  }));

  return { nodes, edges };
}

/**
 * 손으로 잇는 끌기의 판정 — 문서 점의 오른쪽 손잡이에서 화면 점의 왼쪽 손잡이로 갈 때만
 * add 로 삼는다. 방향이 반대거나 같은 쪽이거나 없어진 끝이면 무시(null)한다.
 */
export function connectionToAdd(
  connection: { source: string | null; target: string | null },
  nodes: readonly MapNodeModel[],
): MapChange | null {
  if (connection.source === null || connection.target === null) return null;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const source = byId.get(connection.source);
  const target = byId.get(connection.target);
  if (source?.kind !== "doc" || source.pageId === undefined) return null;
  if (target?.kind !== "screen" || target.route === undefined) return null;
  return { op: "add", pageId: source.pageId, route: target.route };
}

/** 고른 연결을 끊는 고침으로 되돌린다 — 열쇠 말고 다른 그림이면 무시(null)한다. */
export function edgeIdToChange(edgeId: string): MapChange | null {
  const first = edgeId.indexOf("\n");
  const second = first === -1 ? -1 : edgeId.indexOf("\n", first + 1);
  if (first === -1 || second === -1) return null;
  const pageId = edgeId.slice(0, first);
  const route = edgeId.slice(first + 1, second);
  const section = edgeId.slice(second + 1);
  if (pageId === "" || route === "") return null;
  return section === ""
    ? { op: "remove", pageId, route }
    : { op: "remove", pageId, route, section };
}
