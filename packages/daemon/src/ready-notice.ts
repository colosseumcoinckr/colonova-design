import type { RepoPhase } from "@colonova-design/protocol";

/**
 * 처음 여는 프로젝트의 준비가 배경에서 끝났는가(PLAN-UI U8 · P5) — 상태가
 * 움직일 때마다 한 번 부른다. `watching` 은 이 프로젝트가 첫 준비 중인가다:
 * 내려받기(cloning)를 본 순간 켜지고, `ready` 에 닿는 순간 꺼진다. 알림은
 * 켜진 채로 `ready` 에 닿은 한 번뿐이다 — 이미 준비된 프로젝트의 다시 준비
 * (최신화 · 재설치)는 내려받기를 지나지 않으므로 부르지 않는다.
 * 오류는 지켜보기를 끄지 않는다 — AI 가 고쳐 다시 돌린 준비도 첫 준비다.
 *
 * 2026-10-07(베타 준비 분석 · 첫 5분): 지금 보고 있는 프로젝트도 알린다. 예전에는 `보고 있는 프로젝트는 화면이 이미
 * 말한다` 며 활성이 아닌 프로젝트에만 알렸지만, 첫 프로젝트는 늘 활성이고 사용자는 그동안 홈에 있다(미리보기 칸이
 * 숨는다) — 화면이 아무 말도 하지 않았다. 데몬은 사용자가 홈을 보는지 작업 화면을 보는지, 앱 창이 앞에 있는지를 모른다.
 * 그래서 이 판정은 `activeSlug` 를 읽지 않고, 받는 쪽이 자기가 아는 것으로 거른다 — 데스크톱은 창이 앞에 있으면 OS
 * 알림을 내지 않고(`app-notify.ts` · `notify-policy.ts`), 웹은 그 프로젝트의 작업 화면을 보고 있지 않을 때만 앱 안에서
 * 말한다(`next/lib/ready-watch.ts`).
 */
export function nextReadyWatch(
  watching: boolean,
  phase: RepoPhase,
): { watching: boolean; notify: boolean } {
  if (phase === "cloning") return { watching: true, notify: false };
  if (phase === "ready") return { watching: false, notify: watching };
  return { watching, notify: false };
}
