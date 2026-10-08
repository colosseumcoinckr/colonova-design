import type { ProjectSummary } from "@colonova-design/protocol";

/**
 * 첫 준비가 끝난 순간을 알아보는 판정(2026-10-07 베타 준비 분석 · 첫 5분). 첫 프로젝트의 첫 준비는 3~5분이고, 그동안
 * 사용자는 홈에 있다 — 미리보기 칸이 숨어 화면이 아무 말도 하지 않았다. 그래서 웹이 `phase` 가 첫 준비에서 `ready` 로
 * 바뀌는 순간을 보고, 사용자가 그 프로젝트의 작업 화면을 보고 있지 않을 때(홈이거나 다른 프로젝트) 앱 안에서 말한다 —
 * 토스트 한 번과 홈의 `화면 보기` 줄. 데몬은 사용자가 어느 화면을 보는지 모르니 이 판정은 웹의 몫이다(OS 알림은 창이
 * 뒤에 있을 때 데몬 · 데스크톱이 낸다 — `ready-notice.ts` · `notify-policy.ts`).
 *
 * 순수 모듈 — 단위 시험이 src 에서 곧장 읽는다(형제를 부르지 않는다).
 */

/**
 * 첫 준비를 지켜보는 프로젝트 — 데몬이 첫 준비 중이라고 말하는(`firstPrep`) 동안 켜지고 `ready` 에 닿으면 꺼진다. 데몬이
 * 판정의 주인이다: `phase` 만으로는 앱을 다시 켤 때의 준비(최신화 · 재설치)와 갈리지 않고(손대지 않은 프로젝트는 준비된
 * 것이어도 `missing` 으로 온다), 창이 준비 도중에 켜져도 놓치지 않는다. 앱을 켤 때마다 말하지 않게, 이미 준비된
 * 프로젝트의 다시 준비는 지켜보지 않는다. 오류는 지켜보기를 끄지 않는다(AI 가 고쳐 다시 돌린 준비도 첫 준비다 —
 * 데몬의 표식이 이어진다). 목록에서 사라진 프로젝트는 거둔다.
 */
export function stepFirstPrep(
  watching: ReadonlySet<string>,
  projects: ReadonlyArray<Pick<ProjectSummary, "slug" | "phase" | "firstPrep">>,
): { watching: Set<string>; finished: string[] } {
  const next = new Set<string>();
  const finished: string[] = [];
  for (const { slug, phase, firstPrep } of projects) {
    if (firstPrep === true) next.add(slug);
    else if (phase === "ready") {
      if (watching.has(slug)) finished.push(slug);
    } else if (watching.has(slug)) next.add(slug);
  }
  return { watching: next, finished };
}

/** 사용자가 어디를 보고 있는가 — 셸의 이동 상태와 활성 프로젝트, 창 모양. */
export interface SeenView {
  view: "home" | "thread";
  tab: "chat" | "preview";
  narrow: boolean;
  activeSlug: string | null;
}

/**
 * 이 프로젝트의 서비스 화면이 눈앞에 있는가 — 활성 프로젝트의 작업 화면이 열려 있고, 좁은 창이면 화면 탭이 앞에 있을 때.
 * 좁은 창의 대화 탭은 준비 진행 카드를 가리므로 보고 있는 것이 아니다.
 */
export function seesScreen(seen: SeenView, slug: string): boolean {
  return (
    seen.view === "thread" && seen.activeSlug === slug && (!seen.narrow || seen.tab === "preview")
  );
}

/**
 * 알린 것(`ready`)의 다음 모습과 지금 말할 것(`announce`). 새로 끝난 프로젝트 중 화면을 안 보고 있는 것을 얹고,
 * 지금 화면을 보게 된 프로젝트(이미 본 것이다)와 더는 떠 있지 않은 프로젝트(목록에서 사라졌거나 서버가 다시 준비 중이다 —
 * `떴어요` 가 거짓이 된다)는 거둔다. 지금 그 화면을 보고 있는 채로 끝난 프로젝트는 말하지 않는다 — 화면이 이미 말한다
 * (준비 카드의 마무리 장). `up` 은 지금 `ready` 인 프로젝트의 slug 다.
 */
export function nextReady(input: {
  ready: readonly string[];
  finished: readonly string[];
  up: readonly string[];
  seen: SeenView;
}): { ready: string[]; announce: string[] } {
  const { ready, finished, up, seen } = input;
  const announce = finished.filter((slug) => up.includes(slug) && !seesScreen(seen, slug));
  const merged = [...ready, ...announce.filter((slug) => !ready.includes(slug))];
  return {
    ready: merged.filter((slug) => up.includes(slug) && !seesScreen(seen, slug)),
    announce,
  };
}

/** 두 목록이 같은가(순서까지) — 같으면 상태를 갈지 않는다. */
export function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((slug, index) => slug === b[index]);
}
