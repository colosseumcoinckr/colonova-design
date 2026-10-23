/**
 * 기획 근거의 기록(2026-10-23 · 최종 구현 계획 F3 · 작업 C3) — 화면 작업에 첨부로 간
 * 근거 스냅샷의 표식 · 기록 · PR 절의 재료. 스냅샷은 요청 순간에 굳으므로 나중에
 * 문서가 발행돼도 과거 제출의 근거는 소급해 바뀌지 않는다(정본 계획 §10).
 *
 * 기록은 프로젝트 데이터의 `plans/refs.jsonl` 에 JSON 줄로 쌓인다. 로그와 절에는
 * 문서의 제목 · 판 · 절만 남긴다 — 경로 · 사용자의 말 · 초안 본문은 남기지 않는다.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { DraftPlanRef } from "@colonova-design/protocol";

/** 첨부 첫 줄의 표식 — 이 첨부가 기획 근거 스냅샷임을 알린다. */
export const PLAN_REF_MARKER = "colonova-design:plan-ref";

/** 근거 기록 한 줄 — 언제 어떤 대화에서 어떤 문서를 근거로 골랐는가. */
export interface PlanRefEntry {
  at: string;
  sessionId: string;
  ref: DraftPlanRef;
}

/** 표식 줄 — HTML 주석이므로 본문에 `--` 가 들어가지 않게 JSON 이스케이프로 흘린다. */
export function planRefHeader(ref: DraftPlanRef): string {
  const json = JSON.stringify(ref).replace(/--/gu, "\\u002d\\u002d");
  return `<!-- ${PLAN_REF_MARKER} ${json} -->`;
}

// ————— 관용 읽기 — confluence-ledger.ts 의 같은 감각: 절대 던지지 않는다 —————

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);

const asNullableString = (value: unknown): string | null | undefined =>
  value === null ? null : typeof value === "string" ? value : undefined;

const asNullableInt = (value: unknown): number | null | undefined =>
  value === null ? null : typeof value === "number" && Number.isInteger(value) ? value : undefined;

/** 근거 기록의 모양 검사 — 하나라도 어긋나면 null 이다. */
function planRefOf(value: unknown): DraftPlanRef | null {
  const raw = asRecord(value);
  if (raw === null) return null;
  const title = asString(raw.title);
  const pageId = asNullableString(raw.pageId);
  const docKey = asNullableString(raw.docKey);
  const url = asNullableString(raw.url);
  const version = asNullableInt(raw.version);
  const revision = asNullableInt(raw.revision);
  const sections = Array.isArray(raw.sections)
    ? raw.sections.filter((item): item is string => typeof item === "string")
    : undefined;
  if (
    title === null ||
    pageId === undefined ||
    docKey === undefined ||
    url === undefined ||
    version === undefined ||
    revision === undefined ||
    sections === undefined ||
    typeof raw.published !== "boolean"
  ) {
    return null;
  }
  return { title, pageId, docKey, url, version, revision, published: raw.published, sections };
}

/** 첨부(또는 임의 글)의 첫 줄이 표식이면 근거 기록을 읽는다 — 아니면 null. */
export function readPlanRef(text: string): DraftPlanRef | null {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const prefix = `<!-- ${PLAN_REF_MARKER} `;
  if (!first.startsWith(prefix) || !first.endsWith("-->")) return null;
  try {
    return planRefOf(JSON.parse(first.slice(prefix.length, -3)));
  } catch {
    return null;
  }
}

/** 근거 기록을 JSON 줄로 덧붙인다 — 폴더 0o700, 파일 0o600. */
export function appendPlanRefs(file: string, entries: PlanRefEntry[]): void {
  if (entries.length === 0) return;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, {
    mode: 0o600,
  });
}

/** 기록의 한 줄 검사 — 깨진 줄은 건너뛴다. */
function entryOf(value: unknown): PlanRefEntry | null {
  const raw = asRecord(value);
  if (raw === null) return null;
  const at = asString(raw.at);
  const sessionId = asString(raw.sessionId);
  const ref = planRefOf(raw.ref);
  if (at === null || sessionId === null || ref === null) return null;
  return { at, sessionId, ref };
}

/** 근거 기록을 읽는다 — 파일이 없거나 깨진 줄은 건너뛰고, `since` 부터의 것만 산다. */
export function readPlanRefs(file: string, since: Date | null): PlanRefEntry[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const sinceMs = since === null ? null : since.getTime();
  if (sinceMs !== null && Number.isNaN(sinceMs)) return [];
  const entries: PlanRefEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const entry = entryOf(parsed);
    if (entry === null) continue;
    if (sinceMs !== null) {
      const at = Date.parse(entry.at);
      if (Number.isNaN(at) || at < sinceMs) continue;
    }
    entries.push(entry);
  }
  return entries;
}

// ————— 근거 줄(2026-10-23 · 최종 구현 계획 F3 · 작업 F3b) — 화면 대화가 기획으로 돌아가는 길 —————

/** 근거 줄의 상한 — 한 대화의 근거는 최근 20개까지 칩으로 선다. */
export const PLAN_REFS_LIMIT = 20;

/** 같은 근거의 열쇠 — 문서 · 초안 · 판 · 개정 · 절이 같으면 같은 근거다. */
function planRefIdentity(ref: DraftPlanRef): string {
  return JSON.stringify([ref.pageId, ref.docKey, ref.version, ref.revision, ref.sections]);
}

/**
 * 대화의 근거 줄 — 그 대화의 기록만, 같은 근거는 가장 최근 기록 하나로, 최근 것이 앞으로
 * `max` 까지. 깨진 줄은 이미 걷혀 온다(readPlanRefs). 본문은 실리지 않는다. 못 읽는
 * 시각(NaN)은 가장 오래된 것으로 센다 — 줄 순서가 흐트러지지 않게.
 */
export function recentPlanRefs(
  entries: PlanRefEntry[],
  sessionId: string,
  max: number,
): PlanRefEntry[] {
  const latest = new Map<string, PlanRefEntry>();
  for (const entry of entries) {
    if (entry.sessionId !== sessionId) continue;
    latest.set(planRefIdentity(entry.ref), entry);
  }
  const rows = [...latest.values()].sort(
    (left, right) => (Date.parse(right.at) || 0) - (Date.parse(left.at) || 0),
  );
  const cap = Math.max(0, max);
  return rows.length > cap ? rows.slice(0, cap) : rows;
}

/** 근거 줄 — 발행된 문서는 링크 · 판, 초안은 미발행 상태와(있으면) 기존 공식본. */
function planRefLine(ref: DraftPlanRef): string {
  const sections = ref.sections.length > 0 ? ` · 절: ${ref.sections.join(", ")}` : "";
  if (ref.published) {
    const head = ref.url !== null ? `[${ref.title}](${ref.url})` : ref.title;
    const version = ref.version !== null ? ` · 판 ${ref.version}` : "";
    return `- ${head}${version}${sections}`;
  }
  const official =
    ref.url !== null && ref.version !== null
      ? ` · 공식본: [${ref.title}](${ref.url}) 판 ${ref.version}`
      : "";
  return `- ${ref.title} — 아직 발행하지 않은 초안(개정 ${ref.revision ?? 0})${official}${sections}`;
}

/**
 * `### 기획 근거` 절 — 같은 문서(pageId 또는 docKey)는 마지막 기록 하나로 묶는다.
 * 기록이 없으면 null — 절이 서지 않는다. 초안 본문은 절에 들어가지 않는다.
 */
export function buildPlanRefsSection(entries: PlanRefEntry[]): string | null {
  const last = new Map<string, PlanRefEntry>();
  for (const entry of entries) {
    const key = entry.ref.pageId !== null ? `p:${entry.ref.pageId}` : `d:${entry.ref.docKey ?? ""}`;
    last.set(key, entry);
  }
  if (last.size === 0) return null;
  const lines = [...last.values()].map((entry) => planRefLine(entry.ref));
  return `### 기획 근거\n\n이 화면 작업이 근거로 삼은 기획 문서다.\n\n${lines.join("\n")}\n`;
}
