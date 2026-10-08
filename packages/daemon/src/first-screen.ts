/**
 * 서비스의 첫 화면 읽기 (2026-10-07 베타 준비 분석 · 첫 5분) — 준비가 끝난 미리보기의 첫 주소를 한 번 받아 문서가
 * 스스로 단 제목(`<title>`)을 읽는다. 홈의 시작 칩이 `‘회원 목록’ 화면의 …` 처럼 서비스의 이름으로 말하게 하는 재료다.
 * 화면 지도(screen-map)는 고친 화면의 관찰이라 처음 켠 서비스에는 아는 것이 없다.
 *
 * 브라우저를 띄우지 않는다 — 서버가 내는 문서의 머리만 읽는다. 그래서 서버가 그려 주는 문서(Next · Nuxt · Astro …)는
 * 제목이 있고, 브라우저에서 그리는 앱(Vite · CRA)은 `index.html` 에 적힌 제목이 있다. 문서가 스스로 제목을 안 달았거나
 * 읽지 못했으면 null 이다 — 칩은 어느 서비스에나 맞는 말로 선다. 어떤 제목이 이름이 될 만한가는 웹의 판정이다
 * (`home-starters.ts` 의 `firstScreenName`) — 여기는 날것을 깨끗이 해 건넬 뿐이다. 제목은 로그에 남기지 않는다.
 */

/** 데몬이 읽은 첫 화면 — 선로의 `RepoStatus.firstScreen` 과 같은 모양. */
export interface FirstScreen {
  path: string;
  title: string;
}

/** 문서의 머리만 읽는다 — `<title>` 은 앞쪽에 산다. */
const HEAD_BYTES = 64 * 1024;
/** 제목의 긴 쪽 한도(글자) — 이름이 될 만한 것은 이보다 짧다. */
const TITLE_MAX = 120;
/** 처음 켠 개발 서버는 첫 주소를 컴파일하느라 느리다 — 배경 일이라 넉넉히 기다린다. */
const READ_TIMEOUT_MS = 10_000;

/** 제목에 흔한 개체 이름 — `화면명 &middot; 앱 이름` 의 구분점이 대표다. 모르는 이름은 풀지 않고 그대로 둔다. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  middot: "·",
  bull: "•",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
};

/** HTML 개체 이름(`&amp;`)과 번호(`&#39;` · `&#x27;`)를 글자로 — 모르는 이름은 그대로 둔다. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      const ok = Number.isInteger(code) && code > 0 && code <= 0x10ffff;
      // 짝 없는 대용 부호(surrogate)는 글자가 아니다.
      return ok && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * 문서의 `<title>` — 머리 안의 첫 것이다(본문의 SVG `<title>` 은 화면의 이름이 아니다). 태그를 걷고 개체를 풀고 공백을
 * 한 칸으로 모은다. 없거나 비었으면 null.
 */
export function titleOfHtml(html: string): string | null {
  const head = html.split(/<\/head\s*>/i)[0] ?? html;
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head);
  if (!match) return null;
  const text = decodeEntities((match[1] ?? "").replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return null;
  return Array.from(text).slice(0, TITLE_MAX).join("");
}

/** 응답 본문의 앞 `max` 바이트만 글로 읽고 나머지는 받지 않는다. */
async function readHead(response: Response, max: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < max) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

/** 따라간 이동 뒤의 경로 — 쿼리 · 해시 · 끝 슬래시는 뗀다(루트는 `/`). */
function pathOf(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "");
  return path === "" ? "/" : path;
}

/** 서버가 보내는 이동을 따라가는 최대 횟수 — `/` → `/login` 같은 한두 번이면 된다. */
const MAX_HOPS = 4;

/**
 * 미리보기 서버의 첫 주소를 읽는다. 이동(리다이렉트)은 같은 서버 안에서만 손으로 따라간다 — 서버가 다른 주인(로그인
 * 서비스 등)으로 넘기면 이 서비스의 화면이 아니라서 null 이고, 그쪽으로 요청을 보내지도 않는다(개발 서버의 이동이 이 기계의
 * 요청을 바깥으로 끌고 나가지 않게). 실패는 조용하다(칩이 일반 문장으로 서는 것뿐). `options.fetch` 는 시험이 갈아 끼운다.
 */
export async function readFirstScreen(
  previewUrl: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<FirstScreen | null> {
  try {
    const origin = new URL(previewUrl).origin;
    const get = options.fetch ?? fetch;
    const signal = AbortSignal.timeout(options.timeoutMs ?? READ_TIMEOUT_MS);
    let url = new URL(`${origin}/`);
    for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
      const response = await get(url.href, {
        redirect: "manual",
        headers: { accept: "text/html" },
        signal,
      });
      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get("location");
        void response.body?.cancel().catch(() => undefined);
        if (!next) return null;
        url = new URL(next, url);
        if (url.origin !== origin) return null;
        continue;
      }
      if (!response.ok) return null;
      if (!/\bhtml\b/i.test(response.headers.get("content-type") ?? "")) return null;
      const title = titleOfHtml(await readHead(response, HEAD_BYTES));
      return title === null ? null : { path: pathOf(url), title };
    }
    return null;
  } catch {
    return null;
  }
}
