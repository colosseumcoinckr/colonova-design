/**
 * 기획서와 화면을 서로 맞추는 자동 판정의 켜짐(2026-11-03 A안 1A-1 설정 토글). 기본은 켬이고 machine.json 에는
 * 끔(`"off"`)만 적힌다 — 잊기(null)가 곧 켬이다(`agentAutoUpdate` 와 같은 결). 끄면 같이 고치기 · 화면 제안의
 * 판정 호출 자체를 하지 않는다. 연결 · 근거 기록은 계속 쌓는다.
 */
export const PLAN_LOOP_KEY = "planLoop";

export function planLoopOn(setting: { get(key: string): string | null }): boolean {
  return setting.get(PLAN_LOOP_KEY) !== "off";
}
