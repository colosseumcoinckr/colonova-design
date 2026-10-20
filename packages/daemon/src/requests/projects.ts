import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { currentPlatform } from "../environment.js";
import { realpathBestEffort } from "../paths.js";
import { assertClonableRepoUrl } from "../repo.js";
import type { RequestHandlers, RouterDeps } from "./types.js";

type ProjectDeps = Pick<RouterDeps, "fleet" | "registry" | "manager" | "afterProjectSwitch">;

type ProjectRequest = Extract<keyof RequestHandlers, `project.${string}`>;

/** 프로젝트 목록 · 전환 · 등록 해제를 맡는다. */
export function projectHandlers(deps: ProjectDeps): RequestHandlers<ProjectRequest> {
  return {
    "project.list": () => {
      return {
        projects: deps.fleet.projectSummaries(),
        activeSlug: deps.registry.activeSlug(),
      };
    },
    "project.create": async (message) => {
      return await deps.fleet.createProject(message);
    },
    "project.activate": async (message) => {
      await deps.fleet.activateProject(message.slug);
      // 프로젝트가 바뀌면 pane 은 남의 페이지로 옮겨간다 — 세션의 브라우저
      // 요약이 옛 페이지의 줄과 차이를 재지 않게 서버의 기억을 비운다.
      deps.afterProjectSwitch?.();
      return {
        projects: deps.fleet.projectSummaries(),
        activeSlug: deps.registry.activeSlug(),
      };
    },
    "project.update": async (message) => {
      // Same guard as create — a moved url re-clones, so the wire's word
      // passes through the clone-url guard before the registry hears it.
      if (message.repoUrl != null) assertClonableRepoUrl(message.repoUrl);
      // The error card's 실행 허용: the registry remembers, the workspace is
      // told, and the bring-up it was waiting on runs to ready.
      if (message.approveCommands !== undefined) {
        deps.registry.update(message.slug, {
          commandsApproved: message.approveCommands,
        });
        const gate = deps.fleet.workspacesFor(message.slug);
        gate.repo.setCommandsApproved(message.approveCommands);
        if (message.approveCommands) void gate.repo.sync().catch(() => undefined);
      }
      deps.registry.update(message.slug, {
        ...(message.name !== undefined ? { name: message.name } : {}),
        ...(message.repoUrl !== undefined ? { repoUrl: message.repoUrl } : {}),
        ...(message.baseBranch !== undefined ? { baseBranch: message.baseBranch } : {}),
        // 초대 v4(PLAN 단계 5): 개발자의 값은 덮는다 — null 은 지운다.
        ...(message.defaults !== undefined ? { defaults: message.defaults } : {}),
        ...(message.lifecycle !== undefined ? { lifecycle: message.lifecycle } : {}),
        ...(message.reviewers !== undefined ? { reviewers: message.reviewers } : {}),
      });
      // A url change is a repo change: the workspace re-points (and
      // re-clones when the url moved) through its own update path.
      const workspaces = deps.fleet.workspacesFor(message.slug);
      if (message.repoUrl !== undefined) {
        await workspaces.repo.update({ url: message.repoUrl });
      }
      deps.fleet.announceProjects();
      return {
        projects: deps.fleet.projectSummaries(),
        activeSlug: deps.registry.activeSlug(),
      };
    },
    "project.remove": async (message) => {
      const paths = deps.registry.paths(message.slug);
      // Transcripts are keyed by the clone's realpath (see workspaceCwd) —
      // every lookup below must use that same spelling.
      const repoRoot = realpathBestEffort(paths.repoRoot);
      const workspaces = deps.fleet.workspaces.get(message.slug);
      if (workspaces) {
        // The clone's live threads die with it (D21): a session left
        // running would keep writing into a folder the planner just
        // disowned — or one `deleteFiles` is about to remove.
        await deps.manager.closeWhere(repoRoot);
        await workspaces.repo.stop();
        deps.fleet.workspaces.delete(message.slug);
      }
      deps.registry.remove(message.slug);
      // Files survive a forget: the clone holds screen work that was saved
      // but never merged, and nothing else on the machine has it.
      if (message.deleteFiles) {
        // The conversations go with the folder (PLAN D77): the transcript
        // store lives outside the project folder, keyed by this clone's
        // path — leaving it behind would orphan every thread and let a
        // same-named re-add resurrect them against an empty worktree.
        await deps.manager.removeWhere(repoRoot);
        rmSync(paths.root, { recursive: true, force: true });
      }
      const next = deps.registry.activeSlug();
      if (next) await deps.fleet.activateProject(next);
      deps.fleet.announceProjects();
      return { projects: deps.fleet.projectSummaries(), activeSlug: next };
    },
    "project.openFolder": (message) => {
      if (!deps.registry.get(message.slug)) {
        throw new Error(`프로젝트를 찾을 수 없습니다: ${message.slug}`);
      }
      const paths = deps.registry.paths(message.slug);
      openInFileManager(paths.repoRoot);
      return { ok: true };
    },
  };
}

/**
 * 폴더 열기 — the OS file manager on the clone's path. Detached like the
 * onboarding fix spawns: nobody reads the outcome, and an opener that
 * errors must never crash the daemon. `explorer` is an exe, so no shell is
 * needed even on Windows.
 */
function openInFileManager(path: string): void {
  const platform = currentPlatform();
  // COLONOVA_DESIGN_OPEN_BIN pins the opener — the e2e suite points it at a
  // stub that logs the path instead of raising a real Finder window.
  const pinned = process.env.COLONOVA_DESIGN_OPEN_BIN;
  const [command, args] = pinned
    ? [pinned, [path]]
    : platform === "win32"
      ? ["explorer", [path]]
      : platform === "darwin"
        ? ["open", [path]]
        : ["xdg-open", [path]];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => undefined);
  child.unref();
}
