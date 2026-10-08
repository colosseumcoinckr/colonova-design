import type { DaemonNotice } from "@colonova-design/daemon/server";

/**
 * 알림 정책(설정 문서 P0#3)의 결정부. 렌더러의 설정이 여기로 와서, 어떤
 * 순간이 사용자를 부를지 정한다.
 *
 * 규칙은 하나다: **부르는 값이 있는 순간은 언제나 부른다.** 확인 요청·중단·
 * 게이트 실패는 자리를 비운 사람이 돌아와야 하는 이유 그 자체라 시점 설정과
 * 무관하다. 고를 수 있는 것은 `완료`뿐이고, 그 기본은 "모든 턴"이다 — 완료를
 * 놓치는 쪽이 잦은 울림보다 비싸다고 판단했다(2026-10-06 사용자 요청).
 */

/** 완료 알림의 시점: 끔 / 오래 걸린 턴만 / 모든 턴(기본). */
type NoticeTiming = "off" | "long" | "all";

export interface NotificationPrefs {
  done: NoticeTiming;
  sound: boolean;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = { done: "all", sound: true };

/** "오래 걸린 턴"의 기준 — 웹 경로(daemon-client)와 같은 값이다. */
const LONG_TURN_MS = 60_000;

const TIMINGS: NoticeTiming[] = ["off", "long", "all"];

/** 렌더러가 넘긴 값을 믿지 않는다 — 못 쓰는 값은 기본으로 돌아간다. */
export function normalizeNotificationPrefs(value: unknown): NotificationPrefs {
  if (!value || typeof value !== "object") return { ...DEFAULT_NOTIFICATION_PREFS };
  const stored = value as Partial<NotificationPrefs>;
  return {
    done: TIMINGS.includes(stored.done as NoticeTiming)
      ? (stored.done as NoticeTiming)
      : DEFAULT_NOTIFICATION_PREFS.done,
    sound: typeof stored.sound === "boolean" ? stored.sound : DEFAULT_NOTIFICATION_PREFS.sound,
  };
}

/**
 * 이 순간이 알림이 되는가. 걸린 시간을 모르는 완료는 "오래 걸린" 쪽으로
 * 묶는다 — 알리지 않아 놓치는 쪽이 한 번 더 울리는 쪽보다 비싸다.
 */
export function shouldNotify(notice: DaemonNotice, prefs: NotificationPrefs): boolean {
  if (notice.kind !== "done") return true;
  if (prefs.done === "off") return false;
  if (prefs.done === "all") return true;
  return (notice.durationMs ?? LONG_TURN_MS) >= LONG_TURN_MS;
}

/**
 * 이 순간이 OS 알림으로 사용자를 부르는가 — 앱 창이 앞에 있으면 사용자가 이미 보고 있으니 어떤 알림도 내지 않는다
 * (앱 안의 알림이 말한다). 창이 뒤에 있으면 `shouldNotify` 가 판정한다.
 *
 * 2026-10-07(베타 준비 분석 · 첫 5분): 첫 준비가 끝났다는 소식(`ready`)도 이 길이다. 데몬은 지금 보고 있는 프로젝트에도
 * 이 소식을 보내고(`ready-notice.ts`), 창이 앞에 있는지는 여기서만 안다 — 활성 프로젝트의 준비가 끝났을 때 창이 뒤에
 * 있으면(다른 앱에서 기다리는 중) 알림이 나가고, 앞에 있으면 웹이 그 프로젝트의 작업 화면을 보고 있지 않을 때만 앱
 * 안에서 말한다(`next/lib/ready-watch.ts`). 한 순간에 두 신호가 겹치지 않는다.
 */
export function shouldInterrupt(
  notice: DaemonNotice,
  prefs: NotificationPrefs,
  windowFocused: boolean,
): boolean {
  if (windowFocused) return false;
  return shouldNotify(notice, prefs);
}
