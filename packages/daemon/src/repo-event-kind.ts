import type { RepoHistoryKind } from "@colonova-design/protocol";

/** Mark generated repository events without changing their original subjects. */
export function repoEventKind(subject: string, parents = ""): RepoHistoryKind | undefined {
  if (parents.trim().split(/\s+/).filter(Boolean).length > 1) return "merge";
  if (/^Merge (?:remote-tracking )?branch ['"].+['"](?: into .+)?$/.test(subject)) return "merge";
  if (subject.startsWith("되돌리기:")) return "restore";
  if (subject.startsWith("코멘트 반영 — ")) return "comment";
  return undefined;
}
