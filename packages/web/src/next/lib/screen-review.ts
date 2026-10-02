export type ReviewDevice = "desktop" | "tablet" | "mobile";
export interface HumanScreenReview {
  route: string;
  device: ReviewDevice;
  version: string;
  at: string;
}
export type HumanReviewState = "checked" | "pending" | "unknown" | "historical";

/** One route and size, acknowledged for exactly one authoritative saved content version. */
export function humanReviewState(
  rows: readonly HumanScreenReview[],
  route: string,
  device: ReviewDevice,
  version: string | null,
  current = true,
): HumanReviewState {
  if (!current) return "historical";
  if (!version) return "unknown";
  return rows.some((row) => row.route === route && row.device === device && row.version === version)
    ? "checked"
    : "pending";
}

export function markHumanReview(
  rows: readonly HumanScreenReview[],
  next: HumanScreenReview,
): HumanScreenReview[] {
  return [...rows.filter((row) => row.route !== next.route || row.device !== next.device), next];
}

export function parseHumanReviews(raw: string | null): HumanScreenReview[] {
  try {
    const rows: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(rows)
      ? rows.filter(
          (row): row is HumanScreenReview =>
            row &&
            typeof row.route === "string" &&
            ["desktop", "tablet", "mobile"].includes(row.device) &&
            typeof row.version === "string" &&
            typeof row.at === "string",
        )
      : [];
  } catch {
    return [];
  }
}

/** A follow-up fills an editable draft and preserves any words already being written. */
export function appendScreenDraft(current: string, addition: string): string {
  return current.trim() ? `${current.trimEnd()}\n\n${addition}` : addition;
}

/** Every status receipt invalidates an earlier read, even when visible counts stayed identical. */
export class ReviewGeneration {
  private source: unknown;
  private revision = 0;
  observe(source: unknown): number {
    if (source !== this.source) {
      this.source = source;
      ++this.revision;
    }
    return this.revision;
  }
}

/** Check again after the authoritative read; navigation, work, and token changes abort the mark. */
export async function verifyHumanReview<
  T extends { expectedPreview: string; repo: { pendingChanges: number } },
>(version: string, read: () => Promise<T>, isCurrent: () => boolean): Promise<T | null> {
  if (!isCurrent()) return null;
  const fresh = await read().catch(() => null);
  return fresh &&
    isCurrent() &&
    fresh.repo.pendingChanges === 0 &&
    fresh.expectedPreview === version
    ? fresh
    : null;
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
