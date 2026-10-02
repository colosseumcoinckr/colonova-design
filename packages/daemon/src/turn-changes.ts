import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RepoCore } from "./repo-core.js";

export type TurnSnapshot = Map<string, string>;

/** Content of pending files, including binary/untracked files; previous dirty work is a baseline. */
export async function turnSnapshot(core: RepoCore): Promise<TurnSnapshot> {
  const files = await core.diff();
  const rows = await Promise.all(
    files.map(async (file) => {
      const bytes = await readFile(join(core.root, file.path)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        },
      );
      return [
        file.path,
        bytes === null ? "deleted" : createHash("sha256").update(bytes).digest("hex"),
      ] as const;
    }),
  );
  return new Map(rows);
}

export function changedInTurn(before: TurnSnapshot | null, after: TurnSnapshot): string[] {
  if (before === null) return []; // No baseline is not evidence of an edit.
  return [...new Set([...before.keys(), ...after.keys()])].filter(
    (path) => before.get(path) !== after.get(path),
  );
}
