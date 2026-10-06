/**
 * 홈 입력창 아래의 시작점(2026-10-06 홈 개선 — QA 보고서 제안 6 `프로젝트별 요청 시작점`).
 * 칩을 눌러도 보내지 않는다 — 입력창에 고쳐 쓸 초안이 담길 뿐이다. 이번 작업이 만진 화면을 알면
 * 초안이 그 화면의 이름을 말하고, 모르면 어느 서비스에나 맞는 말로 선다.
 *
 * 문장은 `labels.ts`(`L.home.starters`)에서 오지만 이 파일은 그것을 부르지 않고 인자로 받는다 —
 * 단위 시험이 src 에서 곧장 읽는 순수 모듈은 형제를 부르지 않는다(journey.ts 와 같은 규칙).
 */

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
