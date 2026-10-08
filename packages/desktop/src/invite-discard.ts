import { isAbsolute } from "node:path";

// 이 파일은 다른 desktop 파일을 가져오지 않는다 — 데몬의 시험(`invite-discard.test.ts`)이 src 경로로 곧장 읽고,
// node 의 타입 지우기는 src 안의 `.js` 지정자를 풀지 못한다. 그래서 거절 문장도 여기 둔다(copy.ts 의 BRIDGE 가 아니다).

/** 앱이 대신 지우거나 열 수 있는 파일의 끝 — 웹의 isInviteFile 과 같은 잣대다. */
export const INVITE_SUFFIX = ".colonova-invite";

/**
 * 초대 파일 경로의 판정 하나 — 지우기와 열기(더블클릭, 2026-10-08)가 같은 잣대를 쓴다. 건네받은 값은
 * 믿지 않는다: 문자열이고, NUL 이 없고, 절대 위치이고, 초대 파일의 확장자로 끝나야 한다. 없으면 null.
 * `api` 는 시험이 다른 OS 의 경로 규칙(Windows 의 `C:\`)을 끼워 넣는 자리다 — 실행에서는 이 OS 의 것이다.
 */
export function invitePathProblem(
  path: unknown,
  api: { isAbsolute(path: string): boolean } = { isAbsolute },
): "missing" | "not-invite" | null {
  if (typeof path !== "string" || path.trim() === "" || path.includes("\0")) return "missing";
  if (!api.isAbsolute(path)) return "missing";
  if (!path.endsWith(INVITE_SUFFIX)) return "not-invite";
  return null;
}

/**
 * 초대 파일 지우기(PLAN-UI U11)를 거절할 이유 — 없으면 null. 렌더러가 건넨
 * 값은 믿지 않는다(위의 판정). 이 문 뒤에서도 지우기는 OS 휴지통으로 옮기기뿐이다(되살릴 수 있게).
 */
export function inviteDiscardRefusal(path: unknown): string | null {
  const problem = invitePathProblem(path);
  if (problem === "missing") return "지울 초대 파일을 찾지 못했어요.";
  if (problem === "not-invite") return "초대 파일만 지울 수 있어요.";
  return null;
}
