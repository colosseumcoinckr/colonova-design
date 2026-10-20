import type { RepoStatus } from "@colonova-design/protocol";
import type { RepoCore } from "./repo-core.js";

/** 2026-10-20 MVP: 제출 버튼이 확정한 불변 버전. 재시작 뒤에도 최신 HEAD로 바꾸지 않는다. */
export interface SubmitVersion {
  branch: string;
  head: string;
  base: string;
  baseBranch: string;
  remoteHead: string | null;
  screens?: RepoStatus["cycleScreens"];
}

export const SUBMIT_CHANGED =
  "SUBMIT_CHANGED: 확인한 뒤 작업 내용이 바뀌었어요. 변경 목록을 다시 확인해 주세요.";

export async function captureSubmitVersion(core: RepoCore): Promise<SubmitVersion> {
  await core.refreshPendingChanges(true);
  if (!core.branch || core.pendingChanges > 0) throw new Error(SUBMIT_CHANGED);
  const checkout = (
    await core.git(["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => "")
  ).trim();
  if (checkout !== core.branch) throw new Error(SUBMIT_CHANGED);
  if ((await core.finalChangedFiles()).length === 0) throw new Error("제출할 변경이 없어요.");
  const head = (await core.git(["rev-parse", "HEAD"])).trim();
  const base = (await core.git(["rev-parse", `refs/remotes/origin/${core.baseBranch}`])).trim();
  const remoteHead =
    (
      await core
        .git(["rev-parse", "--verify", `refs/remotes/origin/${core.branch}`])
        .catch(() => "")
    ).trim() || null;
  return {
    branch: core.branch,
    head,
    base,
    baseBranch: core.baseBranch,
    remoteHead,
    screens: structuredClone(core.snapshot().cycleScreens ?? []),
  };
}

/** 원장 자료는 명령 인자가 된다. 불완전한 옛 자료는 재확인 대상으로 남긴다. */
export function parseSubmitVersion(raw: unknown): SubmitVersion | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Partial<SubmitVersion>;
  const sha = (item: unknown): item is string =>
    typeof item === "string" && /^[a-f0-9]{40,64}$/.test(item);
  const branch = (item: unknown): item is string =>
    typeof item === "string" &&
    item.length > 0 &&
    !item.startsWith("-") &&
    !/[\s~^:?*[\\]/.test(item) &&
    !item.includes("..");
  if (
    !sha(value.head) ||
    !sha(value.base) ||
    !branch(value.branch) ||
    !branch(value.baseBranch) ||
    (value.remoteHead !== null && !sha(value.remoteHead))
  )
    return undefined;
  return {
    branch: value.branch,
    head: value.head,
    base: value.base,
    baseBranch: value.baseBranch,
    remoteHead: value.remoteHead,
    ...(Array.isArray(value.screens) ? { screens: value.screens } : {}),
  };
}
