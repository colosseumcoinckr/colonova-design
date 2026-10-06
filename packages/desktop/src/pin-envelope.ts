import type {
  ColoNovaDesignCommentTarget,
  ColoNovaDesignPinEnvelope,
} from "@colonova-design/protocol";

/**
 * 오버레이에서 오는 핀 봉투의 문지기(2026-10-02). 봉투는 preload 의 다리를
 * 타고 오지만, 그 다리는 연결 레포의 페이지 스크립트도 부를 수 있다 — 모양이
 * 아니면 버린다.
 *
 * 2026-10-06 고침: 문지기가 오버레이의 정상 출력을 버리고 있었다. `attrs.classes`
 * 는 문자열 배열인데 문자열만 받아, 클래스가 하나라도 있는 요소의 핀이 말없이
 * 사라졌다(길이 상한이 없는 `font-family` 도 200자를 넘으면 같은 길이었다).
 * 그래서 두 가지로 가른다 — **필수 칸**(종류 · id · 요소의 컴포넌트 · 경로 · 좌표)의
 * 모양이 어긋나면 버리고, **보강 칸**(스타일 · 접근성 · 속성 · 주변 글 · html …)이
 * 크면 그 칸을 자른다. 오버레이의 원칙과 같다: 보강 칸의 실패는 칸 하나의 값일 뿐
 * 핀을 죽이지 않는다. 돌려주는 봉투는 알려진 칸만 새 객체에 옮긴 것이다.
 */

/** 봉투가 실을 수 있는 문자열의 한계 — 근거는 프로토콜의 각 주석(cap)보다 넉넉하게. */
const LIMITS = {
  id: 100,
  screen: 500,
  component: 200,
  text: 4_000,
  path: 4_000,
  xpath: 4_000,
  html: 6_144,
  nearby: 1_000,
  a11y: 300,
  attrs: 500,
  styleValue: 200,
  styleKeys: 40,
  classNames: 10,
  className: 200,
  owners: 8,
} as const;

/**
 * 봉투를 버린 까닭의 종류 — 기록에는 이 이름과 숫자만 남긴다(사용자의 말 · 경로 ·
 * 값은 남기지 않는다). 보강 칸은 자르므로 여기에 오지 않는다.
 */
export type PinRejection =
  | "shape"
  | "id"
  | "element"
  | "kind"
  | "component"
  | "text"
  | "path"
  | "rect"
  | "shot";

export type PinRead =
  | { ok: true; envelope: ColoNovaDesignPinEnvelope }
  | { ok: false; reason: PinRejection };

function isString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

/** 한계에서 자른다 — 서로게이트 쌍의 앞 절반이 남지 않게 한 글자 더 물린다. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBox(value: unknown): ColoNovaDesignCommentTarget["rect"] | null {
  if (!isObject(value)) return null;
  const { x, y, width, height } = value;
  if (
    typeof x !== "number" ||
    typeof y !== "number" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return null;
  }
  return { x, y, width, height };
}

/** 이름이 알려진 문자열 칸만 옮긴다 — 비었거나 문자열이 아니면 그 칸을 뺀다. */
function readStrings<K extends string>(
  value: Record<string, unknown>,
  keys: readonly K[],
  max: number,
): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" && item !== "") out[key] = clip(item, max);
  }
  return out;
}

function readStyles(value: unknown): Record<string, string> | undefined {
  if (!isObject(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (Object.keys(out).length >= LIMITS.styleKeys) break;
    if (key.length > 64 || typeof item !== "string") continue;
    out[key] = clip(item, LIMITS.styleValue);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readAttrs(value: unknown): ColoNovaDesignCommentTarget["attrs"] | undefined {
  if (!isObject(value)) return undefined;
  const out: NonNullable<ColoNovaDesignCommentTarget["attrs"]> = readStrings(
    value,
    ["id", "testId", "href", "src", "name", "type", "placeholder"],
    LIMITS.attrs,
  );
  if (Array.isArray(value.classes)) {
    const classes = value.classes
      .filter((name): name is string => typeof name === "string" && name !== "")
      .slice(0, LIMITS.classNames)
      .map((name) => clip(name, LIMITS.className));
    if (classes.length > 0) out.classes = classes;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function readOwners(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const owners = value.filter((name): name is string => isString(name, LIMITS.component));
  return owners.length > 0 ? owners.slice(0, LIMITS.owners) : undefined;
}

/**
 * 핀 봉투 한 통을 읽는다. 필수 칸의 모양이 맞으면 알려진 칸만 옮긴 새 봉투를,
 * 아니면 버린 까닭의 종류를 돌려준다. 보강 칸은 자르거나 빼고 핀은 살린다.
 */
export function readPinEnvelope(payload: unknown): PinRead {
  if (!isObject(payload) || payload.type !== "colonova-design.pin") {
    return { ok: false, reason: "shape" };
  }
  const { pin } = payload;
  if (!isObject(pin)) return { ok: false, reason: "shape" };
  const { id, screen, element, shot } = pin;
  if (!isString(id, LIMITS.id)) return { ok: false, reason: "id" };
  if (typeof screen !== "string") return { ok: false, reason: "shape" };
  // 봉투의 사진은 뷰가 채운다 — 오버레이가 싣는 것은 받지 않는다.
  if (shot !== undefined) return { ok: false, reason: "shot" };
  if (!isObject(element)) return { ok: false, reason: "element" };

  if (element.kind !== undefined && element.kind !== "element" && element.kind !== "region") {
    return { ok: false, reason: "kind" };
  }
  if (!isString(element.component, LIMITS.component)) return { ok: false, reason: "component" };
  if (typeof element.text !== "string") return { ok: false, reason: "text" };
  if (typeof element.path !== "string" || element.path.length > LIMITS.path) {
    return { ok: false, reason: "path" };
  }
  const rect = readBox(element.rect);
  if (!rect) return { ok: false, reason: "rect" };
  const rectView = element.rectView === undefined ? undefined : readBox(element.rectView);
  if (rectView === null) return { ok: false, reason: "rect" };

  const target: ColoNovaDesignCommentTarget = {
    component: element.component,
    text: clip(element.text, LIMITS.text),
    path: element.path,
    rect,
  };
  if (element.kind !== undefined) target.kind = element.kind;
  if (rectView) target.rectView = rectView;
  if (isString(element.xpath, LIMITS.xpath)) target.xpath = element.xpath;
  if (typeof element.html === "string" && element.html !== "") {
    target.html = clip(element.html, LIMITS.html);
  }
  const styles = readStyles(element.styles);
  if (styles) target.styles = styles;
  if (isObject(element.a11y)) {
    const a11y = readStrings(element.a11y, ["role", "name"], LIMITS.a11y);
    if (Object.keys(a11y).length > 0) target.a11y = a11y;
  }
  const attrs = readAttrs(element.attrs);
  if (attrs) target.attrs = attrs;
  if (typeof element.nearby === "string" && element.nearby !== "") {
    target.nearby = clip(element.nearby, LIMITS.nearby);
  }
  const owners = readOwners(element.owners);
  if (owners) target.owners = owners;

  return {
    ok: true,
    envelope: {
      type: "colonova-design.pin",
      pin: { id, screen: clip(screen, LIMITS.screen), element: target },
    },
  };
}

/** 핀 봉투 한 통 — 모양이 맞으면 true, 아니면 false(보강 칸의 크기는 따지지 않는다). */
export function isPinEnvelope(payload: unknown): payload is ColoNovaDesignPinEnvelope {
  return readPinEnvelope(payload).ok;
}

/** 핀 초점 알림 — 봉투보다 가볍다: 문장은 없고 id 만 실는다. */
export function isPinFocus(payload: unknown): payload is { type: string; id: string } {
  if (typeof payload !== "object" || payload === null) return false;
  const focus = payload as Record<string, unknown>;
  return focus.type === "colonova-design.pin-focus" && isString(focus.id, LIMITS.id);
}
