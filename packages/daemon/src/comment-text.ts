/**
 * 코멘트의 글과 저장 포맷(2026-10-23 · 최종 구현 계획 F4 · 오케스트레이터 검토).
 *
 * - 앱은 코멘트를 맨 글로 쓴다 — 줄마다 문단 하나다(`commentStorage`). 마크다운은 해석하지 않는다.
 * - 읽을 때는 저장 포맷을 사람이 읽는 글로 푼다(`commentText`). 멘션은 `@이름` 으로 선다.
 * - 앱에서 고칠 수 있는 코멘트는 문단 · 줄바꿈 · 글뿐인 것이다(`commentIsPlain`). 서식 · 링크 ·
 *   멘션이 든 코멘트를 맨 글로 고치면 그것들이 사라진다 — 그런 코멘트는 Confluence 에서 고친다.
 * - 인라인 닻은 원문의 글에서 센다(`anchorCount`). 화면의 글과 원문의 글은 세는 법이 달라 몇 번째인지를
 *   믿을 수 없다 — 원문에 한 번만 나오는 문장만 잇는다.
 */

/**
 * 이름이 붙는 엔티티 — ISO-8859-1 의 이름 전부(nbsp … yuml · 160–255)와 흔한 기호. 모르는 이름은
 * 그대로 둔다 — 양쪽이 같은 표지로 견주어진다(2026-10-23 2차 검토 R3 발견 2).
 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  // ISO-8859-1 의 이름 엔티티 — 160(nbsp) 부터 255(yuml) 까지 순서대로.
  nbsp: "\u00a0",
  iexcl: "¡",
  cent: "¢",
  pound: "£",
  curren: "¤",
  yen: "¥",
  brvbar: "¦",
  sect: "§",
  uml: "¨",
  copy: "©",
  ordf: "ª",
  laquo: "«",
  not: "¬",
  shy: "\u00ad",
  reg: "®",
  macr: "¯",
  deg: "°",
  plusmn: "±",
  sup2: "²",
  sup3: "³",
  acute: "´",
  micro: "µ",
  para: "¶",
  middot: "·",
  cedil: "¸",
  sup1: "¹",
  ordm: "º",
  raquo: "»",
  frac14: "¼",
  frac12: "½",
  frac34: "¾",
  iquest: "¿",
  Agrave: "À",
  Aacute: "Á",
  Acirc: "Â",
  Atilde: "Ã",
  Auml: "Ä",
  Aring: "Å",
  AElig: "Æ",
  Ccedil: "Ç",
  Egrave: "È",
  Eacute: "É",
  Ecirc: "Ê",
  Euml: "Ë",
  Igrave: "Ì",
  Iacute: "Í",
  Icirc: "Î",
  Iuml: "Ï",
  ETH: "Ð",
  Ntilde: "Ñ",
  Ograve: "Ò",
  Oacute: "Ó",
  Ocirc: "Ô",
  Otilde: "Õ",
  Ouml: "Ö",
  times: "×",
  Oslash: "Ø",
  Ugrave: "Ù",
  Uacute: "Ú",
  Ucirc: "Û",
  Uuml: "Ü",
  Yacute: "Ý",
  THORN: "Þ",
  szlig: "ß",
  agrave: "à",
  aacute: "á",
  acirc: "â",
  atilde: "ã",
  auml: "ä",
  aring: "å",
  aelig: "æ",
  ccedil: "ç",
  egrave: "è",
  eacute: "é",
  ecirc: "ê",
  euml: "ë",
  igrave: "ì",
  iacute: "í",
  icirc: "î",
  iuml: "ï",
  eth: "ð",
  ntilde: "ñ",
  ograve: "ò",
  oacute: "ó",
  ocirc: "ô",
  otilde: "õ",
  ouml: "ö",
  divide: "÷",
  oslash: "ø",
  ugrave: "ù",
  uacute: "ú",
  ucirc: "û",
  uuml: "ü",
  yacute: "ý",
  thorn: "þ",
  yuml: "ÿ",
  // 흔한 기호 — HTML 표준에 있는 것만(2026-10-23 2차 검토 R3 발견 2).
  hellip: "…",
  bull: "•",
  prime: "′",
  Prime: "″",
  lsaquo: "‹",
  rsaquo: "›",
  sbquo: "‚",
  bdquo: "„",
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  ndash: "–",
  mdash: "—",
  dagger: "†",
  Dagger: "‡",
  permil: "‰",
  euro: "€",
  larr: "←",
  uarr: "↑",
  rarr: "→",
  darr: "↓",
  harr: "↔",
  lArr: "⇐",
  rArr: "⇒",
  hArr: "⇔",
  minus: "−",
  le: "≤",
  ge: "≥",
  ne: "≠",
  asymp: "≈",
  infin: "∞",
  trade: "™",
};

/** 엔티티 풀기 — 숫자 · 16진 · 위의 이름들. 이름은 숫자로 끝나기도 한다(frac12 · sup2). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body] ?? whole;
  });
}

/** 맨 글 → 저장 포맷. 줄마다 문단 하나이고 `&` `<` `>` 만 이스케이프한다. */
export function commentStorage(text: string): string {
  return text
    .split("\n")
    .map(
      (line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`,
    )
    .join("");
}

/** 코멘트에 든 멘션의 계정 id — 이름을 미리 찾아 `commentText` 에 넘긴다. */
export function mentionIds(storage: string): string[] {
  const ids = new Set<string>();
  for (const match of storage.matchAll(/<ri:user\b[^>]*\bri:account-id="([^"]+)"/g)) {
    if (match[1] !== undefined) ids.add(match[1]);
  }
  return [...ids];
}

/**
 * 저장 포맷 → 사람이 읽는 글. 문단 · 줄바꿈 · 목록 항목은 줄로, 멘션은 `@이름`(모르면 `@`)으로,
 * CDATA 는 속 글 그대로, 나머지 태그는 벗긴다.
 */
export function commentText(
  storage: string,
  names: ReadonlyMap<string, string> = new Map(),
): string {
  const parts: string[] = [];
  for (const piece of splitCdata(storage)) {
    if (piece.cdata) {
      parts.push(piece.text);
      continue;
    }
    const text = piece.text
      .replace(/<ac:link\b[^>]*>[\s\S]*?<\/ac:link>/g, (link) => {
        const id = /\bri:account-id="([^"]+)"/.exec(link)?.[1];
        return id === undefined ? link : `\ue001${id}\ue001`;
      })
      .replace(/<ri:user\b[^>]*\bri:account-id="([^"]+)"[^>]*\/?>/g, "\ue001$1\ue001")
      .replace(/<br\b[^>]*\/?>/g, "\n")
      .replace(/<li\b[^>]*>/g, "- ")
      .replace(/<\/(?:p|li|h[1-6]|div|tr|blockquote|pre)>/g, "\n")
      .replace(/<[^>]*>/g, "");
    parts.push(decodeEntities(text));
  }
  return parts
    .join("")
    .replace(/\ue001([^\ue001]+)\ue001/g, (_whole, id: string) => `@${names.get(id) ?? ""}`)
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/, "");
}

/**
 * 앱에서 고쳐도 되는 코멘트인가 — 문단(속성은 허용) · 빈 문단 · 줄바꿈 · 글만 있으면 그렇다. 맨 글로 다시
 * 써도 잃는 것이 없다는 뜻이다.
 */
export function commentIsPlain(storage: string): boolean {
  if (storage.includes("<![CDATA[")) return false;
  const rest = storage
    .replace(/<p\b[^>]*\/>/g, "")
    .replace(/<p\b[^>]*>/g, "")
    .replace(/<\/p>/g, "")
    .replace(/<br\b[^>]*\/?>/g, "");
  return !rest.includes("<");
}

/**
 * 인라인 닻의 수 — 원문 글(태그를 벗기고 엔티티를 푼)에서 문장이 겹치지 않게 몇 번 나오는지. 블록의 경계는
 * 끊어 세고(두 문단에 걸친 일치를 만들지 않는다), 공백의 꼴(줄바꿈 · nbsp · 연속)은 하나로 본다.
 */
export function anchorCount(storage: string, selection: string): number {
  const needle = squash(selection);
  if (needle === "") return 0;
  const haystack = squash(anchorText(storage));
  let count = 0;
  for (
    let at = haystack.indexOf(needle);
    at !== -1;
    at = haystack.indexOf(needle, at + needle.length)
  ) {
    count += 1;
  }
  return count;
}

/** 원문의 글 — 블록 경계는 사설 영역 글자(`\ue000`)로 끊는다(공백으로 뭉개지지 않게). */
function anchorText(storage: string): string {
  const parts: string[] = [];
  for (const piece of splitCdata(storage)) {
    if (piece.cdata) {
      parts.push(piece.text);
      continue;
    }
    const text = piece.text
      .replace(/<br\b[^>]*\/?>/g, "\ue000")
      .replace(
        /<\/?(?:p|li|ul|ol|h[1-6]|div|table|tbody|thead|tr|td|th|blockquote|pre)\b[^>]*>/g,
        "\ue000",
      )
      .replace(/<[^>]*>/g, "");
    parts.push(decodeEntities(text));
  }
  return parts.join("");
}

/** 공백의 꼴을 하나로 — 줄바꿈 · nbsp · 연속 공백은 공백 하나다(JS 의 `\s` 가 nbsp 를 품는다). 블록 경계는 남긴다. */
function squash(text: string): string {
  return text.replace(/[^\S\ue000]+/g, " ").trim();
}

/** CDATA 를 갈라 둔다 — 그 속의 `<` 는 태그가 아니다. */
function splitCdata(storage: string): Array<{ cdata: boolean; text: string }> {
  const pieces: Array<{ cdata: boolean; text: string }> = [];
  let last = 0;
  for (const match of storage.matchAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g)) {
    const at = match.index ?? 0;
    if (at > last) pieces.push({ cdata: false, text: storage.slice(last, at) });
    pieces.push({ cdata: true, text: match[1] ?? "" });
    last = at + match[0].length;
  }
  if (last < storage.length) pieces.push({ cdata: false, text: storage.slice(last) });
  return pieces;
}
