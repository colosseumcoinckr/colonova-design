import { APP_SHORTCUTS } from "@colonova-design/protocol";
import type { CSSProperties } from "react";
import { L } from "../../next/labels";
import { keyHint } from "../../next/lib/key-hint";
import { type CapPart, capsLabel, groupShortcuts, keyCaps } from "../../next/lib/shortcut-sheet";
import { KeyboardIcon } from "../../next/ui/icons";
import { ModalBody, ModalFoot, ModalFrame, ModalHead } from "../../next/ui/ModalFrame";

/**
 * ⌘/ 단축키 시트 — 단축키의 목록은 언제나 열어 볼 수 있는 곳에 산다.
 * 행은 protocol 의 APP_SHORTCUTS, 데스크톱 앱 메뉴가 읽는 상수와 같은 한 벌이다.
 *
 * 2026-10-06 겹판 손질 — 옛 `.modal` 틀을 걷고 겹판 뼈대(`ModalFrame`)로 옮겼다: 같은 스크림 ·
 * 닫는 모션 · 초점 가두기. 행은 하는 일별 묶음으로 나뉘고, 키는 한 알씩 키캡으로 그린다. 묶음에
 * 안 적힌 새 단축키는 `그 밖에` 로 가서 시트에서 말없이 사라지지 않는다.
 */

/**
 * 묶음의 순서와 소속 — 행의 글은 프로토콜이 쥐고 여기는 id 만 안다. 순서는 앱 → 입력창 → 핀 →
 * 미리보기 → 그 밖에다: 두 열로 흐를 때 짧은 셋이 왼쪽 열을, 긴 미리보기가 오른쪽 열을 채워
 * 열 높이가 고르게 맞는다(다단은 순서대로 채우므로 순서가 곧 배치다).
 */
const LAYOUT = [
  { key: "app", ids: ["find", "new-session", "settings", "sidebar", "shortcuts"] },
  { key: "composer", ids: ["recall"] },
  { key: "pin", ids: ["pin", "pin-mode"] },
  {
    key: "preview",
    ids: [
      "address",
      "reload",
      "back",
      "forward",
      "zoom-in",
      "zoom-out",
      "zoom-reset",
      "preview-zoom",
    ],
  },
  { key: "rest", ids: [] },
] as const;

type GroupKey = (typeof LAYOUT)[number]["key"];

const GROUP_TITLE: Record<GroupKey, string> = {
  app: L.sheet.groupApp,
  preview: L.sheet.groupPreview,
  pin: L.sheet.groupPin,
  composer: L.sheet.groupComposer,
  rest: L.sheet.groupRest,
};

/** 키 표기 한 칸 — 눌러야 하는 키는 캡으로, 뜻을 말하는 낱말은 글자로 그린다. 낭독은 통째로 한 번만. */
function KeyCaps({ keys }: { keys: string }) {
  const alternatives = keyCaps(keyHint(keys));
  const cap = (part: CapPart, at: number) =>
    part.kind === "key" ? (
      <kbd key={`${at}-${part.text}`} className="nx-kc">
        {part.text}
      </kbd>
    ) : (
      <span key={`${at}-${part.text}`} className="nx-kw">
        {part.text}
      </span>
    );
  return (
    <span className="nx-sc-keys" role="img" aria-label={capsLabel(alternatives)}>
      {alternatives.map((alternative, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 대안의 순서가 곧 정체성이다.
        <span key={index} className="nx-sc-alt" aria-hidden="true">
          {alternative.map(cap)}
        </span>
      ))}
    </span>
  );
}

export function ShortcutsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const groups = groupShortcuts(APP_SHORTCUTS, LAYOUT, "rest");
  const openKeys = APP_SHORTCUTS.find((shortcut) => shortcut.id === "shortcuts")?.keys;
  return (
    <ModalFrame open={open} onClose={onClose} className="nx-sc">
      <ModalHead title={L.sheet.title} sub={L.sheet.sub} icon={<KeyboardIcon />} />
      <ModalBody>
        <div className="nx-sc-grid">
          {groups.map((group, index) => (
            <section
              key={group.key}
              className="nx-sc-group"
              style={{ "--i": index } as CSSProperties}
            >
              <h3>{GROUP_TITLE[group.key]}</h3>
              <ul>
                {group.rows.map((shortcut) => (
                  <li key={shortcut.id} className="nx-sc-row">
                    <span className="nx-sc-label">{shortcut.label}</span>
                    <KeyCaps keys={shortcut.keys} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </ModalBody>
      {openKeys && (
        <ModalFoot className="nx-sc-foot">
          <span>{L.sheet.footBefore}</span>
          <KeyCaps keys={openKeys} />
          <span>{L.sheet.footAfter}</span>
        </ModalFoot>
      )}
    </ModalFrame>
  );
}
