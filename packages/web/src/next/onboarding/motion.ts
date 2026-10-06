/**
 * 첫 실행 · 확인판 · 테마 겹의 움직임 판정 — 컴포넌트가 매 프레임 다시 계산하지
 * 않게 한 곳에 모았다. 문장은 받지 않는다(시험이 곧장 읽는 순수 모듈).
 */

import type { OnboardingStep } from "@colonova-design/protocol";

/** 체크리스트 세 항목의 열쇠 — 통과의 순간을 항목별로 가리킨다. */
export type GateKey = "tools" | "agent" | "invite";

/** 세 항목이 서는 차례 — 링의 조각과 카드가 같은 차례로 읽는다(2026-10-06 온보딩 손질). */
export const GATE_ORDER: readonly GateKey[] = ["tools", "agent", "invite"];

/** 항목별 통과 — 링 · 카드의 위계 · 낭독 문장이 읽는 한 장의 판. */
export type GatePasses = Record<GateKey, boolean>;

/**
 * 데몬의 검사 줄과 프로젝트 수에서 세 항목의 통과를 읽는다. 도구는 git · 런타임이
 * 둘 다 지나가야 한다(데몬이 함께 싣는 github 줄은 이 판의 일이 아니다). 검사 답이
 * 아직 없으면(null) 아무것도 지나가지 않았다.
 */
export function gatePasses(
  steps: readonly OnboardingStep[] | null,
  projectCount: number,
): GatePasses {
  const pass = (id: OnboardingStep["id"]) =>
    steps?.find((step) => step.id === id)?.status === "pass";
  return { tools: pass("git") && pass("runtime"), agent: pass("claude"), invite: projectCount > 0 };
}

/**
 * 지금 손이 가야 할 항목 — 차례상 첫 미통과. 정말 기다리는 칸(`waiting`)은 건너뛴다:
 * 눌러 볼 것이 없는 칸에 강조를 두면 사용자가 거기서 기다리게 된다. 다 찼으면 null.
 */
export function currentGate(passes: GatePasses, waiting: Partial<GatePasses> = {}): GateKey | null {
  return GATE_ORDER.find((key) => !passes[key] && !waiting[key]) ?? null;
}

/** 링 조각의 모양 — 통과(ok) · 지금(now) · 아직(todo). 순서는 GATE_ORDER 와 같다. */
export type RingSegment = "ok" | "now" | "todo";

export function ringSegments(passes: GatePasses, waiting: Partial<GatePasses> = {}): RingSegment[] {
  const now = currentGate(passes, waiting);
  return GATE_ORDER.map((key) => (passes[key] ? "ok" : key === now ? "now" : "todo"));
}

/**
 * 진행 링의 기하 — 조각 `count` 개가 틈 `gap`(눈에 보이는 길이) 사이로 한 바퀴를 나눈다. 선 끝이 둥글어
 * 눈에 보이는 조각은 `선의 길이 + 굵기` 라, 틈이 `gap` 으로 보이도록 그만큼을 뺀다. `dash` 는
 * `pathLength=100` 기준의 백분율(한 바퀴 = 100), `lead` 는 한 조각의 칸 안에서 선이 시작하는 각도(도),
 * `step` 은 조각 사이의 각도(도)다. 단위는 모두 SVG 의 사용자 단위(px)에서 나온다.
 */
export function ringGeometry(spec: {
  radius: number;
  stroke: number;
  gap: number;
  count: number;
}): {
  dash: number;
  lead: number;
  step: number;
} {
  const circumference = 2 * Math.PI * spec.radius;
  const dash = ((circumference / spec.count - spec.gap - spec.stroke) / circumference) * 100;
  const lead = ((spec.gap / 2 + spec.stroke / 2) / circumference) * 360;
  return { dash, lead, step: 360 / spec.count };
}

/** 통과한 항목 수 — 링 곁의 낭독 문장이 읽는다. */
export function gatesDone(passes: GatePasses): number {
  return GATE_ORDER.filter((key) => passes[key]).length;
}

/**
 * 통과 목록을 보고, 이번에 새로 통과한 항목과 갱신한 '본 적'을 돌려준다. 이미
 * 본 항목은 다시 새 것이 아니다 — 앱을 켰을 때 이미 통과한 항목이 튀지 않는
 * 이유다. 처음 볼 때는(빈 '본 적') 전부 이미 본 것으로 새긴다.
 */
export function takeFreshPasses(
  seen: ReadonlySet<GateKey> | null,
  passes: GateKey[],
): { fresh: GateKey[]; seen: Set<GateKey> } {
  if (seen === null) return { fresh: [], seen: new Set(passes) };
  const fresh = passes.filter((key) => !seen.has(key));
  return { fresh, seen: new Set([...seen, ...passes]) };
}

/** 가져오기 진행의 채움 비율(0~100) — 진행기가 아는 만큼만 보여 준다. */
export function inviteProgress(done: number, total: number): number {
  if (total <= 0) return 100;
  return Math.min(100, Math.max(0, Math.round((done / total) * 100)));
}

/**
 * 테마 미리보기가 입을 팔레트 — 시스템 따르기는 밝음과 어두움의 반반으로
 * 말하고, 나머지는 자기 팔레트 한 장이다.
 */
export function themePeekHalves(choice: "system" | string): string[] {
  return choice === "system" ? ["light", "dark"] : [choice];
}

/**
 * 겹이 닫히는 동안 기다리는 시간 — 역방향 pop 의 길이다. 움직임을 끈 창은
 * 기다리지 않는다(0 은 곧바로 닫는다는 뜻).
 */
export function modalCloseMs(reducedMotion: boolean): number {
  return reducedMotion ? 0 : 120;
}
