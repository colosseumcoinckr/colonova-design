/**
 * 질문 카드의 시안 문서 — AI 가 선택지마다 단 HTML 조각(`preview`)을 iframe `srcDoc` 문서로 감싼다
 * (PLAN D96 · 2026-10-08 베타 준비 분석 C1). 순수 함수만 산다 — 시험이 src 에서 곧장 읽으므로 형제
 * 모듈을 부르지 않는다.
 *
 * AI 가 쓴 글은 믿지 않는다. 방어는 겹겹이고, 본 방어는 아래 둘이다.
 *   1. 그리는 쪽의 `<iframe sandbox="">` — 토큰을 하나도 주지 않아 스크립트 · 같은 출처 · 폼 · 팝업 ·
 *      최상위 이동이 모두 없다(`chat/AskPreview.tsx`, 시험이 지킨다).
 *   2. 이 문서 맨 앞의 CSP 메타 — 스크립트 · 네트워크 · 폼 · 프레임을 닫는다.
 * 아래 `cleanFragment` 의 걸러내기(스크립트 · 베이스 · 새로고침 · `on*` · 주소 속성)는 그 위에 겹친
 * 방어일 뿐이다. 브라우저의 파서와 한 치도 어긋나지 않는다고 장담하지 않는다 — 걸러내기에 틈이
 * 있어도 1 · 2 가 막는다. 그래서 걸러내기를 믿고 sandbox 를 풀지 않는다.
 *
 * Claude 는 `previewFormat: "html"` 일 때 `<html>`/`<body>`/`<script>`/`<style>` 없는 조각을 인라인
 * 스타일로만 쓰도록 안내받는다(SDK 가 어기면 되돌려 보낸다). 여기서도 `<style>` 은 버린다.
 */

/** 시안 한 장의 글자 수 상한 — 넘으면 시안이 없는 것으로 친다(카드는 글 선택지로 물러선다). */
export const PREVIEW_MAX_CHARS = 24_000;

/** 문서 맨 앞의 CSP — 인라인 스타일과 `data:` 그림 · 글꼴만 열고 나머지(스크립트 · 네트워크 · 폼 · 프레임)는 닫는다. */
export const PREVIEW_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/**
 * 시안의 바탕 — 앱이 어두워도 시안은 밝은 서비스 화면의 스케치로 읽힌다(투명이면 어두운 바탕에서
 * 글자가 사라진다). 스크롤바 대신 잘라낸다: 썸네일은 고정 크기의 창이다.
 */
const BASE_STYLE = [
  "html{color-scheme:light;overflow:hidden}",
  "*,*::before,*::after{box-sizing:border-box}",
  "body{margin:0;padding:16px;background:#fff;color:#1b1f24;",
  "font:14px/1.5 system-ui,-apple-system,'Segoe UI','Apple SD Gothic Neo','Malgun Gothic',sans-serif}",
  "img,svg{max-width:100%}",
].join("");

/**
 * 태그째 안의 내용까지 버리는 HTML 요소 — 실행하거나 불러오거나 파서의 상태를 바꾼다. `/>` 로 써도 HTML 에서는
 * 스스로 닫히지 않으므로(브라우저는 닫는 태그까지 안을 이 요소의 것으로 읽는다) 같은 자리까지 버린다.
 * 문서를 품는 요소(`portal` · `fencedframe` · `frame` · `frameset`)와 플러그인(`embed` · `applet` · `object`) ·
 * 3D 모델(`model`)이 모두 여기 든다 — 거부 목록이라 이름을 빠뜨리면 그 요소가 남는다(2026-10-08 검토 FIX1:
 * `portal` · `fencedframe` · `model` 이 남았다. `src` 는 벗겨져 해롭지 않았지만 본 방어는 sandbox + CSP 다).
 */
const DROP_WHOLE = new Set([
  "script",
  "style",
  "iframe",
  "noscript",
  "noembed",
  "noframes",
  "xmp",
  "plaintext",
  "title",
  "template",
  "object",
  "embed",
  "applet",
  "frame",
  "frameset",
  "portal",
  "fencedframe",
  "model",
  "audio",
  "video",
  "canvas",
]);

/**
 * `DROP_WHOLE` 중 안이 없는 요소(HTML 의 void) — 닫는 태그가 없으면 나머지 글을 버리지 않고 이 태그만 버린다.
 * 닫는 태그가 뒤에 있으면 다른 요소처럼 거기까지 버린다.
 */
const DROP_VOID = new Set(["embed", "frame"]);

/**
 * 태그째 안의 내용까지 버리는 외래(SVG · MathML) 요소 — 이쪽은 `/>` 로 스스로 닫을 수 있어, 그렇게 쓴 것은
 * 태그만 버린다(안이 없다). 열린 채면 닫는 태그까지 버린다.
 */
const DROP_FOREIGN = new Set([
  "math",
  "foreignobject",
  "animate",
  "animatemotion",
  "animatetransform",
  "set",
]);

/** 안이 없는 태그 — 태그만 버린다(베이스 · 새로고침 · 외부 스타일 같은 것). */
const DROP_TAG = new Set([
  "base",
  "link",
  "meta",
  "source",
  "track",
  "param",
  "basefont",
  "bgsound",
  "keygen",
]);

/** 문서의 뼈대 — 우리 문서가 이미 갖고 있으니 태그(와 속성)만 벗기고 안은 남긴다. */
const UNWRAP = new Set(["html", "head", "body"]);

/** 속성 이름 — 이 틀을 벗어난 이름은 지운다. */
const ATTR_NAME = /^[a-z_:][a-z0-9_:.-]*$/;

/** 태그 이름 — 이 틀을 벗어난 이름의 태그는 벗겨 안만 남긴다. */
const TAG_NAME = /^[a-z][a-z0-9-]*$/;

/** 주소를 싣는 속성 — `urlAllowed` 가 허락한 값만 남는다. */
const URL_ATTR = new Set([
  "href",
  "xlink:href",
  "src",
  "srcset",
  "imagesrcset",
  "action",
  "formaction",
  "poster",
  "background",
  "data",
  "cite",
  "longdesc",
  "codebase",
  "manifest",
  "usemap",
  "lowsrc",
  "dynsrc",
  "icon",
]);

/** 어느 태그에서든 지우는 속성 — 포커스를 뺏거나 이동 · 전송 · 새 창을 부르는 것. */
const DROP_ATTR = new Set([
  "srcdoc",
  "autofocus",
  "accesskey",
  "target",
  "formtarget",
  "ping",
  "nonce",
  "is",
  "http-equiv",
]);

/** 스타일 속성에서 한 글자라도 보이면 속성째 버리는 말 — 역슬래시(이스케이프로 숨기기) · 외부를 부르는 함수 · 옛 실행 문법. */
const CSS_UNSAFE =
  /[\\@]|expression|javascript:|image-set|cross-fade|src\(|image\(|element\(|paint\(|binding|behavior/i;

/** ASCII 알파벳만 소문자로 — `toLowerCase` 는 글자 수를 바꾸는 문자가 있어 원문과 자리가 어긋난다. */
function asciiLower(text: string): string {
  return text.replace(/[A-Z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 32));
}

/** 이 속성의 주소를 남겨도 되는가 — 문서 안의 앵커(`#…`)와 `data:image/` 그림뿐이다. 날것 그대로의 앞머리만 본다. */
function urlAllowed(tag: string, name: string, value: string): boolean {
  if (name === "href" || name === "xlink:href") {
    return value.startsWith("#") || (tag === "image" && /^data:image\//i.test(value));
  }
  return name === "src" && /^data:image\//i.test(value);
}

/** 스타일 속성을 남겨도 되는가 — 외부 주소를 부르거나 숨기는 모양이면 속성째 버린다. */
function cssSafe(value: string): boolean {
  if (CSS_UNSAFE.test(value)) return false;
  const low = asciiLower(value);
  for (let at = low.indexOf("url("); at >= 0; at = low.indexOf("url(", at + 4)) {
    if (!/^\s*["']?data:image\//.test(low.slice(at + 4, at + 40))) return false;
  }
  return true;
}

type Attr = [name: string, value: string | null];

/** 남길 속성만 다시 쓴다 — 값은 늘 큰따옴표로 감싸고 `"` · `<` 는 바꿔, 파서가 속성 밖으로 새지 못하게 한다. */
function attrText(tag: string, attrs: Attr[]): string {
  let out = "";
  for (const [name, raw] of attrs) {
    if (!ATTR_NAME.test(name) || name.startsWith("on") || DROP_ATTR.has(name)) continue;
    const value = raw ?? "";
    if (URL_ATTR.has(name) && !urlAllowed(tag, name, value)) continue;
    if (name === "style" && !cssSafe(value)) continue;
    out +=
      raw === null
        ? ` ${name}`
        : ` ${name}="${value.replaceAll('"', "&quot;").replaceAll("<", "&lt;")}"`;
  }
  return out;
}

interface ParsedTag {
  name: string;
  attrs: Attr[];
  selfClosing: boolean;
  /** `>` 바로 다음 자리. */
  end: number;
}

/**
 * `<` 다음의 태그 하나를 읽는다 — 인용부호 안의 `>` 는 태그의 끝이 아니다. 끝나지 않은 태그(글이
 * 중간에 끊긴)는 null: 부르는 쪽이 나머지를 버린다(브라우저도 그 태그를 버린다).
 */
function parseTag(src: string, nameStart: number): ParsedTag | null {
  const n = src.length;
  let p = nameStart;
  while (p < n && !/[\s/>]/.test(src[p] as string)) p += 1;
  const name = asciiLower(src.slice(nameStart, p));
  const attrs: Attr[] = [];
  let selfClosing = false;
  for (;;) {
    while (p < n && /[\s/]/.test(src[p] as string)) {
      if (src[p] === "/" && src[p + 1] === ">") selfClosing = true;
      p += 1;
    }
    if (p >= n) return null;
    if (src[p] === ">") return { name, attrs, selfClosing, end: p + 1 };
    let q = p + 1;
    while (q < n && !/[\s/>=]/.test(src[q] as string)) q += 1;
    const attrName = asciiLower(src.slice(p, q));
    p = q;
    while (p < n && /\s/.test(src[p] as string)) p += 1;
    let value: string | null = null;
    if (src[p] === "=") {
      p += 1;
      while (p < n && /\s/.test(src[p] as string)) p += 1;
      const quote = src[p];
      if (quote === '"' || quote === "'") {
        const close = src.indexOf(quote, p + 1);
        if (close < 0) return null;
        value = src.slice(p + 1, close);
        p = close + 1;
      } else {
        let r = p;
        while (r < n && !/[\s>]/.test(src[r] as string)) r += 1;
        value = src.slice(p, r);
        p = r;
      }
    }
    attrs.push([attrName, value]);
  }
}

/** `</name …>` 다음 자리 — 없으면 -1(부르는 쪽이 나머지를 버린다). `low` 는 `src` 의 ASCII 소문자 사본이다. */
function afterCloser(src: string, low: string, name: string, from: number): number {
  const needle = `</${name}`;
  for (let at = low.indexOf(needle, from); at >= 0; at = low.indexOf(needle, at + needle.length)) {
    const next = low[at + needle.length] ?? "";
    if (next === ">" || next === "/" || /\s/.test(next)) {
      const gt = src.indexOf(">", at + needle.length);
      return gt < 0 ? -1 : gt + 1;
    }
  }
  return -1;
}

/**
 * AI 의 조각을 한 번 훑어 다시 쓴다 — 태그는 이름과 속성을 검증해 우리 손으로 다시 적고, 글 속의
 * `<` 는 `&lt;` 로 바꾼다. 그래서 원문과 브라우저가 다르게 읽을 여지가 있는 자리(주석 · 처리 명령 ·
 * 닫히지 않은 태그)는 통째로 버린다. 선형으로 훑고 정규식을 길게 돌리지 않는다.
 */
function cleanFragment(raw: string): string {
  const src = raw.replaceAll("\0", "");
  const low = asciiLower(src);
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      out.push(src.slice(i));
      break;
    }
    if (lt > i) out.push(src.slice(i, lt));
    i = lt;
    const next = src[i + 1] ?? "";
    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      if (end < 0) break;
      i = end + 3;
      continue;
    }
    if (next === "!" || next === "?") {
      const end = src.indexOf(">", i + 2);
      if (end < 0) break;
      i = end + 1;
      continue;
    }
    const closing = next === "/";
    const nameStart = i + (closing ? 2 : 1);
    if (!/[a-zA-Z]/.test(src[nameStart] ?? "")) {
      out.push("&lt;");
      i += 1;
      continue;
    }
    const tag = parseTag(src, nameStart);
    if (!tag) break;
    i = tag.end;
    const { name } = tag;
    const dropped = DROP_WHOLE.has(name) || DROP_FOREIGN.has(name);
    if (!closing && dropped && !(tag.selfClosing && DROP_FOREIGN.has(name))) {
      const after = afterCloser(src, low, name, i);
      if (after < 0) {
        if (DROP_VOID.has(name)) continue;
        break;
      }
      i = after;
      continue;
    }
    if (dropped || DROP_TAG.has(name) || UNWRAP.has(name) || !TAG_NAME.test(name)) continue;
    out.push(
      closing
        ? `</${name}>`
        : `<${name}${attrText(name, tag.attrs)}${tag.selfClosing ? " /" : ""}>`,
    );
  }
  return out.join("");
}

/** 우리 문서 — CSP 메타가 문서의 맨 앞 요소이고, AI 의 글은 `<body>` 안에만 앉는다. */
function wrap(body: string): string {
  return (
    `<!doctype html><html lang="ko"><head>` +
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">` +
    `<meta charset="utf-8"><meta name="color-scheme" content="light">` +
    `<style>${BASE_STYLE}</style></head><body>${body}</body></html>`
  );
}

/**
 * 선택지의 `preview`(AI 가 쓴 HTML 조각)를 iframe `srcDoc` 로 쓸 문서로 만든다. 시안이 없는 것으로
 * 칠 입력(빈 글 · 공백 · 상한 초과 · 걸러 보니 남는 것이 없음)은 null — 카드는 글 선택지로 물러선다.
 * 어떤 입력에서도 던지지 않는다.
 */
export function previewDoc(html: string): string | null {
  try {
    if (typeof html !== "string" || html.length > PREVIEW_MAX_CHARS) return null;
    const body = cleanFragment(html).trim();
    return body === "" ? null : wrap(body);
  } catch {
    return null;
  }
}
