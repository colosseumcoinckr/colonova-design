import { type CSSProperties, useEffect, useRef, useState } from "react";
import { L } from "../labels";
import { TOAST_MS, type ToastNote } from "../lib/use-shell-nav";
import { CloseIcon } from "./icons";

/** 나가는 애니메이션의 길이 — ui.css 의 `nx-toast-out` 과 같은 값. */
const LEAVE_MS = 220;
/** 손을 뗀 뒤 적어도 이만큼은 더 머문다 — 떼자마자 사라지면 읽다 만 줄이 도망친다. */
const MIN_LEFT_MS = 900;

/**
 * 셸의 토스트 — 위에서 튕기며 내려앉고, 머무는 동안 아래 막대가 닳고, 사라질 때는
 * 흐려지며 올라간다. 글이 null 이 돼도 나가는 동안은 마지막 글을 붙들고 있는다.
 * 알림이 올 때마다 `seq` 가 새 토스트로 다시 내려앉힌다(같은 문장이 연달아 와도).
 *
 * 머무는 시간은 여기서 잰다 — 손이나 초점이 얹혀 있는 동안은 멈추고(막대도 함께 선다),
 * 떼면 남은 만큼만 더 머문다. `×` 는 읽고 나서 곧바로 치우는 손이다.
 */
export function Toast({ toast, onDone }: { toast: ToastNote | null; onDone: () => void }) {
  const [shown, setShown] = useState(toast);
  const [leaving, setLeaving] = useState(false);
  const [held, setHeld] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  const left = useRef(TOAST_MS);
  const startedAt = useRef(0);

  useEffect(() => {
    if (toast) {
      setShown(toast);
      setLeaving(false);
      return;
    }
    setLeaving(true);
    const timer = setTimeout(() => {
      setShown(null);
      // 손이 얹힌 채 사라진 토스트는 mouseleave 를 못 받는다 — 멈춤이 다음 토스트로 새지 않게 푼다.
      setHeld(false);
    }, LEAVE_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  // 새 알림은 처음부터 다시 잰다. 정리 함수들이 먼저 돌아 옛 알림의 남은 시간을 깎은 뒤에 이
  // 효과가 돌므로, 새 값이 이긴다. 옛 토스트에 얹혔던 손의 멈춤도 함께 푼다(옛 노드가 사라져
  // mouseleave 가 오지 않는다 — 새 노드 위에 손이 그대로면 곧 mouseenter 가 다시 건다).
  // biome-ignore lint/correctness/useExhaustiveDependencies: 열쇠가 바뀔 때만 다시 잰다 — seq 가 그 열쇠다.
  useEffect(() => {
    left.current = TOAST_MS;
    setHeld(false);
  }, [toast?.seq]);
  useEffect(() => {
    if (!toast || held) return;
    startedAt.current = Date.now();
    const timer = setTimeout(() => done.current(), left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(MIN_LEFT_MS, left.current - (Date.now() - startedAt.current));
    };
  }, [toast, held]);

  if (!shown) return null;
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: 머무는 시간을 멈추는 호버 · 초점 범위일 뿐이다 — 누르는 것은 안의 단추다.
    <div
      key={shown.seq}
      className={`nx-toast${leaving ? " nx-toast--out" : ""}${held ? " nx-toast--held" : ""}`}
      role="status"
      style={{ "--nx-toast-ms": `${TOAST_MS}ms` } as CSSProperties}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <span className="nx-toast-text">{shown.text}</span>
      <button
        type="button"
        className="nx-toast-x"
        aria-label={L.toast.close}
        onClick={() => done.current()}
      >
        <CloseIcon />
      </button>
      <span className="nx-toast-bar" aria-hidden />
    </div>
  );
}
