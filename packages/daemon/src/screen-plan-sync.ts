/**
 * 같이 고치기(2026-10-30 사용자 결정 · docs/screen-plan-sync-plan-2026-10-30.md) — 화면 요청이 보관되면 그 화면에
 * 이어진 기획서의 초안을 기획 AI 가 같이 고친다. 초안까지만 자동이고 Confluence 발행은 사람이 한다.
 *
 * - 대상은 사람이 정한 것만이다: 연결 파일(`plans-map.json`)에서 이번 화면에 이어진 문서와, 이 대화에 근거로 보낸
 *   문서. AI 가 내용으로 문서를 추측하지 않는다.
 * - 근거로 보낸 문서와 이번에 바뀐 화면은 연결 파일에 잇는다 — 사람의 행동(근거 보내기)에서 생긴 연결이고, 곁줄의
 *   `끊기` 가 언제든 거둔다. 연결 자리는 같은 날 걷었다.
 * - 기록은 프로젝트 데이터 `plans/screen-sync.jsonl` 이다. 되돌릴 재료(블록의 그 전 모습)와 결과 카드의 마지막 모습이
 *   산다 — 로그가 아니라 초안과 같은 작업 데이터다. 로그에는 종류와 수만 남긴다.
 */
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PlanSync, PlanSyncDoc, PlanSyncLink } from "@colonova-design/protocol";
import type { ScreenSyncInverse, ScreenSyncResult } from "./draft-service.js";
import { type MapLink, readPlanMap, writePlanMap } from "./link-map.js";
import type { DaemonLogger } from "./log.js";
import { type PlanRefEntry, readPlanRefs } from "./plan-refs.js";
import { normalizeRoute } from "./screen-map.js";

/** 한 요청에서 같이 고칠 문서의 상한 — 넘으면 앞의 것만 돈다(같이 고치기 계획 §10). */
export const SCREEN_SYNC_DOC_LIMIT = 3;

/** 근거 문서를 바뀐 화면에 잇는 상한 — 공통 틀처럼 화면 여럿을 건드린 턴이 지도를 어지럽히지 않게. */
export const SCREEN_SYNC_LINK_ROUTES = 3;

/** 보관된 화면 요청 하나 — 서버가 보관이 내려앉은 뒤 넘긴다. */
export interface ScreenTurn {
  slug: string;
  sessionId: string;
  requestId: string;
  /** 사람의 요청 — 표식을 걷은 본문. */
  request: string;
  screens: Array<{ route: string; title: string }>;
  /** 이번 보관의 파일(연결 레포 기준 상대 경로) — 기획 AI 가 읽어 확인할 재료. */
  files: string[];
  sha: string | null;
}

/** 같이 고칠 문서 하나 — pageId 또는 아직 발행하지 않은 새 문서의 docKey. 절이 null 이면 문서 전체다. */
export interface SyncTarget {
  pageId: string | null;
  docKey: string | null;
  title: string | null;
  sections: string[] | null;
}

/**
 * 대상 고르기 — 이 대화에 근거로 보낸 문서가 먼저, 그다음 연결 파일에서 이번 화면에 이어진 문서다. 같은 문서는 한
 * 번이고 절은 합친다(문서 전체가 하나라도 있으면 전체). 상한을 넘는 것은 버린다.
 * `declines`(건너뛴 (문서, 화면) 짝 · 2026-11-03 A안 1A-1)은 연결 줄에서만 걸러낸다 — 근거로 직접 보낸 문서는
 * 건너뛰기와 상관없이 늘 대상이다.
 */
export function syncTargets(input: {
  links: readonly MapLink[];
  refs: readonly PlanRefEntry[];
  sessionId: string;
  routes: readonly string[];
  /** 건너뛴 (pageId, 화면 주소) 짝 — 같은 짝의 연결만 다시 대상으로 고르지 않는다. */
  declines?: ReadonlyArray<{ pageId: string; route: string }>;
}): SyncTarget[] {
  const routes = new Set(input.routes.map((route) => normalizeRoute(route)));
  const declined = new Set(
    (input.declines ?? []).map((row) => `${row.pageId}\n${normalizeRoute(row.route)}`),
  );
  const out: SyncTarget[] = [];
  const keyOf = (pageId: string | null, docKey: string | null): string =>
    pageId !== null ? `p:${pageId}` : `d:${docKey ?? ""}`;
  const byKey = new Map<string, SyncTarget>();
  const add = (
    pageId: string | null,
    docKey: string | null,
    title: string | null,
    sections: string[] | null,
  ): void => {
    if (pageId === null && docKey === null) return;
    const key = keyOf(pageId, docKey);
    const known = byKey.get(key);
    if (known === undefined) {
      const target: SyncTarget = {
        pageId,
        docKey: pageId !== null ? null : docKey,
        title,
        sections: sections === null || sections.length === 0 ? null : [...sections],
      };
      byKey.set(key, target);
      out.push(target);
      return;
    }
    if (known.title === null) known.title = title;
    if (known.sections === null) return;
    if (sections === null || sections.length === 0) known.sections = null;
    else known.sections = [...new Set([...known.sections, ...sections])];
  };
  for (const entry of input.refs) {
    if (entry.sessionId !== input.sessionId) continue;
    add(entry.ref.pageId, entry.ref.docKey, entry.ref.title, entry.ref.sections);
  }
  for (const link of input.links) {
    const route = normalizeRoute(link.route);
    if (!routes.has(route)) continue;
    if (declined.has(`${link.pageId}\n${route}`)) continue;
    add(link.pageId, null, null, link.section === null ? null : [link.section]);
  }
  return out.slice(0, SCREEN_SYNC_DOC_LIMIT);
}

/**
 * 근거 문서와 바뀐 화면을 잇는 연결 — 이미 있는 연결은 빼고, 화면이 상한보다 많으면 잇지 않는다(공통 틀을 고친 턴).
 * 아직 발행하지 않은 새 문서(pageId 없음)는 연결 파일에 설 수 없다.
 */
export function autoLinks(input: {
  links: readonly MapLink[];
  refs: readonly PlanRefEntry[];
  sessionId: string;
  routes: readonly string[];
}): Array<{ pageId: string; title: string; route: string }> {
  const routes = [...new Set(input.routes.map((route) => normalizeRoute(route)))];
  if (routes.length === 0 || routes.length > SCREEN_SYNC_LINK_ROUTES) return [];
  const known = new Set(input.links.map((link) => `${link.pageId}\n${normalizeRoute(link.route)}`));
  const out: Array<{ pageId: string; title: string; route: string }> = [];
  for (const entry of input.refs) {
    if (entry.sessionId !== input.sessionId || entry.ref.pageId === null) continue;
    for (const route of routes) {
      const key = `${entry.ref.pageId}\n${route}`;
      if (known.has(key)) continue;
      known.add(key);
      out.push({ pageId: entry.ref.pageId, title: entry.ref.title, route });
    }
  }
  return out;
}

/**
 * 기획 AI 에게 가는 말 — 무엇이 바뀌었는지와 판정 기준. 바뀐 파일은 기획 AI 가 클론에서 읽어 확인할 수 있다(2026-10-23
 * 사본 이동 — 기획 AI 의 클론 읽기 허용). 끝은 기준 한 줄로 닫는다.
 */
export function screenSyncPrompt(input: {
  request: string;
  screens: ReadonlyArray<{ route: string; title: string }>;
  files: readonly string[];
  sections: readonly string[] | null;
}): string {
  const screens = input.screens
    .map((screen) =>
      screen.title.trim() !== "" ? `${screen.title} (${screen.route})` : screen.route,
    )
    .join(" · ");
  const lines = [
    "[화면 요청에서 같이 고치기]",
    "기획자가 화면 대화에서 아래 요청으로 실제 서비스 화면을 고쳤고, 그 변경이 보관됐다.",
    "",
    `요청: ${input.request.trim()}`,
    `바뀐 화면: ${screens === "" ? "(주소 없음)" : screens}`,
  ];
  if (input.files.length > 0) {
    lines.push(
      `바뀐 파일(연결 레포 — 필요하면 읽어 확인한다): ${input.files.slice(0, 20).join(", ")}`,
    );
  }
  if (input.sections !== null && input.sections.length > 0) {
    lines.push(`이 문서에서 먼저 볼 절: ${input.sections.join(" · ")}`);
  }
  lines.push(
    "",
    "할 일: 이 화면 변경이 이 문서가 정한 정책 · 규칙 · 조건 · 예외 · 문구 정의를 바꾸는지 판단한다.",
    "- 바꾸면 그 내용을 다루는 블록만 고친다. 문서에 없던 새 규칙이면 알맞은 자리에 더한다.",
    "- 색 · 간격 · 배치 같은 꾸밈만 바뀌었거나 이 문서가 다루지 않는 내용이면 걸음(ops)을 비운다.",
    "- 요청과 화면에 없는 내용을 지어내지 않는다. 다른 블록은 건드리지 않는다.",
    "설명(reply)은 한두 문장으로 무엇을 왜 고쳤는지, 또는 고칠 것이 없는 이유를 말한다.",
    "기준: 문서가 지금 화면과 같은 규칙을 말하면 끝이다.",
  );
  return lines.join("\n");
}

// ————— 기록 — plans/screen-sync.jsonl —————

/** 초안에 들어간 같이 고치기 한 건 — 되돌리기의 재료. */
export interface SyncEntry {
  kind: "entry";
  entryId: string;
  at: string;
  slug: string;
  sessionId: string;
  requestId: string;
  sha: string | null;
  docKey: string;
  title: string;
  proposalId: string;
  opIds: string[];
  inverse: ScreenSyncInverse[];
}

/** 결과 카드의 마지막 모습과 그 턴의 재료 — 문서 고르기(`draft.syncPick`)와 되돌리기 뒤 다시 그리기에 쓴다. */
export interface SyncCard {
  kind: "card";
  at: string;
  turn: ScreenTurn;
  sync: PlanSync;
}
/** 곁줄 `건너뛰기` 가 걷은 변경안(2026-11-03 A안 1A-1) — 걷인 문서와 그때의 화면 주소를 기억해, 연결로 이어진
 *  같은 짝만 다시 대상으로 고르지 않게 한다(근거로 보낸 문서는 상관없다). */
export interface SyncDecline {
  kind: "decline";
  at: string;
  slug: string;
  pageId: string | null;
  docKey: string;
  routes: string[];
}

interface SyncUndone {
  kind: "undone";
  at: string;
  entryId: string;
}

type SyncLine = SyncEntry | SyncCard | SyncDecline | SyncUndone;

export function screenSyncFile(projectRoot: string): string {
  return join(projectRoot, "plans", "screen-sync.jsonl");
}

function appendLine(file: string, line: SyncLine): void {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
}

/** 기록 읽기 — 깨진 줄은 건너뛴다(관용 읽기). 모양 검사는 최소다 — 이 앱만 쓰는 파일이다. */
export function readSyncLines(file: string): SyncLine[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: SyncLine[] = [];
  for (const line of raw.split(/\r?\n/u)) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as Partial<SyncLine> | null;
      if (parsed === null || typeof parsed !== "object") continue;
      if (parsed.kind === "entry") {
        const row = parsed as Partial<SyncEntry>;
        if (typeof row.entryId === "string" && Array.isArray(row.inverse)) {
          out.push(row as SyncEntry);
        }
      } else if (parsed.kind === "card") {
        const row = parsed as Partial<SyncCard>;
        if (typeof row.turn === "object" && typeof row.sync === "object") {
          out.push(row as SyncCard);
        }
      } else if (parsed.kind === "decline") {
        const row = parsed as Partial<SyncDecline>;
        if (typeof row.docKey === "string" && Array.isArray(row.routes)) {
          out.push({
            kind: "decline",
            at: typeof row.at === "string" ? row.at : "",
            slug: typeof row.slug === "string" ? row.slug : "",
            pageId: typeof row.pageId === "string" ? row.pageId : null,
            docKey: row.docKey,
            routes: row.routes.filter((route): route is string => typeof route === "string"),
          });
        }
      } else if (parsed.kind === "undone") {
        const row = parsed as Partial<SyncUndone>;
        if (typeof row.entryId === "string") out.push(row as SyncUndone);
      }
    } catch {
      // 깨진 줄은 건너뛴다.
    }
  }
  return out;
}

/** 되돌리지 않은 기록 — 되돌린 표시가 붙은 것은 뺀다. */
export function liveEntries(lines: readonly SyncLine[]): SyncEntry[] {
  const undone = new Set(
    lines.filter((line) => line.kind === "undone").map((line) => line.entryId),
  );
  return lines.filter(
    (line): line is SyncEntry => line.kind === "entry" && !undone.has(line.entryId),
  );
}

/** 한 요청의 마지막 카드. */
export function lastCard(
  lines: readonly SyncLine[],
  sessionId: string,
  requestId: string,
): SyncCard | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (
      line?.kind === "card" &&
      line.turn.sessionId === sessionId &&
      line.turn.requestId === requestId
    ) {
      return line;
    }
  }
  return null;
}

/** 건너뛴 (문서, 화면) 짝 — 대상 고르기(`syncTargets`)에서 같은 짝의 연결만 걸러낸다. */
export function declinedPairs(
  lines: readonly SyncLine[],
): Array<{ pageId: string; route: string }> {
  const out: Array<{ pageId: string; route: string }> = [];
  for (const line of lines) {
    if (line.kind !== "decline" || line.pageId === null) continue;
    for (const route of line.routes) out.push({ pageId: line.pageId, route });
  }
  return out;
}

/**
 * 화면 되돌리기와 묶기(같이 고치기 계획 §5) — 되돌림 지점보다 뒤의 보관(이력에서 그 지점보다 앞에 선 것 · 이력은
 * 새것부터)에 묶인 살아 있는 기록을 새것부터 고른다. 지점을 이력에서 못 찾으면 아무것도 고르지 않는다.
 */
export function entriesAfterRestore(
  entries: readonly SyncEntry[],
  historyNewestFirst: readonly string[],
  sha: string,
): SyncEntry[] {
  const at = historyNewestFirst.indexOf(sha);
  if (at < 0) return [];
  const newer = new Set(historyNewestFirst.slice(0, at));
  return entries.filter((entry) => entry.sha !== null && newer.has(entry.sha)).reverse();
}

// ————— 지휘 —————

export interface ScreenPlanSyncDeps {
  drafts: {
    screenSync(input: {
      slug: string;
      pageId: string | null;
      docKey: string | null;
      displayText: string;
      promptText: string;
    }): Promise<ScreenSyncResult>;
    screenSyncUndo(input: {
      slug: string;
      docKey: string;
      proposalId: string;
      opIds: string[];
      inverse: ScreenSyncInverse[];
    }): Promise<{ restored: number; kept: number }>;
    /** 곁줄 `고치기` — 기다리는 화면 변경안을 초안에 넣는다(2026-11-03 A안 1A-1). */
    screenSyncApply(input: {
      slug: string;
      docKey: string;
      proposalId: string;
    }): Promise<ScreenSyncResult>;
    /** 곁줄 `건너뛰기` — 기다리는 화면 변경안의 열린 걸음을 걷는다. */
    screenSyncDismiss(input: {
      slug: string;
      docKey: string;
      proposalId: string;
    }): Promise<{ ok: true }>;
  };
  paths(slug: string): { root: string; repoRoot: string };
  /** 그 프로젝트가 Confluence 에 이어져 있는가 — 아니면 문서 고르기를 권하지 않는다. */
  connected(slug: string): boolean;
  /** 원장의 문서 제목 — 없으면 null. */
  titleOf(slug: string, pageId: string): string | null;
  /** 결과를 그 대화로 보낸다 — 방송과 대화록 기록은 서버가 맡는다. */
  emit(turn: ScreenTurn, sync: PlanSync): void;
  /**
   * 자동 판정이 켜져 있는가(2026-11-03 A안 1A-1 설정 토글 · `plan-loop.ts`). 꺼져 있으면 잇기(연결 쓰기)만 하고 판정
   * (`drafts.screenSync`)은 부르지 않으며 카드도 세우지 않는다. 없으면 켬.
   */
  loopOn?: () => boolean;
  logger: DaemonLogger;
  now?: () => Date;
}

export class ScreenPlanSync {
  readonly #deps: ScreenPlanSyncDeps;
  /** 프로젝트마다 한 줄로 — 같은 초안을 두 요청이 엇갈려 고치지 않게. */
  readonly #chains = new Map<string, Promise<unknown>>();

  constructor(deps: ScreenPlanSyncDeps) {
    this.#deps = deps;
  }

  #now(): string {
    return (this.#deps.now?.() ?? new Date()).toISOString();
  }

  #queue<T>(slug: string, work: () => Promise<T>): Promise<T> {
    const before = this.#chains.get(slug) ?? Promise.resolve();
    const run = before.then(work, work);
    const tail = run.catch(() => undefined);
    this.#chains.set(slug, tail);
    void tail.then(() => {
      if (this.#chains.get(slug) === tail) this.#chains.delete(slug);
    });
    return run;
  }
  /** 보관이 내려앉은 화면 요청 — 자동 길이다(설정 토글이 판정을 끌 수 있다). 실패는 카드로 말한다. */
  onSaved(turn: ScreenTurn): Promise<void> {
    if (turn.screens.length === 0 || turn.request.trim() === "") return Promise.resolve();
    return this.#settle(turn, () => this.#run(turn, null, false));
  }

  /** 문서 고르기 — 그 턴의 화면과 문서를 잇고 그 문서로 같이 고친다(사람이 부른 길 — 토글과 상관없이 돈다). */
  async pick(
    slug: string,
    sessionId: string,
    requestId: string,
    pageId: string,
  ): Promise<{ ok: true }> {
    const { root } = this.#deps.paths(slug);
    const card = lastCard(readSyncLines(screenSyncFile(root)), sessionId, requestId);
    if (card === null) {
      throw new Error("이 요청의 기록을 찾지 못했어요 — 화면을 한 번 더 고친 뒤 다시 골라 주세요.");
    }
    if (this.#deps.titleOf(slug, pageId) === null) {
      throw new Error("기획서 목록에 없는 문서예요 — 목록 가운데서 골라 주세요.");
    }
    void this.#settle(card.turn, () => this.#run(card.turn, pageId, true));
    return { ok: true };
  }

  /**
   * 프로젝트 한 줄 뒤에서 돌리고, 실패하면 로그(종류만)와 함께 전체 실패 카드를 세운다(2026-11-03 A안 1A-2 — 조용한
   * 실패 알림). card 줄이 남으므로 `다시 시도` 가 턴을 찾는다. 실패 카드의 publish 자체가 던지면 삼킨다.
   */
  async #settle(turn: ScreenTurn, work: () => Promise<void>): Promise<void> {
    await this.#queue(turn.slug, work).catch((error: unknown) => {
      this.#deps.logger.error("같이 고치기 실패", { err: error });
      try {
        this.#publish(turn, {
          phase: "done",
          docs: [],
          linked: [],
          failure: { kind: "sync" },
        });
      } catch {
        // 실패 알림 자체의 실패는 삼킨다.
      }
    });
  }

  async #run(turn: ScreenTurn, picked: string | null, manual: boolean): Promise<void> {
    const { root, repoRoot } = this.#deps.paths(turn.slug);
    const routes = turn.screens.map((screen) => normalizeRoute(screen.route));
    const links = await readPlanMap(repoRoot)
      .then((map) => map.links)
      .catch(() => [] as MapLink[]);
    const refs = readPlanRefs(join(root, "plans", "refs.jsonl"), null).filter(
      (entry) => entry.sessionId === turn.sessionId,
    );
    const lines = readSyncLines(screenSyncFile(root));
    // 잇기 — 근거로 보낸 문서(또는 사람이 고른 문서)와 바뀐 화면.
    const wanted =
      picked !== null
        ? routes
            .filter(
              (route) =>
                !links.some(
                  (link) => link.pageId === picked && normalizeRoute(link.route) === route,
                ),
            )
            .map((route) => ({
              pageId: picked,
              title: this.#deps.titleOf(turn.slug, picked) ?? "",
              route,
            }))
        : autoLinks({ links, refs, sessionId: turn.sessionId, routes });
    let linked: PlanSyncLink[] = [];
    if (wanted.length > 0) {
      try {
        const written = await writePlanMap(
          repoRoot,
          wanted.map((link) => ({ op: "add" as const, pageId: link.pageId, route: link.route })),
        );
        links.splice(0, links.length, ...written);
        linked = wanted;
      } catch (error) {
        this.#deps.logger.error("같이 고치기 잇기 실패", { err: error });
      }
    }
    // 설정 토글(2026-11-03 A안 1A-1) — 끄면 잇기만 하고 대상 고르기 · 판정 · 카드는 하지 않는다.
    // 사람이 부른 길(고르기 · 다시 시도)은 토글과 상관없이 돈다.
    if (!manual && this.#deps.loopOn?.() === false) return;
    const targets: SyncTarget[] =
      picked !== null
        ? [
            {
              pageId: picked,
              docKey: null,
              title: this.#deps.titleOf(turn.slug, picked),
              sections: null,
            },
          ]
        : syncTargets({
            links,
            refs,
            sessionId: turn.sessionId,
            routes,
            declines: declinedPairs(lines),
          });
    if (targets.length === 0) {
      const sync: PlanSync = {
        phase: "done",
        docs: [],
        linked,
        ...(this.#deps.connected(turn.slug) ? { ask: { routes } } : {}),
      };
      if (sync.ask !== undefined || linked.length > 0) this.#publish(turn, sync);
      return;
    }
    const docs: PlanSyncDoc[] = targets.map((target) => ({
      docKey: target.docKey,
      pageId: target.pageId,
      title:
        target.title ??
        (target.pageId !== null ? this.#deps.titleOf(turn.slug, target.pageId) : null) ??
        "",
      outcome: "checking",
      changes: 0,
    }));
    this.#publish(turn, { phase: "checking", docs, linked });
    for (const [index, target] of targets.entries()) {
      const result = await this.#deps.drafts
        .screenSync({
          slug: turn.slug,
          pageId: target.pageId,
          docKey: target.docKey,
          displayText: turn.request,
          promptText: screenSyncPrompt({
            request: turn.request,
            screens: turn.screens,
            files: turn.files,
            sections: target.sections,
          }),
        })
        .catch(
          (error: unknown): ScreenSyncResult => ({
            docKey: target.docKey,
            title: "",
            outcome: "failed",
            changes: 0,
            detail: error instanceof Error ? error.message : String(error),
          }),
        );
      const doc: PlanSyncDoc = {
        docKey: result.docKey,
        pageId: target.pageId,
        title: result.title !== "" ? result.title : (docs[index]?.title ?? ""),
        outcome: result.outcome,
        changes: result.changes,
        ...(result.summary !== undefined && result.summary.trim() !== ""
          ? { summary: result.summary.trim() }
          : {}),
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
        ...(result.proposalId !== undefined ? { proposalId: result.proposalId } : {}),
        ...(result.kept !== undefined && result.kept > 0 ? { kept: result.kept } : {}),
      };
      docs[index] = doc;
    }
    const counts = { pending: 0, proposed: 0, unchanged: 0, failed: 0 };
    for (const doc of docs)
      if (doc.outcome in counts) counts[doc.outcome as keyof typeof counts] += 1;
    this.#deps.logger.info("같이 고치기", { docs: docs.length, linked: linked.length, ...counts });
    this.#publish(turn, { phase: "done", docs, linked });
  }

  /** 카드를 기록하고 그 대화로 보낸다. */
  #publish(turn: ScreenTurn, sync: PlanSync): void {
    if (sync.phase === "done") {
      appendLine(screenSyncFile(this.#deps.paths(turn.slug).root), {
        kind: "card",
        at: this.#now(),
        turn,
        sync,
      });
    }
    this.#deps.emit(turn, sync);
  }

  /** 기다리는 문서 행을 그 요청의 마지막 카드에서 찾는다 — 없으면 사람 말 오류. */
  #pendingDoc(
    slug: string,
    sessionId: string,
    requestId: string,
    docKey: string,
  ): { card: SyncCard; doc: PlanSyncDoc } {
    const card = lastCard(
      readSyncLines(screenSyncFile(this.#deps.paths(slug).root)),
      sessionId,
      requestId,
    );
    const doc = card?.sync.docs.find((row) => row.docKey === docKey) ?? null;
    if (
      card === null ||
      doc === null ||
      doc.outcome !== "pending" ||
      doc.proposalId === undefined
    ) {
      throw new Error("기다리는 고침을 찾지 못했어요 — 이미 넣었거나 건너뛴 것 같아요.");
    }
    return { card, doc };
  }

  /**
   * 되돌리기 기록(entry 줄)을 쓰고 그 문서 행에 entryId 를 붙인다 — 곁줄 카드의 `고치기` 와 기획서 탭의 채택이
   * 같은 줄을 남긴다(2026-11-03 A안 1A-1 — 판정이 남긴 변경안을 사람이 넣을 때 쓴다).
   */
  #writeEntry(
    card: SyncCard,
    doc: PlanSyncDoc,
    input: { proposalId: string; opIds: string[]; inverse: ScreenSyncInverse[] },
  ): void {
    if (doc.docKey === null) return;
    const entry: SyncEntry = {
      kind: "entry",
      entryId: randomUUID(),
      at: this.#now(),
      slug: card.turn.slug,
      sessionId: card.turn.sessionId,
      requestId: card.turn.requestId,
      sha: card.turn.sha,
      docKey: doc.docKey,
      title: doc.title,
      proposalId: input.proposalId,
      opIds: input.opIds,
      inverse: input.inverse,
    };
    appendLine(screenSyncFile(this.#deps.paths(card.turn.slug).root), entry);
    doc.entryId = entry.entryId;
  }

  /** 곁줄 카드의 `고치기`(2026-11-03 A안 1A-1) — 기다리는 변경안을 넣고 되돌리기 기록을 남긴다. */
  async apply(
    slug: string,
    sessionId: string,
    requestId: string,
    docKey: string,
  ): Promise<{ ok: true }> {
    // 줄 밖에서 모양을 먼저 본다 — 사람 말 오류는 즉시 던지고, 넣기는 한 줄 안에서 다시 본다.
    this.#pendingDoc(slug, sessionId, requestId, docKey);
    await this.#queue(slug, async () => {
      // 한 줄 안에서 다시 읽는다 — 줄을 기다리는 동안 다른 길이 그 변경안을 정했을 수 있다.
      const { card: fresh, doc } = this.#pendingDoc(slug, sessionId, requestId, docKey);
      const result = await this.#deps.drafts.screenSyncApply({
        slug,
        docKey: doc.docKey ?? docKey,
        proposalId: doc.proposalId ?? "",
      });
      doc.outcome = result.outcome;
      doc.changes = result.changes;
      if (result.detail !== undefined) doc.detail = result.detail;
      if (result.kept !== undefined && result.kept > 0) doc.kept = result.kept;
      if (result.title !== "") doc.title = result.title;
      if (result.outcome === "adopted") {
        this.#writeEntry(fresh, doc, {
          proposalId: result.proposalId ?? "",
          opIds: result.opIds ?? [],
          inverse: result.inverse ?? [],
        });
        // 들어간 뒤에만 열쇠를 내린다 — proposed(전부 오래됨) · 실패에는 남겨 기획서 탭의 걷기가 카드를 찾게 한다
        // (2026-11-03 검토 · 후속 1).
        delete doc.proposalId;
      }
      this.#publish(fresh.turn, { ...fresh.sync, docs: [...fresh.sync.docs] });
    });
    return { ok: true };
  }

  /** 곁줄 카드의 `건너뛰기`(2026-11-03 A안 1A-1) — 변경안을 걷고 (문서, 화면) 짝을 기억한다. */
  async skip(
    slug: string,
    sessionId: string,
    requestId: string,
    docKey: string,
  ): Promise<{ ok: true }> {
    // 줄 밖에서 모양을 먼저 본다 — 사람 말 오류는 즉시 던지고, 걷기는 한 줄 안에서 다시 본다.
    this.#pendingDoc(slug, sessionId, requestId, docKey);
    await this.#queue(slug, async () => {
      // 한 줄 안에서 다시 읽는다 — 줄을 기다리는 동안 다른 길이 그 변경안을 정했을 수 있다.
      const { card: fresh, doc } = this.#pendingDoc(slug, sessionId, requestId, docKey);
      await this.#deps.drafts.screenSyncDismiss({
        slug,
        docKey: doc.docKey ?? docKey,
        proposalId: doc.proposalId ?? "",
      });
      // 짝 기억 — 같은 문서가 같은 화면에 연결로만 이어져도 다시 대상으로 고르지 않는다.
      appendLine(screenSyncFile(this.#deps.paths(slug).root), {
        kind: "decline",
        at: this.#now(),
        slug,
        pageId: doc.pageId,
        docKey: doc.docKey ?? docKey,
        routes: fresh.turn.screens.map((screen) => normalizeRoute(screen.route)),
      });
      doc.outcome = "declined";
      delete doc.proposalId;
      this.#publish(fresh.turn, { ...fresh.sync, docs: [...fresh.sync.docs] });
    });
    return { ok: true };
  }

  /** 전체 실패 카드의 `다시 시도`(2026-11-03 A안 1A-2) — 사람이 부른 길이라 토글과 상관없이 돈다. */
  async retry(slug: string, sessionId: string, requestId: string): Promise<{ ok: true }> {
    const card = lastCard(
      readSyncLines(screenSyncFile(this.#deps.paths(slug).root)),
      sessionId,
      requestId,
    );
    if (card?.sync.failure === undefined) {
      throw new Error(
        "다시 시도할 같이 고침을 찾지 못했어요 — 실패한 카드에서만 다시 시도할 수 있어요.",
      );
    }
    void this.#settle(card.turn, () => this.#run(card.turn, null, true));
    return { ok: true };
  }

  /**
   * 기획서 탭에서 화면 변경안이 넣어지거나 걷혔다(`DraftServiceDeps.onScreenProposal`) — 그 proposalId 를 기다리는
   * 마지막 카드를 찾아 맞춘다: 넣으면 되돌리기 기록(entry 줄)과 adopted, 걷으면 unchanged(줄이 사라진다).
   */
  onProposalSettled(input: {
    slug: string;
    docKey: string;
    proposalId: string;
    outcome: "adopted" | "rejected";
    opIds: string[];
    inverse: ScreenSyncInverse[];
  }): void {
    const file = screenSyncFile(this.#deps.paths(input.slug).root);
    const lines = readSyncLines(file);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      if (line?.kind !== "card") continue;
      const doc = line.sync.docs.find(
        (row) =>
          (row.outcome === "pending" || row.outcome === "proposed") &&
          row.proposalId === input.proposalId,
      );
      if (doc === undefined) continue;
      if (input.outcome === "adopted") {
        this.#writeEntry(line, doc, {
          proposalId: input.proposalId,
          opIds: input.opIds,
          inverse: input.inverse,
        });
        doc.outcome = "adopted";
        doc.changes = input.opIds.length;
      } else {
        doc.outcome = "unchanged";
        doc.changes = 0;
      }
      delete doc.proposalId;
      this.#publish(line.turn, { ...line.sync, docs: [...line.sync.docs] });
      return;
    }
  }

  /** 곁줄의 되돌리기 — 그 한 문서의 같이 고친 블록을 돌린다. */
  async undo(slug: string, entryId: string): Promise<{ restored: number; kept: number }> {
    const file = screenSyncFile(this.#deps.paths(slug).root);
    const entry = liveEntries(readSyncLines(file)).find((line) => line.entryId === entryId);
    if (entry === undefined) return { restored: 0, kept: 0 };
    return await this.#queue(slug, () => this.#undoEntry(entry));
  }

  /**
   * 화면 되돌리기 뒤 — 그 지점보다 뒤의 보관에 묶인 같이 고친 초안을 새것부터 돌리고(기록과 같은 sha 규칙),
   * 아직 누름을 기다리는(`pending`) 문서의 변경안은 걷는다 — 되돌린 화면의 고침을 기다리게 두지 않는다
   * (2026-11-03 A안 1A-1). 돌린 문서 수를 돌려준다. `historyNewestFirst` 는 되돌리기 전의 보관 이력(새것부터)이다.
   */
  async undoAfterRestore(
    slug: string,
    historyNewestFirst: readonly string[],
    sha: string,
  ): Promise<number> {
    const file = screenSyncFile(this.#deps.paths(slug).root);
    const at = historyNewestFirst.indexOf(sha);
    if (at < 0) return 0;
    const newer = new Set(historyNewestFirst.slice(0, at));
    let undone = 0;
    // 고르기와 걷기 모두 한 줄 안에서 파일을 다시 읽는다(2026-11-03 검토 · 후속 1) — 앞서 줄에 든 `고치기` 가
    // 쓴 entry 를 되돌려야 하고, 한 요청의 옛 카드 줄을 되살리면 안 된다.
    await this.#queue(slug, async () => {
      // 먼저 들어간 고침을 새것부터 돌린다 — 지금 읽은 파일의 살아 있는 기록 기준.
      const picked = entriesAfterRestore(liveEntries(readSyncLines(file)), historyNewestFirst, sha);
      for (const entry of picked) {
        const result = await this.#undoEntry(entry).catch(() => null);
        if (result !== null && result.restored > 0) undone += 1;
      }
      // 걷기 — 되돌림 지점보다 새 보관에 묶인 요청마다 마지막 카드 한 장만 보고, 아직 기다리는 문서만 걷어
      // 그 최신 카드를 한 번 다시 선다. 옛 카드 줄은 다시 쌓지 않는다.
      const seen = new Set<string>();
      const keys: Array<{ sessionId: string; requestId: string }> = [];
      for (const line of readSyncLines(file)) {
        if (line.kind !== "card" || line.turn.sha === null || !newer.has(line.turn.sha)) continue;
        const key = `${line.turn.sessionId}${line.turn.requestId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        keys.push({ sessionId: line.turn.sessionId, requestId: line.turn.requestId });
      }
      for (const key of keys) {
        const card = lastCard(readSyncLines(file), key.sessionId, key.requestId);
        if (card === null) continue;
        let touched = false;
        for (const doc of card.sync.docs) {
          if (doc.outcome !== "pending" || doc.proposalId === undefined) continue;
          if (doc.docKey !== null) {
            const docKey = doc.docKey;
            const proposalId = doc.proposalId;
            await this.#deps.drafts
              .screenSyncDismiss({ slug, docKey, proposalId })
              .catch(() => undefined);
          }
          doc.outcome = "unchanged";
          doc.changes = 0;
          delete doc.proposalId;
          touched = true;
        }
        if (!touched) continue;
        try {
          this.#publish(card.turn, { ...card.sync, docs: [...card.sync.docs] });
        } catch {
          // 카드 다시 서기의 실패는 되돌리기를 막지 않는다.
        }
      }
    });
    return undone;
  }

  async #undoEntry(entry: SyncEntry): Promise<{ restored: number; kept: number }> {
    const result = await this.#deps.drafts.screenSyncUndo({
      slug: entry.slug,
      docKey: entry.docKey,
      proposalId: entry.proposalId,
      opIds: entry.opIds,
      inverse: entry.inverse,
    });
    const { root } = this.#deps.paths(entry.slug);
    const file = screenSyncFile(root);
    appendLine(file, { kind: "undone", at: this.#now(), entryId: entry.entryId });
    this.#deps.logger.info("같이 고치기 되돌림", { restored: result.restored, kept: result.kept });
    const card = lastCard(readSyncLines(file), entry.sessionId, entry.requestId);
    if (card !== null) {
      const sync: PlanSync = {
        ...card.sync,
        docs: card.sync.docs.map((doc) =>
          doc.entryId === entry.entryId
            ? {
                ...doc,
                outcome: "undone",
                kept: result.kept,
              }
            : doc,
        ),
      };
      this.#publish(card.turn, sync);
    }
    return result;
  }
}
