/**
 * 도구 이름표 (2026-09-23): 턴 통계(측정 — 읽기·편집·실행 묶음)가 도구 이름을
 * 모르면 그 턴은 전부 `other` 로 세고, 첫 편집까지의 시간과 핀 적중은 늘 null 이
 * 된다.
 *
 * 그래서 이름은 여기 한 곳에 산다. 코어에 두는 이유는 tool-paths 와 같다 —
 * 드라이버가 코어를 import 하는 방향만 허용된다.
 */

/** Claude Code SDK 의 도구 이름 — CLI 가 쓰는 대소문자 그대로. */
const CLAUDE_READ_TOOLS: Record<string, true> = {
  Read: true,
  Grep: true,
  Glob: true,
  LS: true,
  WebSearch: true,
};
const CLAUDE_EDIT_TOOLS: Record<string, true> = {
  Edit: true,
  Write: true,
  MultiEdit: true,
  NotebookEdit: true,
};
// Windows 의 PowerShell 도구도 명령 실행이다(2026-10-08 — 훅 matcher 와 같은 이름, `write-guard.ts` 의 SHELL_MATCHER).
const CLAUDE_EXEC_TOOLS: Record<string, true> = { Bash: true, PowerShell: true };

/**
 * 통계용 표 — 통계는 "그 턴이 레포를 읽고 · 고치고 · 돌렸는가" 를 센다.
 */
export const STATS_READ_TOOLS: Record<string, true> = { ...CLAUDE_READ_TOOLS };
export const STATS_EDIT_TOOLS: Record<string, true> = { ...CLAUDE_EDIT_TOOLS };
export const STATS_EXEC_TOOLS: Record<string, true> = { ...CLAUDE_EXEC_TOOLS };
