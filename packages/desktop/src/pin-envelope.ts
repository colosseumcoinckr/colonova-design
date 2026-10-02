import type { ColoNovaDesignPinEnvelope } from "@colonova-design/protocol";

/**
 * 오버레이에서 오는 핀 봉투의 문지기(2026-10-02). 봉투는 preload 의 다리를
 * 타고 오지만, 그 다리는 연결 레포의 페이지 스크립트도 부를 수 있다 —
 * 모양 · 크기가 아니면 통째로 버린다. 값의 내용을 바꾸지는 않는다.
 */

/** 봉투가 실을 수 있는 문자열의 한계 — 근거는 프로토콜의 각 주석(cap)보다 넉넉하게. */
const LIMITS = {
  id: 100,
  screen: 500,
  component: 200,
  text: 4_000,
  path: 2_000,
  xpath: 4_000,
  html: 6_144,
  nearby: 1_000,
  a11y: 300,
  attrs: 500,
  styleValue: 200,
  owners: 8,
  shotBytes: 12_000_000,
} as const;

function isString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isBox(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const box = value as Record<string, unknown>;
  return (["x", "y", "width", "height"] as const).every(
    (key) => typeof box[key] === "number" && Number.isFinite(box[key]),
  );
}

function isCappedStringMap(value: unknown, maxKeys: number, maxValue: number): boolean {
  if (typeof value !== "object" || value === null) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= maxKeys &&
    entries.every(
      ([key, item]) => key.length <= 64 && typeof item === "string" && item.length <= maxValue,
    )
  );
}

/** 핀 봉투 한 통 — 모양이 맞으면 true, 아니면 false. */
export function isPinEnvelope(payload: unknown): payload is ColoNovaDesignPinEnvelope {
  if (typeof payload !== "object" || payload === null) return false;
  const envelope = payload as Record<string, unknown>;
  if (envelope.type !== "colonova-design.pin") return false;
  const pin = envelope.pin;
  if (typeof pin !== "object" || pin === null) return false;
  const { id, screen, element, shot } = pin as Record<string, unknown>;
  if (!isString(id, LIMITS.id) || typeof screen !== "string" || screen.length > LIMITS.screen) {
    return false;
  }
  if (typeof element !== "object" || element === null) return false;
  const target = element as Record<string, unknown>;
  if (target.kind !== undefined && target.kind !== "element" && target.kind !== "region") {
    return false;
  }
  if (!isString(target.component, LIMITS.component)) return false;
  if (typeof target.text !== "string" || target.text.length > LIMITS.text) return false;
  if (typeof target.path !== "string" || target.path.length > LIMITS.path) return false;
  if (!isBox(target.rect)) return false;
  if (target.rectView !== undefined && !isBox(target.rectView)) return false;
  if (target.xpath !== undefined && !isString(target.xpath, LIMITS.xpath)) return false;
  if (target.html !== undefined && !isString(target.html, LIMITS.html)) return false;
  if (target.styles !== undefined && !isCappedStringMap(target.styles, 40, LIMITS.styleValue)) {
    return false;
  }
  if (target.a11y !== undefined && !isCappedStringMap(target.a11y, 2, LIMITS.a11y)) return false;
  if (target.attrs !== undefined && !isCappedStringMap(target.attrs, 8, LIMITS.attrs)) return false;
  if (target.nearby !== undefined && !isString(target.nearby, LIMITS.nearby)) return false;
  if (target.owners !== undefined) {
    if (
      !Array.isArray(target.owners) ||
      target.owners.length > LIMITS.owners ||
      !target.owners.every((name) => isString(name, LIMITS.component))
    ) {
      return false;
    }
  }
  if (shot !== undefined) {
    // 봉투의 사진은 뷰가 채운다 — 오버레이가 싣는 것은 받지 않는다.
    return false;
  }
  return true;
}

/** 핀 초점 알림 — 봉투보다 가볍다: 문장은 없고 id 만 실는다. */
export function isPinFocus(payload: unknown): payload is { type: string; id: string } {
  if (typeof payload !== "object" || payload === null) return false;
  const focus = payload as Record<string, unknown>;
  return focus.type === "colonova-design.pin-focus" && isString(focus.id, LIMITS.id);
}
