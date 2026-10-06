import { useId, useState } from "react";
import { composing } from "../../lib/ime";
import { L } from "../labels";

/**
 * `개발자에게 한마디 더` 의 상자 — 쓰던 글(`draft`)은 부르는 쪽(상태 줄)이 쥔다(2026-10-06 겹판 조사:
 * 영수증 카드의 `ReplyBox` 는 글을 제 안에 두어, 팝이 Esc 나 바깥 누름 한 번에 닫히면 쓰던 한마디가 함께
 * 사라졌다). Esc 는 이 상자만 접고(`stopPropagation` — 바깥 팝까지 닫지 않는다) 글은 남는다; 보내야만 비운다.
 * 모양은 카드의 답하기 줄과 같은 클래스(`nx-reply`)를 입는다.
 */
export function NoteBox({
  placeholder,
  draft,
  onDraft,
  onSend,
  onSent,
  onCancel,
}: {
  placeholder: string;
  draft: string;
  onDraft: (text: string) => void;
  onSend: (text: string) => Promise<void>;
  onSent: (text: string) => void;
  /** Esc — 상자를 접는다. 글은 `draft` 에 남는다. */
  onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // 접근 이름은 고정으로 — 바뀌는 자리 표시는 힌트로 묶는다(2026-10-04 ux-review, ReplyBox 와 같다).
  const hintId = useId();
  const send = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await onSend(text);
      onDraft("");
      onSent(text);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="nx-reply">
        <input
          // biome-ignore lint/a11y/noAutofocus: 한마디 더를 누른 손이 곧 쓸 자리다.
          autoFocus
          value={draft}
          readOnly={busy}
          placeholder={placeholder}
          aria-label={L.composer.noteToDev}
          aria-describedby={hintId}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (composing(event)) return;
            if (event.key === "Enter") {
              event.preventDefault();
              void send();
            } else if (event.key === "Escape") {
              // 한글 조합 중의 Esc 는 위에서 걸러졌다 — 여기 온 Esc 는 상자를 접는 손이다.
              event.preventDefault();
              event.stopPropagation();
              onCancel();
            }
          }}
        />
        <span id={hintId} className="nx-sr">
          {placeholder}
        </span>
        <button
          type="button"
          className="nx-btn nx-btn--sm nx-btn--pri"
          disabled={busy || draft.trim() === ""}
          onClick={() => void send()}
        >
          {L.cards.replySend}
        </button>
      </div>
      {failed && (
        <div className="nx-reply-sent nx-tone--red" role="alert">
          {L.chat.sendFailed}
        </div>
      )}
    </>
  );
}
