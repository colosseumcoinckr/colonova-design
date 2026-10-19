import { relative, sep } from "node:path";

/**
 * `root` 에서 `file` 까지의 상대 경로를 `/` 로 잇는다 — 시험의 면제 목록 · 비교 열쇠(`next/labels.ts`)가
 * OS 와 상관없이 같은 글이 되게. Windows 의 `relative` 는 `\` 로 잇는다(2026-10-19 Windows 시험 점검).
 * macOS 에서는 `sep` 가 `/` 라 결과가 `relative` 와 같다.
 */
export function sourcePath(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}
