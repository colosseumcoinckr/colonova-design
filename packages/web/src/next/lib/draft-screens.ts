/** A follow-up fills an editable draft and preserves any words already being written. */
export function appendScreenDraft(current: string, addition: string): string {
  return current.trim() ? `${current.trimEnd()}\n\n${addition}` : addition;
}

/** Hidden screen context belongs to the draft that accepted it, including late send failures. */
export class DraftScreenHints {
  private drafts = new Map<string, Array<{ screen: string }>>();
  add(key: string, hints: readonly { screen: string }[]): void {
    this.drafts.set(
      key,
      [...(this.drafts.get(key) ?? []), ...hints].filter(
        (hint, i, rows) => rows.findIndex((row) => row.screen === hint.screen) === i,
      ),
    );
  }
  take(key: string): Array<{ screen: string }> {
    const hints = this.drafts.get(key) ?? [];
    this.drafts.delete(key);
    return hints;
  }
}
