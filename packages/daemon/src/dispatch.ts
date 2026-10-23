import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  type ClientMessage,
  type DraftPlanRef,
  type EffortLevel,
  markTurn,
  readTurn,
} from "@colonova-design/protocol";

import { describeProblem } from "./developer-notice.js";
import { realpathBestEffort } from "./paths.js";
import { appendPlanRefs, readPlanRef } from "./plan-refs.js";
import type { ProjectWorkspaces } from "./project-fleet.js";
import type { StartupRecovery } from "./queue-store.js";
import type { RepoWorkspace } from "./repo.js";
import { confluenceHandlers } from "./requests/confluence.js";
import { docCommentHandlers } from "./requests/doc-comments.js";
import { docOpHandlers } from "./requests/doc-ops.js";
import { draftHandlers } from "./requests/drafts.js";
import { projectHandlers } from "./requests/projects.js";
import { repositoryHandlers } from "./requests/repository.js";
import { systemHandlers } from "./requests/system.js";
import type { RequestHandlers, RouterDeps } from "./requests/types.js";
import { ReviveBudget } from "./revive-budget.js";
import type { Session } from "./session.js";
import { screenSessionDirs } from "./session-dirs.js";
import { dropTape, readTape, spliceTape } from "./session-tape.js";
import { threadProvider } from "./thread-provider.js";
import { REVIVE_GRACE_MS } from "./turn-retry.js";
import { repoWritePolicy } from "./workspaces.js";

export type { RouterDeps } from "./requests/types.js";

export class RequestRouter {
  /** The last thread a failing gate briefed, when it had to open one itself. */
  private gateThreadId: string | null = null;
  /**
   * 감독(2026-09-19): 대화별 자동 재개 상한 — 고장난 CLI 가 뜰 때마다 죽는
   * 세계에서 무한 재기를 막는다(PLAN L12). 셈은 ReviveBudget 이 들고,
   * 지우는 길은 둘뿐이다: 성공한 턴의 끝(settled)과 대화의 진짜 닫힘.
   */
  private readonly reviveBudget = new ReviveBudget();
  /** 지금 되살리는 중인 대화 — 되살리기 자신의 교체 close 가 셈을 지우는
   *  일(옛 결함: 매번 0 에서 다시 시작)을 가르는 표식이다. */
  private readonly reviving = new Set<string>();
  private readonly handlers: RequestHandlers;

  constructor(private readonly deps: RouterDeps) {
    this.handlers = {
      ...this.sessionHandlers,
      ...confluenceHandlers(deps),
      ...draftHandlers(deps),
      ...docOpHandlers(deps),
      ...docCommentHandlers(deps),
      ...projectHandlers(deps),
      ...repositoryHandlers(deps, (sessionId, stage) => this.briefTo(sessionId, stage)),
      ...systemHandlers(deps),
    };
  }

  /** The active project's repo — every repo.* case's "the repo". */
  private get repo(): RepoWorkspace {
    return this.deps.fleet.requireActive().repo;
  }

  private requireActive(): ProjectWorkspaces {
    return this.deps.fleet.requireActive();
  }

  private announceProjects(): void {
    this.deps.fleet.announceProjects();
  }

  private refreshThreads(): void {
    this.deps.fleet.refreshThreads();
  }

  private touchThreadsCwd(cwd: string | null | undefined): void {
    this.deps.fleet.touchThreadsCwd(cwd);
  }

  private workspaceCwd(): string {
    return this.deps.fleet.workspaceCwd();
  }

  private projectInstructions(cwd: string): string {
    return this.deps.fleet.projectInstructions(cwd);
  }

  private async resolveSessionCwd(sessionId: string): Promise<string> {
    return this.deps.fleet.resolveSessionCwd(sessionId);
  }

  private workspaceOfSession(sessionId: string): ProjectWorkspaces | null {
    return this.deps.fleet.workspaceOfSession(sessionId);
  }

  /**
   * 세션 cwd(실제 경로)가 어떤 프로젝트의 클론인지 — 그 프로젝트 폴더. 모르면 null.
   * 화면 세션의 함께 여는 폴더(기획서 사본)를 찾는 길(2026-10-23 · 기획서 사본 이동 계획 §6).
   */
  private projectRootOfCwd(cwd: string): string | null {
    for (const project of this.deps.registry.list()) {
      if (realpathBestEffort(this.deps.registry.paths(project.slug).repoRoot) === cwd) {
        return this.deps.registry.paths(project.slug).root;
      }
    }
    return null;
  }

  /**
   * 기획 근거의 기록(2026-10-23 작업 C3) — 글 첨부 가운데 첫 줄에 근거 표식이 선
   * 것을 활성 프로젝트 데이터의 `plans/refs.jsonl` 에 덧붙인다. 남기는 것은 언제 ·
   * 어느 대화 · 어느 문서(제목 · 판 · 절)뿐이다 — 첨부 본문과 사용자의 말은 기록에
   * 들어가지 않는다.
   */
  private recordPlanRefs(
    sessionId: string,
    attachments: Array<{ name: string; mediaType: string; data: string }>,
  ): void {
    // 표식부터 읽는다 — 근거가 없는 보통의 보내기는 프로젝트 자료에 닿지 않는다(2026-10-23 오케스트레이터 검토).
    const refs = attachments
      .filter((file) => file.mediaType.startsWith("text/"))
      .map((file) => readPlanRef(Buffer.from(file.data, "base64").toString("utf8")))
      .filter((ref): ref is DraftPlanRef => ref !== null);
    if (refs.length === 0) return;
    const slug = this.deps.registry.activeSlug();
    if (slug === null) return;
    appendPlanRefs(
      join(this.deps.registry.paths(slug).root, "plans", "refs.jsonl"),
      refs.map((ref) => ({ at: new Date().toISOString(), sessionId, ref })),
    );
  }

  /** 세션 요청은 재개 예산과 복구 수명을 함께 쓴다. */
  private readonly sessionHandlers = {
    "session.list": async (message) => {
      return await this.deps.manager.list(this.workspaceCwd(), message.limit ?? 50);
    },
    // 리뷰 B7: the notification click names a session, the UI needs its
    // project first — resuming in the wrong project would fork the thread.
    "session.locate": (message) => {
      const workspaces = this.workspaceOfSession(message.sessionId);
      const slug = workspaces
        ? ([...this.deps.fleet.workspaces.entries()].find(
            ([, value]) => value === workspaces,
          )?.[0] ?? null)
        : null;
      return { slug };
    },
    "session.history": async (message) => {
      const sessionCwd = await this.resolveSessionCwd(message.sessionId);
      const events0 = await this.deps.manager.history(message.sessionId, sessionCwd);
      // hero-synthesis D1: the daemon's own cycle events (저장 · 넘김 ·
      // 반영 · 코멘트 도착) live on the session tape, not the vendor
      // transcript — splice them in at the turn they followed.
      const tape = this.deps.fleet.workspacesForCwd(sessionCwd);
      const replayed = tape
        ? spliceTape(
            events0,
            readTape(tape.paths.root, this.deps.manager.canonicalId(message.sessionId, sessionCwd)),
          )
        : events0;
      // 대기 줄과 lost room 은 기록이 아니라 지금의 상태 (PLAN D86 의
      // 확장): a window opened — or reloaded — must see both above the
      // field, so they ride at the tail of the replay. The tail is
      // AUTHORITATIVE, empty rooms included — a window that kept rows the
      // daemon no longer holds must lose them here, not keep the ghosts.
      const events = [
        ...replayed,
        { kind: "queued", items: this.deps.manager.get(message.sessionId)?.heldItems() ?? [] },
      ];
      const lost = this.deps.queueStore.lostItems(message.sessionId);
      return lost.length > 0 ? [...events, { kind: "queue.lost", items: lost }] : events;
    },
    "session.create": async (message) => {
      // 재개는 대화를 가리킬 뿐 공급자를 고르지 않는다 — 대화의 AI 는 태어날 때
      // 정해진다. 주인(살아 있는 세션 → 대화록 저장소)이 드라이버를 정하고, 요청이
      // 다른 공급자를 실어 와도 조용히 무시한다(thread-provider.ts).
      const live = message.resume ? this.deps.manager.get(message.resume)?.provider : undefined;
      const storedProvider =
        message.resume && live === undefined
          ? await this.deps.manager.findStoredProvider(message.resume, this.workspaceCwd())
          : undefined;
      const { provider, ignored } = threadProvider({
        resume: message.resume,
        requested: message.provider,
        live,
        stored: storedProvider,
      });
      if (ignored !== undefined) {
        this.deps.logger.warn("재개 요청의 공급자를 무시한다 — 대화는 태어난 AI 로 이어진다", {
          sessionId: message.resume,
          requested: ignored,
          provider,
        });
      }
      const driver = this.deps.agentDrivers.get(provider);
      if (!driver) {
        // 앱에서 뺀 에이전트(2026-10-20 의 codex)로 만든 대화 — 대화록은 그 에이전트의 저장소에만
        // 있어 다른 드라이버로는 이어 갈 수 없다(없는 대화록을 재개하다 멈춘다). 새 대화로 안내한다.
        throw new Error(
          message.resume
            ? "이 대화를 만든 AI 는 이제 이 앱에서 쓰지 않아 이어 갈 수 없어요 — 새 대화에서 다시 말해 주세요."
            : `알 수 없는 에이전트입니다: ${provider}`,
        );
      }
      const availability = await driver.isAvailable();
      if (!availability.ok || !availability.executable) {
        throw new Error(
          provider === "claude"
            ? "Claude Code CLI 를 찾지 못했습니다 — 설치를 마친 뒤 다시 시도해 주세요."
            : `${driver.describe().label} CLI 를 찾지 못했습니다 — 설치를 마친 뒤 다시 시도해 주세요.`,
        );
      }
      if (!existsSync(this.repo.root)) {
        throw new Error("연결 레포가 아직 준비되지 않았습니다 — 잠시 후 다시 시도해 주세요.");
      }
      // A resume onto a thread whose live query already died (the crash
      // card's own state, or a force-aborted stop): tear the dead object
      // down FIRST, under its own id — after the replacement lands, its
      // late `closed` broadcast would take the fresh session's preview
      // driver with it. A healthy live thread is left exactly as it was.
      const dead = message.resume ? this.deps.manager.get(message.resume) : undefined;
      if (dead && (dead.state === "error" || dead.state === "closed")) {
        // 교체 close 도 "shutdown" — lost 방은 복구 패널의 몫이라 지우지 않는다.
        await this.deps.manager.close(dead.id, "shutdown");
      }
      const sessionCwd = this.workspaceCwd();
      const instructions = this.projectInstructions(sessionCwd);
      // 초대 v4(PLAN 단계 5): 칩이 말하지 않은 값은 프로젝트의 기본값이
      // 채운다 — defaults.provider 가 있으면 그 공급자에게만 적용된다.
      // 이어 든 스레드(resume)는 태어날 때의 모델을 이미 갖고 있어 기본값이
      // 끼어들지 않는다.
      const defaults = message.resume ? undefined : this.deps.registry.active()?.defaults;
      const defaultsFit =
        defaults !== undefined && (!defaults.provider || defaults.provider === provider);
      const model = message.model ?? (defaultsFit ? defaults.model : undefined);
      const effort = message.effort ?? (defaultsFit ? defaults.effort : undefined);
      const fastMode = message.fastMode === true;
      const additionalDirectories = screenSessionDirs(this.projectRootOfCwd(sessionCwd));
      const session = this.deps.manager.create({
        cwd: sessionCwd,
        provider,
        queueDiskFor: this.deps.queueDiskFor,
        writePolicy: repoWritePolicy(sessionCwd),
        ...(message.title ? { title: message.title } : {}),
        launch: {
          executable: availability.executable,
          ...(instructions ? { appendSystemPrompt: instructions } : {}),
          ...(message.resume ? { resume: message.resume } : {}),
          ...(model ? { model } : {}),
          ...(effort ? { effort } : {}),
          ...(fastMode ? { fastMode: true } : {}),
          ...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
        },
      });
      // 태어날 때의 빠르게 — 새 대화 자리에서 미리 켠 ⚡ 선택. 첫 selectors
      // 읽기가 이미 켠 상태를 보도록 여기서 기다린다. 받지 못하는 에이전트의
      // 거절은 조용히 흘린다 — 칩이 이미 그 모델의 줄로 걸러 서 있었다.
      if (fastMode) await session.setFastMode(true).catch(() => undefined);
      // The plan reading is owed per provider, and a fresh session is
      // already idle — ask it now rather than waiting for a status
      // broadcast nothing schedules. A thread's first composer render is
      // exactly when its account's numbers matter.
      this.deps.plans.refresh(provider);
      // A session start is the moment the 화면 half goes back to the remote.
      // 감독자의 틱이 원격을 읽고 착지를 치르고(PLAN L2 흡수표 — 베이스 합치기는
      // 받아오기를 누를 때만, 2026-10-20), 충돌은 원장에
      // 적혀 브리프 턴이 된다 — 새 세션이 열린 뒤에 부르는 이유는 그 브리프가
      // 이 대화를 찾을 수 있게 하기 위해서다.
      void this.workspaceOfSession(session.id)?.supervisor.tick("session-start");
      // The tree gains a child row (PLAN D59).
      this.deps.manager.invalidateThreads(session.cwd);
      this.refreshThreads();
      return { sessionId: session.id, state: session.state };
    },
    "session.send": async (message) => {
      // A live session of another project writes into another clone.
      // list() filters them out, but a client that kept an old id (a stale
      // tab) could still reach it — refuse instead of writing across.
      const target = this.deps.manager.require(message.sessionId);
      if (target.cwd !== this.workspaceCwd()) {
        throw new Error("다른 프로젝트의 대화입니다 — 프로젝트를 전환한 뒤 보내 주세요.");
      }
      // 사람이 다시 말을 걸었다 — 화면 확인 게이트의 한 번 제한이 풀린다.
      // 게이트는 사람의 턴마다 한 번이지, 대화마다 한 번이 아니다.
      this.deps.previewDrivers.gatedSessions.delete(message.sessionId);
      // 사람이 가리킨 화면은 이 말과 함께 간다: 핀을 받는 시점에 기록하지
      // 않는 이유는 대기 줄 때문이다. 도는 턴에 온 말은 held 로 기다리는데,
      // 그 핀을 미리 적으면 턴이 바뀔 때 지워져 그 말을 실은 턴의 게이트
      // 입력이 영영 사라진다. 핀은 deliver 시점(session 쪽)에 적힌다.
      // 죽은 질의에 말을 흘리지 않는다: 크래시 카드가 약속한대로, 같은 id 의
      // 재개(resume)가 새 CLI 에서 대화를 이어받아 지금의 말을 전달한다.
      // Refusals answer through the dispatch-wide Korean boundary above.
      const carrier = target.sendable ? target : await this.resurrectSession(target);
      // 2026-10-20 응답 지연 개선: 준비 중인 프로젝트만 대기 줄에 둔다.
      // 원격 읽기는 감독자의 관찰 주기에서(합치기는 받아오기 단추), 핀의 코드 탐색은 AI가 맡는다.
      this.deps.fleet.holdIfPreparing(carrier.id);
      // 기획 근거의 기록(2026-10-23 작업 C3) — 표식이 선 첨부는 이 요청의 근거로
      // 남긴다. 제출 때 PR 본문의 `### 기획 근거` 절이 이 기록을 읽는다. 실패는
      // 보내기를 막지 않고 종류만 로그에 남긴다.
      try {
        this.recordPlanRefs(message.sessionId, message.attachments ?? []);
      } catch {
        this.deps.logger.warn("기획 근거 기록 실패");
      }
      carrier.send(
        message.text,
        message.attachments,
        message.pins,
        message.mode,
        message.viewing,
        message.sentAt,
      );
      return { ok: true };
    },
    "session.interrupt": async (message) => {
      await this.deps.manager.require(message.sessionId).interrupt();
      return { ok: true };
    },
    // 대기 줄 다루기 (PLAN D86): both act on a live room, and `sendNow`
    // writes into the clone — the same cross-project fence as session.send.
    "session.queue.remove": (message) => {
      const target = this.deps.manager.require(message.sessionId);
      if (target.cwd !== this.workspaceCwd()) {
        throw new Error("다른 프로젝트의 대화입니다 — 프로젝트를 전환한 뒤 시도해 주세요.");
      }
      return target.removeHeld(message.itemId);
    },
    "session.queue.sendNow": async (message) => {
      const target = this.deps.manager.require(message.sessionId);
      if (target.cwd !== this.workspaceCwd()) {
        throw new Error("다른 프로젝트의 대화입니다 — 프로젝트를 전환한 뒤 시도해 주세요.");
      }
      await target.sendHeldNow(message.itemId);
      return { ok: true };
    },
    // lost room 다루기 (PLAN D86 의 확장): these touch only the daemon's
    // own store — no clone is written — so they need no project fence, and
    // they work for a thread nobody has reopened since the restart.
    "session.queue.takeDropped": (message) => {
      return this.deps.queueStore.takeLost(message.sessionId, message.itemId);
    },
    "session.queue.dismissDropped": (message) => {
      this.deps.queueStore.dismissLost(message.sessionId, message.itemId);
      // The store changed under every window: re-announce the state.
      this.deps.broadcast({
        type: "session.event",
        sessionId: message.sessionId,
        event: { kind: "queue.lost", items: this.deps.queueStore.lostItems(message.sessionId) },
      });
      return { ok: true };
    },
    "session.close": async (message) => {
      const cwd = this.deps.manager.get(message.sessionId)?.cwd;
      await this.deps.manager.close(message.sessionId);
      this.touchThreadsCwd(cwd);
      return { ok: true };
    },
    "session.delete": async (message) => {
      const cwd = await this.resolveSessionCwd(message.sessionId);
      const canonicalId = this.deps.manager.canonicalId(message.sessionId, cwd);
      await this.deps.manager.remove(message.sessionId, cwd);
      // The thread is gone; its wait room, lost room and tape rows go with
      // it — 사람 메시지도 세션 소속이다 (hero-synthesis D1).
      this.deps.queueStore.clear(canonicalId);
      const tape = this.deps.fleet.workspacesForCwd(cwd);
      if (tape) dropTape(tape.paths.root, canonicalId);
      this.touchThreadsCwd(cwd);
      return { ok: true };
    },
    "session.deleteAll": async (message) => {
      // The tree's 대화 모두 지우기: unlike session.delete this names its
      // project, so a non-active clone's transcripts die too (D77's store
      // is keyed by the clone's realpath).
      const paths = this.deps.registry.paths(message.slug);
      const repoRoot = realpathBestEffort(paths.repoRoot);
      // The erase takes seconds (live sessions close under a grace, the
      // store sweep retries) and the planner's tree empties the moment
      // they press the button — so the reply carries the ACCEPTANCE, not
      // the completion. `beginRemoveWhere` invalidates every cache and
      // marks the clone synchronously: reads from any window — a reload
      // mid-erase included — answer empty from the first message after
      // this one, and the background pass below lands the sweep.
      this.deps.manager.beginRemoveWhere(repoRoot);
      // The wait rooms, lost rooms and tape rows go with the threads —
      // collect the ids first; removeWhere closes live sessions and
      // sweeps every driver's store in one pass. The id set must cover
      // what the sweep deletes: manager.list 의 상한(그리고 그 캐시)을
      // 믿으면 상한 너머의 대화는 지워지면서 방과 테이프만 남는다 — 저장소마다
      // 사실상 전부(사이드바 상한의 2000배)를 읽어 모으고, 아직 대화록을
      // 쓰지 않은 라이브 세션은 따로 더한다.
      const ids = new Set<string>();
      for (const session of this.deps.manager.all()) {
        if (session.cwd === repoRoot) ids.add(session.id);
      }
      for (const driver of this.deps.agentDrivers.all()) {
        const stored = await driver.store?.list(repoRoot, 100_000).catch(() => []);
        for (const info of stored ?? []) ids.add(info.id);
      }
      for (const sessionId of ids) {
        this.deps.queueStore.clear(sessionId);
        dropTape(paths.root, sessionId);
      }
      void this.deps.manager
        .removeWhere(repoRoot)
        .catch(() => undefined)
        .then(() => {
          this.touchThreadsCwd(repoRoot);
          this.announceProjects();
        });
      return { ok: true };
    },
    "session.contextUsage": async (message) => {
      const usage = await this.deps.manager.require(message.sessionId).contextUsage();
      this.deps.plans.rememberPlanUsage(usage?.plan ?? null);
      return usage;
    },
    "plan.refresh": (message) => {
      // 사용량 칸이 열렸다 — 그 계정의 한도를 지금 다시 읽는다. 쉬는 대화가
      // 없으면 드라이버의 probe 가 읽고, 읽기 간격의 하한은 추적기가 지킨다.
      // 답은 status 방송으로 돌아온다.
      this.deps.plans.refresh(message.provider);
      return { ok: true };
    },
    "session.setModel": async (message) => {
      await this.deps.manager.require(message.sessionId).setModel(message.model);
      this.deps.manager.rememberIdentity(message.sessionId);
      return { ok: true };
    },
    "session.setEffort": async (message) => {
      await this.deps.manager.require(message.sessionId).setEffort(message.effort);
      this.deps.manager.rememberIdentity(message.sessionId);
      return { ok: true };
    },
    "session.setFastMode": async (message) => {
      await this.deps.manager.require(message.sessionId).setFastMode(message.fast);
      return { ok: true };
    },
    "session.selectors": async (message) => {
      const selectors = await this.deps.manager.selectors(
        message.sessionId,
        await this.resolveSessionCwd(message.sessionId),
      );
      if (selectors.provider && selectors.models.length)
        this.deps.plans.rememberModels(selectors.provider, selectors.models);
      return selectors;
    },
    "session.commands": async (message) => {
      return await this.deps.manager.require(message.sessionId).commands();
    },
    "session.stopTask": async (message) => {
      await this.deps.manager.require(message.sessionId).stopTask(message.taskId);
      return { ok: true };
    },
    "session.backgroundTask": async (message) => {
      const moved = await this.deps.manager
        .require(message.sessionId)
        .backgroundTask(message.toolUseId);
      return { moved };
    },
    "cli.commands": async () => {
      return await this.deps.fleet.cliCommands();
    },
    "permission.respond": async (message) => {
      const session = this.deps.manager.findByRequest(message.requestId);
      if (!session)
        throw new Error("이미 끝난 권한 요청입니다 — 방금 뜬 카드에서 다시 답해 주세요.");
      await session.respondPermission(
        message.requestId,
        message.decision,
        message.message,
        message.updatedInput,
      );
      return { ok: true };
    },
    "question.respond": (message) => {
      const session = this.deps.manager.findByRequest(message.requestId);
      if (!session) throw new Error("이미 끝난 질문입니다 — 방금 뜬 카드에서 다시 답해 주세요.");
      session.respondQuestion(
        message.requestId,
        message.answers,
        message.response,
        message.annotations,
      );
      return { ok: true };
    },

    // 답하기 (PLAN D88): the planner's words to one developer comment —
    // the daemon picks the endpoint by the id's kind.
    "session.branch": async (message) => {
      const target = this.deps.manager.require(message.sessionId);
      if (target.cwd !== this.workspaceCwd()) {
        throw new Error("다른 프로젝트의 대화입니다 — 프로젝트를 전환한 뒤 시도해 주세요.");
      }
      // 도는 턴의 대화록은 아직 정산되지 않았다 — 그 위에서 자르면 k 셈과
      // 저장 대화록이 어긋난다. 되감기의 실행 중 거절과 같은 정직함이다.
      if (target.state === "running" || target.state === "starting") {
        throw new Error("돌고 있는 턴이 있습니다 — 턴이 끝난 뒤 분기할 수 있습니다.");
      }
      const targetDriver = this.deps.agentDrivers.get(target.provider);
      const targetExecutable = targetDriver
        ? ((await targetDriver.isAvailable().catch(() => null))?.executable ?? null)
        : null;
      // 새 대화 · 재개와 같이 분기도 사본 폴더를 함께 연다 — 폴더가 있을 때만
      // (2026-10-23 · 기획서 사본 이동 계획 §6 · 검토 R1).
      const additionalDirectories = screenSessionDirs(this.projectRootOfCwd(target.cwd));
      const result = await this.deps.manager.branch({
        sessionId: message.sessionId,
        cwd: this.workspaceCwd(),
        turn: message.turn,
        base: {
          cwd: this.workspaceCwd(),
          provider: target.provider,
          queueDiskFor: this.deps.queueDiskFor,
          writePolicy: repoWritePolicy(this.workspaceCwd()),
          launch: {
            ...(targetExecutable ? { executable: targetExecutable } : {}),
            ...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
          },
        },
      });
      this.deps.manager.invalidateThreads(target.cwd);
      this.refreshThreads();
      return result;
    },
  } satisfies Partial<RequestHandlers>;

  async dispatch(message: ClientMessage): Promise<unknown> {
    const handler = this.handlers[message.type];
    if (!handler) return undefined;
    return (handler as (message: ClientMessage) => unknown)(message);
  }

  /**
   * The thread a send must land in when its own query died (crash · a
   * force-aborted stop · a CLI that ended on its own): same id, fresh CLI,
   * the stored transcript resumed — the planner's words ride the
   * conversation they belong to, which is the promise the crash card made
   * ("다시내면 이어집니다"). The dead object is torn down FIRST, under
   * its own id, so its late `closed` broadcast cannot shadow the
   * replacement.
   */
  private async resurrectSession(dead: Session): Promise<Session> {
    // 되감기·재개를 위 교체 close 는 "shutdown" 으로 — "user" 는 disk.clear() 를
    // 달고 있어 크래시 복구의 lost 방까지 통째로 지웠다(실측).
    await this.deps.manager.close(dead.id, "shutdown");
    return this.resurrectThreadId({
      id: dead.id,
      cwd: dead.cwd,
      provider: dead.provider,
      chosen: dead.chosen,
      title: dead.title,
    });
  }

  /**
   * 같은 id 의 재개 — 죽은 세션의 교체(crash) 와 시작 복구(브리프) 가 같이 타는
   * 길. 살아 있는 세션이 이미 그 id 를 쥐고 있으면 manager.create 가 그것을
   * 돌려주므로 안전하다.
   */
  private async resurrectThreadId(spec: {
    id: string;
    cwd: string;
    provider: string;
    chosen: { model: string | null; effort: EffortLevel | null };
    title: string;
  }): Promise<Session> {
    const driver = this.deps.agentDrivers.get(spec.provider);
    const availability = driver ? await driver.isAvailable().catch(() => null) : null;
    const executable = availability?.executable;
    if (!executable) {
      // 죽은 세션을 돌려주면 호출자의 send 가 "크래시" 에러로 오진된다 —
      // 진짜 이유는 CLI 가 없는 것. isAvailable 의 한국어 사유를 그대로 넘긴다.
      throw new Error(
        availability?.reason ?? `${spec.provider} 를 찾지 못했습니다 — 설치한 뒤 다시 보내 주세요.`,
      );
    }
    const instructions = this.projectInstructions(spec.cwd);
    const additionalDirectories = screenSessionDirs(this.projectRootOfCwd(spec.cwd));
    const session = this.deps.manager.create({
      cwd: spec.cwd,
      provider: spec.provider,
      queueDiskFor: this.deps.queueDiskFor,
      writePolicy: repoWritePolicy(spec.cwd),
      title: spec.title,
      launch: {
        ...(instructions ? { appendSystemPrompt: instructions } : {}),
        executable,
        resume: spec.id,
        ...(spec.chosen.model ? { model: spec.chosen.model } : {}),
        ...(spec.chosen.effort ? { effort: spec.chosen.effort } : {}),
        ...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
      },
    });
    // The tree's child row points at the same id; a rescan picks the new life up.
    this.deps.manager.invalidateThreads(session.cwd);
    this.refreshThreads();
    return session;
  }

  /**
   * 죽은 질의를 스스로 되살린다 — 세션의 onRevive 가 부르는 문(커밋
   * 2026-09-19 "무조건 처리"). 사람의 재입력을 기다리는 대신, 같은 id 의
   * 재개(resurrectSession)로 새 CLI 를 띄워 마지막 말을 다시 내려놓는다.
   *
   * 유예를 먼저 센다: 세션은 아직 제 스레드를 정리하는 중이고, 죽는 CLI 의
   * 마지막 방송과 경합하면 안 된다. 그 사이 사람이 먼저 다시 보냈거나 대화를
   * 다시 열었다면 물러난다(상태가 error 가 아니다). 살릴 말이 없어도 물러난다
   * — 턴이 돌지 않던 죽음(idle crash)의 다음 보내기가 이 길로 되살아난다.
   *
   * 세션은 이제 크래시 알림을 내지 않는다 (PLAN L12): 되살리기의 결과만 한 줄로
   * 말한다. 살리지 못하면(예산 초과 · CLI 없음) 개발자 알림(revive:exhausted)과
   * 함께 그 사실을 알린다 — 사용자가 오류 문장을 읽는 세계가 아니다 (I2).
   */
  async revive(sessionId: string): Promise<void> {
    const grace = Promise.withResolvers<void>();
    setTimeout(grace.resolve, REVIVE_GRACE_MS);
    await grace.promise;
    const dead = this.deps.manager.get(sessionId);
    if (dead?.state !== "error") return;
    const item = dead.revivePayload;
    if (!item) return;
    if (!this.reviveBudget.allow(sessionId, Date.now())) {
      await this.announceReviveExhausted(sessionId, "되살리기 상한(10분 안에 3회)에 닿았습니다");
      return;
    }
    // 되살리기 자신이 교체를 위해 닫는 close 는 예산을 지우지 못하게 한다
    // (PLAN L12): 그 사이에 manager.close 의 onState("closed") 가 서버의
    // forgetReviveBudget 을 되부르는데, 표식이 없으면 셈이 매번 0 이 된다.
    this.reviving.add(sessionId);
    try {
      const session = await this.resurrectSession(dead);
      this.deps.logger.warn("크래시 자동 재개", { sessionId });
      this.deps.broadcast({
        type: "session.event",
        sessionId,
        event: {
          kind: "notice",
          level: "info",
          text: "AI 프로그램을 다시 켰어요 — 하던 일을 이어서 합니다",
        },
      });
      session.send(item.text, item.attachments, item.pins);
      this.requeueFreshLost(session);
    } catch {
      // CLI 가 없다든가 — 알림 한 줄과 개발자 알림이 전부다 (PLAN L12).
      await this.announceReviveExhausted(sessionId, "새 AI 프로그램을 띄우지 못했습니다");
    } finally {
      this.reviving.delete(sessionId);
    }
  }

  /**
   * 되살리지 못했다 — 한 줄로 말하고 개발자에게 알린다 (예산 초과 · CLI 없음).
   * 이 문 자체가 또 던지면 방사된 약속이 남으므로, 무엇이든 삼킨다.
   */
  private async announceReviveExhausted(sessionId: string, what: string): Promise<void> {
    try {
      this.deps.logger.warn("크래시 되살리기 실패", { sessionId, what });
      this.deps.broadcast({
        type: "session.event",
        sessionId,
        event: {
          kind: "notice",
          level: "warn",
          text: "AI 프로그램이 멈췄어요 — 개발자에게 알렸어요",
        },
      });
      await this.raiseProjectNotice(sessionId, "revive:exhausted", what);
    } catch (error) {
      this.deps.logger.warn("되살리기 실패 알림을 마치지 못했다", { sessionId, err: error });
    }
  }

  private requeueFreshLost(session: Session): void {
    const items = this.deps.queueStore.takeFreshLost(session.id);
    if (items.length === 0) return;
    session.restoreHeld(items);
    this.deps.broadcast({
      type: "session.event",
      sessionId: session.id,
      event: { kind: "queue.lost", items: this.deps.queueStore.lostItems(session.id) },
    });
  }

  /**
   * 사다리를 다 쓴 실패 (PLAN L12) — 그 프로젝트의 개발자 알림(turn:failed).
   * 세션 → 프로젝트는 세션의 cwd 가 사는 작업공간(fleet)으로 찾는다.
   */
  async noteTurnFailed(sessionId: string, resultText: string | null): Promise<void> {
    await this.raiseProjectNotice(sessionId, "turn:failed", resultText ?? undefined);
  }

  /**
   * 그 프로젝트에서 턴이 답을 냈다 — 서 있는 턴 자기치유 알림(turn:failed ·
   * revive:exhausted)을 거둔다. 같은 프로젝트의 다른 대화가 낸 답도 푼다:
   * 알림은 프로젝트의 것이지 대화의 것이 아니다.
   */
  async settleProjectTurns(sessionId: string): Promise<void> {
    const slug = this.deps.fleet.workspaceOfSession(sessionId)?.slug ?? null;
    if (slug === null) return;
    await this.deps.developerNotice.resolve("turn:failed", slug);
    await this.deps.developerNotice.resolve("revive:exhausted", slug);
  }

  /** 프로젝트 알림 공통 문 — 세션의 프로젝트를 찾아 올린다. */
  private async raiseProjectNotice(sessionId: string, key: string, detail?: string): Promise<void> {
    const slug = this.deps.fleet.workspaceOfSession(sessionId)?.slug ?? null;
    await this.deps.developerNotice.raise({
      key,
      slug,
      ...describeProblem(key, detail),
    });
  }

  /** 감독: 턴이 답을 냈다 — 되살리기 예산은 성공한 턴의 끝에서만 지운다. */
  settleReviveBudget(sessionId: string): void {
    this.reviveBudget.settled(sessionId);
  }

  /**
   * 감독: 대화가 닫혔다 — 재개 상한을 돌려놓는다. 되살리기 자신이 세션을
   * 교체하며 닫는 close 는 제외다(PLAN L12): 그 close 까지 지우면 망가진 CLI
   * 가 상한 없이 되살아난다 — 표식(reviving)이 그 가른다.
   */
  forgetReviveBudget(sessionId: string): void {
    if (this.reviving.has(sessionId)) return;
    this.reviveBudget.forget(sessionId);
  }

  /**
   * 시작 브리프 (PLAN L12) — 앱이 꺼질 때 돌던 턴을 이어받는다. 2시간 안의
   * inflight 는 그 대화를 같은 id 로 되살려(resume) 브리프 턴 한 번을 연다:
   * "직전 요청이 중단됐습니다 … 지금 파일 상태를 보고 마무리해 주세요."
   * 같은 말을 그대로 다시 보내지 않는다 — 반쯤 적용된 작업이 겹친다. 살려 둔
   * 대기 말(30분 안)은 브리프 뒤 대기 줄로 돌려놓는다. 되살리지 못하면 그 말을
   * lost 로 되돌려 회복의 길을 지킨다. 이미 살아 있는 대화(사람이 먼저 열었다)는
   * 건드리지 않는다.
   */
  async recoverStartupTurns(recoveries: StartupRecovery[]): Promise<void> {
    for (const recovery of recoveries) {
      const marker = readTurn(recovery.inflight.text).marker;
      if (marker?.kind === "review" || marker?.kind === "ci") {
        this.deps.queueStore.moveHeldToLost(recovery.sessionId, recovery.held);
        continue;
      }
      if (this.deps.manager.get(recovery.sessionId)) continue;
      try {
        const located = await this.locateStoredThread(recovery.sessionId);
        if (!located) {
          this.deps.queueStore.moveHeldToLost(recovery.sessionId, [recovery.inflight]);
          continue;
        }
        const session = await this.resurrectThreadId({
          id: recovery.sessionId,
          cwd: located.cwd,
          provider: located.provider,
          chosen: { model: null, effort: null },
          title: "중단된 요청 마무리",
        });
        this.deps.logger.warn("시작 브리프 — 중단된 턴을 이어받는다", {
          sessionId: recovery.sessionId,
        });
        session.restoreHeld(recovery.held);
        const firstLine = readTurn(recovery.inflight.text).body.split("\n")[0]?.trim() ?? "";
        session.send(
          markTurn(
            { kind: "brief", title: "중단된 요청 마무리" },
            `직전 요청이 중단됐습니다: ${firstLine.slice(0, 80)}. 지금 파일 상태를 보고 마무리해 주세요.`,
          ),
        );
      } catch (error) {
        // 되살리지 못한 말은 lost 로 — 다음 시작도, 화면도 잃지 않게.
        this.deps.logger.warn("시작 브리프 실패", { sessionId: recovery.sessionId, err: error });
        this.deps.queueStore.moveHeldToLost(recovery.sessionId, [recovery.inflight]);
      }
    }
  }

  /**
   * 저장된 대화가 어느 클론 · 어느 공급자의 것인지 — 활성 프로젝트가 먼저, 그
   * 다음 레지스트리의 모든 클론을 찾는다. 시작 복구는 살아 있는 세션이 없으므로
   * 저장소(transcript store)에게 물어야 한다.
   */
  private async locateStoredThread(
    sessionId: string,
  ): Promise<{ cwd: string; provider: string } | null> {
    const roots = new Set<string>();
    const active = this.deps.fleet.workspaces.get(this.deps.registry.activeSlug() ?? "");
    if (active) roots.add(realpathBestEffort(active.paths.repoRoot));
    for (const project of this.deps.registry.list()) {
      roots.add(realpathBestEffort(this.deps.registry.paths(project.slug).repoRoot));
    }
    for (const cwd of roots) {
      const provider = await this.deps.manager.findStoredProvider(sessionId, cwd);
      if (provider !== undefined) return { cwd, provider };
    }
    return null;
  }

  /**
   * Routes a failing gate's output to a live session as a user turn — the same
   * path a typed message takes, so the agent sees the planner asking for a fix.
   * The failure itself is news the planner clicked for — the step never
   * reached the developer and the agent is now on the fix — so it also fires a
   * notice before the turn starts.
   *
   * 게이트 실패는 AI 의 과제다(README) — 열린 대화가 없어도 과제는 태어나야
   * 한다: 저장·넘기기는 도구가 대화를 열고 브리프를 내려놓는다(준비 턴
   * runConventionsPrepare 와 같은 길). 최신화 충돌만 예외다 — 대화가 없을 때의 그
   * 상태는 오류 카드가 자기 버튼(AI 에게 해결 요청)으로 대화를 고르는 자리다.
   */
  private briefTo(sessionId: string | undefined, stage: "save" | "handoff" | "refresh") {
    if (!sessionId && stage === "refresh") return { onSessionTurn: undefined };
    return {
      onSessionTurn: (brief: string) => {
        // 문 여는 일은 기다리지 않고 뒤에서 이어된다 — 공급자 고르기가 CLI 를
        // 띄우느라 비동기라서(auto-thread.ts) 게이트의 실패 상태가 그림을 늦추면
        // 안 된다.
        void this.briefGateThread(sessionId, stage, brief);
      },
    };
  }

  /** 게이트 실패의 브리프를 내려놓는 몸통 — briefTo 의 콜백이 뒤에서 부른다. */
  private async briefGateThread(
    sessionId: string | undefined,
    stage: "save" | "handoff" | "refresh",
    brief: string,
  ): Promise<void> {
    // A named thread whose query already died cannot take the brief — and
    // since the crash guard it would refuse the send. The gate thread is
    // the fallback either way: no open thread, or a dead one.
    const named = sessionId ? this.deps.manager.get(sessionId) : undefined;
    const session =
      named && named.state !== "error" && named.state !== "closed"
        ? named
        : await this.gateThreadFor(stage);
    if (!session) return;
    this.deps.logger.warn("게이트 실패", { sessionId: session.id, stage });
    this.deps.notice({
      kind: "gate",
      sessionId: session.id,
      title: session.title,
      stage,
    });
    try {
      session.send(brief);
    } catch {
      // Lost the race with the query's death — the failed DiffStatus
      // still tells the planner why the step stopped.
    }
  }

  /**
   * The thread a failing gate briefs when none is (or none living one is)
   * open. One per run: a planner who presses 저장 twice with no thread open
   * must not grow a garden of failure threads. Reused while it lives in this
   * clone and its query is healthy; a dead one is replaced on the next brief.
   */
  private async gateThreadFor(stage: "save" | "handoff" | "refresh") {
    const cwd = this.workspaceCwd();
    const remembered = this.gateThreadId ? this.deps.manager.get(this.gateThreadId) : undefined;
    if (
      remembered &&
      remembered.cwd === cwd &&
      remembered.state !== "error" &&
      remembered.state !== "closed"
    ) {
      return remembered;
    }
    // 새 대화는 쓸 수 있는 공급자로 연다 — fleet 의 자동 대화 길(auto-thread.ts,
    // autoFixThreadFor 와 같은 모양). 공급자 고르기는 한 곳(auto-thread.ts)에만
    // 산다(PLAN I1 · I4).
    const session = await this.deps.fleet.autoFixThreadFor(
      this.requireActive(),
      stage === "save"
        ? "보관 문제 해결"
        : stage === "handoff"
          ? "제출 문제 해결"
          : "최신화 문제 해결",
    );
    if (!session) return null;
    this.gateThreadId = session.id;
    return session;
  }
}
