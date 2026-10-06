import type { ComponentType } from "react";
import { L } from "../labels";
import type { Starter, StarterKey } from "../lib/home-starters";
import { StarterEmptyIcon, StarterPhoneIcon, StarterTidyIcon, StarterWordsIcon } from "../ui/icons";

const ICONS: Record<StarterKey, ComponentType> = {
  words: StarterWordsIcon,
  empty: StarterEmptyIcon,
  phone: StarterPhoneIcon,
  tidy: StarterTidyIcon,
};

/**
 * 입력창 아래의 시작점 칩(2026-10-06 홈 개선) — 무엇을 말해야 할지 막막할 때 요청의 모양을 보여 준다.
 * 누르면 보내지 않고 입력창에 고쳐 쓸 초안이 담긴다(`onPick`). 입력창에 말이 생기면 `away` 로
 * 접혀 물러난다 — 쓰던 말을 덮는 길이 없도록 접힌 칩은 `inert` 로 초점도 받지 못한다.
 */
export function HomeStarters({
  starters,
  away,
  onPick,
}: {
  starters: Starter[];
  away: boolean;
  onPick: (starter: Starter) => void;
}) {
  return (
    <div className={`nx-starters${away ? " nx-starters--away" : ""}`} inert={away}>
      {/* biome-ignore lint/a11y/useSemanticElements: 칩의 한 줄(세그먼트) — fieldset 의 테두리 · legend 틀이 필요 없는 자리라 group 으로 읽힌다. */}
      <div className="nx-starters-in" role="group" aria-label={L.home.startersLabel}>
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
