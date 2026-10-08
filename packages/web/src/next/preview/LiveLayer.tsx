import { L } from "../labels";
import type { LiveLine } from "../lib/follow-edit";

/**
 * 한 줄의 말을 [이름 앞, 이름, 이름 뒤] 로 — 이름이 없는 말은 앞에 전부, 이름은 null. 긴 이름만 줄임표로 잘리고
 * 문장의 끝은 남게 이름을 따로 그린다. 문장은 labels 가 쥔다.
 */
export function liveLineParts(line: LiveLine): [string, string | null, string] {
  if (line.kind === "driving") return [L.live.driving, null, ""];
  const [before, after] =
    line.kind === "moved" ? L.live.moved(line.name) : L.live.editing(line.name);
  return [before, line.name, after];
}

/**
 * 미리보기 무대 위의 라이브 층(2026-10-08 베타 준비 분석) — AI 가 일하는 동안 무엇을 하는지 말하는 두 가지다.
 * `ring` 은 AI 가 화면을 직접 누르는 동안 무대 가장자리에 서는 옅은 고리, `line` 은 아래 가운데의 한 줄(눌러 보는 중 ·
 * 고치는 중 · 방금 옮겼어요). 둘 다 입력을 막지 않는다(`pointer-events: none`) — 표시만 하고 잠그지 않는다.
 * 무대 안에 그려지므로 덮개(`.nx-over`)와 얼린 화면은 이 위에 서서 이 층을 가린다. 칸이 아니라 이 조각이 마크업을
 * 쥐는 까닭은 견본(`dev/preview-fixture.html`)이 같은 마크업 · 같은 CSS 를 그대로 그리게 하려는 것이다.
 */
export function LiveLayer({ line, ring }: { line: LiveLine | null; ring: boolean }) {
  const [before, name, after] = line ? liveLineParts(line) : ["", null, ""];
  return (
    <>
      {ring && <div className="nx-pvdrive" aria-hidden="true" />}
      {line && (
        <span key={line.kind} className={`nx-pvlive nx-pvlive--${line.kind}`} role="status">
          <i className="nx-pvlive-dot" aria-hidden="true" />
          {name === null ? (
            <span className="nx-pvlive-txt">{before}</span>
          ) : (
            <span className="nx-pvlive-txt nx-pvlive-txt--named">
              <span className="nx-pvlive-pre">{before}</span>
              <span className="nx-pvlive-name">{name}</span>
              <span className="nx-pvlive-post">{after}</span>
            </span>
          )}
        </span>
      )}
    </>
  );
}
