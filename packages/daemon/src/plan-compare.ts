/**
 * 화면과 맞춰 보기(2026-11-02 · docs/screen-plan-sync-ux-plan-2026-11-02.md C7 · C8) — 기획 AI 에게
 * 문서 하나와 지금 화면을 견주어 어긋난 곳을 물을 때 쓰는 순수 재료다. 판정은 읽기만 하고 초안 · 화면 어디에도
 * 쓰지 않는다 — 손을 눌렀을 때만 그 방향으로 간다. 기획서 쪽 말의 정본은 초안 우선(같은 계획 §2)이라 어느 판에서
 * 읽었는지를 source 로 함께 돌려준다.
 */
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DraftMismatchRow } from "@colonova-design/protocol";
import { readPlanMap } from "./link-map.js";
import { readSyncLines, screenSyncFile } from "./screen-plan-sync.js";

/** 한 번의 맞춰 보기가 볼 절의 상한 — 넘으면 앞의 절만 보고 「앞의 절만 봤어요」를 말한다(계획 §3 C7 검토). */
export const COMPARE_SECTION_LIMIT = 20;

/** 맞춰 보기가 돌려주는 줄의 상한 — 판정이 늘어나지 않게. */
const COMPARE_ROW_LIMIT = 20;

/** 절 머리 줄 — 파생 마크다운의 `## …` 를 잡는다(앞뒤 공백과 붙은 # 만 본다). */
function isHeadingLine(line: string): boolean {
  return /^#{1,6}\s+\S/u.test(line);
}

/** 문서를 절 상한까지 자른다 — 넘으면 자른 몸과 함께 「앞의 절만 봤다」고 알린다. */
export function clipSections(
  markdown: string,
  limit = COMPARE_SECTION_LIMIT,
): {
  body: string;
  partial: boolean;
} {
  const lines = markdown.split(/\r?\n/u);
  let headings = 0;
  let cutAt = -1;
  for (let at = 0; at < lines.length; at += 1) {
    if (!isHeadingLine(lines[at] ?? "")) continue;
    headings += 1;
    if (headings > limit) {
      cutAt = at;
      break;
    }
  }
  if (cutAt < 0) return { body: markdown, partial: false };
  return { body: lines.slice(0, cutAt).join("\n"), partial: true };
}

/**
 * 맞춰 보기의 프롬프트 — 문서 · 먼저 볼 화면 · 판정 기준. 화면 쪽 말에는 파일 경로 · 컴포넌트 이름을 쓰지 않게
 * 당부한다(계획 §2). 끝은 기준 한 줄로 닫는다(기계가 쓴 턴과 같은 규칙).
 */
export function comparePrompt(input: {
  title: string;
  source: string;
  markdown: string;
  partial: boolean;
  screens: ReadonlyArray<{ route: string; title: string | null }>;
}): string {
  const screens = input.screens
    .map((screen) =>
      screen.title !== null && screen.title.trim() !== ""
        ? `${screen.title} (${screen.route})`
        : screen.route,
    )
    .join(" · ");
  const lines = [
    "[화면과 맞춰 보기]",
    `기획자가 문서 「${input.title.trim()}」(${input.source})과 지금 화면이 같은지 확인하려 한다.`,
    "",
    "[문서]",
    input.markdown.trim(),
    "",
    screens === ""
      ? "먼저 볼 화면: (아는 화면이 없다 — 연결 레포에서 스스로 찾는다)"
      : `먼저 볼 화면(연결 · 같이 고친 기록에서 닿은 것): ${screens}`,
    ...(input.partial ? ["(문서의 절이 많아 앞의 절만 실었다 — 실린 절만 본다)"] : []),
    "",
    "할 일: 문서가 정한 정책 · 규칙 · 조건 · 예외 · 문구 정의 가운데 화면과 다른 것을 찾는다.",
    "- 한 줄이 한 절 · 한 규칙이다. compare.rows 에 절(section) · 기획서 쪽 말(plan) · 화면 쪽 말(screen) · 화면 이름(screenName)을 채운다.",
    "- 두 말은 사람이 읽는 짧은 문장으로 — 파일 경로 · 컴포넌트 이름을 쓰지 않는다.",
    "- 화면은 연결 레포에서 Read · Grep · Glob 으로 확인한다. 읽지 않고 짚지 않는다.",
    "- 문서와 화면이 같은 규칙이면 줄을 만들지 않는다. 걸음(ops)은 비운다.",
    "설명(reply)은 한두 문장으로.",
    "기준: 실린 문서와 화면이 같은 규칙을 말하면 끝이다.",
  ];
  return lines.join("\n");
}

/** AI 답의 compare 덩어리 — 모양이 맞는 줄만 돌려준다. 모양이 아니면 null(판정이 아니라 사람의 말로 안내한다). */
export function parseCompareRows(
  value: unknown,
): { rows: DraftMismatchRow[]; partial: boolean } | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as { rows?: unknown; partial?: unknown };
  if (!Array.isArray(raw.rows) || typeof raw.partial !== "boolean") return null;
  const rows: DraftMismatchRow[] = [];
  for (const item of raw.rows) {
    if (typeof item !== "object" || item === null) continue;
    const row = item as Record<string, unknown>;
    if (
      typeof row.section !== "string" ||
      typeof row.plan !== "string" ||
      typeof row.screen !== "string" ||
      typeof row.screenName !== "string"
    ) {
      continue;
    }
    const section = row.section.trim();
    const plan = row.plan.trim();
    const screen = row.screen.trim();
    const screenName = row.screenName.trim();
    if (section === "" || plan === "" || screen === "" || screenName === "") continue;
    rows.push({ section, plan, screen, screenName });
    if (rows.length >= COMPARE_ROW_LIMIT) break;
  }
  return { rows, partial: raw.partial };
}

// ————— 먼저 볼 화면 — 같이 고친 기록 · 연결 파일에서 이 문서에 닿은 주소 —————

/**
 * 이 문서에 닿은 화면 주소를 모은다(계획 §3 C7 — 같이 고친 기록 · 연결 파일). 연결 파일은 이제 게이트가 아니라
 * 가산점 격의 재료다. 화면 제목을 아는 것은 같이 고친 기록뿐이다.
 */
export async function compareScreens(input: {
  root: string;
  repoRoot: string | null;
  pageId: string;
}): Promise<Array<{ route: string; title: string | null }>> {
  const out: Array<{ route: string; title: string | null }> = [];
  const seen = new Set<string>();
  const push = (route: string, title: string | null) => {
    if (route === "" || seen.has(route)) return;
    seen.add(route);
    out.push({ route, title });
  };
  // 같이 고친 기록 — 이 문서가 고쳐진 턴이 본 화면. 결과 카드에서 곧바로 닿는다.
  for (const line of readSyncLines(screenSyncFile(input.root))) {
    if (line.kind !== "card") continue;
    if (!line.sync.docs.some((doc) => doc.pageId === input.pageId)) continue;
    for (const screen of line.turn.screens) {
      push(screen.route, screen.title.trim() === "" ? null : screen.title);
    }
  }
  // 연결 파일 — 사람이 정확히 이어 둔 주소(제목은 모른다).
  if (input.repoRoot !== null) {
    const { links } = await readPlanMap(input.repoRoot);
    for (const link of links) {
      if (link.pageId === input.pageId) push(link.route, null);
    }
  }
  return out.slice(0, 8);
}

// ————— 안 받기 — 화면 · 문서 짝의 거부 저장(계획 §2 — C1 의 거부 신호와 같은 저장) —————

interface DeclineLine {
  at: string;
  pageId: string;
  screenName: string;
}

function declineFile(projectRoot: string): string {
  return join(projectRoot, "plans", "compare-declines.jsonl");
}

/** 안 받은 짝 읽기 — 깨진 줄은 건너뛴다. 문서의 거부 이름 묶음을 돌려준다. */
export function readCompareDeclines(projectRoot: string, pageId: string): Set<string> {
  let raw: string;
  try {
    raw = readFileSync(declineFile(projectRoot), "utf8");
  } catch {
    return new Set();
  }
  const names = new Set<string>();
  for (const line of raw.split(/\r?\n/u)) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line) as Partial<DeclineLine> | null;
      if (
        parsed !== null &&
        parsed.pageId === pageId &&
        typeof parsed.screenName === "string" &&
        parsed.screenName !== ""
      ) {
        names.add(parsed.screenName);
      }
    } catch {
      // 깨진 줄은 건너뛴다.
    }
  }
  return names;
}

/** 안 받은 짝 남기기 — 이 화면 · 문서 짝의 어긋남 카드를 다시 띄우지 않는다. */
export function appendCompareDecline(
  projectRoot: string,
  pageId: string,
  screenName: string,
  at: string,
): void {
  const file = declineFile(projectRoot);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  appendFileSync(file, `${JSON.stringify({ at, pageId, screenName } satisfies DeclineLine)}\n`, {
    mode: 0o600,
  });
}
