import { existsSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_HANDOFF_BODY } from "@colonova-design/protocol";
import { recordComments } from "../comments.js";
import { browseFiles, listFiles } from "../environment.js";
import { readComparison } from "../screen-comparisons.js";
import { undoLog } from "../undo-log.js";
import type { RequestHandlers, RouterDeps } from "./types.js";

type RepositoryDeps = Pick<
  RouterDeps,
  "fleet" | "registry" | "manager" | "handoffPreviews" | "previewDrivers" | "comparisonReady"
>;
type RepositoryRequest = Extract<
  keyof RequestHandlers,
  `repo.${string}` | `comments.${string}` | "diff.get" | "preview.screenCheck"
>;
type BriefTo = (
  sessionId: string | undefined,
  stage: "save" | "handoff" | "refresh",
) => { onSessionTurn: ((brief: string) => void) | undefined };

/** 제출 의도는 원장에 남기고, 응답은 감독자의 틱을 최대 60초 기다린다. */
const SUBMIT_WAIT_MS = 60_000;

/** 연결 레포의 읽기 · 보관 · 제출을 맡는다. */
export function repositoryHandlers(
  deps: RepositoryDeps,
  briefTo: BriefTo,
): RequestHandlers<RepositoryRequest> {
  /** 활성 클론에서 도는 턴 위에는 복원이나 확인된 제출을 실행하지 않는다. */
  function refuseWhileTurnRuns(): void {
    if (!deps.manager.anyRunning(deps.fleet.workspaceCwd())) return;
    throw new Error(
      "돌고 있는 턴이 있습니다 — 중지한 뒤에 되돌릴 수 있습니다. 먼저 중지해 주세요.",
    );
  }

  return {
    "repo.files": async (message) => {
      // @-mention autocomplete draws from the repo clone only.
      const root = deps.fleet.requireActive().repo.root;
      const files = existsSync(root) ? await listFiles(root) : [];
      return browseFiles(files, message.query ?? "", message.limit ?? 40);
    },
    "repo.status": async () => {
      return await deps.fleet.requireActive().repo.status();
    },
    "repo.sync": async (message) => {
      return await deps.fleet.requireActive().repo.sync(message.force === true);
    },
    "diff.get": async () => {
      return await deps.fleet.requireActive().repo.diff();
    },
    "repo.save": async (message) => {
      return await deps.fleet.requireActive().repo.save({
        ...(message.message ? { message: message.message } : {}),
        // hero-synthesis D1: the calling conversation owns the saved card.
        ...(message.sessionId ? { sessionId: message.sessionId } : {}),
        ...briefTo(message.sessionId, "save"),
      });
    },
    "repo.handoff": async (message) => {
      const active = deps.fleet.requireActive();
      const commentsFile = join(active.paths.root, "comments.json");
      return await active.repo.handoff({
        title: message.title ?? deps.registry.get(active.slug)?.name ?? undefined,
        body: message.body ?? DEFAULT_HANDOFF_BODY,
        // D93: the comment store — the PR body's `### 수정 요청` section is
        // the daemon's to build.
        commentsFile,
        ...(message.sessionId ? { sessionId: message.sessionId } : {}),
        ...briefTo(message.sessionId, "handoff"),
      });
    },
    "repo.submit": async (message) => {
      // 제출은 의도를 적는 것으로 끝난다 (PLAN L6) — 나머지는 감독자의 네
      // 단계가 멱등하게 끝낸다. 여기서는 그 틱의 끝을 최대 60초 기다렸다 지금
      // DiffStatus 를 돌려준다: 넘으면 "진행 중"(handing-off) — 의도는 원장에
      // 남아 다음 틱이 이어받는다.
      const active = deps.fleet.requireActive();
      // 확인 창의 한마디(PLAN-UI U3)는 의도와 함께 원장에 적힌다 — 본문의 `> 한마디:`.
      if (message.expectedHead || message.expectedPreview) {
        refuseWhileTurnRuns();
        await active.repo.repoCore().lane.run("submit", async () => {
          const head = await active.repo.headCommitFiles();
          await active.repo.repoCore().refreshPendingChanges(true);
          refuseWhileTurnRuns();
          if (
            (message.expectedHead && head?.sha !== message.expectedHead) ||
            active.repo.pendingChanges > 0 ||
            (message.expectedPreview &&
              (await active.repo.repoCore().submitPreviewToken()) !== message.expectedPreview)
          ) {
            throw new Error(
              "SUBMIT_CHANGED: 확인한 뒤 작업 내용이 바뀌었어요. 변경 목록을 다시 확인해 주세요.",
            );
          }
          if ((await active.repo.repoCore().finalChangedFiles()).length === 0) {
            throw new Error("제출할 변경이 없어요.");
          }
          active.supervisor.submit(
            "button",
            message.sessionId,
            message.note || undefined,
            message.sent,
          );
        });
      } else {
        active.supervisor.submit(
          "button",
          message.sessionId,
          message.note || undefined,
          message.sent,
        );
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, SUBMIT_WAIT_MS);
        void active.supervisor.settled().then(() => {
          clearTimeout(timer);
          resolve();
        });
      });
      return active.lastDiff ?? { stage: "computing" as const };
    },
    "repo.handoffStatus": async () => {
      // 상태 확인은 읽기만 한다 — 끝난 사이클의 착지(fetch·checkout·reset)는
      // 감독자의 몫이다(PLAN L2 흡수표). 읽은 뒤의 틱이 그 일을 한다.
      const workspaces = deps.fleet.requireActive();
      const report = await workspaces.repo.peekHandoff();
      void workspaces.supervisor.tick("manual");
      return report;
    },
    // 보낸 화면 동결: the frozen stage asks for one
    // committed capture at a time — null is the "no shot" answer, not an
    // error, so the panel falls back to the live preview with the stamp.
    "repo.handoffShot": async (message) => {
      return await deps.fleet.requireActive().repo.handoffShot(message.route);
    },
    // 시점 빌드 재현: the frozen stage's 실제로
    // 열기 — the handoff branch's tip in a throwaway worktree, served on
    // a second port. Absence answers as a ready:false info, not an error,
    // so the stage falls back to the committed capture. The sessionId is
    // what ties the build's life to the conversation that asked for it.
    "repo.handoffPreview": async (message) => {
      return await deps.handoffPreviews.open(message.sessionId ?? null);
    },
    // 패인 오류의 판정: the pane's held error report, re-opened in the
    // isolated verification window. The pane decides what the verdict
    // means — a fixed transient is put away quietly, a live break becomes
    // the auto fix turn. 확인 불능(null)도 판정의 하나다.
    "preview.screenCheck": async (message) => {
      return await deps.previewDrivers.checkScreen(message.route);
    },
    "comments.reply": async (message) => {
      const activeWs = deps.fleet.requireActive();
      await activeWs.repo.replyToReview(message.reviewId, message.body);
      return { ok: true as const };
    },
    // U20(PLAN-UI §10): 영수증의 `개발자에게 한마디 더` — 활성 프로젝트의
    // 열린 요청에 달린다. 명령 id 가 멱등 키라 재전송이 두 번 달지 않는다.
    "repo.note": async (message) => {
      const activeWs = deps.fleet.requireActive();
      await activeWs.repo.noteToDeveloper(message.text);
      return { ok: true as const };
    },
    // 제출 취소(2026-10-14) — 활성 프로젝트의 열린 요청을 닫는다. 감독자가 표식을 적고 닫은 뒤 착지 틱까지 돈다.
    "repo.withdraw": async () => {
      await deps.fleet.requireActive().supervisor.withdraw();
      return { ok: true as const };
    },
    // --- 되돌리기와 넘기기 (PLAN D52 · D53) ------------------------------
    "repo.handoffDraft": async () => {
      const active = deps.fleet.requireActive();
      const commentsFile = join(active.paths.root, "comments.json");
      return await active.repo.handoffDraft({
        commentsFile,
        shotCount: 0,
      });
    },
    "repo.comparison": async (message) => {
      const active = deps.fleet.requireActive();
      if (!message.submitted) {
        await deps.comparisonReady?.(active.slug);
        return readComparison(active.paths.root, message);
      }
      const route = message.route.split("?")[0] ?? "/";
      if (!route.startsWith("/") || route.startsWith("//")) return null;
      const before = await active.repo.handoffShot(route);
      const shots = await deps.previewDrivers.captureHandoffShots([{ route }]);
      const shot = shots[0];
      const mediaType =
        shot?.extension === ".png"
          ? "image/png"
          : shot?.extension === ".webp"
            ? "image/webp"
            : "image/jpeg";
      return {
        route,
        requestId: "submitted",
        sessionId: "",
        sha: "",
        title: "",
        viewport: "desktop",
        before: before ? { ...before, at: "" } : null,
        after: shot
          ? {
              mediaType,
              data: Buffer.from(shot.image).toString("base64"),
              at: new Date().toISOString(),
            }
          : null,
      };
    },
    // 서비스의 첫 화면 사진(2026-10-07) — 첫 화면의 주소는 준비가 끝나며 읽은 것, 모르면 루트. 쿼리는 뗀다.
    "repo.firstLook": async () => {
      const active = deps.fleet.requireActive();
      const found = deps.fleet.firstScreenOf(active.slug)?.path.split(/[?#]/, 1)[0] ?? "/";
      const route = found.startsWith("/") && !found.startsWith("//") ? found : "/";
      return { route, image: null };
    },
    "repo.submitPreview": async () => {
      const active = deps.fleet.requireActive();
      // 웹은 repo.status 를 받을 때마다 다시 묻고, 이 읽기의 git 출력이 다시
      // repo.status 를 방송한다. git 이 느린 Windows 에서는 한 바퀴가 방송 간격보다
      // 길어 줄이 끝없이 불어났다(2026-10-19 — 턴이 40초 넘게 줄 뒤에 섰다). 아직
      // 시작하지 않은 읽기에 합류해 줄에는 많아야 하나만 선다 — 합류한 읽기도 요청
      // 뒤에 시작하므로 신선하다. 칸은 "review": "submit" 은 실제 제출 · 넘기기가
      // 쓰는 칸이라 거기에 합류하면 다른 모양의 결과를 받는다.
      return active.repo.repoCore().lane.run(
        "review",
        async () => {
          const core = active.repo.repoCore();
          const head = await core.headCommitFiles();
          if (!head) throw new Error("제출할 작업을 읽지 못했어요.");
          await core.refreshPendingChanges(true);
          const history = await core.history(true);
          const finalFiles = await core.finalChangedFiles();
          const expectedPreview = await core.submitPreviewToken();
          return { head: head.sha, expectedPreview, repo: core.snapshot(), history, finalFiles };
        },
        { join: true },
      );
    },
    "repo.history": async () => {
      return await deps.fleet.requireActive().repo.history();
    },
    "repo.restore": async (message) => {
      refuseWhileTurnRuns();
      const restored = await deps.fleet.requireActive().repo.restore(message.sha);
      undoLog().record({ kind: "save", slug: deps.fleet.requireActive().slug });
      return restored;
    },
    // --- 코멘트 저장소 (PLAN D57) ----------------------------------------
    // The pins belong to the ACTIVE project: the messages carry no slug,
    // exactly because the planner is looking at one project's preview.
    // Write-only from here: the store's reader is the pull request body.
    "comments.record": (message) => {
      recordComments(join(deps.fleet.requireActive().paths.root, "comments.json"), message.items);
      return { recorded: message.items.length };
    },
  };
}
