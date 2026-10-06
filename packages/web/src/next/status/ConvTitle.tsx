import { useEffect, useRef, useState } from "react";
import { composing } from "../../lib/ime";
import { L } from "../labels";
import { renamedTitle } from "../lib/conv-title";
import { PencilIcon } from "../ui/icons";

/**
 * 상태 줄의 대화 제목 — 한 줄로 서고, 길면 말줄임이며 전체는 툴팁에 있다. 이름을 바꿀 수
 * 있는 대화(`onRename` 이 있다)는 눌러서 그 자리에서 바꾼다 — 사이드바가 접혀 있어도
 * 닿는다. Enter · 입력칸을 벗어남은 저장, Esc 는 그만둔다. 한글 조합 중의 Enter 는
 * 저장이 아니다. 저장은 사이드바의 이름 바꾸기와 같은 길(`renamedTitle`)을 지난다.
 */
export function ConvTitle({
  title,
  onRename,
}: {
  title: string;
  /** 없으면 읽기만 한다 — 아직 태어나지 않은 새 대화는 바꿀 이름이 없다. */
  onRename?: (title: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  // 입력칸이 사라지며 blur 가 한 번 더 와도 같은 이름을 두 번 저장하지 않는다.
  const settled = useRef(true);
  const editing = draft !== null;
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const finish = (save: boolean, refocus: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const next = save && draft !== null ? renamedTitle(title, draft) : null;
    setDraft(null);
    if (next) onRename?.(next);
    // 키로 끝냈으면 초점을 제목으로 되돌린다 — 입력칸이 사라지며 허공에 남지 않게.
    if (refocus) requestAnimationFrame(() => opener.current?.focus());
  };

  if (draft !== null) {
    return (
      <div className="nx-conv-title nx-conv-title--editing">
        <input
          ref={input}
          className="nx-conv-input"
          value={draft}
          aria-label={L.convMenu.renameLabel}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => finish(true, false)}
          onKeyDown={(event) => {
            if (composing(event)) return;
            if (event.key === "Enter") finish(true, true);
            if (event.key === "Escape") {
              // 열려 있는 다른 Esc 처리기(서랍 닫기 등)까지 내려가지 않게 여기서 멈춘다.
              event.stopPropagation();
              finish(false, true);
            }
          }}
        />
      </div>
    );
  }

  if (!onRename) {
    return (
      <div className="nx-conv-title">
        <span className="nx-conv-name nx-conv-name--static" title={title}>
          <span>{title}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="nx-conv-title">
      <button
        ref={opener}
        type="button"
        className="nx-conv-name"
        title={title}
        aria-label={`${L.convMenu.rename} · ${title}`}
        onClick={() => {
          settled.current = false;
          setDraft(title);
        }}
      >
        <span>{title}</span>
        <PencilIcon />
      </button>
    </div>
  );
}
