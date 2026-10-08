/**
 * 기계 동작의 한국어 이름 (PLAN D37). The transcript's tool rows and the
 * permission card show these instead of the CLI's English tool names; an
 * unknown name passes through unchanged. Lives in `protocol` because the
 * daemon's permission notices (daemon/src/translate.ts) and the web's
 * transcript need the same words — one file, or the two surfaces drift (the
 * M6 marker lesson).
 */
const NAMES: Record<string, string> = {
  Bash: "명령 실행",
  PowerShell: "명령 실행",
  Read: "파일 읽기",
  Write: "파일 만들기",
  Edit: "파일 고치기",
  MultiEdit: "파일 고치기",
  NotebookEdit: "노트북 고치기",
  Glob: "파일 찾기",
  Grep: "파일 찾기",
  WebFetch: "웹 읽기",
  WebSearch: "웹 찾아보기",
  TodoWrite: "할 일 정리",
  LS: "폴더 보기",
  // 서브에이전트 도구 — 옛 CLI 는 `Task`, SDK 0.3.x 타입은 `Agent`(2026-10-02). 둘 다 같은 일이다.
  Task: "보조 작업",
  Agent: "보조 작업",
  AskUserQuestion: "질문",
  // 앱이 올리는 도구(daemon/src/browser-tools.ts 의 전부) — 허락 카드와 작업 과정 줄에 `browser_snapshot`
  // 같은 영어가 그대로 떴다(베타 준비 분석 2026-10-07). 사용자의 어휘로: 화면을 열고 · 읽고 · 누르고 ·
  // 입력한다. `submit_for_review` 는 사용자가 대화로 제출을 청했을 때만 불리는 도구라 「제출 요청」 —
  // AI 가 스스로 제출하는 것으로 읽히지 않게 「제출하기」 라 쓰지 않는다(제출은 사용자의 일이다).
  browser_navigate: "화면 열기",
  browser_snapshot: "화면 읽기",
  browser_find: "화면에서 찾기",
  browser_inspect: "요소 살피기",
  browser_screenshot: "화면 사진 찍기",
  browser_click: "누르기",
  browser_fill: "입력하기",
  browser_type: "입력하기",
  browser_press: "키 누르기",
  browser_scroll: "스크롤하기",
  browser_hover: "마우스 올려 보기",
  browser_select: "고르기",
  browser_drag: "끌어 놓기",
  browser_wait: "기다리기",
  browser_console: "오류 기록 보기",
  browser_evaluate: "화면에서 실행하기",
  browser_back: "뒤로 가기",
  browser_forward: "앞으로 가기",
  // 브라우저 게이트의 허락 카드는 도구 이름이 아니라 op 이름(`browser_${op}`)으로 묻는다 —
  // 이름이 다른 둘(`browser_wait` · `browser_console`)만 따로 둔다.
  browser_waitFor: "기다리기",
  browser_consoleLines: "오류 기록 보기",
  screen_check: "화면 확인",
  repo_diagnostics: "오류 검사",
  submit_for_review: "제출 요청",
  screen_files: "화면 파일 찾기",
  notify_developer: "개발자에게 알리기",
  // Codex 가 올리는 이름 — daemon/src/tool-names.ts 의 통계 표와 같은 이름이다(시험이 일치를 지킨다).
  commandExecution: "명령 실행",
  execCommand: "명령 실행",
  exec_command: "명령 실행",
  run_command: "명령 실행",
  Shell: "명령 실행",
  shell: "명령 실행",
  fileChange: "파일 고치기",
  applyPatch: "파일 고치기",
  apply_patch: "파일 고치기",
  edit_file: "파일 고치기",
  write_file: "파일 만들기",
  view: "파일 읽기",
  view_file: "파일 읽기",
  read_file: "파일 읽기",
  webSearch: "웹 찾아보기",
};

/** The Korean action name for a tool, or the raw name when unknown. */
export function toolLabel(name: string): string {
  // SDK 가 올린 MCP 도구는 `mcp__<서버>__<이름>` 로, Codex 는 `<서버>/<이름>` 로
  // 온다: the server prefix is plumbing, so the dictionary keys on the tool's
  // own name. An unknown tool still passes through with its full name —
  // nothing here invents a label the dictionary does not have.
  const bare = name.startsWith("mcp__")
    ? name.slice(name.lastIndexOf("__") + 2)
    : name.slice(name.lastIndexOf("/") + 1);
  // `Object.hasOwn` — `constructor` · `toString` 같은 이름이 사전의 상속 칸에 걸리지 않게.
  return Object.hasOwn(NAMES, bare) ? (NAMES[bare] as string) : name;
}
