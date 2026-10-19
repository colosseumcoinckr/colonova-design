const DRAFT_PREFIX = "colonova-design.draft.";

/** 실패한 글과 첨부를 돌려놓되, 기다리며 새로 쓴 말도 보존한다. */
export function restoreRejectedDraft<T>(
  sent: { text: string; attachments: T[] },
  current: { text: string; attachments: T[] },
): { text: string; attachments: T[] } {
  return {
    text: current.text ? `${sent.text}${sent.text ? "\n\n" : ""}${current.text}` : sent.text,
    attachments: [...sent.attachments, ...current.attachments],
  };
}

/** Clear an accepted draft even when its home composer has already unmounted. */
export function clearSentDraft(
  key: string,
  sentText: string,
  storage?: Pick<Storage, "getItem" | "removeItem">,
): void {
  try {
    const target = storage ?? localStorage;
    const stored = target.getItem(DRAFT_PREFIX + key);
    if (stored === sentText) target.removeItem(DRAFT_PREFIX + key);
  } catch {
    // Storage can be unavailable in private mode.
  }
}
