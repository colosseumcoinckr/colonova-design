import { type UIEvent, useEffect, useState } from "react";
import { PICKER_THEMES, type PickerTheme, type Settings } from "../../lib/settings";
import { L } from "../labels";
import { keyHint } from "../lib/key-hint";
import { keyCaps } from "../lib/shortcut-sheet";
import { CheckIcon } from "../ui/icons";
import { radioArrowStep, rovingTab, SGroup, SPage, SRow, ThemePeek } from "./parts";

/** 글자 크기의 단축키 — 앱 전체를 키우고 줄이는 길은 단축키뿐이라 어디에도 안 보였다. */
const ZOOM_KEYS = [
  { keys: "⌘=", label: L.settings.zoomIn },
  { keys: "⌘-", label: L.settings.zoomOut },
  { keys: "⌘0", label: L.settings.zoomReset },
] as const;

/** 지금 시스템이 어두운가 — `시스템 따르기` 카드가 지금 무엇을 따르는지 말한다. */
function useSystemDark(): boolean {
  const [dark, setDark] = useState(
    () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const onChange = () => setDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return dark;
}

/** 테마 쪽 — 일곱 카드 사이를 화살표로 옮겨 가며 곧바로 고른다. 시스템 카드는 첫 줄을 다 쓴다. */
export function ThemePage({
  active,
  settings,
  onSettingsChange,
  onScroll,
}: {
  active: boolean;
  settings: Settings;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
}) {
  const themeAt = PICKER_THEMES.indexOf(settings.theme as PickerTheme);
  const dark = useSystemDark();
  return (
    <SPage id="theme" active={active} onScroll={onScroll}>
      {/* 같은 일곱 선택 — 보이는 법만 카드로. 미리보기는 진짜 팔레트를 입은 작은 앱 창이다. */}
      <div
        className="nx-tgrid"
        role="radiogroup"
        aria-label={L.settings.theme}
        onKeyDown={(event) =>
          radioArrowStep(event, themeAt, PICKER_THEMES.length, (index) => {
            const choice = PICKER_THEMES[index];
            if (choice) onSettingsChange({ theme: choice });
          })
        }
      >
        {PICKER_THEMES.map((choice, index) => (
          // biome-ignore lint/a11y/useSemanticElements: 카드 전체가 누르는 과녁이다 — AI 카드와 같은 모양(radiogroup 안).
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={settings.theme === choice}
            tabIndex={rovingTab(index, themeAt)}
            className={`nx-tcard${choice === "system" ? " nx-tcard--sys" : ""}${
              settings.theme === choice ? " nx-tcard--on" : ""
            }`}
            onClick={() => onSettingsChange({ theme: choice })}
          >
            <ThemePeek choice={choice} />
            <span className="nx-tname">
              <b>{L.settings.themeNames[choice]}</b>
              {choice === "system" && (
                <span className="nx-tnow">· {L.settings.themeSystemNow(dark)}</span>
              )}
              {settings.theme === choice && <CheckIcon />}
            </span>
          </button>
        ))}
      </div>
      <SGroup>
        <SRow
          title={L.settings.zoom}
          sub={
            <span className="nx-zoomsub">
              <span>{L.settings.zoomSub}</span>
              <span className="nx-zk">
                {ZOOM_KEYS.map((entry) => (
                  <span key={entry.keys} className="nx-zk-i">
                    <span className="nx-zk-caps">
                      {keyCaps(keyHint(entry.keys))[0]?.map((part) => (
                        <kbd key={part.text} className="nx-kc">
                          {part.text}
                        </kbd>
                      ))}
                    </span>
                    {entry.label}
                  </span>
                ))}
              </span>
            </span>
          }
        />
      </SGroup>
    </SPage>
  );
}
