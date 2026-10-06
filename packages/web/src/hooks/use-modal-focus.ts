import { type RefObject, useEffect } from "react";

/**
 * The keyboard side of `aria-modal="true"`: while the dialog is open, Tab
 * wraps inside the panel instead of wandering the page it claims to cover,
 * and closing hands focus back to the element that opened it — so the
 * planner's next keystroke lands where their attention already is.
 *
 * Focus SEEDING stays with the caller (some panels want the panel itself,
 * the palette wants its search field); this hook only traps and restores.
 */
export interface ModalFocusOptions {
  /**
   * 판 밖(뒷배경 · 다른 칸)에 초점이 있을 때의 Tab 을 판의 끝으로 되돌릴까. 모달은 되돌린다(기본) —
   * 뒤가 죽어 있으니 초점이 샌 것이다. 작업 기록 서랍처럼 뒤가 살아 있는 옆 서랍은 끈다: 채팅 입력창에서
   * 누른 Tab 이 서랍 안으로 끌려 들어가거나 막대의 다른 단추에 닿지 못하는 일이 없게.
   */
  reenter?: boolean;
}

export function useModalFocus(
  panel: RefObject<HTMLElement | null>,
  open: boolean = true,
  returnRef?: RefObject<HTMLElement | null>,
  options?: ModalFocusOptions,
): void {
  const reenter = options?.reenter ?? true;
  useEffect(() => {
    if (!open) return;
    const opener = modalReturnTarget(
      returnRef?.current,
      document.activeElement as HTMLElement | null,
    );
    const panelEl = panel.current;
    const root = panel.current?.closest<HTMLElement>(MODAL_ROOT_SELECTOR) ?? null;
    const restoreLayers = isolateModalLayer(
      root,
      Array.from(document.querySelectorAll<HTMLElement>(MODAL_ROOT_SELECTOR)),
      (a, b) => a.contains(b) || b.contains(a),
    );

    // Elements outside the tab order (tabindex -1) are not ends of the trap: a
    // roving group (radio cards, tabs) leaves only its checked item tabbable,
    // and if the last node in the DOM were an unreachable one, Tab would walk
    // out of the dialog instead of wrapping.
    const focusables = (root: HTMLElement): HTMLElement[] =>
      Array.from(
        root.querySelectorAll<HTMLElement>(
          [
            "a[href]",
            "button:not([disabled])",
            "input:not([disabled])",
            "select:not([disabled])",
            "textarea:not([disabled])",
            "details > summary",
            '[tabindex]:not([tabindex="-1"])',
          ].join(", "),
        ),
      ).filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0);

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const root = panel.current;
      if (!root) return;
      // 숨었거나 inert 인 판(홈 · 가려진 탭 · 옆 서랍 뒤)은 손이 닿지 않는다 — 가두면 초점이 못 가는 곳으로 Tab 을 막아
      // 키보드가 죽는다.
      if (!panelReachable(root.closest("[inert]"), getComputedStyle(root).visibility)) return;
      // 초점이 이 판 밖의 다른 겹판(aria-modal) 안에 있으면 그쪽의 가두기가 맡는다 — 서랍 위에
      // 비교창 · 말풍선이 뜬 때, 두 가두기가 차례로 돌아 Tab 이 서랍으로 튕겼다 돌아오고 가운데
      // 단추는 키보드로 닿을 수 없었다(2026-10-06 겹판 조사).
      if (trapYields(document.activeElement as FocusLike | null, root)) return;
      const overlay = root.closest(MODAL_ROOT_SELECTOR);
      if (
        overlay &&
        !escapeCloses(overlay, Array.from(document.querySelectorAll(MODAL_ROOT_SELECTOR)))
      )
        return;
      const within = focusables(root);
      if (within.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = within[0]!;
      const last = within[within.length - 1]!;
      const at = document.activeElement;
      // Focus that escaped the panel (a click into the backdrop, a bug)
      // re-enters at the ends rather than being lost behind the modal.
      // 초점을 옮겨 본 뒤에야 Tab 을 막는다 — 옮겨지지 않는 곳(보이지 않는 단추)이면 브라우저가 제 길을 가게 둔다.
      if (!(at instanceof HTMLElement) || !root.contains(at)) {
        if (!reenter) return;
        const target = event.shiftKey ? last : first;
        target.focus();
        if (document.activeElement === target) event.preventDefault();
        return;
      }
      if (!event.shiftKey && at === last) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && at === first) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      restoreLayers();
      // 그새 사용자가 초점을 다른 곳(입력창 …)으로 옮겼다면 건드리지 않는다 — 되돌리기가 끝나 서랍이 저절로 접히는 때처럼
      // 사용자 손이 아닌 닫힘이 타이핑 중인 초점을 빼앗지 않게.
      if (
        opener &&
        document.contains(opener) &&
        returnsFocus(document.activeElement, document.body, panelEl)
      )
        opener.focus();
    };
  }, [panel, open, returnRef, reenter]);
}

/** 이 판에 손이 닿는가 — inert 인 조상이 없고 눈에 보여야(visibility) 한다. */
export function panelReachable(inertAncestor: unknown, visibility: string): boolean {
  return inertAncestor == null && visibility !== "hidden";
}

/**
 * 닫힐 때 초점을 여는 요소로 돌려 보낼까 — 초점이 판 안에 있거나 아무 데도 없을(body) 때만이다. 판이 접히며
 * 초점이 허공으로 떨어진 것이면 돌려 보내고, 사용자가 이미 다른 곳을 잡았으면 그대로 둔다.
 */
export function returnsFocus(
  active: unknown,
  body: unknown,
  panel: { contains(node: unknown): boolean } | null,
): boolean {
  if (active == null || active === body) return true;
  return panel?.contains(active) === true;
}

/**
 * The Escape side of `aria-modal="true"`: only the TOPMOST overlay answers.
 * Every dialog used to listen on `document` unconditionally, so a confirm
 * stacked on a settings or review surface closed both at once — the planner
 * pressed Escape once and lost two layers. The rule is stacking, not
 * registration order: the palette (z-70) paints above a dialog (z-60) even
 * when the markup puts the modal last, so an open palette is the layer
 * Escape dismisses; with no palette open, the last overlay in the DOM is.
 *
 * Menus and folds are not overlays — they keep their own Escape handlers.
 */

/** 덮개의 뿌리가 되는 클래스 — 낡은 셸의 것과 새 셸의 창 · 확인판이 함께 산다. */
export const MODAL_ROOT_SELECTOR = [
  ".modal",
  ".nx-pal",
  ".onboarding",
  ".nx-set-back",
  ".nx-modal-back",
].join(", ");

/**
 * 열려 있는 겹판의 뿌리 — 닫는 모션 중인 판(`…--out`)은 이미 닫힌 것으로 쳐서 뺀다. 단축키 · Esc 가
 * 뒤로 물러서는 판정이 네 곳(Workspace 둘 · 작업 기록 서랍 · 미리보기 칸)에 따로 복붙돼 서로 다른 목록
 * (`.nx-set` 이 빠진 곳 · 나가는 판을 못 거르는 곳)을 들고 있었다(2026-10-06 겹판 조사).
 */
const OPEN_OVERLAY_SELECTOR = MODAL_ROOT_SELECTOR.split(", ")
  .map((root) => `${root}:not([class*="--out"])`)
  .join(", ");

/** 겹판이 하나라도 열려 있나 — 열려 있으면 앱 단축키 · 뒤 칸의 Esc 는 물러선다. */
export function overlayOpen(): boolean {
  return document.querySelector(OPEN_OVERLAY_SELECTOR) !== null;
}

/** Esc 닫힘의 층 판정에 필요한 최소 모양 — 시험이 DOM 없이 이 모양으로 갈아끼운다. */
export interface OverlayLike {
  classList: { contains(name: string): boolean };
}

/** 겹친 덮개 가운데 맨 위 층을 고른다 — 팔레트가 열려 있기만 해도 그것이 맨 위고, 없으면 문서 마지막이다. */
export function topmostOverlay<T extends OverlayLike>(overlays: readonly T[]): T | null {
  if (overlays.length === 0) return null;
  return (
    overlays.find((el) => el.classList.contains("nx-pal")) ?? overlays[overlays.length - 1] ?? null
  );
}

/** 이 판의 뿌리가 맨 위 층일 때만 Esc 가 닫는다 — 아래 층은 위의 것이 닫힐 때까지 기다린다. */
export function escapeCloses(root: OverlayLike | null, overlays: readonly OverlayLike[]): boolean {
  if (!root) return false;
  return topmostOverlay(overlays) === root;
}

export function useModalEscape(
  panel: RefObject<HTMLElement | null>,
  onClose: () => void,
  open: boolean = true,
): void {
  useEffect(() => {
    if (!open) return;
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 한글 조합 중의 Esc 는 조합을 취소하는 키다 — 대화상자까지 닫으면 쓰던 글이 한꺼번에
      // 날아간다(2026-10-06 겹판 조사).
      if (event.isComposing) return;
      const overlays = Array.from(document.querySelectorAll(MODAL_ROOT_SELECTOR));
      // 규칙은 겹침이다, 마크 순서가 아니다 — 팔레트(z-70)는 대화상자(z-60)보다
      // 위에 칠해지는데 마크에서는 앞에 설 수 있다. 팔레트가 열려 있기만 해도
      // 그것이 맨 위 층이다; 없을 때만 DOM 마지막이 맨 위다.
      const root = panel.current?.closest(MODAL_ROOT_SELECTOR);
      if (!escapeCloses(root ?? null, overlays)) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeydown);
    return () => document.removeEventListener("keydown", onKeydown);
  }, [panel, onClose, open]);
}

/** 초점의 위치를 묻는 데 필요한 최소 모양 — 시험이 DOM 없이 이 모양으로 갈아끼운다. */
export interface FocusLike {
  closest(selector: string): FocusLike | null;
}

/**
 * 이 판의 Tab 가두기가 물러서야 하나 — 초점이 이 판 밖의 다른 `aria-modal` 안에 있을 때다.
 * 그 위 층이 제 가두기로 초점을 쥐고 있으니, 아래 층이 끼어들어 끝으로 되돌리면 안 된다.
 * 초점이 판 안이거나 어느 겹판 안도 아니면(뒷배경을 눌러 새어 나온 초점) 가두기가 맡는다.
 */
export function trapYields(
  active: FocusLike | null,
  root: { contains(node: unknown): boolean },
): boolean {
  const other = active?.closest('[aria-modal="true"]') ?? null;
  return other !== null && !root.contains(other);
}

/** Auto-focused dialog fields cannot replace an explicit initiating control. */
export function modalReturnTarget<T>(explicit: T | null | undefined, focused: T | null): T | null {
  return explicit ?? focused;
}

export interface ModalAttributes {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}
export interface ModalLayer extends OverlayLike, ModalAttributes {
  inert: boolean;
  querySelectorAll(selector: string): Iterable<ModalAttributes>;
}

/** Only the top dialog is interactive/exposed; closing restores the exact lower layer state. */
export function isolateModalLayer<T extends ModalLayer>(
  root: T | null,
  layers: readonly T[],
  related: (a: T, b: T) => boolean = () => false,
): () => void {
  if (!root || !escapeCloses(root, layers)) return () => {};
  const lower = layers
    .filter((layer) => layer !== root && !related(layer, root))
    .map((layer) => ({
      layer,
      inert: layer.inert,
      hidden: layer.getAttribute("aria-hidden"),
      dialogs: Array.from(layer.querySelectorAll('[aria-modal="true"]')).map((dialog) => ({
        dialog,
        modal: dialog.getAttribute("aria-modal"),
      })),
    }));
  for (const { layer, dialogs } of lower) {
    // Hidden lower dialogs must stop claiming exclusive AX modal scope.
    for (const { dialog } of dialogs) dialog.setAttribute("aria-modal", "false");
    layer.inert = true;
    layer.setAttribute("aria-hidden", "true");
  }
  return () => {
    for (const { layer, inert, hidden, dialogs } of lower) {
      layer.inert = inert;
      if (hidden === null) layer.removeAttribute("aria-hidden");
      else layer.setAttribute("aria-hidden", hidden);
      for (const { dialog, modal } of dialogs) {
        if (modal === null) dialog.removeAttribute("aria-modal");
        else dialog.setAttribute("aria-modal", modal);
      }
    }
  };
}
