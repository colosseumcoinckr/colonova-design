import type { EffortLevel, SessionModelInfo } from "@colonova-design/protocol";
import { modelRowOf, seedEffort } from "../../../lib/chat-options.ts";

/**
 * 기획 AI 의 모델 · 생각 시간 고름(2026-10-26 사용자 요청) — 화면 대화의 칩과 같은 부품(ModelChip)이
 * 읽고 쓰는 값이다. 화면 대화의 next 고름이 프로젝트 설정에 사는 것과 달리 이쪽은 이 앱의 자리에 산다:
 * 기획 AI 는 프로바이더가 Claude 하나로 정해져 있어 프로젝트마다 달라질 이유가 없다. 읽고 쓰는 길만
 * 여기 두고(순수 모듈 — 시험은 src 에서 곧장 읽는다), 칩과 이어주는 몸은 use-draft-pick 이다.
 */

export interface DraftPick {
  model: string | null;
  effort: EffortLevel | null;
}

export const DRAFT_PICK_KEY = "colonova-design.draft-pick";

const EFFORTS: readonly EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

const NO_PICK: DraftPick = { model: null, effort: null };

/** 저장된 고름을 읽는다 — 없거나 깨진 기록은 고른 적 없는 것과 같다. */
export function readDraftPick(storage: Storage): DraftPick {
  let raw: string | null = null;
  try {
    raw = storage.getItem(DRAFT_PICK_KEY);
  } catch {
    return NO_PICK;
  }
  if (raw === null) return NO_PICK;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return NO_PICK;
  }
  if (typeof parsed !== "object" || parsed === null) return NO_PICK;
  const record = parsed as Record<string, unknown>;
  const model =
    typeof record.model === "string" && record.model !== ""
      ? record.model
      : record.model === null
        ? null
        : undefined;
  const effort =
    typeof record.effort === "string" && EFFORTS.includes(record.effort as EffortLevel)
      ? (record.effort as EffortLevel)
      : record.effort === null
        ? null
        : undefined;
  if (model === undefined || effort === undefined) return NO_PICK;
  return { model, effort };
}

export function writeDraftPick(storage: Storage, pick: DraftPick): void {
  try {
    storage.setItem(DRAFT_PICK_KEY, JSON.stringify(pick));
  } catch {
    // 저장이 막혀도 이번 실행의 고름은 살아 있다 — 다음 시작이 CLI 기본으로 돌아갈 뿐이다.
  }
}

/**
 * 모델 목록이 처음 닿았을 때 안 고른 칸을 채우는 씨앗 — 화면 대화의 next 씨앗(useSessions)과 같은
 * 규칙이다. 모델은 default 줄(없으면 첫 줄), 생각 시간은 받는 단계 가운데 보통. 채울 것이 없으면
 * null(부르는 쪽은 그대로 둔다).
 */
export function seedDraftPick(pick: DraftPick, models: SessionModelInfo[]): DraftPick | null {
  if (models.length === 0) return null;
  let next: DraftPick | null = null;
  if (pick.model === null) {
    // "default" 는 CLI 의 「무엇이든 알아서 고른다」 줄 — chat-options 의 CLI_DEFAULT 와 같은 값이다.
    const row = models.find((model) => model.value === "default") ?? models[0];
    if (row !== undefined) next = { model: row.value, effort: pick.effort };
  }
  const model = next?.model ?? pick.model;
  if (model !== null && (next?.effort ?? pick.effort) === null) {
    const row = modelRowOf(models, model);
    const level =
      row?.supportsEffort === false ? undefined : seedEffort(row?.supportedEffortLevels ?? []);
    if (level !== undefined) next = { model, effort: level };
  }
  return next;
}
