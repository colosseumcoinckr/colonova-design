import { type CSSProperties, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useModalFocus } from "../../hooks/use-modal-focus";
import type { PinAttachment } from "../../hooks/usePins";
import { composing } from "../../lib/ime";
import { L } from "../labels";
import { keyHint } from "../lib/key-hint";
import { pinTitle } from "../lib/pin-name";
import { type BubblePlace, bubblePlacement, bubbleRect } from "../lib/preview-geometry";
import { TrashIcon } from "./icons";

/** `nx:pins:send` — 말풍선의 ⌘↵. 입력창(단계 2)이 지금의 글과 핀을 보낸다. */
export const PINS_SEND_EVENT = "nx:pins:send";

/** 핀 하나의 이름 — 사람이 읽는 말만(접근성 이름 · 글자 · 종류), 영역이면 `영역`, 끝까지 못 짚으면 `찍은 곳`. */
export function pinName(pin: PinAttachment): string {
  return pinTitle(pin.element, {
    area: L.pin.area,
    point: L.pin.point,
    kindButton: L.pin.kindButton,
    kindLink: L.pin.kindLink,
    kindImage: L.pin.kindImage,
    kindInput: L.pin.kindInput,
  });
}

const PIN_STYLE_NAMES: Readonly<Record<string, string>> = {
  color: L.pin.textColor,
  "background-color": L.pin.backgroundColor,
  "font-family": L.pin.font,
  "font-size": L.pin.textSize,
  "font-weight": L.pin.weight,
  "line-height": L.pin.lineHeight,
  padding: L.pin.padding,
  margin: L.pin.margin,
  "border-radius": L.pin.rounding,
  display: L.pin.layout,
  width: L.pin.width,
  height: L.pin.height,
  gap: L.pin.gap,
};

const samePlace = (a: BubblePlace, b: BubblePlace): boolean =>
  a.left === b.left &&
  a.top === b.top &&
  a.up === b.up &&
  a.arrowLeft === b.arrowLeft &&
  a.anchor.edge === b.anchor.edge &&
  a.anchor.at === b.anchor.at &&
  a.maxHeight === b.maxHeight;

/**
 * 핀 말풍선(PLAN-UI U4) — 찍은 자리에 뜨는 메모 입력. 입력창 칩의 원격
 * 조작기다: 적는 글은 곧장 `pins.setNote` 로 가서 같은 번호의 칩에 비친다.
 * 게스트 안이 아니라 앱 쪽 층에 선다 — 한글 입력과 포커스가 웹뷰로 넘어가지 않게.
 *
 * ↵ 담기(글을 두고 닫는다) · ⇧↵ 줄바꿈 · ⌘↵ 지금 보내기 · 휴지통(이 핀 빼기) · esc(적은 글
 * 없이 닫는다 — 열기 전의 메모로 되돌린다). 한글을 치는 중의 ↵ 는 글자를 확정할 뿐 담지 않는다.
 *
 * 2026-10-06 겹판 손질 — 자리는 연 순간 한 번이 아니라 말풍선의 높이가 변할 때마다 다시 잡는다(요소 정보를
 * 펼치거나 메모가 여러 줄이 되면 아래로 연 것은 담기 · 보내기 단추가 칸에 잘렸고, 위로 연 것은 화살표가 요소에서
 * 떨어졌다). 위로 열면 아랫끝이 요소에 붙들려 위로 자라고, 칸보다 길어지면 안쪽(메모 · 요소 정보)이 굴러간다.
 * 어긋날 수 있는 사건(이동 · 배율 · 바깥 누름)에는 칸이 닫는다.
 */
export function PinBubble({
  pin,
  n,
  screenName,
  frame,
  zoom,
  box,
  narrow,
  onNote,
  onRemove,
  onClose,
  toast,
}: {
  pin: PinAttachment;
  n: number;
  screenName: string;
  /** 게스트 요소의 왼쪽 위(칸 기준). */
  frame: { left: number; top: number };
  zoom: number;
  box: { width: number; height: number };
  narrow: boolean;
  onNote: (note: string) => void;
  onRemove: () => void;
  onClose: () => void;
  toast: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const nameId = useId();
  const [note, setNote] = useState(pin.note);
  const styleRows = Object.entries(pin.element.styles ?? {}).flatMap(([key, value]) => {
    const name = PIN_STYLE_NAMES[key];
    return name ? [{ name, value }] : [];
  });
  const [place, setPlace] = useState<BubblePlace | null>(null);

  // 말풍선도 대화상자의 층다리를 탄다 — Tab 이 칸 밖으로 새지 않고(ComparisonDialog
  // 의 같은 손), 닫히면 초점이 돌아간다. 초점 씨 뿌리기는 아래의 입력칸 몫이다.
  // 2026-10-04 ux-review: role=dialog 만으로 트랩이 없었다.
  useModalFocus(ref);

  // 자리 — 말풍선의 실제 높이를 재고 나서, 그리고 높이가 변할 때마다. 영역 핀의 rect 는 스크롤이 남은 페이지
  // 좌표라 화면 좌표(rectView)로 본다.
  const rect = bubbleRect(pin.element);
  // biome-ignore lint/correctness/useExhaustiveDependencies: rect · frame · box 는 객체라 값(좌표)으로 본다.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // 높이 제한을 풀고 자연스러운 높이를 잰다 — 제한이 걸린 채로 재면 늘 제한만큼만 나와 자리가 굳는다.
      const limit = el.style.maxHeight;
      el.style.maxHeight = "none";
      const size = { width: el.offsetWidth, height: el.offsetHeight };
      el.style.maxHeight = limit;
      setPlace((prev) => {
        const next = bubblePlacement({
          rect,
          frame,
          zoom,
          box,
          bubble: size,
          prefer: prev?.up ? "up" : "down",
        });
        return prev && samePlace(prev, next) ? prev : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [rect.x, rect.y, rect.width, rect.height, frame.left, frame.top, zoom, box.width, box.height]);

  // 자리가 정해져 말풍선이 보이는 그림에서 초점을 한 번 준다 — 첫 그림은 visibility:hidden 이라
  // 그때의 focus() 는 조용히 실패하고, 바로 친 글과 Enter 가 엉뚱한 곳(찍기 단추)으로 간다. 자리가 다시
  // 잡힐 때마다 줄 일은 아니다 — 요소 정보 머리에 가 있던 초점을 입력칸으로 끌어오지 않게.
  const seeded = useRef(false);
  useEffect(() => {
    if (!place || seeded.current) return;
    seeded.current = true;
    input.current?.focus({ preventScroll: true });
  }, [place]);

  // 바깥을 누르거나 게스트가 포커스를 가져가면 닫는다(글은 이미 칩에 있다).
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current?.contains(event.target as Node)) return;
      close.current();
    };
    const onFocusIn = (event: FocusEvent) => {
      if ((event.target as HTMLElement | null)?.tagName === "WEBVIEW") close.current();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  const keep = () => {
    onClose();
    toast(narrow ? L.pin.keptNarrow(n) : L.pin.keptN(n));
  };
  const sendNow = () => {
    onClose();
    window.dispatchEvent(new CustomEvent(PINS_SEND_EVENT));
  };

  // 층 숫자 75 는 이 칸(`.nx-preview` — 쌓임 맥락을 만든다) 안에서만 다른 층과 견줘진다. 앱의 겹판(70) ·
  // 찾기(75)와는 맞서지 않는다.
  const style = (
    place
      ? {
          left: place.left,
          ...(place.anchor.edge === "top" ? { top: place.anchor.at } : { bottom: place.anchor.at }),
          maxHeight: place.maxHeight,
          "--pv-arrow": `${place.arrowLeft}px`,
        }
      : { visibility: "hidden" }
  ) as CSSProperties;

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: 대화상자 안 어디서 올라온 Esc 든 이 칸이 받아 닫는다 — 입력칸 · 단추 · 요소 정보 어디에 초점이 있어도.
    <div
      ref={ref}
      className={`nx-pinbub${place?.up ? " nx-pinbub--up" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={nameId}
      tabIndex={-1}
      style={style}
      onKeyDown={(event) => {
        // Esc 는 닫기 하나다 — 메모는 치는 대로 칩에 담기므로 아무것도 잃지 않는다(2026-10-04 ux-review: 안에서는
        // 되돌리기, 밖에서는 닫기의 불일치를 하나의 규칙으로). 초점이 입력칸이 아니라 단추에 있어도 닫힌다.
        if (event.key !== "Escape" || composing(event)) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <div className="nx-pinbub-h">
        {/* 대화상자의 이름 — 번호와 이름이 머리에 이미 있다(같은 말을 이름으로 또 달지 않는다). */}
        <span className="nx-pinbub-id" id={nameId}>
          <span className="nx-sr">{L.pin.bubble}</span>
          <span className="nx-pnum">{n}</span>
          <b className="nx-pinbub-name">{pinName(pin)}</b>
          <span className="nx-pinbub-screen">· {screenName}</span>
        </span>
        <button
          type="button"
          className="nx-ibtn nx-ibtn--sm nx-r"
          title={L.pin.removePin}
          aria-label={L.pin.removePin}
          onClick={() => {
            onClose();
            onRemove();
            toast(L.pin.removed);
          }}
        >
          <TrashIcon />
        </button>
      </div>
      <div className="nx-pinbub-body">
        <textarea
          ref={input}
          className="nx-pinbub-note"
          rows={1}
          value={note}
          placeholder={L.pin.bubblePlaceholder}
          aria-label={L.pin.bubblePlaceholder}
          onChange={(event) => {
            setNote(event.target.value);
            onNote(event.target.value);
          }}
          onKeyDown={(event) => {
            if (composing(event)) return;
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              sendNow();
            } else if (event.key === "Enter" && !event.shiftKey) {
              // ⇧↵ 는 막지 않는다 — 줄바꿈이다.
              event.preventDefault();
              keep();
            }
          }}
        />
        {styleRows.length > 0 && (
          <details className="nx-pinbub-details">
            <summary>{L.pin.details}</summary>
            <dl>
              {styleRows.map(({ name, value }) => (
                <div key={name}>
                  <dt>{name}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </details>
        )}
      </div>
      <div className="nx-pinbub-f">
        <span className="nx-pinbub-hint">
          <kbd className="nx-pinbub-key">{keyHint("⇧↵")}</kbd>
          {L.pin.bubbleNewline}
        </span>
        <span className="nx-grow" />
        {/* 여러 곳을 찍고 문장 하나로 보내는 것이 기본 흐름이다 — Enter 가 하는 `담기` 가 주 단추다. */}
        <button type="button" className="nx-btn nx-btn--sm" onClick={sendNow}>
          {L.pin.sendNow}
          <span className="nx-pinbub-key" aria-hidden="true">
            {keyHint("⌘↵")}
          </span>
        </button>
        <button type="button" className="nx-btn nx-btn--sm nx-btn--pri" onClick={keep}>
          {L.pin.keep}
          <span className="nx-pinbub-key" aria-hidden="true">
            ↵
          </span>
        </button>
      </div>
    </div>
  );
}
