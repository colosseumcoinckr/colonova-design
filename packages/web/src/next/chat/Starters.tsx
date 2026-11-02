import type { ComponentType } from "react";
import { L } from "../labels";
import type { Starter, StarterKey } from "../lib/starters";
import { PinIcon } from "../preview/icons";
import { StarterEmptyIcon, StarterPhoneIcon, StarterTidyIcon, StarterWordsIcon } from "../ui/icons";

const ICONS: Record<StarterKey, ComponentType> = {
  words: StarterWordsIcon,
  empty: StarterEmptyIcon,
  phone: StarterPhoneIcon,
  tidy: StarterTidyIcon,
};

/**
 * 새 대화의 빈 자리의 시작점 칩(2026-10-06 홈 개선 · 2026-10-31 홈 걷기로 옮겼다) — 무엇을 말해야
 * 할지 막막할 때 요청의 모양을 보여 준다. 누르면 보내지 않고 입력창에 고쳐 쓸 초안이 담긴다(`onPick`).
 * 입력창에 말이 생기면 `away` 로 접혀 물러난다 — 쓰던 말을 덮는 길이 없도록 접힌 칩은 `inert` 로
 * 초점도 받지 못한다. 첫 칸은 `찍기`(2026-10-31 화면 자리 개선안 S5 — 옛 `수정할 곳 선택` 단추가
 * 칩 줄의 첫 칸으로 합쳐졌다)이다: 누르면 미리보기에서 고칠 곳을 짚는다.
 */
export function Starters({
  starters,
  away,
  onPick,
  onPin,
}: {
  starters: Starter[];
  away: boolean;
  onPick: (starter: Starter) => void;
  /** 첫 칸의 찍기 — 없으면(준비 중) 칩도 서지 않는다. */
  onPin?: () => void;
}) {
  return (
    <div className={`nx-starters${away ? " nx-starters--away" : ""}`} inert={away}>
      {/* biome-ignore lint/a11y/useSemanticElements: 칩의 한 줄(세그먼트) — fieldset 의 테두리 · legend 틀이 필요 없는 자리라 group 으로 읽힌다. */}
      <div className="nx-starters-in" role="group" aria-label={L.composer.startersLabel}>
        <span className="nx-starters-label">{L.composer.startersLabel}</span>
        {onPin && (
          <button type="button" className="nx-starter" title={L.preview.pinTip} onClick={onPin}>
            <span className="nx-starter-i">
              <PinIcon />
            </span>
            {L.preview.pin}
          </button>
        )}
        {starters.map((starter) => {
          const Icon = ICONS[starter.key];
          return (
            <button
              key={starter.key}
              type="button"
              className="nx-starter"
              /* 눌렀을 때 담길 문장을 미리 보여 준다 — 칩 이름만으로는 무엇이 담기는지 모른다. */
              title={starter.text}
              onClick={() => onPick(starter)}
            >
              <span className="nx-starter-i">
                <Icon />
              </span>
              {starter.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
