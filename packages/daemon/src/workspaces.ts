/**
 * The one write policy every session runs under: edits inside the project's
 * repo clone (and the OS temp folders) are silent, and a write anywhere else
 * is refused. It used to surface a permission card for the planner to
 * answer, but every session runs bypassPermissions — nobody was ever asked,
 * so "ask" meant "allow" (베타 준비 분석 2026-10-07). The Claude PreToolUse
 * hook reads the same `pathWritable`, so hook and policy never disagree.
 */

import type { WritePolicy } from "./session.js";
import { pathWritable } from "./write-guard.js";

/**
 * The path the policy is asked about is already absolute and realpath-resolved
 * (`Session` does that before calling); `pathWritable` resolves the repo root
 * and the temp folders the same way.
 */
export function repoWritePolicy(repoRoot: string): WritePolicy {
  return (path) => (pathWritable(path, { cwd: repoRoot }) ? "allow" : "deny");
}
