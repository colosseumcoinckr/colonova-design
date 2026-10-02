import assert from "node:assert/strict";
import { test } from "node:test";
// 순수 모듈 — src 에서 곧장 읽는다(next-journey.test.ts 와 같은 모양).
import {
  escapeCloses,
  isolateModalLayer,
  type ModalAttributes,
  type ModalLayer,
  modalReturnTarget,
  type OverlayLike,
  topmostOverlay,
} from "../src/hooks/use-modal-focus.ts";

/** DOM 없이 쓸 덮개 흉내 — 클래스 이름만으로 층을 판정하는지 본다. */
const overlay = (name: string): OverlayLike => ({
  classList: { contains: (className: string) => className === name },
});

test("topmostOverlay: 팔레트가 열려 있기만 해도 그것이 맨 위다", () => {
  const overlays = [overlay("nx-modal-back"), overlay("nx-pal"), overlay("nx-set-back")];
  assert.equal(topmostOverlay(overlays), overlays[1]);
});

test("topmostOverlay: 팔레트가 없으면 문서 마지막이 맨 위다", () => {
  const settings = overlay("nx-set-back");
  const modal = overlay("nx-modal-back");
  assert.equal(topmostOverlay([settings, modal]), modal);
  assert.equal(topmostOverlay([settings]), settings);
});

test("topmostOverlay: 열린 덮개가 없으면 맨 위도 없다", () => {
  assert.equal(topmostOverlay([]), null);
});

test("escapeCloses: 맨 위 층의 판만 답하고, 아래 층은 기다린다", () => {
  const settings = overlay("nx-set-back");
  const palette = overlay("nx-pal");
  // 설정 위에 팔레트가 떠 있으면 설정은 Esc 에 답하지 않는다.
  assert.equal(escapeCloses(settings, [settings, palette]), false);
  assert.equal(escapeCloses(palette, [settings, palette]), true);
  // 팔레트가 닫히면 설정이 다시 답한다.
  assert.equal(escapeCloses(settings, [settings]), true);
});

test("escapeCloses: 판의 뿌리를 못 찾으면 아무것도 닫지 않는다", () => {
  assert.equal(escapeCloses(null, [overlay("nx-modal-back")]), false);
  assert.equal(escapeCloses(overlay("nx-set-back"), []), false);
});

test("an auto-focused note field never replaces the explicit submission trigger", () => {
  const trigger = { name: "submit" };
  const removedField = { name: "note" };
  assert.equal(modalReturnTarget(trigger, removedField), trigger);
  assert.equal(modalReturnTarget(undefined, trigger), trigger);
});
test("nested comparison isolates the underlying submit dialog and restores it before focus returns", () => {
  const dialog = (): ModalAttributes => {
    const values = new Map([["aria-modal", "true"]]);
    return {
      getAttribute: (name) => values.get(name) ?? null,
      setAttribute: (name, value) => {
        values.set(name, value);
      },
      removeAttribute: (name) => {
        values.delete(name);
      },
    };
  };
  const submitDialog = dialog();
  const comparisonDialog = dialog();
  const layer = (hidden: string | null = null, panel = dialog()): ModalLayer => ({
    ...overlay("nx-modal-back"),
    inert: false,
    querySelectorAll: () => [panel],
    getAttribute: () => hidden,
    setAttribute: (_name, value) => {
      hidden = value;
    },
    removeAttribute: () => {
      hidden = null;
    },
  });
  const submit = layer("false", submitDialog);
  const comparison = layer(null, comparisonDialog);
  const restore = isolateModalLayer(comparison, [submit, comparison]);
  assert.equal(submit.inert, true);
  assert.equal(submit.getAttribute("aria-hidden"), "true");
  assert.equal(submitDialog.getAttribute("aria-modal"), "false");
  assert.equal(comparisonDialog.getAttribute("aria-modal"), "true");
  assert.equal(comparison.inert, false);
  assert.equal(comparison.getAttribute("aria-hidden"), null);
  assert.equal(escapeCloses(submit, [submit, comparison]), false);
  restore();
  assert.equal(submit.inert, false);
  assert.equal(submit.getAttribute("aria-hidden"), "false");
  assert.equal(submitDialog.getAttribute("aria-modal"), "true");
  assert.equal(escapeCloses(submit, [submit]), true);
});
