const DRAFT_PREFIX = "colonova-design.draft.";

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
