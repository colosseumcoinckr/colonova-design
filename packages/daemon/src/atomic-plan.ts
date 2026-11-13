/**
 * 의미 단위 보관의 분류기 (비개발자 저장) — atomic-plan.
 *
 * 화면 요청 뒤의 미보관 변경(단위 diff 목록)을 haiku 단발 하나로 읽어
 * «커밋 순서가 있는 묶음 + 한국어 Conventional 제목»으로 나눈다. 입력은
 * 단위의 diff · 요약과 사람의 요청뿐이다 — 전체 대화나 수정 후보를 싣지
 * 않는다(2026-11-12: 후보 재사용은 비용 · 계약 확대로 이번에 미도입).
 * 답은 JSON 하나뿐이고 코드 · 패치를 다시 쓰지 않는다.
 *
 * 보장:
 *   - 완전 커버리지 — 알려진 id 가 정확히 한 번씩만 서는 답만 받는다.
 *     중복 · unknown · 빈 그룹 · 나쁜 제목은 모두 거절한다(결정적 검증).
 *   - 예산 — 일반 소스 diff 가 단위 예산을 넘으면 요약으로 대체하지 않고
 *     input-too-large 로 물러난다(소스 문맥의 누락은 예산 폴백). 요약
 *     대체는 kind:binary 와 lock · 생성 파일 경로만 허용하되 단위를
 *     빠뜨리지 않는다. 총량이 넘어도 임의로 자르지 않는다.
 *   - 재시도 — 나쁜 답은 딱 한 번 다시 묻는다. 무한 루프가 없다.
 *   - 캐시 — 같은 모델 · 규칙 버전 · base/target 트리 · 요청 · 단위
 *     집합의 성공 결과를 재쓰고, 도는 중인 같은 키의 호출은 하나로 합친다.
 *     적중 · 합류는 이번 호출의 계측이 없다 — 다른 호출의 턴을 이중으로
 *     세지 않게 빈 누계로 답한다(2026-11-12).
 *   - 폴백 — machine turn 실패 · 파싱/검증 실패 · 예산 초과는 ok:false
 *     결과로 돌고, 호출자의 저장 경로는 그대로 살아남는다.
 *
 * SDK 의 structured output 은 쓰지 않는다 — 내부 재시도가 숨은 턴을
 * 더 태우므로(2026-11-12 감독자 지시) JSON 파싱 + 스키마 검증으로 닫는다.
 */

import { createHash } from "node:crypto";
import type { AtomicPlan, AtomicUnit } from "./atomic-types.js";
import type { MachineTurn, OneShotUsage } from "./machine-provider.js";

// 계약 형은 atomic-types.ts 의 정본이다 — 호출자(atomic-git · repo-summary)가
// 이 경로로도 읽을 수 있게 그대로 되내보낸다.
export type { AtomicGroup, AtomicPlan, AtomicUnit } from "./atomic-types.js";
/** 분류가 machine turn 없이 끝날 수 없었던 이유, 또는 답이 거절된 이유. */
export type AtomicPlanFallbackReason =
  | "empty-input"
  | "input-too-large"
  | "turn-failed"
  | "invalid-answer";

/** haiku 단발(들)의 누계 — 숫자만(사용자 말 · 경로 금지와 같은 잣대). */
export interface TurnUsageTotals {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  durationMs: number;
  apiRetries: number;
}

export type AtomicPlanResult =
  | { ok: true; plan: AtomicPlan; usage: TurnUsageTotals; cached: boolean }
  | { ok: false; reason: AtomicPlanFallbackReason; usage?: TurnUsageTotals };

export interface AtomicPlanInput {
  units: AtomicUnit[];
  /** 화면 요청을 한 사람의 말 — 제목의 배경이지 정답이 아니다. */
  request: string;
  /** 캐시 키의 트리 표식 — base/target 의 해시 또는 sha. 모르면 비워 둔다. */
  baseTree?: string;
  targetTree?: string;
  /** 담당 모델 이름 — 캐시 키에만 쓰인다(모델이 바뀌면 결과를 재쓰지 않는다). */
  model?: string;
}

export interface AtomicPlanDeps {
  /** machine-provider 가 고른 단발 — 무도구 · 단답 · 목줄의 보장은 그쪽 몫. */
  turn: MachineTurn;
  cwd: string;
  /** 단발 한 번의 목줄 — 기본은 넉넉한 한 번의 기계 턴. */
  timeoutMs?: number;
  /** 단발마다의 숫자 계측 — 예산 · 속도 관찰용, 없어도 돈다. */
  onUsage?: (usage: OneShotUsage) => void;
}

// ---------------------------------------------------------------------------
// 예산 · 규칙 — 한 곳이 정본이다. 규칙이 바뀌면 버전을 올려 캐시를 끊는다.
// ---------------------------------------------------------------------------

/** 분류 규칙 버전 — 프롬프트 규칙을 고치면 올린다(캐시 키의 한 재료). */
export const ATOMIC_RULES_VERSION = "atomic-plan/3";

const DEFAULT_TIMEOUT_MS = 30_000;
const REQUEST_MAX_CHARS = 2_000;
const PROMPT_MAX_CHARS = 160_000;
/** 단위 패치 하나의 렌더 상한 — 일반 소스가 이 선을 넘으면 예산 폴백이다. */
const UNIT_PATCH_MAX_CHARS = 16_000;
const MESSAGE_MAX_CHARS = 120;
const CACHE_MAX_ENTRIES = 32;

/**
 * 요약 대체가 허용되는 경로 — lock · 생성 파일만(2026-11-12 사용자 지시).
 * 이 밖의 경로의 kind:hunk|file(일반 소스)은 패치가 예산을 넘으면 대체 없이
 * 폴백한다. kind:binary 는 경로와 무관하게 항상 허용.
 */
const SUMMARY_ONLY_PATH =
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|Gemfile\.lock|composer\.lock|poetry\.lock|Pipfile\.lock|go\.sum)$|(?:^|\/)__generated__\/|\.(?:min\.(?:js|css)|pb\.[jt]s|generated\.[jt]s|gen\.[jt]s|designer\.[jt]s|snap)$/u;

const CONVENTIONAL_TYPES: Record<string, true> = {
  feat: true,
  fix: true,
  refactor: true,
  style: true,
  docs: true,
  test: true,
  chore: true,
  perf: true,
  build: true,
  ci: true,
  revert: true,
};

const MESSAGE_RE = /^([a-z]+): (.+)$/u;

// ---------------------------------------------------------------------------
// 프롬프트 — 순수 렌더. 답으로 쓸 수 있는 전부가 이 문자열 안에 있다.
// ---------------------------------------------------------------------------

/** 렌더에 쓸 문자를 정한다 — 닫는 태그가 본문에 들어가면 구조가 깨진다. */
function scrubTag(text: string, tag: string): string {
  return text.replaceAll(`</${tag}>`, `(태그 제거)`);
}

/**
 * 단위 하나의 본문 — 패치 상한 안이면 통째로 싣고, 넘으면 요약 허용
 * 계열(binary · lock · 생성 파일)만 note 로 대체한다. 일반 소스가 넘으면
 * null — 소스 문맥의 누락을 숨긴 분류는 만들지 않는다.
 */
function renderUnit(unit: AtomicUnit): string | null {
  const head = [`### ${unit.id} — ${unit.path} (${unit.kind})`];
  if (unit.summary) head.push(`요약: ${unit.summary}`);
  const patch = unit.patch.trim();
  if (patch === "") {
    head.push("(패치 없음)");
    return head.join("\n");
  }
  if (patch.length > UNIT_PATCH_MAX_CHARS) {
    if (unit.kind !== "binary" && !SUMMARY_ONLY_PATH.test(unit.path)) return null;
    head.push(`(패치가 커서 요약만 실음 · 전체 ${patch.length}자)`);
    return head.join("\n");
  }
  head.push(`<unit>\n${scrubTag(patch, "unit")}\n</unit>`);
  return head.join("\n");
}

/**
 * 분류 턴의 전체 지시 — 규칙 · 요청 · 단위 목록. 어느 단위든 일반 소스
 * 패치가 예산을 넘거나 총량이 넘으면 null (input-too-large) — 임의로
 * 자른 입력은 만들지 않는다.
 */
export function buildAtomicPlanPrompt(input: {
  units: AtomicUnit[];
  request: string;
}): string | null {
  const units = input.units;
  if (units.length === 0) return null;
  const request =
    input.request.length > REQUEST_MAX_CHARS
      ? `${input.request.slice(0, REQUEST_MAX_CHARS)}\n(요청이 길어 앞부분만 실음)`
      : input.request;
  const bodies: string[] = [];
  for (const unit of units) {
    const body = renderUnit(unit);
    if (body === null) return null;
    bodies.push(body);
  }
  const prompt = [
    "아래 변경들을 의미 단위로 나눠 보관(커밋)하려고 합니다. 묶음의 적용 순서와 각 묶음의 커밋 제목만 JSON 으로 답해 주세요.",
    "규칙:",
    `- 답은 JSON 하나뿐입니다. {"groups":[{"message":"type: 변경","unitIds":["id"]}]} 꼴이고 그 밖의 말 · 코드 · 마크다운 · 설명은 쓰지 않습니다.`,
    `- 모든 변경 id 를 빠짐없이 한 번씩만 담습니다. 아래에 적힌 id 만 쓰고, 같은 id 를 두 묶음에 넣지 않으며, 빈 묶음도 두지 않습니다.`,
    `- 한 묶음은 한 가지 의미의 변경입니다. 함께 바꿔야 깨지지 않는 코드와 그 시험 · 그 문서는 한 묶음입니다.`,
    `- 모르겠으면 나누지 말고 합칩니다. 파일마다 묶음을 만들거나 시험만 따로 묶는 식의 기계적 나누기는 하지 않습니다.`,
    `- groups 의 순서가 커밋 순서입니다. 앞 묶음이 뒷 묶음의 변경을 기다리지 않는 순서로 늘어놓습니다.`,
    `- message 는 \`type: 변경\` 꼴의 한국어 한 줄입니다. type 은 feat(기능) · fix(오류) · refactor(구조) · style(코드 서식) · docs(문서) · test(시험) · chore(그 밖) 중 실제 변경에 맞는 하나(화면의 기능이나 배치를 바꿨으면 feat)이고, 변경은 바뀐 결과를 명사형으로 끝맺은 40자 안팎입니다. 따옴표 · 목록 기호 · 파일 이름 · 코드 이름 · 줄표(—)는 쓰지 않습니다.`,
    `- 요청한 사람의 말은 왜 바꿨는지의 배경입니다. 제목은 실제 변경이 말하게 합니다.`,
    "",
    "요청한 사람의 말:",
    `<request>\n${scrubTag(request, "request")}\n</request>`,
    "",
    `변경 목록 (${units.length}개):`,
    "",
    bodies.join("\n\n"),
  ].join("\n");
  return prompt.length <= PROMPT_MAX_CHARS ? prompt : null;
}

// ---------------------------------------------------------------------------
// 답 읽기 — LLM 없는 결정적 검증. 완전 커버리지 · 유일성 · 제목 규칙.
// ---------------------------------------------------------------------------

/** 코드 울타리 · 잡음을 걷고 JSON 덩어리를 찾는다. */
function extractJson(answer: string): unknown {
  const text = answer
    .trim()
    .replace(/^```(?:json)?\s*|\s*```$/gmu, "")
    .trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** 제목 하나의 검사 — `type: 변경` 꼴 · 길이 · 공백 · 개행. */
function messageUsable(message: unknown): message is string {
  if (typeof message !== "string") return false;
  const text = message.trim();
  if (text.length === 0 || text.length > MESSAGE_MAX_CHARS) return false;
  if (text !== message) return false; // 앞뒤 공백이 든 제목은 기계가 고치지 않고 거절한다
  const match = MESSAGE_RE.exec(text);
  if (!match) return false;
  const type = match[1];
  const subject = match[2];
  if (typeof type !== "string" || !CONVENTIONAL_TYPES[type]) return false;
  if (typeof subject !== "string" || subject !== subject.trim() || /[\r\n]/u.test(subject)) {
    return false;
  }
  return true;
}

/**
 * haiku 의 답을 읽어 계획으로 굳힌다 — LLM 없는 결정적 검증의 전부다.
 * 거절하면 null 이고 이유는 호출자의 재시도 · 폴백 판단에만 쓴다.
 */
export function parseAtomicPlanAnswer(
  answer: string,
  expectedUnitIds: readonly string[],
): AtomicPlan | null {
  const data = extractJson(answer);
  if (typeof data !== "object" || data === null || !("groups" in data)) return null;
  const groups = data.groups;
  if (!Array.isArray(groups) || groups.length === 0) return null;

  const expected = new Set(expectedUnitIds);
  const seen = new Set<string>();
  const plan: AtomicPlan = { groups: [] };
  for (const group of groups) {
    if (typeof group !== "object" || group === null) return null;
    if (!("message" in group) || !("unitIds" in group)) return null;
    const { message, unitIds } = group;
    if (!messageUsable(message)) return null;
    if (!Array.isArray(unitIds) || unitIds.length === 0) return null;
    const ids: string[] = [];
    for (const id of unitIds) {
      if (typeof id !== "string" || !expected.has(id) || seen.has(id)) return null;
      seen.add(id);
      ids.push(id);
    }
    plan.groups.push({ message, unitIds: ids });
  }
  return seen.size === expected.size ? plan : null;
}

// ---------------------------------------------------------------------------
// 캐시 · 판돌이 — 성공 결과만 저장하고, 도는 중인 키는 하나로 합친다.
// ---------------------------------------------------------------------------

/** 캐시 키 — 모델 · 규칙 버전 · base/target · 요청 · 단위 집합의 해시. */
function cacheKeyOf(input: AtomicPlanInput): string {
  const hash = createHash("sha256");
  hash.update(ATOMIC_RULES_VERSION);
  hash.update("\x00");
  hash.update(input.model ?? "");
  hash.update("\x00");
  hash.update(input.baseTree ?? "");
  hash.update("\x00");
  hash.update(input.targetTree ?? "");
  hash.update("\x00");
  hash.update(input.request);
  hash.update("\x00");
  for (const unit of input.units) {
    hash.update(unit.id);
    hash.update("\x01");
    hash.update(unit.path);
    hash.update("\x01");
    hash.update(unit.kind);
    hash.update("\x01");
    hash.update(unit.summary ?? "");
    hash.update("\x01");
    hash.update(unit.patch);
    hash.update("\x02");
  }
  return hash.digest("hex").slice(0, 32);
}

function emptyTotals(): TurnUsageTotals {
  return {
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    durationMs: 0,
    apiRetries: 0,
  };
}

function addUsage(totals: TurnUsageTotals, usage: OneShotUsage): void {
  totals.inputTokens += usage.inputTokens ?? 0;
  totals.outputTokens += usage.outputTokens ?? 0;
  totals.cacheReadTokens += usage.cacheReadTokens ?? 0;
  totals.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
  totals.durationMs += usage.durationMs ?? 0;
  totals.apiRetries += usage.apiRetries ?? 0;
}

export interface AtomicPlanner {
  plan(input: AtomicPlanInput, deps: AtomicPlanDeps): Promise<AtomicPlanResult>;
}

/**
 * 캐시를 소유하는 분류기 — 플릿/프로젝트 경계마다 하나씩 만들어 쓰거나
 * 기본 인스턴스를 나눠 쓴다. 성공(ok:true)만 저장하므로 폴백은 재시도된다.
 */
export function createAtomicPlanner(cacheSize = CACHE_MAX_ENTRIES): AtomicPlanner {
  const cache = new Map<string, { plan: AtomicPlan; usage: TurnUsageTotals }>();
  const inflight = new Map<string, Promise<AtomicPlanResult>>();

  /** 캐시에 들어가고 나오는 계획은 항상 사본 — 호출자가 고쳐도 저장분이 상하지 않는다. */
  function clonePlan(plan: AtomicPlan): AtomicPlan {
    return {
      groups: plan.groups.map((g) => ({ message: g.message, unitIds: [...g.unitIds] })),
    };
  }

  /**
   * 캐시 적중 · in-flight 합류가 호출자에게 가는 모습 — 이번 호출의 턴이
   * 아닌 다른 호출의 턴을 이중으로 세지 않게 계획 사본 · 빈 계측 · cached
   * 로 답한다(2026-11-12).
   */
  function sharedView(result: AtomicPlanResult): AtomicPlanResult {
    if (!result.ok) return result;
    return { ok: true, plan: clonePlan(result.plan), usage: emptyTotals(), cached: true };
  }

  async function attempt(
    prompt: string,
    correction: string | null,
    input: AtomicPlanInput,
    deps: AtomicPlanDeps,
    totals: TurnUsageTotals,
  ): Promise<AtomicPlanResult> {
    // 턴 수는 실제 호출 직전에 센다 — 실패 · fake 도 한 턴이고, onUsage 를
    // 안 싣는 드라이버와 독립적으로 늘어난다.
    totals.turns += 1;
    const answer = await deps
      .turn(correction ? `${prompt}\n\n${correction}` : prompt, {
        cwd: deps.cwd,
        timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        onUsage: (usage) => {
          addUsage(totals, usage);
          deps.onUsage?.(usage);
        },
      })
      .catch(() => null);
    if (answer === null) return { ok: false, reason: "turn-failed", usage: totals };
    const plan = parseAtomicPlanAnswer(
      answer,
      input.units.map((unit) => unit.id),
    );
    if (plan) return { ok: true, plan, usage: totals, cached: false };
    return { ok: false, reason: "invalid-answer", usage: totals };
  }

  async function classify(input: AtomicPlanInput, deps: AtomicPlanDeps): Promise<AtomicPlanResult> {
    if (input.units.length === 0) return { ok: false, reason: "empty-input" };
    const prompt = buildAtomicPlanPrompt({ units: input.units, request: input.request });
    if (prompt === null) return { ok: false, reason: "input-too-large" };
    const totals = emptyTotals();
    const first = await attempt(prompt, null, input, deps, totals);
    if (first.ok) return first;
    // 나쁜 답은 딱 한 번 — 같은 재료에 교정 지시만 더한다. 그 뒤는 폴백.
    if (first.reason !== "invalid-answer") return first;
    return attempt(
      prompt,
      "직전의 답은 규칙을 어겼습니다. JSON 하나만, 모든 id 를 한 번씩만 담아 다시 답해 주세요.",
      input,
      deps,
      totals,
    );
  }

  return {
    plan(input: AtomicPlanInput, deps: AtomicPlanDeps): Promise<AtomicPlanResult> {
      const key = cacheKeyOf(input);
      const hit = cache.get(key);
      if (hit) {
        return Promise.resolve({
          ok: true,
          plan: clonePlan(hit.plan),
          usage: emptyTotals(),
          cached: true,
        });
      }
      const running = inflight.get(key);
      if (running) {
        // 합류 쪽은 원 호출의 계측을 받지 않는다 — 결과 공유, 비용은 한 번.
        return running.then(sharedView);
      }
      const pending = classify(input, deps)
        .then((result) => {
          if (result.ok) {
            // LRU — 앞쪽이 가장 오래된 키. 상한을 넘으면 가장 오래된 것을 버린다.
            cache.delete(key);
            cache.set(key, { plan: clonePlan(result.plan), usage: result.usage });
            while (cache.size > cacheSize) {
              const oldest = cache.keys().next().value;
              if (oldest === undefined) break;
              cache.delete(oldest);
            }
          }
          return result;
        })
        .finally(() => {
          if (inflight.get(key) === pending) inflight.delete(key);
        });
      inflight.set(key, pending);
      return pending;
    },
  };
}

/** 데몬 기본 분류기 — 저장 경로가 나눠 쓰는 캐시 소유자. */
const defaultPlanner = createAtomicPlanner();

/** 기본 분류기로 한 번 분류한다 — 캐시 · in-flight 합류는 인스턴스를 따라간다. */
export function planAtomicCommits(
  input: AtomicPlanInput,
  deps: AtomicPlanDeps,
): Promise<AtomicPlanResult> {
  return defaultPlanner.plan(input, deps);
}
