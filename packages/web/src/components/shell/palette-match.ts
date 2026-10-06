/**
 * 찾기(⌘K) 창의 걸음 판정 — 순위와 친 글자의 위치. 순수 모듈이라 시험이 곧장
 * 읽는다(next/ 의 순수 판정과 같은 계약 — 형제를 부르지 않는다).
 *
 * 한글은 두 가지로 더 너그럽다(2026-10-06 겹판 조사 — 한글을 치는 동안 음절마다 목록이
 * 비었다 돌아오던 것):
 * ① 마지막 글자는 아직 조합 중일 수 있다 — `결ㅈ` · `전` 은 `결제` · `저녁` 에 맞는다.
 *    받침이 다음 글자의 초성으로 넘어가는 순간(`한` → `하나`)과 겹모음 · 겹받침이 자라는 순간
 *    (`오` → `와` · `갑` → `값`)까지 센다. 앞 글자들은 이미 끝난 글자라 글자 그대로만 맞는다.
 * ② 홀로 선 자음은 초성이다 — `ㄱㅈ` 은 `결제` 에, `ㄱㅈㄴㅇ` 은 `결제 내역` 에 맞는다(띄어쓰기는
 *    묻지 않는다).
 * 맞은 자리는 늘 글자(음절) 경계다 — 하이라이트가 글자를 쪼개지 않는다.
 *
 * 한글 낱자는 `labels.ts` 밖에 한글 리터럴을 둘 수 없으니 코드 포인트 표로 적는다.
 */

const SYLLABLE_FIRST = 0xac00;
const SYLLABLE_LAST = 0xd7a3;
const MEDIALS = 21;
const FINALS = 28;

/** 호환 자모의 초성 19자(ㄱ ㄲ ㄴ ㄷ ㄸ ㄹ ㅁ ㅂ ㅃ ㅅ ㅆ ㅇ ㅈ ㅉ ㅊ ㅋ ㅌ ㅍ ㅎ) — 순서가 초성 번호다. */
const INITIAL_JAMO = [
  0x3131, 0x3132, 0x3134, 0x3137, 0x3138, 0x3139, 0x3141, 0x3142, 0x3143, 0x3145, 0x3146, 0x3147,
  0x3148, 0x3149, 0x314a, 0x314b, 0x314c, 0x314d, 0x314e,
];
const INITIAL_OF = new Map<number, number>(
  INITIAL_JAMO.map((jamo, index): [number, number] => [jamo, index]),
);

/** 홑받침 번호 → 같은 자음의 초성 번호(받침이 다음 글자의 초성으로 넘어갈 때). */
const FINAL_AS_INITIAL: Record<number, number> = {
  1: 0,
  2: 1,
  4: 2,
  7: 3,
  8: 5,
  16: 6,
  17: 7,
  19: 9,
  20: 10,
  21: 11,
  22: 12,
  23: 14,
  24: 15,
  25: 16,
  26: 17,
  27: 18,
};

/** 겹받침 번호 → [남는 홑받침 번호, 다음 글자로 넘어가는 초성 번호]. */
const COMPOUND_FINAL: Record<number, [number, number]> = {
  3: [1, 9],
  5: [4, 12],
  6: [4, 18],
  9: [8, 0],
  10: [8, 6],
  11: [8, 7],
  12: [8, 9],
  13: [8, 16],
  14: [8, 17],
  15: [8, 18],
  18: [17, 9],
};

/** 모음 번호 → 거기서 자라는 겹모음 번호(ㅗ → ㅘ ㅙ ㅚ · ㅜ → ㅝ ㅞ ㅟ · ㅡ → ㅢ). */
const VOWEL_GROWS: Record<number, number[]> = { 8: [9, 10, 11], 13: [14, 15, 16], 18: [19] };

const syllable = (initial: number, medial: number, final: number) =>
  SYLLABLE_FIRST + (initial * MEDIALS + medial) * FINALS + final;

/** 그 초성으로 시작하는 모든 글자의 코드 포인트 구간. */
const initialRange = (initial: number): [number, number] => [
  syllable(initial, 0, 0),
  syllable(initial, MEDIALS - 1, FINALS - 1),
];

const isSyllable = (cp: number) => cp >= SYLLABLE_FIRST && cp <= SYLLABLE_LAST;
const isHangul = (cp: number) => isSyllable(cp) || (cp >= 0x3131 && cp <= 0x3163);

/** 글자 하나가 받는 것 — 코드 포인트 구간들, 그리고 받침이 넘어간 두 글자 꼴(`각` → `가` + 초성 ㄱ). */
interface Spec {
  ranges: Array<[number, number]>;
  carry?: { head: number; next: [number, number] };
}

/** 코드 포인트 목록을 이어진 구간으로 묶는다. */
function compress(points: number[]): Array<[number, number]> {
  const sorted = [...new Set(points)].sort((a, b) => a - b);
  const out: Array<[number, number]> = [];
  for (const point of sorted) {
    const last = out[out.length - 1];
    if (last && point === last[1] + 1) last[1] = point;
    else out.push([point, point]);
  }
  return out;
}

/** 조합 중일 수 있는 마지막 글자 — 이 글자가 될 수 있는 글자들. */
function composingSpec(cp: number): Spec {
  const at = cp - SYLLABLE_FIRST;
  const final = at % FINALS;
  const medial = Math.floor(at / FINALS) % MEDIALS;
  const initial = Math.floor(at / (FINALS * MEDIALS));
  // 받침이 없으면 모음이 겹모음으로 자라거나 받침이 붙을 수 있고, 받침이 있으면 겹받침으로만 자란다.
  const medials = final === 0 ? [medial, ...(VOWEL_GROWS[medial] ?? [])] : [medial];
  const finals =
    final === 0
      ? Array.from({ length: FINALS }, (_, index) => index)
      : [
          final,
          ...Object.entries(COMPOUND_FINAL)
            .filter(([, [first]]) => first === final)
            .map(([compound]) => Number(compound)),
        ];
  const points = medials.flatMap((m) => finals.map((f) => syllable(initial, m, f)));
  const spec: Spec = { ranges: compress(points) };
  const compound = COMPOUND_FINAL[final];
  const moved = FINAL_AS_INITIAL[final];
  if (compound) {
    spec.carry = { head: syllable(initial, medial, compound[0]), next: initialRange(compound[1]) };
  } else if (moved !== undefined) {
    spec.carry = { head: syllable(initial, medial, 0), next: initialRange(moved) };
  }
  return spec;
}

/**
 * 쓴 글자 하나(코드 포인트)가 글에서 받는 것. `last` — 아직 조합 중일 수 있는 마지막 글자.
 * `initials` 가 꺼지면 마지막이 아닌 홀로 선 자음은 초성이 아니라 글자 그대로다(긴 글 속의 초성
 * 찾기는 어느 글에나 맞아 소음이다).
 */
function specOf(cp: number, last: boolean, initials: boolean): Spec {
  const initial = INITIAL_OF.get(cp);
  if (initial !== undefined && (initials || last)) {
    return { ranges: [[cp, cp], initialRange(initial)] };
  }
  if (last && isSyllable(cp)) return composingSpec(cp);
  return { ranges: [[cp, cp]] };
}

/** 쓴 말을 글자별 `Spec` 으로 — 띄어쓰기는 건너뛴다(글 쪽 띄어쓰기도 묻지 않는다). */
function specsOf(query: string, initials = true): Spec[] {
  const points = [...query].filter((ch) => ch.trim() !== "").map((ch) => ch.codePointAt(0) ?? 0);
  return points.map((cp, index) => specOf(cp, index === points.length - 1, initials));
}

const accepts = (spec: Spec, cp: number) =>
  spec.ranges.some(([from, to]) => cp >= from && cp <= to);

const unicode = (cp: number) => `\\u{${cp.toString(16)}}`;
const classOf = (ranges: Array<[number, number]>) =>
  `[${ranges.map(([from, to]) => (from === to ? unicode(from) : `${unicode(from)}-${unicode(to)}`)).join("")}]`;

/** 글자 사이의 띄어쓰기를 묻지 않는 정규식 — 이어진 덩이(`결ㅈ` → `결제`)를 찾는다. */
function patternOf(specs: Spec[]): RegExp {
  const source = specs
    .map((spec) =>
      spec.carry
        ? `(?:${classOf(spec.ranges)}|${unicode(spec.carry.head)}\\s*${classOf([spec.carry.next])})`
        : classOf(spec.ranges),
    )
    .join("\\s*");
  return new RegExp(source, "u");
}

const compiled = new Map<string, RegExp | null>();

/** 한글이 든 말만 글자 규칙을 쓴다 — 그 밖은 글자 그대로의 찾기뿐이다. 같은 말은 한 번만 짠다. */
function looseRange(query: string, text: string, initials = true): [number, number] | null {
  const key = `${initials ? "i" : "c"}:${query}`;
  let pattern = compiled.get(key);
  if (pattern === undefined) {
    const specs = [...query].some((ch) => isHangul(ch.codePointAt(0) ?? 0))
      ? specsOf(query, initials)
      : [];
    pattern = specs.length > 0 ? patternOf(specs) : null;
    if (compiled.size > 64) compiled.clear();
    compiled.set(key, pattern);
  }
  if (!pattern) return null;
  const found = pattern.exec(text);
  return found ? [found.index, found.index + found[0].length] : null;
}

/** 글자가 차례로 흩어져 있어도 맞는가 — 앞에서부터 한 번 훑는다(되돌아가지 않아 글이 길어도 느려지지 않는다). */
function scatters(query: string, text: string): boolean {
  const specs = specsOf(query);
  if (specs.length === 0) return false;
  let at = 0;
  for (const ch of text) {
    const spec = specs[at];
    if (spec && accepts(spec, ch.codePointAt(0) ?? 0)) at += 1;
    if (at === specs.length) return true;
  }
  return false;
}

/**
 * 순위(작을수록 앞): 1 글자 그대로 맞고 처음부터 · 2 글자 그대로 맞고 중간 · 3 한글 규칙으로
 * 맞고 처음부터 · 4 한글 규칙으로 맞고 중간 · 5 글자가 흩어져 맞음 · -1 맞지 않음. 빈 말은 0 이다.
 * 한글 규칙으로 맞은 것은 글자 그대로 맞은 것의 뒤에 서지만 같은 차례(처음 · 중간)를 지킨다 —
 * 한글을 치는 동안 목록의 차례가 음절마다 뒤섞이지 않는다.
 */
export function rank(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at >= 0) return at === 0 ? 1 : 2;
  const loose = looseRange(q, t);
  if (loose) return loose[0] === 0 ? 3 : 4;
  return scatters(q, t) ? 5 : -1;
}

/**
 * 친 글자의 자리 — 결과에서 `<mark>` 로 묶을 한 덩이. 접두 · 중간 어느 쪽이든 이어진 덩이로
 * 있고(한글 규칙으로 맞은 것도 글자 경계로 끊는다), 흩어져 맞은 차례(rank 5)는 한 덩이로 될 수
 * 없으니 비운다. 찾는 말이 비었으면 하이라이트도 없다. `initials: false` — 대화 내용 같은 긴
 * 글에서는 가운데의 홀로 선 자음을 초성으로 읽지 않는다(어느 글에나 맞는다).
 */
export function matchRange(
  query: string,
  text: string,
  options: { initials?: boolean } = {},
): [number, number] | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const t = text.toLowerCase();
  const at = t.indexOf(q);
  if (at >= 0) return [at, at + q.length];
  return looseRange(q, t, options.initials ?? true);
}

/**
 * 긴 글에서 맞은 자리가 보이는 조각 — 앞뒤를 `…` 로 자르고, 맞은 자리를 조각 안의 자리로 옮겨
 * 준다. 맞은 자리를 모르면 앞에서부터 자른다. 한 줄로 말줄임되는 제목이 맞은 조각을 말줄임
 * 뒤에 숨기지 않게 한다.
 */
export function excerptAround(
  text: string,
  range: [number, number] | null,
  lead = 24,
  tail = 56,
): { text: string; range: [number, number] | null } {
  const ellipsis = "…";
  if (!range) {
    const end = lead + tail;
    return { text: text.length > end ? `${text.slice(0, end)}${ellipsis}` : text, range: null };
  }
  const start = Math.max(0, range[0] - lead);
  const end = Math.min(text.length, range[1] + tail);
  const before = start > 0 ? ellipsis : "";
  const after = end < text.length ? ellipsis : "";
  const shift = before.length - start;
  return {
    text: `${before}${text.slice(start, end)}${after}`,
    range: [range[0] + shift, range[1] + shift],
  };
}

/** 입력칸의 커서가 처음 · 끝에 서 있는가 — 글 일부를 골라 둔 동안은 어느 쪽도 아니다. */
export function caretEdge(
  value: string,
  from: number | null,
  to: number | null,
): { start: boolean; end: boolean } {
  const a = from ?? 0;
  const b = to ?? a;
  return { start: a === 0 && b === 0, end: a === value.length && b === value.length };
}

/**
 * 화살표 한 번이 하이라이트를 옮기는 곳 — 대화·프로젝트 줄 다음에 명령 칩이 이어 서서
 * 한 줄로 걷는다(`index` 는 그 한 줄의 자리: 줄이 `rows` 개, 그 뒤로 칩이 `commands` 개.
 * 걸을 곳을 아직 고르지 않았으면 -1). ↑↓ 는 끝에서도 그 자리에 머물며 키를 가져간다 — 입력칸의
 * 커서가 처음 · 끝으로 튀지 않게. 칩은 가로로 서 있어 칩 위에서는 ←/→ 도 걷는데, 실제로 옮겨
 * 갈 때만 가져가고 끝에서는 null 을 돌려 입력칸의 커서에 남긴다. Home/End 는 입력칸의 키이기도
 * 하다 — 커서가 그 가장자리에 서 있을 때만(`edge`) 줄 처음 · 끝으로 걷고, 아니면 입력칸의 커서가
 * 쓴다(친 글 가운데서 End 가 목록 끝으로 날아가 Enter 가 엉뚱한 것을 열던 것, 2026-10-06 겹판 조사).
 * 이미 그 자리에 하이라이트가 서 있어도 null. 걸음의 일이 아닌 키도 null.
 */
export function stepWalk(
  key: string,
  index: number,
  rows: number,
  commands: number,
  edge: { start: boolean; end: boolean } = { start: true, end: true },
): number | null {
  const total = rows + commands;
  if (key === "ArrowDown") return Math.min(index + 1, Math.max(0, total - 1));
  if (key === "ArrowUp") return Math.max(index - 1, 0);
  if (key === "Home") return edge.start && total > 0 && index !== 0 ? 0 : null;
  if (key === "End") return edge.end && total > 0 && index !== total - 1 ? total - 1 : null;
  // ←/→ 는 칩의 것이다 — 줄 위에서는 입력칸의 커서가 쓴다.
  if (index < rows) return null;
  if (key === "ArrowRight") return index < total - 1 ? index + 1 : null;
  if (key === "ArrowLeft") return index > rows ? index - 1 : null;
  return null;
}
