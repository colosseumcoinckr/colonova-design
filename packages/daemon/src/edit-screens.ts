/**
 * 편집한 파일 → 화면 (2026-10-08 라이브감 · 베타 준비 분석): AI 가 일하는 몇 분 동안 사용자의 미리보기가 고치는 화면을
 * 같이 따라가려면, 편집 도구가 끝날 때 「그 파일이 어느 화면의 것인가」를 알아야 한다. 이 모듈은 그 판정과, 판정이 난
 * 화면을 턴당 화면당 한 번만 알리는 장부를 맡는다.
 *
 * 추측하지 않는다 — 화면 지도(screen-map)가 이미 아는 화면이어야 하고, 그 위에서 확실한 두 길만 쓴다.
 * ① Next.js 의 고정 경로 page 파일 — 라우터가 정한 문이다(`[id]` 같은 동적 문은 어느 주소인지 몰라 말하지 않는다).
 * ② 지도의 관찰이 한 화면으로만 모이는 파일 — 두 번 이상의 저장이 모두 같은 화면 하나만 가리킨 파일. 한 번이라도
 *    화면이 없거나 둘 이상이던 저장에 든 파일은 공용 파일이라 말하지 않는다(게이트의 `routesForFiles` 보다 엄격하다 —
 *    그쪽은 틀려도 화면을 한 번 더 볼 뿐이지만, 이쪽은 사용자의 미리보기를 움직인다).
 * 파일 이름에서 주소를 지어내지 않는다(`filesForRoute` 의 후보는 힌트지 답이 아니다). 파일 내용은 읽지 않는다.
 *
 * 이 모듈은 선로의 재료만 만든다 — 로그 · 턴 통계에 경로를 남기지 않는다.
 */
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ChatEvent } from "@colonova-design/protocol";
import { isCodeFile } from "./code-files.js";
import { fileSegments, nextRoutePattern } from "./route-index.js";
import { normalizeRoute, type ScreenMapRow } from "./screen-map.js";
import { STATS_EDIT_TOOLS } from "./tool-names.js";
import { editPathsOf } from "./tool-paths.js";

/** 관찰 길에 필요한 저장(지도 행)의 수 — 한 번의 관찰은 우연일 수 있다. */
export const OBSERVED_MIN_ROWS = 2;
/** 한 턴이 알릴 수 있는 화면 수의 상한 — 장부가 무한히 자라지 않게. */
export const MAX_TOLD_PER_TURN = 8;

/** 알릴 화면 — 쿼리 없는 경로와, 지도가 아는 제목(없으면 빠진다). */
export interface EditedScreen {
  route: string;
  title?: string;
}

/** 지도에서 읽어 둔 색인 — 한 턴 동안 한 번만 짓는다(지도는 저장이 설 때만 자란다). */
export interface ScreenIndex {
  /** 지도가 아는 화면 — 경로 → 가장 최근의 제목(없으면 빈 문자열). */
  known: Map<string, string>;
  /** 파일 → 그 파일이 든 저장들의 화면. `clean` 은 든 저장마다 화면이 정확히 하나였다는 뜻이다. */
  byFile: Map<string, { paths: Set<string>; rows: number; clean: boolean }>;
}

/** 쿼리를 뗀 경로 — 같은 화면은 쿼리가 달라도 같은 화면이다. 외부 주소(빈 문자열)는 그대로 빈다. */
function pathOnly(route: string): string {
  return route.split("?")[0] ?? "";
}

/**
 * 지도 행이 가리킨 화면들 — `screens`(정규 경로)가 먼저, 없으면 날 `routes` 를 폈다. `routesForFiles` 와 같은 읽기다.
 * 이 기계의 미리보기가 아닌 주소는 `normalizeRoute` 가 빈 문자열로 만들어 빠진다.
 */
function pathsOfRow(row: ScreenMapRow): string[] {
  const raw = row.screens?.map((screen) => screen.route) ?? row.routes;
  const out: string[] = [];
  for (const entry of raw) {
    // 손으로 고친 지도에서 온 낯선 값은 건너뛴다 — 색인 하나가 이 턴의 모든 판정을 막지 않게.
    if (typeof entry !== "string") continue;
    const path = pathOnly(normalizeRoute(entry));
    if (path !== "" && !out.includes(path)) out.push(path);
  }
  return out;
}

/** 지도 → 색인. 순수 — 오래된 행부터 읽어 제목은 가장 최근의 것이 남는다. */
export function indexScreens(rows: readonly ScreenMapRow[]): ScreenIndex {
  const known = new Map<string, string>();
  const byFile = new Map<string, { paths: Set<string>; rows: number; clean: boolean }>();
  for (const row of rows) {
    const paths = pathsOfRow(row);
    for (const path of paths) if (!known.has(path)) known.set(path, "");
    for (const screen of row.screens ?? []) {
      if (typeof screen.route !== "string" || typeof screen.title !== "string") continue;
      const path = pathOnly(normalizeRoute(screen.route));
      const title = screen.title.trim();
      if (path !== "" && title !== "") known.set(path, title);
    }
    for (const file of row.files) {
      if (typeof file !== "string") continue;
      const entry = byFile.get(file) ?? { paths: new Set<string>(), rows: 0, clean: true };
      entry.rows += 1;
      if (paths.length === 1 && paths[0] !== undefined) entry.paths.add(paths[0]);
      else entry.clean = false;
      byFile.set(file, entry);
    }
  }
  return { known, byFile };
}

/**
 * 도구가 쓴 경로 → 레포 뿌리 상대 경로(슬래시). 뿌리를 둘 받는 이유는 도구가 실제 경로(심볼릭 링크를 푼 것)로 쓸 수
 * 있어서다. 레포 밖이거나 뿌리 자체면 null.
 */
export function repoRelativePath(roots: readonly string[], path: string): string | null {
  for (const root of roots) {
    const rel = relative(root, isAbsolute(path) ? path : resolve(root, path));
    if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) continue;
    return rel.split(sep).join("/");
  }
  return null;
}

/** 파일 하나가 확실히 이어진 화면 — 확실하지 않으면 null(말하지 않는다). 순수. */
export function screenOfFile(rel: string, index: ScreenIndex): EditedScreen | null {
  // 화면의 말이 사는 코드 파일만 — 시험 · 스토리 · 선언 파일은 화면이 아니다.
  if (!isCodeFile(rel) || fileSegments(rel) === null) return null;
  const screen = (route: string): EditedScreen | null => {
    const title = index.known.get(route);
    if (title === undefined) return null; // 처음 보는 화면은 말하지 않는다.
    return title === "" ? { route } : { route, title };
  };
  // ① Next.js 의 문 — 고정 경로만. 동적 문은 어느 주소인지 몰라서 관찰 길로도 가지 않는다. 문이 가리킨 화면을
  // 지도가 모르면(Next 가 아닌 레포의 `pages/` 폴더일 수 있다) 문으로 치지 않고 ②로 간다.
  const door = nextRoutePattern(rel);
  if (door !== null) {
    if (door.some((seg) => seg.kind !== "fixed")) return null;
    const byDoor = screen(`/${door.map((seg) => (seg.kind === "fixed" ? seg.raw : "")).join("/")}`);
    if (byDoor !== null) return byDoor;
  }
  // ② 지도의 관찰 — 든 저장마다 화면이 정확히 하나였고, 그 하나가 늘 같았다.
  const seen = index.byFile.get(rel);
  if (seen === undefined || !seen.clean || seen.rows < OBSERVED_MIN_ROWS || seen.paths.size !== 1) {
    return null;
  }
  const [route] = seen.paths;
  return route === undefined ? null : screen(route);
}

/** 한 턴의 장부 — 세션마다 하나, 턴이 끝나면 버린다. */
interface TurnLedger {
  /** 아직 끝나지 않은 편집 도구 호출 → 그 호출이 쓴 경로들. */
  pending: Map<string, string[]>;
  /** 이 턴이 이미 알린 화면. */
  told: Set<string>;
  /** 지도 색인 — 첫 편집이 짓고 이 턴이 다시 쓴다. */
  index: Promise<ScreenIndex> | null;
}

export interface EditAnnouncerDeps {
  /** 세션의 레포 뿌리들(그대로 · 실제 경로)과 지도가 사는 프로젝트 폴더. 모르면 null. */
  where(sessionId: string): { roots: string[]; projectRoot: string } | null;
  /** 화면 지도 전부 — 읽지 못하면 빈 목록으로 읽는다(말하지 않을 뿐이다). */
  readRows(projectRoot: string): Promise<ScreenMapRow[]>;
  /** 알릴 화면 하나 — 서버가 `session.editing` 으로 방송한다. */
  emit(sessionId: string, screen: EditedScreen): void;
}

/**
 * 편집 도구가 끝날 때마다 그 파일이 이어진 화면을 턴당 화면당 한 번만 알린다. 모든 사건을 먼저 본다 — 아는 것은 편집
 * 도구의 시작 · 끝과 턴의 끝뿐이다. 도구가 실패했거나(`isError`) 파일이 레포 밖이거나 화면이 확실하지 않으면 조용하다.
 */
export class EditAnnouncer {
  private readonly turns = new Map<string, TurnLedger>();

  constructor(private readonly deps: EditAnnouncerDeps) {}

  observe(sessionId: string, event: ChatEvent): void {
    // 이 장부는 사건의 흐름을 죽일 수 없다 — 무엇이 틀려도 조용히 삼킨다(턴 통계와 같은 약속).
    try {
      if (event.kind === "turn.end") {
        this.forget(sessionId);
        return;
      }
      if (event.kind === "tool.start") {
        if (STATS_EDIT_TOOLS[event.name] !== true) return;
        const paths = editPathsOf(event.input);
        if (paths.length === 0) return;
        this.ledger(sessionId).pending.set(event.toolUseId, paths);
        return;
      }
      if (event.kind === "tool.end") {
        const turn = this.turns.get(sessionId);
        const paths = turn?.pending.get(event.toolUseId);
        if (turn === undefined || paths === undefined) return;
        turn.pending.delete(event.toolUseId);
        // 실패한 편집은 화면을 바꾸지 않았다.
        if (event.isError) return;
        void this.settle(sessionId, turn, paths).catch(() => undefined);
      }
    } catch {
      // 위와 같다.
    }
  }

  /** 턴이 끝났거나 세션이 닫혔다 — 장부를 버린다. */
  forget(sessionId: string): void {
    this.turns.delete(sessionId);
  }

  private ledger(sessionId: string): TurnLedger {
    let turn = this.turns.get(sessionId);
    if (turn === undefined) {
      turn = { pending: new Map(), told: new Set(), index: null };
      this.turns.set(sessionId, turn);
    }
    return turn;
  }

  private async settle(sessionId: string, turn: TurnLedger, paths: string[]): Promise<void> {
    const where = this.deps.where(sessionId);
    if (where === null) return;
    const files = paths
      .map((path) => repoRelativePath(where.roots, path))
      .filter((rel): rel is string => rel !== null);
    if (files.length === 0) return;
    turn.index ??= this.deps.readRows(where.projectRoot).then(indexScreens, () => indexScreens([]));
    const index = await turn.index;
    // 기다리는 동안 턴이 끝났거나 새 턴이 섰다면 이 판정은 낡았다.
    if (this.turns.get(sessionId) !== turn) return;
    for (const rel of files) {
      const screen = screenOfFile(rel, index);
      if (screen === null || turn.told.has(screen.route)) continue;
      if (turn.told.size >= MAX_TOLD_PER_TURN) return;
      turn.told.add(screen.route);
      this.deps.emit(sessionId, screen);
    }
  }
}
