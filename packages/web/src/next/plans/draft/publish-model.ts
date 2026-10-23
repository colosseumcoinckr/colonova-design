import type {
  DraftPublishBlocker,
  DraftPublishPreview,
  DraftPublishResult,
} from "@colonova-design/protocol";
import { L } from "../../labels.ts";

/**
 * 발행 확인의 순수 도우미(2026-10-23 · 최종 구현 계획 F2) — 확인 창이 보이는 문장과 다음 행동을
 * 판정한다. 시험이 src 에서 곧장 읽으므로 형제를 부르지 않고, 문장은 `labels.ts` 를 확장자와 함께
 * 읽는다(draft-model.ts 와 같은 모양).
 */

/** 막는 이유의 다음 행동 — 기계 이름이다. null 이면 이유의 글만 말한다. */
export type BlockerAction = "rebase" | "open-confluence" | "resolve" | "recheck";

/** 막는 이유 한 줄 — 사람의 말과, 있으면 다음 행동. */
export interface BlockerLine {
  text: string;
  action: BlockerAction | null;
}

/** 이유마다 세운 다음 행동 — 설정 안내만으로 끝나는 이유는 null 이다. */
const BLOCKER_ACTIONS: Record<DraftPublishBlocker, BlockerAction | null> = {
  "publish-disabled": null,
  "nothing-to-publish": null,
  "remote-newer": "rebase",
  "remote-draft": "open-confluence",
  "remote-draft-unknown": "open-confluence",
  "remote-missing": null,
  "no-permission": "open-confluence",
  "out-of-scope": null,
  "conflict-open": "resolve",
  "pending-command": "recheck",
  "unsupported-change": null,
};

/** 막는 이유의 줄들 — 미리보기가 세운 순서 그대로다. */
export function blockerLines(preview: DraftPublishPreview): BlockerLine[] {
  return preview.blockers.map((name) => ({
    text: L.drafts.blocker[name],
    action: BLOCKER_ACTIONS[name],
  }));
}

/** 이번 발행의 요약 — 바뀜 · 새로 · 지움 수 한 줄과, 지운 보호 조각은 사람의 말로 한 줄씩. */
export function changeSummary(preview: DraftPublishPreview): string[] {
  const lines: string[] = [];
  const counts = L.drafts.changeCounts(
    preview.changes.changed,
    preview.changes.inserted,
    preview.changes.deleted,
  );
  if (counts !== "") lines.push(counts);
  for (const machine of preview.changes.protectedRemoved) {
    lines.push(L.drafts.protectedRemoved(L.drafts.tokenLabel(machine)));
  }
  return lines;
}

/** 단계 표기가 1.0 이상 — 발행에 새 표기와 사유가 필요하다(개정 발행). */
export function stageInputNeeded(preview: DraftPublishPreview): boolean {
  return preview.stage.required;
}

/**
 * 같은 단계의 다음 개정 표기 — 마친 단계(1.0 이상)만 한 걸음 더 간다. 마치지 못한 단계는
 * 표기가 그대로다(같은 단계 개정이 기본). 못 읽는 표기도 그대로 돌려준다.
 */
export function nextNotation(current: string | null): string | null {
  if (current === null) return null;
  const [majorText, minorText] = current.split(".");
  const major = Number.parseInt(majorText ?? "", 10);
  const minor = Number.parseInt(minorText ?? "0", 10);
  if (!Number.isFinite(major) || major < 1 || !Number.isFinite(minor)) return current;
  return `${major}.${String(minor + 1).padStart(2, "0")}`;
}

/** 결과 처지의 한 줄 — 확인 창과 편집기의 알림이 같은 문장을 쓴다. */
export function resultLine(result: DraftPublishResult): string {
  if (result.state === "applied") {
    return result.version === null
      ? L.drafts.resultUnknownTitle
      : L.drafts.resultApplied(result.version);
  }
  if (result.state === "unknown") return L.drafts.resultUnknownTitle;
  if (result.state === "conflict") return L.drafts.resultConflict;
  if (result.state === "not-applied") return L.drafts.resultNotApplied;
  if (result.state === "failed") {
    const detail = result.detail.trim();
    if (detail === "") return L.drafts.resultFailed;
    // 막는 이유의 기계 이름이 그대로 실려 오면 사람의 말로 바꾼다 — 모르는 글은 받은 대로 보인다
    // (2026-10-23 화면 확인 · R2 검토 2).
    return detail in L.drafts.blocker ? L.drafts.blocker[detail as DraftPublishBlocker] : detail;
  }
  return L.drafts.resultClosed;
}

/** 발행 명령의 멱등 키 — 같은 내용을 두 번 보내지 않게 소문자 UUID 를 쓴다. */
export function newCommandId(): string {
  return crypto.randomUUID().toLowerCase();
}
