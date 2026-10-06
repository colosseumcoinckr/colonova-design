/**
 * 단축키 시트의 순수 판정 — 행을 묶음으로 나누고, 키 표기를 키캡 조각으로 쪼갠다
 * (2026-10-06 겹판 손질). 형제 모듈을 부르지 않는다(시험이 src 에서 곧장 읽는다) —
 * 이 컴퓨터에 맞춘 표기(`keyHint`)는 부르는 쪽이 먼저 바꿔 건넨다.
 */

/** 시트가 읽는 행의 최소 모양 — 프로토콜의 `AppShortcut` 이 구조적으로 만족한다. */
export interface SheetRow {
  id: string;
  label: string;
  keys: string;
}

export interface SheetGroup<Key extends string, Row extends SheetRow> {
  key: Key;
  rows: Row[];
}

/**
 * 행의 묶음 — `layout` 이 정한 순서와 소속대로 나눈다. 어느 묶음에도 없는 행(프로토콜에
 * 새로 더해진 단축키)은 마지막 `rest` 묶음으로 간다: 표에 안 적었다고 시트에서 말없이
 * 사라지지 않게. 빈 묶음은 그리지 않는다.
 */
export function groupShortcuts<Key extends string, Row extends SheetRow>(
  rows: readonly Row[],
  layout: ReadonlyArray<{ key: Key; ids: readonly string[] }>,
  rest: Key,
): Array<SheetGroup<Key, Row>> {
  const placed = new Set(layout.flatMap((group) => group.ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const groups: Array<SheetGroup<Key, Row>> = layout.map((group) => ({
    key: group.key,
    rows: group.ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    }),
  }));
  const leftovers = rows.filter((row) => !placed.has(row.id));
  if (leftovers.length > 0) {
    const tail = groups.find((group) => group.key === rest);
    if (tail) tail.rows.push(...leftovers);
    else groups.push({ key: rest, rows: leftovers });
  }
  return groups.filter((group) => group.rows.length > 0);
}

/** 키캡의 한 조각 — `key` 는 눌러야 하는 키(캡으로), `word` 는 뜻을 말하는 낱말(글자로). */
export interface CapPart {
  kind: "key" | "word";
  text: string;
}

/** 수정 키 — mac 은 글리프(⌘ ⌥ ⇧), 그 밖의 컴퓨터는 이름(Ctrl · Alt · Shift)으로 적힌다. */
const MODIFIERS = /[⌘⌃⌥⇧]|\b(?:Ctrl|Alt|Shift)\b/;

/**
 * 한글 글자인가 — 자모 · 호환 자모 · 음절. 정규식 범위로 적지 않는다: `next/` 의 라벨 시험은
 * 정규식 리터럴을 모르는 토크나이저라 안의 한글을 문장으로 오인한다.
 */
function isHangul(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x1100 && code <= 0x11ff) ||
    (code >= 0x3130 && code <= 0x318f) ||
    (code >= 0xac00 && code <= 0xd7af)
  );
}

const hasHangul = (text: string): boolean => Array.from(text).some(isHangul);

/** 글리프(⌘ ⌥ ⇧)는 한 글자씩, 나머지 덩어리는 그대로 — `⌘⇧P` → `⌘` `⇧` `P`. */
function splitGlyphs(token: string): string[] {
  return token.match(/[⌘⌃⌥⇧]|[^⌘⌃⌥⇧]+/g) ?? [];
}

/**
 * 키 표기를 키캡 조각의 묶음으로 쪼갠다 — ` · ` 가 대안을 가르고, 대안 안은 `+` 와 글리프가
 * 조각을 가른다. 한글만 있는 대안(`끌면 영역` · `··· 메뉴`)은 눌러야 하는 키가 아니라 설명이라
 * 통째로 낱말 하나다. 한글 낱말이 키 사이에 끼면(`⌥+클릭`) 그 조각만 낱말이다.
 *
 * 입력은 이 컴퓨터에 맞춘 표기다 — mac 은 `⌘⇧P`, 그 밖은 `Ctrl+Shift+P`. 둘 다 같은 조각이
 * 된다(앞은 글리프로, 뒤는 `+` 로 갈린다).
 */
export function keyCaps(text: string): CapPart[][] {
  return text
    .split(" · ")
    .map((alternative) => alternative.trim())
    .filter((alternative) => alternative.length > 0)
    .map((alternative) => {
      const keyLike = MODIFIERS.test(alternative) || !hasHangul(alternative);
      if (!keyLike) return [{ kind: "word", text: alternative } satisfies CapPart];
      return alternative
        .replace(/\+\+/g, "+")
        .split("+")
        .flatMap((token) => splitGlyphs(token.trim()))
        .map((piece) => piece.trim())
        .filter((piece) => piece.length > 0)
        .map((piece): CapPart => ({ kind: hasHangul(piece) ? "word" : "key", text: piece }));
    });
}

/** 낭독용 한 줄 — 캡 조각을 `Ctrl + K` · `⌘ K` 처럼 이어 읽게 한다(대안은 `, `). */
export function capsLabel(caps: CapPart[][]): string {
  return caps.map((alternative) => alternative.map((part) => part.text).join(" ")).join(", ");
}
