import { type InviteSupport, parseSupport } from "@colonova-design/protocol";

/**
 * machine.json 의 창구 칸을 읽는 판정(2026-11-12 결정 ㉱ · 검토 WF-10) —
 * 저장소(MachineSetting)는 문자열 키·값만 알므로 JSON 문자열로 둔다. 깨진 값
 * (못 읽는 JSON · 배열 · 숫자 · `https://` 가 아닌 주소)은 없는 것으로
 * 읽는다 — 화면이 «개발팀»이라고만 말하는 쪽이 안전하다. 값 자체는 로그에
 * 남기지 않는다.
 */
export function machineSupportValue(raw: string | null): InviteSupport | null {
  if (raw === null) return null;
  try {
    return parseSupport(JSON.parse(raw)) ?? null;
  } catch {
    return null;
  }
}
