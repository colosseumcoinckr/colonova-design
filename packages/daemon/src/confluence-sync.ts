/**
 * 기획서 가져오기(2026-10-18 기획서 동기화 1단계 · 계획 A1) — 연결이 쓰는 국소 규칙과
 * 가져오기 루프가 여기 산다. 트리거는 넷이다: 데몬 시작 · 10분 타이머 ·
 * `confluence.importNow`(뷰어 · 설정의 새로 가져오기 단추 — 중복 눌림은 차선의 합류로
 * 한 번만 돈다, 취소는 없다) · 문서 관리 뒤의 `walkNow`(2026-10-23 · 최종 구현 계획 F2 ·
 * 작업 B5 — 휴지통 · 이동 · 복구 · 복제는 증분이 못 본다). 저장 포맷은 원문 그대로,
 * 마크다운은 파생물, 원장은 한 벌이다.
 * 커밋은 없다(D1) — 쓰기는 각 프로젝트의 차선("confluence")에 서서 stash · checkout 경합을 피한다.
 * 가져오기 중 401 을 만나면 만료 상태로 적고 다시 connect 전까지 조용히 건너뛴다.
 *
 * 걷기와 증분(2026-10-19 고침) — 폴더 경로는 트리 걷기(planPaths) 한 곳에서만 계산한다. 걷기는
 * 첫 가져오기 · 데몬 시작 뒤 첫 바퀴 · 빠짐없이 끝나지 못한 걷기의 다음 바퀴 · 증분이 처음 보는
 * 문서나 제목이 바뀐 문서를 만난 바퀴 · 문서 관리 뒤의 walkNow(2026-10-23 · 작업 B5)에 돈다.
 * 이동은 판도 lastModified 도 올리지 않아(2026-10-18 실측) 증분이 못 보므로 시작 걷기가 잡는다.
 * 그 사이의 바퀴는 뿌리 아래로 좁힌 CQL 증분이다. 걷기는 경로가 바뀐 문서를
 * 새 자리로 옮기고, 빠짐없이 끝난 걷기는 트리에 없는 문서(지워졌거나 뿌리 밖으로 옮겨 간 것)를 거둔다.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, sep } from "node:path";
import {
  ConfluenceClient,
  type ConfluencePage,
  type ConfluenceRead,
  type ConfluenceReadFailure,
  createConfluenceTransport,
  normalizeSite,
} from "./confluence-client.js";
import {
  type ConfluenceLedger,
  emptyConfluenceLedger,
  readConfluenceLedger,
  writeConfluenceLedger,
} from "./confluence-ledger.js";
import { deriveMarkdown } from "./confluence-markdown.js";
import { type PlanNode, planName, planPaths } from "./confluence-path.js";
import { type CredentialStore, loadConfluenceCredentials } from "./credentials.js";
import type { LaneKind } from "./git-lane.js";
import type { DaemonLogger } from "./log.js";
import type { RestTransport } from "./rest-transport.js";

/** 기획서 폴더 — 클론 안에서 문서가 내려앉는 자리(제출에 안 탄다 — D1). */
export const PLANS_DIR = "docs/plans/";

/**
 * 클론의 `.git/info/exclude` 에 기획서 폴더를 한 줄로 박는다(F7 · 연결 직후, 첫 쓰기보다
 * 앞선다 — `stash push --include-untracked` 가 미추적 파일을 치우기 전에 규칙이 먼저
 * 있어야 한다). 멱등하다 — 이미 있는 줄은 다시 쓰지 않는다. 클론 국소 파일이므로 커밋은
 * 없다. `.git` 이 없으면(클론이 아직 없다) 조용히 넘어간다 — 연결은 클론을 요구하지 않는다.
 */
export function ensurePlansExclude(repoRoot: string): boolean {
  const gitDir = join(repoRoot, ".git");
  if (!existsSync(gitDir)) return false;
  const excludeFile = join(gitDir, "info", "exclude");
  const existing = existsSync(excludeFile) ? readFileSync(excludeFile, "utf8") : "";
  const line = PLANS_DIR;
  if (existing.split(/\r?\n/).some((entry: string) => entry.trim() === line)) return false;
  mkdirSync(join(gitDir, "info"), { recursive: true });
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  writeFileSync(excludeFile, `${existing}${separator}${line}\n`);
  return true;
}

/**
 * 뿌리가 바뀐 연결 — 원장을 비운다: 다음 가져오기가 새 뿌리 전체를 걷게 하고, 옛 뿌리의
 * 문서는 목록에 남지 않는다(파일은 클론의 몫이 아니라 앱의 몫이지만 지우지는 않는다 —
 * 경로가 같으면 덮어쓴다). 같은 뿌리면 아무 일도 없다.
 */
export function resetLedgerOnRootChange(
  repoRoot: string,
  previousRootId: string | null,
  nextRootId: string,
): boolean {
  if (previousRootId === null || previousRootId === nextRootId) return false;
  writeConfluenceLedger(confluenceLedgerFile(repoRoot), emptyConfluenceLedger());
  return true;
}

/** 연결 미러의 키 — machine.json 의 플랫 맵에 프로젝트 스코프를 주는 방법(F1 · 슬러그 키). */
export function confluenceSiteKey(slug: string): string {
  return `confluenceSite:${slug}`;
}

export function confluenceRootIdKey(slug: string): string {
  return `confluenceRootId:${slug}`;
}

export function confluenceRootTitleKey(slug: string): string {
  return `confluenceRootTitle:${slug}`;
}

/** 원장 파일 — 클론 안 기획서 폴더의 한 벌. */
export function confluenceLedgerFile(repoRoot: string): string {
  return join(repoRoot, PLANS_DIR, "confluence.json");
}

/** 가져오기의 간격 — 레포 최신화와 같은 감각의 10분(계획 A1). */
export const CONFLUENCE_POLL_MS = 10 * 60_000;

/** 시작 첫 바퀴의 미룸 — 서버 조립이 끝난 뒤에 돌도록 5초(세대4 설계자 지적 · 항목 11). */
export const CONFLUENCE_BOOT_TICK_MS = 5_000;

/**
 * 문서 수의 상한 — 정책서 87쪽 + 기능설계서 73쪽(160여)이면 충분한 여유다. 상한에 닿으면
 * 멈추고 lastSyncAt 을 앞서지 않는다: 다음 차례가 남은 문서를 이어받는다(기록은 종류와 수만).
 */
export const MAX_IMPORT_PAGES = 500;

/**
 * 증분 CQL 의 겹침(2026-10-19) — CQL 의 시각 글자는 검색하는 계정의 시간대로 읽힌다. 가장 서쪽
 * 시간대(UTC−12)로 읽혀도 빠지는 문서가 없게 12시간, 분 단위로 자른 자리까지 1분을 더 겹친다. 겹쳐
 * 다시 걸린 문서는 검색이 실어 오는 판으로 거르고(원장이 같은 판을 알면 본문을 읽지 않는다), 판이
 * 안 오면 readPage 의 판 검사가 거른다 — 겹침은 정확성을 해치지 않는다.
 */
export const CQL_OVERLAP_MS = 12 * 60 * 60_000 + 60_000;

/**
 * 빠짐없이 끝나지 못한 걷기 뒤에 다시 걷는 횟수의 상한 — 늘 못 읽히는 문서 하나(권한 · 계속 끊기는 본문)가
 * 10분마다 트리 전체를 다시 읽게 두지 않는다. 상한을 넘으면 다음 데몬 시작까지 증분으로 돈다(2026-10-19).
 */
export const MAX_INCOMPLETE_REWALKS = 2;

/** 클론의 모습 — 뿌리와 그 프로젝트의 차선. */
export interface ConfluenceWorkspaceView {
  root: string;
  laneRun: <T>(kind: LaneKind, job: () => Promise<T>, opts?: { join?: boolean }) => Promise<T>;
}

export interface ConfluenceSyncDeps {
  machineSetting: { get(key: string): string | null };
  credentials: CredentialStore;
  /** 프로젝트의 클론 모습 — 클론이 없는 프로젝트는 null(가져올 자리가 없다). */
  workspaceOf(slug: string): ConfluenceWorkspaceView | null;
  /** 연결될 수 있는 프로젝트의 목록 — registry 가 기억하는 slug 전부. */
  slugs(): string[];
  logger: DaemonLogger;
  now?: () => Date;
  /** 기다림의 주입 — 429 사다리가 시험에서 자지 않는다(CI 는 프로세스를 띄우지 않는다). */
  sleep?: (ms: number) => Promise<void>;
}

export interface ConfluenceImportResult {
  imported: number;
  /** 원장이 이미 같은 판을 알거나(자리만 옮긴 문서 포함) 이번 바퀴에 못 읽은 문서. */
  skipped: number;
  capped: boolean;
}

/** 연결의 한 끳이 — importOnce 가 돌기 위해 알아야 할 최소. */
interface ConfluenceLink {
  site: string;
  rootId: string;
  client: ConfluenceClient;
}

/** 이번 바퀴가 손볼 문서들 — 걷기든 증분이든 같은 모양으로 루프에 들어간다. */
interface ImportTargets {
  pages: Array<{ id: string; path: string }>;
  /** 폴더 — 본문 없는 계층. 걷기만 채운다(2026-10-23 최종 구현 계획 F0). */
  folders: Array<{ id: string; path: string; title: string }>;
  /** 본문을 읽지 않는 종류 — 화이트보드 · 데이터베이스 · 임베드 · 모르는 종류. 걷기만 채운다. */
  unsupported: Array<{ id: string; path: string; title: string; type: string }>;
  /** 이미 읽은 문서 — 루프가 다시 묻지 않는다. */
  reads: Map<string, ConfluencePage>;
  /** 트리 걷기였는가 — 자리를 옮기고 트리에 없는 문서를 거두는 것은 걷기만 한다. */
  walked: boolean;
  /** 걷기가 한 갈래도 빠짐없이 끝났는가 — 아니면 거두지 않고 다음 바퀴가 다시 걷는다. */
  complete: boolean;
  /** 검색이 실어 온 판으로 미리 거른 문서 수(본문을 읽지 않았다). */
  skipped: number;
}

type TargetsOutcome =
  | { kind: "ok"; targets: ImportTargets }
  /** 증분이 처음 보는 문서나 제목이 바뀐 문서를 만났다 — 이 바퀴는 걷는다(읽은 문서는 넘긴다). */
  | { kind: "walk"; reads: Map<string, ConfluencePage> }
  | { kind: "unauthorized" }
  /** 뿌리나 검색을 못 읽었다 — 원장을 앞서지 않는다(시각을 앞서면 그 사이의 변경을 영영 놓친다). */
  | { kind: "failed"; stage: "root" | "search"; reason: ConfluenceReadFailure };

/** 클론이 섰는가 — repo-core 의 isCloned 와 같은 판정(`.git` 이 있다). */
function cloned(root: string): boolean {
  return existsSync(join(root, ".git"));
}

export class ConfluenceSync {
  /** 만료(가져오기 중 401)의 원장 밖 상태 — 다시 connect 하면 내려앉는다. */
  private readonly expiredBySlug = new Set<string>();
  /** 다음 바퀴가 트리를 걸어야 하는 프로젝트 — 데몬 시작(start)과 빠짐없이 끝나지 못한 걷기가 넣는다. */
  private readonly walkDue = new Set<string>();
  /** 빠짐없이 끝나지 못한 걷기가 잇달아 몇 번이었나 — MAX_INCOMPLETE_REWALKS 가 다시 걷기를 끊는다. */
  private readonly incompleteWalks = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private bootTimer: NodeJS.Timeout | null = null;
  /**
   * 전송은 데몬 당 한 벌이다(github-bridge 선례) — 기록된 fixture 의 테이프가
   * 가져오기마다 되감기면 증분이 같은 페이지를 다시 읽는다. 실사이트 전송은
   * 사이트별로 한 벌(뿌리 주소가 사이트마다 다르다).
   */
  private readonly fixtureTransport: RestTransport | null;
  private readonly siteTransports = new Map<string, RestTransport>();

  constructor(private readonly deps: ConfluenceSyncDeps) {
    this.fixtureTransport = process.env.COLONOVA_DESIGN_CONFLUENCE_FIXTURE
      ? createConfluenceTransport(process.env, "fixture").transport
      : null;
  }

  /**
   * 데몬 시작의 트리거 — 앱을 켤 때 한 번, 이후 10분 타이머(계획 항목 11). 시작 뒤 첫 바퀴는 프로젝트마다
   * 트리를 걷는다 — 꺼져 있던 사이의 이동은 증분이 못 본다.
   */
  start(): void {
    if (this.timer !== null) return;
    this.incompleteWalks.clear();
    for (const slug of this.deps.slugs()) this.walkDue.add(slug);
    this.timer = setInterval(() => this.tickAll(), CONFLUENCE_POLL_MS);
    this.timer.unref?.();
    // 조용한 첫 바퀴 — 부팅 직전에 이미 만료된 토큰의 401 도 이 바퀴가 만료 상태로 싣는다.
    this.bootTimer = setTimeout(() => this.tickAll(), CONFLUENCE_BOOT_TICK_MS);
    this.bootTimer.unref?.();
  }

  stop(): void {
    if (this.bootTimer !== null) clearTimeout(this.bootTimer);
    this.bootTimer = null;
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** 만료 판정 — ProjectSummary.confluence.expired 의 원천. */
  expiredState(slug: string): boolean {
    return this.expiredBySlug.has(slug);
  }

  /** connect 가 다시 이기면 만료는 내려앉는다. */
  clearExpired(slug: string): void {
    this.expiredBySlug.delete(slug);
  }

  private readonly inFlight = new Map<string, Promise<ConfluenceImportResult>>();

  /**
   * 설정 · 뷰어의 새로 가져오기 — 같은 프로젝트의 도는 가져오기에 합류한다. 차선의 join 이
   * 잡는 것은 줄에 선 작업까지라, 이미 도는 바퀴는 여기서 한 번 더 잡는다(취소는 없다 —
   * 부르는 손이 몇 개든 같은 결과를 받는다).
   */
  importNow(slug: string): Promise<ConfluenceImportResult> {
    const running = this.inFlight.get(slug);
    if (running !== undefined) return running;
    const workspace = this.deps.workspaceOf(slug);
    // 클론이 서기 전에는 쓰지 않는다 — 클론 전의 폴더에 파일을 두면 준비가 그 폴더를 잔해로 보고
    // 통째로 지운다(repo-bringup 의 clearBringUpDebris · 2026-10-19 고침).
    if (workspace === null || !cloned(workspace.root)) {
      return Promise.reject(
        new Error(
          "기획서를 가져올 클론이 아직 없어요 — 프로젝트 준비가 끝난 뒤 다시 가져와 주세요.",
        ),
      );
    }
    const promise = workspace
      .laneRun("confluence", () => this.importOnce(slug), { join: true })
      .finally(() => {
        this.inFlight.delete(slug);
      });
    this.inFlight.set(slug, promise);
    return promise;
  }

  /** 걷기를 청하는 손의 합류 — 여러 손이 동시에 불러도 걷는 바퀴는 하나다(2026-10-23 · 작업 B5). */
  private readonly walkInFlight = new Map<string, Promise<ConfluenceImportResult>>();

  /**
   * 문서 관리(휴지통 · 이동 · 복구 · 복제) 뒤의 걷기(2026-10-23 · 최종 구현 계획 F2 · 작업 B5) —
   * 이동은 판도 lastModified 도 올리지 않고 휴지통으로 간 문서는 검색에서 빠질 뿐이라 증분이 못 본다.
   * 먼저 walkDue 에 넣는다 — 이 뒤에 걷기 판정을 하는 바퀴는 모두 걷는다(증분 바퀴는 표를 지우지 않고,
   * 빠짐없이 끝난 걷기만 지운다). 이미 도는 바퀴는 판정을 마쳤을 수 있으니 끝나길 기다린 뒤 한 바퀴를 더
   * 돈다(importNow — 줄에 선 바퀴에 합류해도 그 바퀴는 아직 판정 전이라 걷는다).
   * 기다림은 차선 밖에서 한다 — 차선 작업 안에서 다른 바퀴를 기다리면, 합류(join)가 종류만 보고 줄에 선
   * 작업에 붙는 탓에 자기 자신을 기다려 차선(보관 · 제출과 같은 줄)이 멈춘다(2026-10-23 오케스트레이터 검토).
   * 클론이 서기 전의 거절은 importNow 와 같다.
   */
  walkNow(slug: string): Promise<ConfluenceImportResult> {
    const walking = this.walkInFlight.get(slug);
    if (walking !== undefined) return walking;
    const workspace = this.deps.workspaceOf(slug);
    // 클론이 서기 전에는 쓰지 않는다 — importNow 의 거절과 같은 문장이다(2026-10-23 · 작업 B5).
    if (workspace === null || !cloned(workspace.root)) {
      return Promise.reject(
        new Error(
          "기획서를 가져올 클론이 아직 없어요 — 프로젝트 준비가 끝난 뒤 다시 가져와 주세요.",
        ),
      );
    }
    this.walkDue.add(slug);
    const running = this.inFlight.get(slug);
    const promise = (async () => {
      // 도는 바퀴가 끝나길 기다린다 — 그 바퀴가 실패해도 우리 걷기는 돈다.
      if (running !== undefined) await running.catch(() => undefined);
      // 기다린 바퀴가 걷기로 끝났으면 표를 지웠다 — 그 바퀴의 트리는 문서 관리 전에 찍혔을 수 있으니 다시 세운다
      // (2026-10-23 2차 검토 R3 — 증분으로 흘러 휴지통 · 이동을 놓치던 것).
      this.walkDue.add(slug);
      return await this.importNow(slug);
    })().finally(() => {
      this.walkInFlight.delete(slug);
    });
    this.walkInFlight.set(slug, promise);
    return promise;
  }

  /**
   * 타이머의 한 바퀴 — 연결되고 클론이 선 프로젝트만 조용히 돈다. 만료 · 도는 바퀴 · 연결 안 된 프로젝트 ·
   * 클론 전의 프로젝트는 건너뛴다(열 번째 분마다 같은 경고를 쌓지 않는다 · 2026-10-19 고침).
   */
  private tickAll(): void {
    for (const slug of this.deps.slugs()) {
      if (this.expiredBySlug.has(slug) || this.inFlight.has(slug)) continue;
      if (!this.connected(slug)) continue;
      const workspace = this.deps.workspaceOf(slug);
      if (workspace === null || !cloned(workspace.root)) continue;
      // importNow 의 한 길로든다 — 도는 바퀴에의 합류 등록까지 같은 규칙을 받는다.
      this.importNow(slug).catch((error: unknown) => {
        // 로그는 종류와 수만 — 사용자의 말 · 경로 · 자격은 남기지 않는다.
        this.deps.logger.warn("기획서 가져오기 실패", {
          reason: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  /** 연결 미러가 사이트와 뿌리를 다 아는가 — 자격은 바퀴 안에서 읽는다. */
  private connected(slug: string): boolean {
    return (
      this.deps.machineSetting.get(confluenceSiteKey(slug)) !== null &&
      this.deps.machineSetting.get(confluenceRootIdKey(slug)) !== null
    );
  }

  /** 한 프로젝트의 한 바퀴 — 읽고(Confluence 가 정본) 쓰고(파생물) 원장을 고친다. */
  private async importOnce(slug: string): Promise<ConfluenceImportResult> {
    const none: ConfluenceImportResult = { imported: 0, skipped: 0, capped: false };
    const link = await this.link(slug);
    if (link === null || this.expiredBySlug.has(slug)) return none;
    const workspace = this.deps.workspaceOf(slug);
    // 줄에 서 있는 사이 클론이 사라졌을 수 있다 — 차선 안에서 한 번 더 본다.
    if (workspace === null || !cloned(workspace.root)) return none;
    // 쓰기보다 규칙이 먼저다(F7) — 재클론 뒤에도 exclude 가 살아 있게 매 바퀴 확인한다.
    ensurePlansExclude(workspace.root);

    const startedAt = (this.deps.now?.() ?? new Date()).toISOString();
    const ledger = readConfluenceLedger(confluenceLedgerFile(workspace.root));
    const first = ledger.roots.length === 0 || ledger.lastSyncAt === null;
    let outcome =
      first || this.walkDue.has(slug)
        ? await this.walkTargets(link, new Map())
        : await this.incrementalTargets(link, ledger);
    if (outcome.kind === "walk") outcome = await this.walkTargets(link, outcome.reads);
    if (outcome.kind === "unauthorized") {
      this.noteExpired(slug);
      return none;
    }
    if (outcome.kind === "failed") {
      // 종류만 남긴다 — 시각은 앞서지 않으니 다음 바퀴가 같은 자리에서 다시 묻는다.
      this.deps.logger.warn("기획서 가져오기 실패", {
        stage: outcome.stage,
        reason: outcome.reason,
      });
      return none;
    }
    if (outcome.kind !== "ok") return none;
    const targets = outcome.targets;

    let imported = 0;
    let skipped = targets.skipped;
    let capped = false;
    /** 옛 자리 — 모든 쓰기가 끝난 뒤에 지운다. 두 문서가 자리를 맞바꾼 바퀴에서 새로 쓴 파일을 지우지 않게. */
    const stale = new Set<string>();
    for (const target of targets.pages) {
      if (imported >= MAX_IMPORT_PAGES) {
        capped = true;
        break;
      }
      const cached = targets.reads.get(target.id);
      const read: ConfluenceRead<ConfluencePage> =
        cached !== undefined
          ? { readable: true, value: cached }
          : await link.client.readPage(target.id);
      if (!read.readable) {
        if (read.reason === "unauthorized") {
          this.noteExpired(slug);
          return { imported, skipped, capped };
        }
        // 못 읽은 한 문서는 이번 바퀴의 건너뜀이다 — 원장은 아는 것만 고친다.
        skipped += 1;
        continue;
      }
      const known = ledger.pages[target.id];
      const fresh = known === undefined || known.version < read.value.version;
      const moved = known !== undefined && known.path !== target.path;
      // 원장이 같거나 더 새 판을 알고 자리도 그대로면 흘려 보낸다(CQL 의 너른 답 · 겹침).
      if (!fresh && !moved) {
        skipped += 1;
        continue;
      }
      const comments = fresh
        ? await this.commentCount(link, ledger, target.id)
        : (known?.comments ?? null);
      const derived = deriveMarkdown(read.value.storage, {
        pageId: read.value.id,
        space: read.value.spaceId,
        title: read.value.title,
        version: read.value.version,
        updatedAt: read.value.updatedAt,
      });
      // 정본은 원문 그대로 — 저장 포맷을 한 글자도 바꾸지 않는다. 자리만 옮긴 문서도 새 자리에 다시 쓴다.
      writeDoc(workspace.root, target.path, read.value.storage, derived.markdown);
      if (moved && known !== undefined) stale.add(known.path);
      ledger.pages[target.id] = {
        path: target.path,
        title: read.value.title,
        version: read.value.version,
        sections: derived.sections,
        comments,
      };
      if (fresh) imported += 1;
      else skipped += 1;
    }

    // 빠짐없이 끝난 걷기만 거둔다 — 트리에 없는 문서는 지워졌거나 뿌리 밖으로 옮겨 갔다.
    if (targets.walked && targets.complete) {
      const inTree = new Set(targets.pages.map((page) => page.id));
      for (const [id, page] of Object.entries(ledger.pages)) {
        if (inTree.has(id)) continue;
        stale.add(page.path);
        delete ledger.pages[id];
      }
    }
    // 폴더 · 미지원 종류는 걷기의 몫이다 — 빠짐없이 끝난 걷기는 통째로 바꾸고, 아니면 아는 것만 덮어 넣는다
    // (지우지 않는다 — 못 읽은 갈래의 옛 항목이 다음 바퀴의 몫이다 · 2026-10-23 최종 구현 계획 F0).
    if (targets.walked) {
      if (targets.complete) {
        ledger.folders = Object.fromEntries(
          targets.folders.map((folder) => [folder.id, { path: folder.path, title: folder.title }]),
        );
        ledger.unsupported = Object.fromEntries(
          targets.unsupported.map((row) => [
            row.id,
            { path: row.path, title: row.title, type: row.type },
          ]),
        );
      } else {
        for (const folder of targets.folders) {
          ledger.folders[folder.id] = { path: folder.path, title: folder.title };
        }
        for (const row of targets.unsupported) {
          ledger.unsupported[row.id] = { path: row.path, title: row.title, type: row.type };
        }
      }
    }
    const live = new Set(Object.values(ledger.pages).map((page) => page.path));
    for (const path of stale) {
      if (!live.has(path)) removeDoc(workspace.root, path);
    }

    if (!capped) {
      ledger.lastSyncAt = startedAt;
      ledger.site = `https://${normalizeSite(link.site)}`;
      if (ledger.roots.length === 0) ledger.roots = [link.rootId];
    }
    mkdirSync(join(workspace.root, PLANS_DIR), { recursive: true });
    writeConfluenceLedger(confluenceLedgerFile(workspace.root), ledger);
    if (targets.walked) {
      // 한 갈래라도 못 읽은 걷기는 다음 바퀴가 다시 걷는다 — 빠진 문서가 증분에 영영 안 걸리지 않게. 다만
      // 잇달아 MAX_INCOMPLETE_REWALKS 번을 넘으면 멈춘다(다음 데몬 시작이 다시 걷는다).
      const misses = targets.complete ? 0 : (this.incompleteWalks.get(slug) ?? 0) + 1;
      if (misses === 0) this.incompleteWalks.delete(slug);
      else this.incompleteWalks.set(slug, misses);
      if (misses > 0 && misses <= MAX_INCOMPLETE_REWALKS) this.walkDue.add(slug);
      else this.walkDue.delete(slug);
    }
    if (capped) {
      // 상한 안내는 종류와 수만 — 다음 바퀴가 남은 문서를 이어받는다.
      this.deps.logger.warn("기획서 가져오기 상한", { imported, cap: MAX_IMPORT_PAGES });
    }
    return { imported, skipped, capped };
  }

  /** 원장 밖 만료 상태 — 문장은 상태 방송이 말한다. */
  private noteExpired(slug: string): void {
    this.expiredBySlug.add(slug);
  }

  /** 연결의 한 끳이 — 미러와 저장된 자격이 모여 클라이언트가 된다. */
  private async link(slug: string): Promise<ConfluenceLink | null> {
    const site = this.deps.machineSetting.get(confluenceSiteKey(slug));
    const rootId = this.deps.machineSetting.get(confluenceRootIdKey(slug));
    const creds = await loadConfluenceCredentials(this.deps.credentials, process.env);
    if (site === null || rootId === null || creds === null) return null;
    let transport = this.fixtureTransport;
    if (transport === null) {
      const cached = this.siteTransports.get(site);
      if (cached !== undefined) transport = cached;
      else {
        transport = createConfluenceTransport(process.env, site).transport;
        this.siteTransports.set(site, transport);
      }
    }
    return {
      site,
      rootId,
      client: new ConfluenceClient({ site, ...creds }, transport, this.deps.sleep),
    };
  }

  /** 한 문서 읽기 — 이 바퀴에 이미 읽은 것은 다시 묻지 않는다. */
  private async readCached(
    link: ConfluenceLink,
    pageId: string,
    reads: Map<string, ConfluencePage>,
  ): Promise<ConfluenceRead<ConfluencePage>> {
    const cached = reads.get(pageId);
    if (cached !== undefined) return { readable: true, value: cached };
    const read = await link.client.readPage(pageId);
    if (read.readable) reads.set(pageId, read.value);
    return read;
  }

  /**
   * 트리 걷기 — 뿌리 아래 전체 트리를 걷고 폴더 경로를 한 번에 계산한다(페이지 id 는 이동해도
   * 변하지 않는다 — 경로는 트리에서 다시 계산한다). 증분이 넘긴 읽기는 다시 묻지 않는다.
   */
  private async walkTargets(
    link: ConfluenceLink,
    reads: Map<string, ConfluencePage>,
  ): Promise<TargetsOutcome> {
    const rootRead = await this.readCached(link, link.rootId, reads);
    if (!rootRead.readable) {
      return rootRead.reason === "unauthorized"
        ? { kind: "unauthorized" }
        : { kind: "failed", stage: "root", reason: rootRead.reason };
    }
    const walk = await this.walkChildren(link, link.rootId, "page", reads);
    if (walk.unauthorized) return { kind: "unauthorized" };
    const root: PlanNode = {
      id: rootRead.value.id,
      title: rootRead.value.title,
      kind: "page",
      children: walk.nodes,
    };
    const spaceKey =
      rootRead.value.spaceId === null ? null : await link.client.spaceKey(rootRead.value.spaceId);
    const paths = planPaths(root, spaceKey ?? "plans");
    const pages: Array<{ id: string; path: string }> = [];
    const folders: Array<{ id: string; path: string; title: string }> = [];
    const unsupported: Array<{ id: string; path: string; title: string; type: string }> = [];
    // 종류별로 나눈다 — 경로는 planPaths 의 계산을 그대로 쓴다(2026-10-23 최종 구현 계획 F0).
    const collect = (node: PlanNode): void => {
      const path = paths.get(node.id);
      if (path !== undefined) {
        if (node.kind === "page") {
          // 뿌리 자신도 문서다 — 폴더 경로의 마지막 걸음에 제목을 얹어 파일로 만든다.
          const file =
            node.id === root.id ? `${path}/${planName(rootRead.value.title, root.id)}` : path;
          pages.push({ id: node.id, path: file });
        } else if (node.kind === "folder") {
          folders.push({ id: node.id, path, title: node.title });
        } else {
          unsupported.push({ id: node.id, path, title: node.title, type: node.type ?? "unknown" });
        }
      }
      for (const child of node.children) collect(child);
    };
    collect(root);
    return {
      kind: "ok",
      targets: {
        pages,
        folders,
        unsupported,
        reads,
        walked: true,
        complete: walk.complete,
        skipped: 0,
      },
    };
  }

  /**
   * 트리 걷기 — 자식의 자식까지. 폴더 · 화이트보드 등은 본문 없이 종류만 내려간다(2026-10-23 최종
   * 구현 계획 F0). 못 읽힌 갈래는 두 갈래다: 만료(401)면 걷기 전체가 만료다 — 원장을 앞서지 않고
   * 다시 connect 를 기다린다(루프의 401 손과 같은 칸). 그 밖의 실패는 그 문서만 이번 바퀴의 건너뜀이고
   * 걷기는 멈추지 않되, 걷기는 빠짐없이 끝나지 못한 것으로 적힌다(complete: false — 거두지 않고 다음 바퀴가 다시 걷는다).
   */
  private async walkChildren(
    link: ConfluenceLink,
    parentId: string,
    parentType: string,
    reads: Map<string, ConfluencePage>,
  ): Promise<{ nodes: PlanNode[]; unauthorized: boolean; complete: boolean }> {
    const listed = await link.client.listDirectChildren(parentId, parentType);
    if (!listed.readable) {
      return { nodes: [], unauthorized: listed.reason === "unauthorized", complete: false };
    }
    const nodes: PlanNode[] = [];
    let complete = true;
    for (const child of listed.value) {
      // 아직 사는 아이만 걷는다 — archived 는 기록도 걷기도 아니고 그냥 없는 것이다(2026-10-23 최종 구현 계획 F0).
      if (child.status !== null && child.status !== "current") continue;
      if (child.type === "page") {
        const read = await this.readCached(link, child.id, reads);
        if (!read.readable) {
          if (read.reason === "unauthorized") return { nodes: [], unauthorized: true, complete };
          complete = false;
          continue;
        }
        const grand = await this.walkChildren(link, child.id, "page", reads);
        if (grand.unauthorized) return { nodes: [], unauthorized: true, complete };
        if (!grand.complete) complete = false;
        nodes.push({ id: child.id, title: read.value.title, kind: "page", children: grand.nodes });
      } else if (child.type === "folder") {
        // 폴더는 본문이 없다 — 목록의 제목이 곧 이름이다.
        const grand = await this.walkChildren(link, child.id, "folder", reads);
        if (grand.unauthorized) return { nodes: [], unauthorized: true, complete };
        if (!grand.complete) complete = false;
        nodes.push({ id: child.id, title: child.title, kind: "folder", children: grand.nodes });
      } else if (
        child.type === "whiteboard" ||
        child.type === "database" ||
        child.type === "embed"
      ) {
        // 본문을 읽지 않는 종류 — 아래는 읽되 파일은 만들지 않는다.
        const grand = await this.walkChildren(link, child.id, child.type, reads);
        if (grand.unauthorized) return { nodes: [], unauthorized: true, complete };
        if (!grand.complete) complete = false;
        nodes.push({
          id: child.id,
          title: child.title,
          kind: "unsupported",
          type: child.type,
          children: grand.nodes,
        });
      } else {
        // 모르는 종류 — 아래를 읽을 길이 없으니 빠짐없이 걸었다 하지 않는다(2026-10-23 최종 구현 계획 F0).
        nodes.push({
          id: child.id,
          title: child.title,
          kind: "unsupported",
          type: child.type,
          children: [],
        });
        complete = false;
      }
    }
    return { nodes, unauthorized: false, complete };
  }

  /**
   * 증분 — CQL `type=page AND (id = 뿌리 OR ancestor = 뿌리) AND lastModified > 마지막 동기 − 겹침`.
   * 뿌리 아래로 좁히는 절(2026-10-19)은 사이트 어디서 바뀐 문서마다 읽기와 조상 걷기가 돌던 것을 끊는다.
   * 원장이 아는 문서는 그 자리 그대로 다시 읽는다. 처음 보는 문서와 제목이 바뀐 문서는 자리를 트리가
   * 정하므로 이 바퀴를 걷기로 돌린다(폴더 경로는 걷기의 planPaths 한 곳에서만 계산한다).
   */
  private async incrementalTargets(
    link: ConfluenceLink,
    ledger: ConfluenceLedger,
  ): Promise<TargetsOutcome> {
    // 페이지 id 는 숫자다 — 숫자가 아니면 질의에 끼우지 않고 사이트 전체로 묻는다(처음 보는 문서는 걷기로 간다).
    const scope = /^\d+$/.test(link.rootId)
      ? ` AND (id = ${link.rootId} OR ancestor = ${link.rootId})`
      : "";
    const cql = `type=page${scope} AND lastModified > "${cqlTimestamp(ledger.lastSyncAt)}"`;
    const search = await link.client.searchPages(cql, { withVersion: true });
    if (!search.readable) {
      return search.reason === "unauthorized"
        ? { kind: "unauthorized" }
        : { kind: "failed", stage: "search", reason: search.reason };
    }
    const reads = new Map<string, ConfluencePage>();
    const pages: Array<{ id: string; path: string }> = [];
    let skipped = 0;
    for (const hit of search.value) {
      const known = ledger.pages[hit.id];
      if (known === undefined) return { kind: "walk", reads };
      // 겹침으로 다시 걸린 문서 — 검색의 판이 원장과 같으면 본문을 읽지 않는다.
      if (hit.version !== undefined && known.version >= hit.version) {
        skipped += 1;
        continue;
      }
      const read = await this.readCached(link, hit.id, reads);
      if (!read.readable) {
        if (read.reason === "unauthorized") return { kind: "unauthorized" };
        skipped += 1;
        continue;
      }
      // 제목이 바뀌면 그 문서의 파일과 아래 문서들의 폴더가 함께 옮겨 간다 — 이것도 걷기의 몫이다.
      if (read.value.title !== known.title) return { kind: "walk", reads };
      pages.push({ id: hit.id, path: known.path });
    }
    return {
      kind: "ok",
      // 증분 바퀴는 폴더 · 미지원 종류의 원장을 건드리지 않는다(2026-10-23 최종 구현 계획 F0).
      targets: {
        pages,
        folders: [],
        unsupported: [],
        reads,
        walked: false,
        complete: false,
        skipped,
      },
    };
  }

  /** 코멘트의 수 — 안 풀린 것만 센다. 못 읽으면 원장이 알던 수를 지키고, 처음이면 null. */
  private async commentCount(
    link: ConfluenceLink,
    ledger: ConfluenceLedger,
    pageId: string,
  ): Promise<{ unresolved: number } | null> {
    const previous = ledger.pages[pageId]?.comments ?? null;
    const footer = await link.client.listFooterComments(pageId);
    const inline = await link.client.listInlineComments(pageId);
    if (!footer.readable || !inline.readable) return previous;
    const unresolved =
      footer.value.filter((comment) => !comment.resolved).length +
      inline.value.filter((comment) => !comment.resolved).length;
    return { unresolved };
  }
}

/** 한 문서의 두 파일 — 정본(저장 포맷)과 파생 마크다운을 그 자리에 쓴다. */
function writeDoc(repoRoot: string, path: string, storage: string, markdown: string): void {
  const absolute = join(repoRoot, PLANS_DIR, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(`${absolute}.storage.xml`, storage, "utf8");
  writeFileSync(`${absolute}.md`, markdown, "utf8");
}

/**
 * 한 문서의 옛 자리를 거둔다 — 두 파일을 지우고, 비어 버린 폴더는 기획서 폴더까지 거슬러 거둔다
 * (옛 자리의 빈 폴더가 남아 AI 가 읽는 폴더를 어지럽히지 않게). 아이가 남은 폴더는 그대로 둔다.
 */
function removeDoc(repoRoot: string, path: string): void {
  const plansRoot = join(repoRoot, "docs", "plans");
  const base = join(plansRoot, path);
  for (const file of [`${base}.storage.xml`, `${base}.md`]) {
    if (existsSync(file)) unlinkSync(file);
  }
  let dir = dirname(base);
  while (dir.startsWith(`${plansRoot}${sep}`)) {
    try {
      if (readdirSync(dir).length > 0) break;
      rmdirSync(dir);
    } catch {
      break;
    }
    dir = dirname(dir);
  }
}

/**
 * CQL 의 시각 문법 — `yyyy/MM/dd HH:mm`(실측 쪽과 같은 자리). UTC 로 적되 CQL_OVERLAP_MS 만큼 앞당긴다 —
 * 어느 시간대로 읽혀도 마지막 동기 뒤의 변경이 빠지지 않는다. 시각이 없으면 처음부터다.
 */
function cqlTimestamp(iso: string | null): string {
  const at = new Date(iso ?? "");
  if (Number.isNaN(at.getTime())) return "1970/01/01 00:00";
  const from = new Date(at.getTime() - CQL_OVERLAP_MS);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${from.getUTCFullYear()}/${pad(from.getUTCMonth() + 1)}/${pad(from.getUTCDate())} ${pad(from.getUTCHours())}:${pad(from.getUTCMinutes())}`;
}
