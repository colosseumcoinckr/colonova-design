import { appendFileSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { EffortLevel } from "@colonova-design/protocol";

export interface SessionIdentity {
  publicId: string;
  vendorId: string;
  provider: string;
  model: string | null;
  effort: EffortLevel | null;
}

/** Local identity journal belongs to the clone, never to the provider's global store. */
export class SessionIdentities {
  private file(cwd: string): string {
    const dotgit = join(cwd, ".git");
    if (statSync(dotgit).isDirectory()) return join(dotgit, "colonova-session-identities.jsonl");
    const pointer = /^gitdir: (.+)\s*$/.exec(readFileSync(dotgit, "utf8"));
    if (!pointer) throw new Error("Invalid git directory");
    return join(resolve(cwd, pointer[1]!.trim()), "colonova-session-identities.jsonl");
  }

  private readonly byCwd = new Map<string, Map<string, SessionIdentity>>();

  private rows(cwd: string): Map<string, SessionIdentity> {
    let rows = this.byCwd.get(cwd);
    if (rows) return rows;
    rows = new Map();
    try {
      for (const line of readFileSync(this.file(cwd), "utf8").split("\n")) {
        try {
          const row = JSON.parse(line) as SessionIdentity;
          if (
            typeof row.publicId === "string" &&
            (row as SessionIdentity & { deleted?: boolean }).deleted
          ) {
            rows.delete(row.publicId);
            continue;
          }
          if (
            typeof row.publicId === "string" &&
            typeof row.vendorId === "string" &&
            typeof row.provider === "string"
          )
            rows.set(row.publicId, {
              ...row,
              model: typeof row.model === "string" ? row.model : null,
              effort: ["low", "medium", "high", "xhigh", "max"].includes(row.effort ?? "")
                ? row.effort
                : null,
            });
        } catch {
          /* torn tail */
        }
      }
    } catch {
      /* legacy clone or no journal */
    }
    this.byCwd.set(cwd, rows);
    return rows;
  }

  find(cwd: string, id: string, provider?: string): SessionIdentity | undefined {
    return [...this.rows(cwd).values()].find(
      (row) =>
        (row.publicId === id || row.vendorId === id) && (!provider || row.provider === provider),
    );
  }

  save(cwd: string, row: SessionIdentity): void {
    const rows = this.rows(cwd);
    if (JSON.stringify(rows.get(row.publicId)) === JSON.stringify(row)) return;
    // Tests and not-yet-cloned projects have no .git. Never create a fake repository.
    try {
      appendFileSync(this.file(cwd), `${JSON.stringify(row)}\n`, { mode: 0o600 });
    } catch {
      /* Unavailable storage must not crash a running conversation. Keep the live alias. */
    }
    rows.set(row.publicId, row);
  }

  forget(cwd: string): void {
    this.byCwd.delete(cwd);
  }

  clear(cwd: string): void {
    for (const id of [...this.rows(cwd).keys()]) this.remove(cwd, id);
    this.forget(cwd);
  }

  remove(cwd: string, id: string): void {
    const row = this.find(cwd, id);
    if (!row) return;
    try {
      appendFileSync(
        this.file(cwd),
        `${JSON.stringify({ publicId: row.publicId, deleted: true })}\n`,
        { mode: 0o600 },
      );
    } catch {
      /* same best-effort persistence as save */
    }
    this.rows(cwd).delete(row.publicId);
  }
}
