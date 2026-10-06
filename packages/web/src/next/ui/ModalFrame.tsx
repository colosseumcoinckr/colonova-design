import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useId,
  useRef,
} from "react";
import { useModalEscape, useModalFocus } from "../../hooks/use-modal-focus";
import { L } from "../labels";
import { useClosing } from "../lib/use-closing";
import { CloseIcon } from "./icons";

interface FrameContext {
  titleId: string;
  /** 닫기를 청한다 — 잠겨 있으면 아무 일도 없다. */
  request: () => void;
  locked: boolean;
}

const Frame = createContext<FrameContext | null>(null);

/**
 * 겹판(대화상자)의 뼈대 — 스크림 · 판 · 이름 · 초점 가두기 · Esc(맨 위 층만) · 스크림 누름 ·
 * 닫는 모션을 한 곳에서 맡는다(2026-10-06 겹판 손질). 피드백 · 초대 확인판 · 단축키 · 비교 ·
 * 제출 확인이 같은 마크업과 훅 서넛을 복붙하던 것이다.
 *
 * 닫기의 길은 하나다 — Esc · 스크림 · `ModalHead` 의 ✕ 가 모두 `request()` 로 모이고,
 * 열림의 거꾸로가 끝나는 뒤에 `onClose` 가 불린다(`useClosing`). 안의 단추가 직접 닫을 때는
 * `useModalClose()` 로 같은 손을 쓴다. `locked` 는 닫으면 안 되는 동안(적용 중)이다.
 *
 * 판은 세로 flex 다 — `ModalHead` · `ModalFoot` 는 굴러가지 않고 `ModalBody` 만 굴러간다.
 * 안쪽이 한 덩어리로 굴러야 하는 옛 판(`.nx-modal` 만 쓰는 곳)은 이 뼈대를 쓰지 않는다.
 */
export function ModalFrame({
  open = true,
  locked = false,
  onClose,
  onRequestClose,
  label,
  describedBy,
  className = "",
  backClassName = "",
  dismissOnScrim = true,
  returnRef,
  children,
}: {
  /** 늘 마운트해 두는 대화상자는 닫힌 동안 false — 훅은 걸리지 않고 아무것도 그리지 않는다. */
  open?: boolean;
  locked?: boolean;
  /** 닫는 모션이 끝난 뒤. */
  onClose: () => void;
  /** 닫기를 청한 순간 — 모션이 시작되기 전에 해 둘 일(적던 글 보관 같은). */
  onRequestClose?: () => void;
  /** `ModalHead` 가 없는 판의 이름. 있으면 제목의 id 보다 이것이 이긴다. */
  label?: string;
  describedBy?: string;
  /** 판의 폭 · 높이를 정하는 클래스(`nx-fb`, `nx-sc` …). */
  className?: string;
  /** 스크림에 덧붙일 클래스(`nx-compare-back` …). */
  backClassName?: string;
  /** 스크림을 누르면 닫는다 — 닫으면 안 되는 판만 끈다. */
  dismissOnScrim?: boolean;
  /** 닫힌 뒤 초점이 돌아갈 곳 — 모르면 열기 직전에 초점이 있던 곳이다. */
  returnRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const { closing, begin } = useClosing(onClose);
  const request = () => {
    if (locked || closing) return;
    onRequestClose?.();
    begin();
  };
  const live = open && !closing;
  useModalFocus(panel, live, returnRef);
  useModalEscape(panel, request, live && !locked);
  // 열릴 때 초점은 판에 둔다 — 안의 첫 입력칸을 바로 주고 싶은 판은 제 효과가 이어서 옮긴다.
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);
  if (!open) return null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 스크림은 포인터 전용의 닫기 손이다 — 키보드의 닫기는 Esc 와 ✕ 가 맡는다.
    <div
      className={`nx-modal-back${closing ? " nx-modal-back--out" : ""}${backClassName ? ` ${backClassName}` : ""}`}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target !== event.currentTarget) return;
        // 기본 동작(스크림을 눌러 초점이 body 로 옮겨 가는 것)을 막는다 — 닫힘이 막 돌려준 초점을
        // 눌림의 blur 가 다시 빼앗지 않게(2026-10-06 T 의 제출 확인에서 재현).
        event.preventDefault();
        if (dismissOnScrim) request();
      }}
    >
      <Frame.Provider value={{ titleId, request, locked }}>
        <div
          ref={panel}
          className={`nx-modal nx-modal--frame${className ? ` ${className}` : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={label}
          aria-labelledby={label ? undefined : titleId}
          aria-describedby={describedBy}
          tabIndex={-1}
        >
          {children}
        </div>
      </Frame.Provider>
    </div>
  );
}

/** 안의 단추가 판을 닫을 때 — ✕ 와 같은 길(닫는 모션 · 잠금)을 지난다. */
export function useModalClose(): () => void {
  const frame = useContext(Frame);
  return frame?.request ?? (() => undefined);
}

/**
 * 판의 머리 — 제목(낭독이 판의 이름으로 읽는다) · 한 줄 설명 · ✕. 굴러가도 머리는 선다.
 * `children` 은 ✕ 앞에 서는 덧단추(복사 · 설정 같은 머리의 손).
 */
export function ModalHead({
  title,
  sub,
  icon,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  const frame = useContext(Frame);
  return (
    <div className="nx-mhd">
      {icon && <span className="nx-mhd-ic">{icon}</span>}
      <div className="nx-mhd-t">
        <h2 id={frame?.titleId}>{title}</h2>
        {sub && <p>{sub}</p>}
      </div>
      {children}
      <button
        type="button"
        className="nx-ibtn nx-mhd-x"
        aria-label={L.modal.close}
        disabled={frame?.locked}
        onClick={frame?.request}
      >
        <CloseIcon />
      </button>
    </div>
  );
}

/** 굴러가는 몸 — 위아래로 더 있으면 가장자리에 그림자가 비친다(CSS 만으로). */
export function ModalBody({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`nx-mbody nx-mbody--frame${className ? ` ${className}` : ""}`}>{children}</div>
  );
}

/** 굴러가지 않는 바닥 — 주 단추는 오른쪽 끝이다. */
export function ModalFoot({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`nx-mfoot nx-mfoot--frame${className ? ` ${className}` : ""}`}>{children}</div>
  );
}
