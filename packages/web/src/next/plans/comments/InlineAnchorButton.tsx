import { type RefObject, useCallback, useEffect, useState } from "react";
import { L } from "../../labels";

/** 지금 고른 문장 — 선택이 본문 안에 있고 비지 않았을 때만 온다(자리는 화면의 눈금). */
interface AnchorPick {
  text: string;
  top: number;
  left: number;
}

/**
 * 본문 선택 단추(2026-10-23 · 최종 구현 계획 F4 · 작업 D2b) — 본문(`.nx-pl-body`)에서 글을 고르면
 * 선택 끝 가까이에 `이 부분에 코멘트` 가 뜬다. 마우스 · 키보드 어느 쪽의 선택이든 selectionchange 로
 * 본다. 선택이 본문 밖에 걸치거나 비면 사라진다. 누르면 고른 문장을 그대로 올린다 — 닻 판정은 부르는
 * 쪽이 한다(모호하거나 바뀐 문장은 다시 고르게).
 */
export function InlineAnchorButton({
  body,
  onSelect,
}: {
  /** 본문 덩어리 — 문서 보기가 담는 참조. */
  body: RefObject<HTMLDivElement | null>;
  /** 고른 문장을 받는 쪽 — 코멘트 절이 인라인 입력을 연다. */
  onSelect: (selection: string) => void;
}) {
  const [pick, setPick] = useState<AnchorPick | null>(null);

  const read = useCallback(() => {
    const host = body.current;
    const selection = window.getSelection();
    if (
      host === null ||
      selection === null ||
      selection.isCollapsed ||
      selection.rangeCount === 0
    ) {
      setPick(null);
      return;
    }
    const range = selection.getRangeAt(0);
    const text = selection.toString();
    if (text.trim() === "" || !host.contains(range.commonAncestorContainer)) {
      setPick(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setPick({ text, top: rect.bottom, left: rect.right });
  }, [body]);

  useEffect(() => {
    document.addEventListener("selectionchange", read);
    document.addEventListener("mouseup", read);
    document.addEventListener("keyup", read);
    // 문서 보기가 굴러가면 단추는 옛 자리에 떠 있다 — 숨기고 다음 선택 때 다시 선다(2026-10-23 · R3 의심 6).
    // 굴림은 bubble 하지 않아 잡으려면 문서 단위 잡기(capture)다.
    const onScroll = () => setPick(null);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("selectionchange", read);
      document.removeEventListener("mouseup", read);
      document.removeEventListener("keyup", read);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [read]);

  if (pick === null) return null;
  return (
    <button
      type="button"
      className="nx-btn nx-btn--sm nx-dc-anchor-btn"
      style={{ top: `${pick.top + 6}px`, left: `${pick.left}px` }}
      // 누르는 사이 선택이 풀리지 않게 — 마우스 내림을 단추가 삼키지 않는다.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        onSelect(pick.text);
        setPick(null);
      }}
    >
      {L.comments.anchorButton}
    </button>
  );
}
