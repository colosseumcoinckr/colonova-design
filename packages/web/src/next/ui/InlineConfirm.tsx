import { type ReactNode, type RefObject, useEffect, useId, useLayoutEffect, useRef } from "react";

/**
 * 인라인 확인 — 되돌릴 수 없는 일(대화 지우기 · 프로젝트 빼기 · 기록으로 되돌리기) 앞에서 팝 · 서랍
 * 안의 한 칸이 확인판으로 바뀐다(2026-10-06 겹판 조사: 세 곳이 같은 복붙을 하고 있었다).
 *
 * - 제목은 일을 말하고, 본문은 무엇이 어떻게 되는지(영향의 크기 · 남는 것)를 말한다.
 * - 초점은 `그만두기` 에 선다 — 위험한 단추에 초점을 주지 않는다(Enter 한 번의 사고를 막는다).
 * - Esc 는 이 확인만 접는다(`stopPropagation` — 바깥 팝 · 서랍까지 닫지 않는다).
 * - 접힌 뒤 초점은 `returnRef`(확인을 부른 단추)로 간다. 부른 단추가 이 확인에 가려 사라졌다면
 *   부르는 쪽이 같은 자리의 단추를 다시 그린 뒤 ref 를 건넨다.
 * - 바쁜 동안은 단추가 잠기고 `busyWhy` 가 이유를 말한다(눌러야 보이는 이유가 아니라 늘 보이는 줄).
 */
export function InlineConfirm({
  title,
  body,
  confirmLabel,
  cancelLabel,
  busy = false,
  busyWhy,
  tone = "danger",
  confirmDisabled = false,
  onConfirm,
  onCancel,
  returnRef,
  className = "",
  children,
}: {
  title: ReactNode;
  body?: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel: ReactNode;
  busy?: boolean;
  /** 확인이 막힌 이유 — 있으면 확인 단추가 잠기고 이 줄이 단추 위에 선다. */
  busyWhy?: ReactNode;
  tone?: "danger" | "neutral";
  /** 이유 없이 잠글 때(입력이 모자란 경우) — 이유는 부르는 쪽이 `children` 에 둔다. */
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  returnRef?: RefObject<HTMLElement | null>;
  className?: string;
  /** 본문과 단추 사이의 덧칸(영향받는 화면 목록 같은). */
  children?: ReactNode;
}) {
  const titleId = useId();
  const bodyId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const back = useRef(returnRef);
  back.current = returnRef;
  const cancelNow = useRef(onCancel);
  cancelNow.current = onCancel;
  // 열릴 때 초점은 그만두기에.
  useEffect(() => {
    cancel.current?.focus({ preventScroll: true });
  }, []);
  // 닫힐 때(언마운트) 초점이 이 안에 있었다면 부른 단추로 돌려 보낸다. 초점이 이 안에 있었는지는 노드가 걷히기
  // 전에 — layout 정리에서 — 봐야 한다(passive 정리 때는 노드가 이미 걷혀 초점이 body 로 떨어진 뒤라 돌려 보낼
  // 수 없었다). 개발 중 StrictMode 의 가짜 언마운트는 노드가 문서에 그대로 있어, 그때 돌려 보내면 곧이어 다시 선
  // 확인의 `그만두기` 초점을 빼앗는다 — 진짜 언마운트(노드가 걷힌 뒤)에만 돌려 보낸다(2026-10-06 P).
  useLayoutEffect(() => {
    const box = cancel.current?.closest<HTMLElement>(".nx-iconf");
    return () => {
      if (!box?.contains(document.activeElement)) return;
      queueMicrotask(() => {
        if (box.isConnected) return;
        back.current?.current?.focus();
      });
    };
  }, []);
  const locked = busy || confirmDisabled || Boolean(busyWhy);
  return (
    // biome-ignore lint/a11y/useSemanticElements lint/a11y/noNoninteractiveElementInteractions: 확인은 하나의 묶음이라 fieldset 의 모양을 입지 않고, Esc 는 안의 단추에서 올라온 키를 이 칸이 받는다.
    <div
      className={`nx-iconf nx-iconf--${tone}${className ? ` ${className}` : ""}`}
      role="group"
      aria-labelledby={titleId}
      aria-describedby={body ? bodyId : undefined}
      aria-busy={busy || undefined}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.stopPropagation();
        cancelNow.current();
      }}
    >
      <p className="nx-iconf-t" id={titleId}>
        {title}
      </p>
      {body && (
        <p className="nx-iconf-b" id={bodyId}>
          {body}
        </p>
      )}
      {children}
      {busyWhy && (
        <p className="nx-iconf-why" role="status">
          {busyWhy}
        </p>
      )}
      <div className="nx-iconf-act">
        <button type="button" className="nx-btn nx-btn--sm" ref={cancel} onClick={onCancel}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`nx-btn nx-btn--sm ${tone === "danger" ? "nx-btn--dng" : "nx-btn--pri"}`}
          disabled={locked}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </div>
  );
}
