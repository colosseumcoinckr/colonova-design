import type { FirstLook } from "@colonova-design/protocol";
import { photoUrl } from "./result-photos.ts";

/**
 * 서비스가 떴을 때의 첫 화면 사진(2026-10-07 베타 준비 분석 · 첫 5분) — 홈의 `서비스가 떴어요` 줄에 서는 한 장. 사진은
 * 있으면 좋은 것이라 모든 실패는 없는 것으로 친다: 못 찍었거나 · 그릴 수 없는 형식이거나 · 너무 크면 null, 줄은 사진 없이
 * 선다 — 깨진 그림을 세우지 않는다(`result-photos.ts` 의 같은 규칙). 순수 모듈 — 단위 시험이 src 에서 곧장 읽는다.
 */

/** 이 사진을 `<img src>` 로 — 그릴 수 없으면 null. */
export function firstLookUrl(look: FirstLook | null | undefined): string | null {
  return photoUrl(look?.image);
}

/** 기억하는 열쇠의 수 — 지금 프로젝트 하나면 되고, 몇 개 더는 프로젝트를 오갈 때를 위해. */
const KEPT = 4;
const asked = new Map<string, Promise<string | null>>();

/**
 * 같은 열쇠로는 한 번만 묻는다 — 홈이 오갈 때마다(홈은 들어올 때마다 새로 그려진다) 숨은 창을 다시 열지 않게. 묻다가
 * 실패한 것도 기억한다(사진이 안 나오는 서비스에 되풀이해 묻지 않는다). 열쇠는 서버가 새로 뜨면 달라진다.
 */
export function askFirstLook(key: string, ask: () => Promise<FirstLook>): Promise<string | null> {
  const known = asked.get(key);
  if (known) return known;
  const pending = Promise.resolve()
    .then(ask)
    .then(firstLookUrl, () => null);
  asked.set(key, pending);
  while (asked.size > KEPT) {
    const oldest = asked.keys().next().value;
    if (oldest === undefined) break;
    asked.delete(oldest);
  }
  return pending;
}

/** 기억을 비운다 — 시험이 쓴다. */
export function forgetFirstLooks(): void {
  asked.clear();
}
