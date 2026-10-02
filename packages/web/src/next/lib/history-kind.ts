import type { RepoHistoryKind } from "@colonova-design/protocol";

/** Recover event types for older history rows that predate the typed field. */
export function historyKindOf(
  subject: string,
  kind: RepoHistoryKind | undefined,
  prefixes: { restore: string; comment: string },
): RepoHistoryKind | null {
  if (kind) return kind;
  const first = (subject.split(/\r?\n/, 1)[0] ?? "").trim();
  if (first.startsWith(prefixes.restore)) return "restore";
  if (first.startsWith(prefixes.comment)) return "comment";
  if (
    /^Merge (?:remote-tracking )?branch ['"].+['"](?: into .+)?$/.test(first) ||
    /^Merge .+ into .+$/.test(first)
  )
    return "merge";
  return null;
}
