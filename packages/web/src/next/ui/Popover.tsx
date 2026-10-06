import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])";

/** 메뉴 역할의 팝에서 화살표가 걸어 다니는 줄 — 안 보이는 줄과 `:disabled` 는 건너뛴다. */
const MENU_ITEMS =
  '[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled), [role="menuitemcheckbox"]:not(:disabled)';

const LEAVE_MS = 130;

/**
 * 팝이 사라지는 순간 — 부모는 노드를 곧바로 지우므로 복제 한 장을 같은 자리에 남겨 짧게
 * 물러나게 한다(`nx-pop--leaving`). 복제는 React 의 밖에 있고 눌리지도 읽히지도 않는다
 * (`inert` · `aria-hidden`). 흐름 안에 있는 팝(position 이 static · relative)은 부르는 쪽이 거른다 —
 * 자리를 차지해 옆 줄이 한 박자 튀기 때문이다. 동작을 줄인 창도 건너뛴다.
 * 복제는 마이크로태스크에서 뜬다 — 개발 중 StrictMode 의 가짜 언마운트는 노드가 그대로 문서에
 * 있어 그때는 유령이 서면 안 되고, 떨어진 노드도 하위 트리는 온전해 복제할 수 있다.
 */
function leaveAsGhost(el: HTMLElement): void {
  const parent = el.parentNode;
  if (!parent || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  queueMicrotask(() => {
    if (el.isConnected || !parent.isConnected) return;
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.classList.add("nx-pop--leaving");
    ghost.removeAttribute("role");
    ghost.removeAttribute("aria-label");
    ghost.removeAttribute("id");
    for (const node of ghost.querySelectorAll("[id]")) node.removeAttribute("id");
    ghost.setAttribute("aria-hidden", "true");
    ghost.setAttribute("inert", "");
    parent.appendChild(ghost);
    const drop = () => ghost.remove();
    ghost.addEventListener("animationend", drop, { once: true });
    window.setTimeout(drop, LEAVE_MS + 120);
  });
}

/** 메뉴의 줄 — 보이는 것만, 문서 순서대로. */
function menuItems(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>(MENU_ITEMS)).filter(
    (item) => item.getClientRects().length > 0,
  );
}

/**
 * 누른 자리 아래에 뜨는 팝오버 한 장 — 목업의 `.pop`. 부르는 쪽이 누르는
 * 요소와 함께 `nx-anchor`(position: relative) 안에 둔다. 바깥을 누르거나
 * Esc 를 누르면 닫힌다; 누르는 요소 자체는 바깥으로 치지 않는다(다시 누르면
 * 부르는 쪽의 토글이 닫는다).
 *
 * 키보드로 연 팝(여는 단추가 `:focus-visible`)은 열리자마자 첫 초점 요소로 초점이 건너온다 —
 * 창 뿌리로 옮겨 그리는 `float` 팝은 탭 순서의 끝에 있어 건너올 길이 없었다. 마우스로 연
 * 팝은 초점을 가져가지 않는다. 팝 안에 있던 초점이 닫힘과 함께 허공(body)으로 떨어지면 여는
 * 요소로 되돌린다.
 *
 * `role="menu"` 는 줄(`role="menuitem"`)을 ↑ ↓ Home End 로 걷고 글자로 건너뛴다 — 줄 마다
 * `role` 은 부르는 쪽이 단다. 그 밖의 팝은 `dialog` 다.
 */
export function Popover({
  anchor,
  onClose,
  className,
  align = "start",
  up = false,
  float = false,
  label,
  role = "dialog",
  children,
}: {
  /** 팝오버를 연 요소 — 이 안의 누름은 바깥이 아니다. */
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  className?: string;
  /** 누른 요소의 왼쪽(start)에 맞출까 오른쪽(end)에 맞출까. */
  align?: "start" | "end";
  /** 위로 열기 — 바닥에 붙은 요소(사이드바 아래 · 입력창)의 팝오버. */
  up?: boolean;
  /**
   * 조상의 굴리는 면에서 벗어나 창 기준으로 선다 — 대화록처럼 좁은 굴림 칸 안에서 팝이
   * 칸 끝에 잘리는 자리용. 앱 뿌리(`.nx`)로 옮겨 그려 고정 배치하고, 놓인 방향에 자리가
   * 모자라면 넓은 쪽으로 뒤집는다(`up` 은 먼저 시도할 방향이다).
   */
  float?: boolean;
  /** 대화상자의 이름 — 화면 낭독이 이 팝이 무엇인지 말해 준다. */
  label?: string;
  /** 줄을 고르는 목록이면 `menu` — 화살표 걸음이 붙는다. 그 밖은 `dialog`. */
  role?: "dialog" | "menu";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // 앵커 · 역할은 ref 로 쥔다 — 부르는 쪽이 렌더마다 새 ref 객체를 만들어도(예: 목록 줄마다 만드는
  // 앵커) 아래 마운트 · 언마운트 효과가 렌더마다 다시 돌지 않는다.
  const anchorNow = useRef(anchor);
  anchorNow.current = anchor;
  const roleNow = useRef(role);
  roleNow.current = role;
  /* 열릴 때 한 번 — 키보드로 연 팝이면 첫 초점 요소로 건너간다. 마우스로 연 팝은 건드리지
     않는다. 이미 안에 초점이 있으면(부르는 쪽이 입력칸에 심었다) 그대로 둔다. */
  useEffect(() => {
    const el = ref.current;
    const opener = anchorNow.current.current;
    if (!el || !opener) return;
    const at = document.activeElement;
    if (!(at instanceof HTMLElement) || el.contains(at) || !opener.contains(at)) return;
    if (!at.matches(":focus-visible")) return;
    // 고르는 메뉴(`menuitemradio`)는 지금 고른 줄이 첫 초점이다 — 목록의 맨 위가 아니라(2026-10-06 겹판 조사).
    const items = roleNow.current === "menu" ? menuItems(el) : [];
    const first =
      roleNow.current === "menu"
        ? (items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0])
        : el.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
  }, []);
  /* 닫힘 — 안에 있던 초점이 body 로 떨어지면 여는 요소로 되돌리고, 노드는 짧게 물러난다.
     위치(흐름 안인가)는 마운트 때 한 번 재 둔다 — 정리 함수에서 재면 렌더마다 스타일을 다시 푼다. */
  useLayoutEffect(() => {
    const el = ref.current;
    const floating = el ? ["absolute", "fixed"].includes(getComputedStyle(el).position) : false;
    return () => {
      if (!el) return;
      const opener = anchorNow.current.current;
      const hadFocus = el.contains(document.activeElement);
      if (hadFocus && opener) {
        queueMicrotask(() => {
          if (document.activeElement !== document.body || !opener.isConnected) return;
          (opener.matches(FOCUSABLE)
            ? opener
            : opener.querySelector<HTMLElement>(FOCUSABLE)
          )?.focus();
        });
      }
      if (floating) leaveAsGhost(el);
    };
  }, []);
  /* 메뉴의 화살표 걸음 — 패널에만 건다(문서 전체의 Esc · 바깥 누름 처리기와 섞이지 않게). */
  useEffect(() => {
    const el = ref.current;
    if (!el || role !== "menu") return;
    let typed = "";
    let typedAt = 0;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const items = menuItems(el);
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      let next = -1;
      if (event.key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % items.length;
      else if (event.key === "ArrowUp") next = at <= 0 ? items.length - 1 : at - 1;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = items.length - 1;
      else if (event.key.length === 1 && event.key !== " ") {
        // 글자로 건너뛰기 — 짧은 사이에 친 글자는 이어 붙여 앞글자를 맞춘다.
        const now = Date.now();
        typed = now - typedAt > 700 ? event.key : typed + event.key;
        typedAt = now;
        const lower = typed.toLowerCase();
        const from = at < 0 ? 0 : typed.length === 1 ? at + 1 : at;
        for (let step = 0; step < items.length; step++) {
          const index = (from + step) % items.length;
          if (items[index]?.textContent?.trim().toLowerCase().startsWith(lower)) {
            next = index;
            break;
          }
        }
      }
      if (next < 0) return;
      event.preventDefault();
      items[next]?.focus();
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [role]);
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (ref.current?.contains(target) || anchor.current?.contains(target)) return;
      close.current();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 한글 조합 중의 Esc 는 조합을 취소하는 키다 — 팝까지 닫지 않는다.
      if (event.isComposing) return;
      /* 다른 Esc 처리기(서랍 닫기 등)까지 내려가지 않게 여기서 멈춘다. */
      event.stopPropagation();
      close.current();
      /* 닫힌 뒤 초점이 허공에 남지 않게 여는 요소로 되돌린다. 앵커가 단추를 감싼 상자
         (`nx-anchor`)면 초점을 받을 수 없으니 그 안의 첫 초점 요소 — 여는 단추 — 로. */
      const opener = anchor.current;
      (opener?.matches(FOCUSABLE)
        ? opener
        : opener?.querySelector<HTMLElement>(FOCUSABLE)
      )?.focus();
    };
    /* 미리보기(`<webview>`) 안을 눌러도 이 문서에는 mousedown 이 오지 않는다 — 초점이 웹뷰로
       넘어가는 것이 바깥을 누른 신호다(핀 말풍선 · 주소 팝과 같은 손). */
    const onFocusIn = (event: FocusEvent) => {
      if ((event.target as HTMLElement | null)?.tagName === "WEBVIEW") close.current();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [anchor]);
  /**
   * 팝이 위로(`up`)든 아래로든 앵커가 놓인 방향의 남은 공간보다 크면 팝 한쪽
   * 끝이 자르는 면 밖으로 나가, 굴려도 닿을 수 없는 부분이 된다. 자르는 면은
   * 둘이다 — 창 가장자리와, 팝을 안쪽에서 자르는 조상 상자(홈처럼 overflow
   * 가 굴리는 면). 창만 재면 문제 문장이 조상의 위끝을 눌러 내린 만큼 팝이
   * 솟아 잘린다. 팝을 여는 순간 앵커와 그 면들을 함께 재서 높이 상한을 안쪽에
   * 묶고, 창이 바뀌거나 어느 조상이 굴러도 다시 잰다.
   */
  useLayoutEffect(() => {
    const el = ref.current;
    const anchorEl = anchor.current;
    if (!el || !anchorEl) return;
    if (float) {
      const place = () => {
        const rect = anchorEl.getBoundingClientRect();
        const gap = 6;
        const edge = 12;
        // 원래 크기를 다시 재려고 이전에 묶은 상한을 푼다.
        el.style.maxHeight = "";
        el.style.maxWidth = `${Math.max(200, window.innerWidth - edge * 2)}px`;
        const natural = el.offsetHeight;
        const above = rect.top - gap - edge;
        const below = window.innerHeight - rect.bottom - gap - edge;
        const goUp = up ? above >= natural || above >= below : below < natural && above > below;
        // 들어오는 움직임의 기준점(ui.css 의 transform-origin)이 뒤집힌 방향을 따라간다.
        el.dataset.side = goUp ? "up" : "down";
        const room = Math.max(96, Math.floor(goUp ? above : below));
        el.style.maxHeight = `${room}px`;
        const width = el.offsetWidth;
        const left = align === "end" ? rect.right - width : rect.left;
        el.style.position = "fixed";
        el.style.left = `${Math.round(Math.min(Math.max(edge, left), window.innerWidth - width - edge))}px`;
        el.style.right = "auto";
        if (goUp) {
          el.style.top = "auto";
          el.style.bottom = `${Math.round(window.innerHeight - rect.top + gap)}px`;
        } else {
          el.style.bottom = "auto";
          el.style.top = `${Math.round(rect.bottom + gap)}px`;
        }
      };
      place();
      window.addEventListener("resize", place);
      document.addEventListener("scroll", place, true);
      return () => {
        window.removeEventListener("resize", place);
        document.removeEventListener("scroll", place, true);
      };
    }
    const clamp = () => {
      const rect = anchorEl.getBoundingClientRect();
      let limitTop = 0;
      let limitBottom = window.innerHeight;
      let limitLeft = 0;
      let limitRight = window.innerWidth;
      for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent);
        if (style.display === "contents") continue;
        const box = parent.getBoundingClientRect();
        if (style.overflowY !== "visible") {
          limitTop = Math.max(limitTop, box.top);
          limitBottom = Math.min(limitBottom, box.bottom);
        }
        if (style.overflowX !== "visible") {
          limitLeft = Math.max(limitLeft, box.left);
          limitRight = Math.min(limitRight, box.right);
        }
      }
      // 여백 12px — 가장자리에 딱 붙이지 않는다.
      const space = Math.max(140, (up ? rect.top - limitTop : limitBottom - rect.bottom) - 12);
      el.style.maxHeight = `${Math.floor(space)}px`;
      /* 위 계산은 누른 단추의 자리를 기준으로 하지만 팝은 그 단추를 감싼 인라인 상자
         (`nx-anchor`)에서 6px 떨어져 서므로 두 기준이 몇 px 어긋나 팝 끝이 자르는 면 밖으로
         나간다(정산 줄의 `···` 메뉴 첫 줄이 위에서 잘렸다). 서 버린 팝을 다시 재어 남는
         만큼 높이를 더 줄인다 — 팝은 안에서 굴러가므로 줄여도 닿을 수 없는 곳은 없다. */
      const placed = el.getBoundingClientRect();
      const bleed = up ? limitTop + 8 - placed.top : placed.bottom - (limitBottom - 8);
      if (bleed > 0) {
        el.style.maxHeight = `${Math.max(96, Math.floor(placed.height - bleed))}px`;
      }
      /* 옆으로도 같다 — 오른쪽에 맞춘(end) 넓은 팝은 대화 칸을 좁히면 왼쪽 끝이
         창 밖으로 나가 잘렸다(모델 팝, 실사). 팝이 서는 기준은 부모(`nx-anchor`)
         의 한쪽 끝이라 그 끝에서 반대쪽 면까지를 폭 상한으로 묶는다. */
      const base = el.parentElement?.getBoundingClientRect() ?? rect;
      const room = Math.max(
        200,
        (align === "end" ? base.right - limitLeft : limitRight - base.left) - 12,
      );
      el.style.maxWidth = `${Math.floor(room)}px`;

      // 가로도 같다 — 좁은 창 칸(대화 칸)에서 팝이 옆 칸 아래로 들어가 잘린다.
      // 자르는 면 안쪽으로 팝을 밀어 넣는다(오른쪽 우선, 그다음 왼쪽).
      el.style.marginLeft = "";
      el.style.marginRight = "";
      const box = el.getBoundingClientRect();
      const margin = 8;
      const overRight = box.right - (limitRight - margin);
      const overLeft = limitLeft + margin - box.left;
      const shift =
        overRight > 0
          ? -Math.min(overRight, box.left - limitLeft - margin)
          : overLeft > 0
            ? overLeft
            : 0;
      if (shift !== 0) {
        if (align === "end") el.style.marginRight = `${-shift}px`;
        else el.style.marginLeft = `${shift}px`;
      }
    };
    clamp();
    window.addEventListener("resize", clamp);
    document.addEventListener("scroll", clamp, true);
    return () => {
      window.removeEventListener("resize", clamp);
      document.removeEventListener("scroll", clamp, true);
    };
  }, [anchor, up, align, float]);
  const classes = ["nx-pop", `nx-pop--${align}`, up ? "nx-pop--up" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  // 역할은 `dialog` · `menu` 둘뿐이고 둘 다 이름(aria-label)을 받는다 — 동적 역할이라 한데 묶어 건넨다.
  const aria = { role, "aria-label": label };
  const panel = (
    <div ref={ref} className={classes} data-side={up ? "up" : "down"} {...aria}>
      {children}
    </div>
  );
  if (!float) return panel;
  // 앱 뿌리(`.nx`) 안이어야 테마 변수와 `.nx …` 규칙이 그대로 닿는다.
  const root = anchor.current?.closest<HTMLElement>(".nx") ?? document.body;
  return createPortal(panel, root);
}
