/**
 * 홈 입력창 아래의 시작점(2026-10-06 홈 개선 — QA 보고서 제안 6 `프로젝트별 요청 시작점`).
 * 칩을 눌러도 보내지 않는다 — 입력창에 고쳐 쓸 초안이 담길 뿐이다. 이번 작업이 만진 화면을 알면
 * 초안이 그 화면의 이름을 말하고, 모르면 어느 서비스에나 맞는 말로 선다.
 *
 * 2026-10-07(베타 준비 분석 · 첫 5분): 처음 켠 서비스에는 만진 화면이 없다 — 준비가 끝나면 데몬이 읽어 온 서비스의
 * 첫 화면(`RepoStatus.firstScreen`)의 이름으로 선다(`firstScreenName`). 그 제목이 개발 흔적이면 쓰지 않는다.
 *
 * 문장은 `labels.ts`(`L.home.starters`)에서 오지만 이 파일은 그것을 부르지 않고 인자로 받는다 —
 * 단위 시험이 src 에서 곧장 읽는 순수 모듈은 형제를 부르지 않는다(journey.ts 와 같은 규칙). 유일한 이웃은 제목을
 * 화면 이름으로 가르는 순수 함수(`lib/turn-screens.ts`)이고, 확장자를 붙여 부른다.
 */

import { screenNameOfTitle } from "../../lib/turn-screens.ts";

/** 칩의 종류 — 앞에서부터 이 차례로 선다. 그림은 부르는 쪽이 이 열쇠로 고른다. */
export const STARTER_KEYS = ["words", "empty", "phone", "tidy"] as const;
export type StarterKey = (typeof STARTER_KEYS)[number];

/**
 * 칩마다의 문장 — `screen` 은 이번 작업이 만진 화면의 이름(모르면 null). `blank` 는 화면 이름을 모를 때
 * 초안 속에서 이름 자리를 대신 서는 낱말(`화면` · `목록`) — 초안이 담기면 이 자리가 선택돼 바로 바꿔 칠 수 있다.
 */
export type StarterWords = Record<
  StarterKey,
  { label: string; blank: string; draft: (screen: string | null) => string }
>;

export interface Starter {
  key: StarterKey;
  label: string;
  /** 눌렀을 때 입력창에 담기는 초안 — 그대로 보내도 말이 되고, 고쳐 써도 된다. */
  text: string;
  /**
   * 담긴 뒤 선택해 둘 자리(`text` 안의 [시작, 끝)) — 화면 이름(모르면 대신 서는 낱말)이다. 첫 글자를 치면
   * 그 이름이 바뀌어, 입력창을 눌러 커서를 옮기지 않고도 어느 화면인지 말할 수 있다. 못 찾으면 null.
   */
  pick: [number, number] | null;
}

/** 초안에 이름으로 들어갈 화면 제목의 긴 쪽 한도 — 이보다 길면 문장을 어지럽힌다. */
const SCREEN_NAME_MAX = 24;
/** 이름을 따옴표로 감싸 쓰므로 제목 안의 따옴표는 걷는다. */
const QUOTES = "‘’“”\"'";

/** 화면 제목을 초안에 쓸 이름으로 — 쓸 수 없으면 null(비었거나 길거나 여러 줄). */
export function usableScreen(title: string | null | undefined): string | null {
  if (!title) return null;
  const name = Array.from(title)
    .filter((ch) => !QUOTES.includes(ch))
    .join("")
    .trim();
  if (name === "" || name.includes("\n") || Array.from(name).length > SCREEN_NAME_MAX) return null;
  return name;
}

// 한글 자모 · 호환 자모 · 음절 — 정규식 안에 한글을 직접 쓰면 문장 검사(`next-labels`)의 토크나이저가 속아 이스케이프로 쓴다.
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
/** 스캐폴드가 남기는 기본 제목에 늘 끼는 프레임워크 이름 — 서비스의 화면 이름이 아니다. */
const FRAMEWORKS =
  /\b(vite|react|vue|next(\.js)?|nuxt|svelte(kit)?|astro|angular|solid(js)?|preact|webpack|parcel|expo|remix)\b/i;
/** 이름이 못 되는 낱말 — 파일 · 상태 · 기본 제목. 한글 `제목 없음`(\uc81c\ubaa9\s*\uc5c6\uc74c)도 같다. */
const NOT_A_NAME =
  /^(index|page|app|main|test|document|undefined|null|untitled( document)?|localhost(:\d+)?|loading(\.\.\.|\u2026)?|redirecting(\.\.\.|\u2026)?|not found|404|error|\uc81c\ubaa9\s*\uc5c6\uc74c)$/i;

/**
 * 개발 흔적처럼 보이는 이름인가 — 사람이 서비스의 화면을 부르는 말이 아니다. 스캐폴드의 기본 제목(`Vite + React` ·
 * `Create Next App`), 파일 · 경로 이름(`index.html` · `/login`), 주소(`localhost:3000`), 패키지 이름꼴(`my-vite-app` ·
 * `myApp`), 상태 낱말(`Loading…` · `404`)이다. 한글이 든 이름은 사람의 말로 본다 — 한글 서비스의 화면 제목이 압도적이고,
 * 영어 제목은 흔적일 위험이 커서 이 문턱은 일부러 영어 쪽을 더 깐깐하게 둔다(틀리면 칩이 일반 문장으로 설 뿐이다).
 */
export function looksLikeDevTrace(name: string): boolean {
  if (NOT_A_NAME.test(name)) return true;
  // 풀리지 않은 HTML 개체(`&unknown;`)가 남은 제목은 믿을 수 없다 — 이름이 아니라 깨진 글자다.
  if (/&#?[a-z0-9]+;/i.test(name)) return true;
  if (HANGUL.test(name)) return false;
  return (
    FRAMEWORKS.test(name) ||
    /[/\\]|\.(html?|[jt]sx?|vue|svelte|astro|md|php)$/i.test(name) ||
    /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(name) ||
    /^[a-z0-9]+([-_][a-z0-9]+)+$/.test(name) ||
    /^[a-z]+([A-Z][a-z0-9]+)+$/.test(name)
  );
}

/**
 * 서비스의 첫 화면(`RepoStatus.firstScreen` — 준비가 끝난 미리보기의 첫 주소와 문서가 단 제목)이 초안에 쓸 이름이면 그
 * 이름, 아니면 null. 제목은 `화면명 · 앱 이름` 꼴이 흔해 첫 조각만 쓰고, 초안의 규칙(`usableScreen` — 24자 · 따옴표 ·
 * 한 줄)을 지키며, 개발 흔적(`looksLikeDevTrace`)이면 쓰지 않는다. 모르면 null — 칩은 지금의 일반 문장 그대로 선다.
 */
export function firstScreenName(
  first: { path: string; title: string } | null | undefined,
): string | null {
  if (!first) return null;
  const name = usableScreen(screenNameOfTitle(first.title));
  return name === null || looksLikeDevTrace(name) ? null : name;
}

/** 이번 작업이 가장 나중에 만진 화면의 이름 — 아는 것이 없으면 null. */
export function recentScreenName(
  screens: ReadonlyArray<{ title: string; at: string }> | null | undefined,
): string | null {
  let best: { name: string; at: number } | null = null;
  for (const screen of screens ?? []) {
    const name = usableScreen(screen.title);
    if (name === null) continue;
    const at = Date.parse(screen.at);
    const stamp = Number.isFinite(at) ? at : 0;
    if (best === null || stamp >= best.at) best = { name, at: stamp };
  }
  return best === null ? null : best.name;
}

/** 칩 네 개 — 같은 `screen` 이면 늘 같은 차례 · 같은 문장이다. */
export function startersOf(screen: string | null, words: StarterWords): Starter[] {
  return STARTER_KEYS.map((key) => {
    const { label, blank, draft } = words[key];
    const text = draft(screen);
    const name = screen ?? blank;
    const at = text.indexOf(name);
    return { key, label, text, pick: at < 0 ? null : [at, at + name.length] };
  });
}
