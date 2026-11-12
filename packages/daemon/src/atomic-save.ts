/** 화면 요청의 분류·검사·보관 연결. 폴백도 처음 고정한 내용만 보관한다. */
import { accessSync, constants, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { DiffStatus } from "@colonova-design/protocol";
import { atomicCheckPreflight, validateAtomicTree } from "./atomic-check.js";
import {
  applyAtomicCommits,
  captureAtomicSnapshot,
  disposeAtomicSnapshot,
  prepareAtomicCommits,
} from "./atomic-git.js";
import type { AtomicPlanInput, AtomicPlanResult } from "./atomic-plan.js";
import type { AtomicPlan, PreparedAtomicCommits } from "./atomic-types.js";
import type { RepoCore } from "./repo-core.js";

/** commit-tree가 레포 훅을 조용히 건너뛰지 않게, 훅이 있으면 기존 commit 경로를 쓴다. */
export async function hasCommitHooks(core: RepoCore): Promise<boolean> {
  const custom = (await core.git(["config", "--get", "core.hooksPath"]).catch(() => "")).trim();
  const hooks = custom
    ? resolve(core.root, custom)
    : resolve(core.root, (await core.git(["rev-parse", "--git-path", "hooks"])).trim());
  return ["pre-commit", "prepare-commit-msg", "commit-msg", "post-commit"].some((name) => {
    try {
      accessSync(join(hooks, name), process.platform === "win32" ? constants.F_OK : constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

export interface AtomicSaveResult {
  commits: NonNullable<DiffStatus["turnCommits"]>;
  atomic: NonNullable<DiffStatus["atomic"]>;
}

class CheckRefused extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

export async function runAtomicSave(
  core: RepoCore,
  options: {
    paths: string[];
    request: string;
    fallbackMessage: string;
    plan: (input: AtomicPlanInput) => Promise<AtomicPlanResult>;
  },
): Promise<AtomicSaveResult> {
  const started = Date.now();
  const snapshot = await captureAtomicSnapshot(core, options.paths);
  let classification: AtomicPlanResult | undefined;
  let atomic: AtomicSaveResult["atomic"] = {
    status: "fallback",
    checked: false,
    reason: "turn-failed",
  };
  try {
    const unavailable = await atomicCheckPreflight(core, snapshot.targetTree);
    if (!unavailable)
      classification = await options
        .plan({
          units: snapshot.units,
          request: options.request,
          baseTree: snapshot.baseTree,
          targetTree: snapshot.targetTree,
        })
        .catch(() => undefined);
    const fallback: AtomicPlan = {
      groups: [
        {
          message:
            options.fallbackMessage.replace(/\0/g, "").split(/\r?\n/)[0]?.trim() ||
            "chore: 화면 변경 보관",
          unitIds: snapshot.units.map((unit) => unit.id),
        },
      ],
    };
    const plan = classification?.ok ? classification.plan : fallback;
    const identityArgs = await core.identityArgs();
    let prepared: PreparedAtomicCommits;
    if (classification?.ok) {
      try {
        // 요청 하나가 저장을 오래 붙잡지 않게 모든 중간 검사의 예산을 나눠 쓴다.
        const deadline = Date.now() + 120_000;
        prepared = await prepareAtomicCommits(core, snapshot, plan, {
          identityArgs,
          validateTree: async (tree) => {
            const left = deadline - Date.now();
            if (left <= 0) throw new CheckRefused("check-timeout");
            const result = await validateAtomicTree({ core, tree, timeoutMs: left });
            if (result.status !== "passed") throw new CheckRefused(result.reason ?? "check-failed");
          },
        });
        atomic = { status: plan.groups.length > 1 ? "split" : "single", checked: true };
      } catch (error) {
        atomic.reason = error instanceof CheckRefused ? error.reason : "prepare-failed";
        prepared = await prepareAtomicCommits(core, snapshot, fallback, { identityArgs });
      }
    } else {
      atomic.reason = unavailable ?? classification?.reason ?? "turn-failed";
      prepared = await prepareAtomicCommits(core, snapshot, fallback, { identityArgs });
    }
    await applyAtomicCommits(core, snapshot, prepared);
    // 통계에는 말과 경로를 싣지 않는다. 입력·출력 숫자와 결과 종류만 200행 보관한다.
    try {
      const file = join(dirname(core.root), "atomic-save.jsonl");
      const previous = existsSync(file)
        ? readFileSync(file, "utf8").trim().split("\n").slice(-199)
        : [];
      previous.push(
        JSON.stringify({
          at: Date.now(),
          status: atomic.status,
          reason: atomic.reason,
          checked: atomic.checked,
          units: snapshot.units.length,
          commits: prepared.commits.length,
          cached: classification?.ok ? classification.cached : false,
          ...classification?.usage,
          durationMs: Date.now() - started,
          classificationMs: classification?.usage?.durationMs ?? 0,
        }),
      );
      writeFileSync(file, `${previous.join("\n")}\n`);
    } catch {
      /* 계측 실패는 보관 결과를 바꾸지 않는다. */
    }
    return { commits: prepared.commits, atomic };
  } finally {
    disposeAtomicSnapshot(snapshot);
  }
}
