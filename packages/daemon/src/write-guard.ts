/**
 * AI 세션의 쓰기 울타리 (베타 준비 분석 2026-10-07).
 *
 * 모든 세션이 bypassPermissions 로 돌아 CLI 는 아무것도 묻지 않는다. 그동안 실제로 막은 것은
 * git 쓰기(git-guard.ts) 하나였고, 클론 밖의 파일(사용자 설정 · 홈의 다른 폴더)은 Write · Edit 가
 * 그대로 지났다 — 쓰기 정책(workspaces.ts)이 "묻는다" 고 답해도 아무도 묻지 않았다. 이 모듈은
 * 순수 판정 둘을 더한다. 훅(claude/session.ts 의 PreToolUse)과 코어의 decidePermission 이 같은
 * 함수를 읽어 두 길의 답이 갈라지지 않는다.
 *
 * 1. 파일 쓰기 도구(Write · Edit · MultiEdit · NotebookEdit)는 세션의 클론과 임시 폴더 안만 고친다.
 *    경로는 풀어서 본다 — 상대 경로는 클론 기준, `..` · `~` · 심볼릭 링크(끊어진 링크 — 아직 없는 파일을
 *    가리키는 링크 — 는 대상을 따라간다, paths.ts) · 아직 없는 파일 ·
 *    Windows 의 드라이브 문자와 대소문자 · 유니코드 정규화(한글 폴더 이름)까지.
 * 2. 셸 도구(Bash 와 Windows 의 PowerShell)는 뻔한 파괴만 막는다 — sudo, 클론 밖을 지우는 `rm -r`,
 *    클론 밖의 `chmod/chown -R`, 클론 밖 파일로 가는 리다이렉션. 클론 안의 정리(`rm -rf node_modules`)와
 *    /tmp 는 지난다.
 *
 * 한계: git-guard 와 같은 입장이다 — 협조적인 AI 의 실수를 막는 장치지 샌드박스가 아니다.
 * 애매하면 통과시킨다. 셸 도구는 그 밖의 쓰기(tee · cp · mv · 스크립트가 여는 파일)와 풀리지 않는
 * 변수(`$VAR`) · 명령 치환을 보지 않는다. `cd` 는 한 명령 안에서만 따라간다(앞선 호출의 `cd` 는 CLI 가
 * 훅 입력에 실어 오는 cwd 가 알려 준다). PowerShell 도구도 Bash 문법의 같은 훑개로 본다(2026-10-08 검토) —
 * 그래서 `Remove-Item -Recurse` · `Set-Content` · `Out-File` 같은 PowerShell 자신의 쓰기는 보지 않고,
 * 리다이렉션 · `rm` 별칭 · git 쓰기만 닿는다. 훑개의 드문 틈은 알고 둔다 — 서브셸 `( cd x; … )` 의 `cd` 가
 * 밖으로 새는 것 · `$(( a << b ))` 산술의 `<<` 를 heredoc 으로 읽는 것 · `$'…'` 인용 · 링크 뒤의 `..`
 * (`link/../x` 를 글자로만 접는다).
 *
 * Bash 를 git-guard 의 tokenizeShellWords 가 아니라 여기 따로 훑는 이유: 그쪽은 따옴표 정보를
 * 버려 `grep ">" /etc/hosts` 의 `>` 가 리다이렉션으로 읽히고, heredoc 본문(`cat > a <<EOF … EOF`)
 * 안의 글이 명령으로 읽힌다. 리다이렉션을 보려면 둘 다 알아야 한다. git 가드의 판정은 건드리지 않는다.
 */
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { currentPlatform, type Platform } from "./environment.js";
import {
  type GitGuardHookOutput,
  gitGuardHookDecision,
  isShellTool,
  SHELL_TOOLS,
} from "./git-guard.js";
import { realpathBestEffort } from "./paths.js";

/**
 * 파일 쓰기 도구가 클론 밖을 겨눌 때 AI 가 읽는 한 문장 — 훅의 deny 이유와 decidePermission 의
 * 거절이 같은 말을 쓴다. AI 가 답변에 옮길 수 있어 사용자 어휘만 쓴다(해요체 · 개발 어휘 없음).
 */
export const OUTSIDE_WRITE_REFUSAL =
  "이 프로젝트 폴더 밖의 파일은 고치지 않아요 — 프로젝트 안의 파일만 고쳐 주세요.";

/** Bash 의 뻔한 파괴(sudo · 클론 밖 삭제/권한/덮어쓰기)에 읽는 한 문장. */
export const OUTSIDE_COMMAND_REFUSAL =
  "관리자 권한이나 이 프로젝트 폴더 밖을 건드리는 명령은 실행하지 않아요 — 프로젝트 안의 파일만 고쳐 주세요.";

/**
 * 파일을 고치는 Claude 도구 — claude/session.ts 의 EDIT_TOOLS 와 같은 이름이다(시험이 둘의 일치를
 * 지킨다). 입력의 경로 칸은 `file_path` · `notebook_path` · `path`.
 */
export const FILE_WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"] as const;

/**
 * SDK 훅의 matcher — 파이프로 나눈 이름 목록. CLI 는 글자 · 숫자 · `_` · `|` 뿐인 matcher 를 이름
 * 목록으로 정확히 맞춘다(번들 CLI 2.1.292 로 확인, 2026-10-07).
 */
export const FILE_WRITE_MATCHER = FILE_WRITE_TOOLS.join("|");

/**
 * 명령을 돌리는 도구의 matcher — `Bash|PowerShell`(같은 이름 목록 규칙). Windows 에서는 PowerShell 도구가
 * 명령의 길이라, Bash 만 보던 훅은 git 가드도 쓰기 가드도 그 호출을 못 봤다(2026-10-08 검토 FIX1).
 */
export const SHELL_MATCHER = SHELL_TOOLS.join("|");

export interface WriteScope {
  /** 세션의 클론 — 첫 허용 뿌리. 상대 경로의 기준도 이것이다(`base` 가 없으면). */
  cwd: string;
  /**
   * 상대 경로를 푸는 작업 폴더 — CLI 가 훅 입력에 실어 오는 지금의 cwd. AI 가 `cd packages/web` 하고
   * 나면 도구는 그 폴더 기준으로 경로를 읽으므로, 같은 기준으로 봐야 같은 곳을 판정한다. 생략하면 `cwd`.
   */
  base?: string;
  /**
   * 클론 밖이어도 쓰게 두는 임시 폴더들 — AI 가 스크래치 파일을 둔다. 생략하면 OS 임시 폴더
   * (그리고 POSIX 의 /tmp · /var/tmp). 시험이 다른 플랫폼을 흉내 낼 때 직접 준다.
   */
  tempRoots?: readonly string[];
  /** 그 밖에 쓰게 두는 폴더 — 훅이 Claude 의 자동 메모 폴더를 싣는다(`autoMemoryRoots`). */
  extraRoots?: readonly string[];
  /** 경로의 모양과 대소문자 규칙 — 생략하면 이 컴퓨터. */
  platform?: Platform;
  /** `~` 의 자리 — 생략하면 홈 폴더. */
  home?: string;
  /**
   * 심볼릭 링크를 푸는 함수 — 생략하면 실제 파일 시스템(아직 없는 파일은 가장 가까운 부모까지).
   * 시험이 다른 플랫폼의 경로를 이 컴퓨터의 파일 시스템 없이 다룰 때 넘긴다.
   */
  realpath?: (absolute: string) => string;
}

export type WriteVerdict = { allow: true } | { allow: false; reason: string };

// ---------------------------------------------------------------------------
// 경로 판정 — 파일 쓰기 도구와 Bash 가 함께 읽는다
// ---------------------------------------------------------------------------

interface Ctx {
  api: path.PlatformPath;
  platform: Platform;
  home: string;
  /** 상대 경로를 푸는 작업 폴더. */
  base: string;
  realpath: (absolute: string) => string;
  /** 허용 뿌리 — 각 뿌리와 그 realpath. 모두 절대 경로. */
  roots: string[];
}

function pathApi(platform: Platform): path.PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

/**
 * 비교하는 모양 — 유니코드 NFC(맥은 한글 파일 이름을 분해형으로 돌려줄 수 있다), 그리고 대소문자를
 * 가리지 않는 파일 시스템(Windows · macOS 의 기본 볼륨)은 소문자.
 */
function comparable(value: string, platform: Platform): string {
  const nfc = value.normalize("NFC");
  return platform === "win32" || platform === "darwin" ? nfc.toLowerCase() : nfc;
}

/** `root` 와 같거나 그 안인가 — 글자 접두사가 아니라 경로의 마디로 본다(`/a/repo` ≠ `/a/repo-evil`). */
function isInside(root: string, target: string, ctx: Pick<Ctx, "api" | "platform">): boolean {
  const rel = ctx.api.relative(comparable(root, ctx.platform), comparable(target, ctx.platform));
  return (
    rel === "" || (rel !== ".." && !rel.startsWith(`..${ctx.api.sep}`) && !ctx.api.isAbsolute(rel))
  );
}

/** OS 임시 폴더 — POSIX 는 /tmp · /var/tmp 도(AI 가 늘 거기에 스크래치를 둔다). */
function defaultTempRoots(platform: Platform): string[] {
  return platform === "win32" ? [tmpdir()] : [tmpdir(), "/tmp", "/var/tmp"];
}

function context(scope: WriteScope): Ctx {
  const platform = scope.platform ?? currentPlatform();
  const api = pathApi(platform);
  const realpath = scope.realpath ?? realpathBestEffort;
  const home = scope.home ?? homedir();
  const cwd = api.resolve(scope.cwd);
  const base = scope.base === undefined ? cwd : api.resolve(scope.base);
  const light = { api, platform };
  const others = [...(scope.tempRoots ?? defaultTempRoots(platform)), ...(scope.extraRoots ?? [])]
    .map((root) => api.resolve(root))
    // 파일 시스템의 뿌리이거나 홈을 품은 "임시 폴더"(TMPDIR=$HOME 같은 설정)는 울타리를 지운다 — 뺀다.
    .filter((root) => root !== api.parse(root).root && !isInside(root, home, light));
  const roots = [cwd, ...others].flatMap((root) => [root, realpath(root)]);
  return { api, platform, home, base, realpath, roots: [...new Set(roots)] };
}

/**
 * Claude 가 이 프로젝트의 자동 메모를 두는 폴더 — 대화 기록(`…/projects/<키>/<id>.jsonl`) 옆의
 * `memory/`. 자동 메모는 CLI 의 기본 기능(끄지 않으면 켜져 있다)이라 AI 가 Write 로 거기에 적는다 —
 * 개발 PC 의 앱 프로젝트에 CLI 가 빈 `memory/` 를 만들어 둔 것을 확인했다(2026-10-07). 막으면 이유 없이
 * 도구 줄이 "실패" 로 뜬다. 키 계산(경로 → 폴더 이름)을 따라 하지 않고 CLI 가 훅 입력에 실어 오는 기록
 * 경로에서 읽는다. 모양이 다르면 아무것도 열지 않는다.
 */
export function autoMemoryRoots(
  transcriptPath: unknown,
  platform: Platform = currentPlatform(),
): string[] {
  if (typeof transcriptPath !== "string" || transcriptPath === "") return [];
  const api = pathApi(platform);
  const folder = api.dirname(transcriptPath);
  return api.basename(api.dirname(folder)) === "projects" ? [api.join(folder, "memory")] : [];
}

/** `~` 를 홈으로, Windows 의 확장 접두(`\\?\C:\x`)를 벗긴다 — 파일 도구가 하는 만큼만. */
function expandTilde(raw: string, ctx: Ctx): string {
  let value = raw;
  if (value === "~") value = ctx.home;
  else if (value.startsWith("~/") || (ctx.platform === "win32" && value.startsWith("~\\"))) {
    value = ctx.api.join(ctx.home, value.slice(2));
  }
  if (ctx.platform === "win32") value = value.replace(/^\\\\[?.]\\(?=[A-Za-z]:)/, "");
  return value;
}

/** 쓰려는 곳을 풀어낸 절대 경로 — 상대 경로는 클론 기준, 심볼릭 링크는 따라간다. */
function resolveTarget(raw: string, ctx: Ctx): string {
  return ctx.realpath(ctx.api.resolve(ctx.base, expandTilde(raw, ctx)));
}

function insideRoots(absolute: string, ctx: Ctx): boolean {
  return ctx.roots.some((root) => isInside(root, absolute, ctx));
}

/**
 * 이 경로를 써도 되는가 — 클론이나 임시 폴더 안이면 참. 코어의 쓰기 정책(`repoWritePolicy`)과 훅이
 * 같은 이 함수를 읽는다. 받는 경로는 절대 경로이거나 클론 기준 상대 경로다.
 */
export function pathWritable(target: string, scope: WriteScope): boolean {
  const ctx = context(scope);
  return insideRoots(resolveTarget(target, ctx), ctx);
}

/** 파일 쓰기 도구의 입력에서 고치려는 경로들 — claude/session.ts 의 classifyTool 이 읽는 칸과 같다. */
export function fileWriteTargets(input: Record<string, unknown>): string[] {
  return [input.file_path, input.notebook_path, input.path].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

/**
 * 파일 쓰기 도구 호출의 판정. 쓰기 도구가 아니거나 경로가 없으면 통과 — 경로 없는 호출은 도구가
 * 스스로 거절한다. 하나라도 클론 · 임시 폴더 밖이면 거절.
 */
export function fileWriteVerdict(
  toolName: string,
  input: Record<string, unknown>,
  scope: WriteScope,
): WriteVerdict {
  if (!(FILE_WRITE_TOOLS as readonly string[]).includes(toolName)) return { allow: true };
  const targets = fileWriteTargets(input);
  if (targets.length === 0) return { allow: true };
  const ctx = context(scope);
  for (const target of targets) {
    if (!insideRoots(resolveTarget(target, ctx), ctx)) {
      return { allow: false, reason: OUTSIDE_WRITE_REFUSAL };
    }
  }
  return { allow: true };
}

// ---------------------------------------------------------------------------
// Bash — 뻔한 파괴만. 따옴표와 heredoc 을 아는 작은 훑개 하나가 전부다
// ---------------------------------------------------------------------------

/** 명령 하나(`;` `|` `&&` 줄바꿈 따위로 끊은 한 토막) — 단어들과 리다이렉션이 쓰는 파일들. */
interface Segment {
  words: string[];
  /** 쓰기 리다이렉션(`>` `>>` `>|` `&>`)의 목적지. 입력(`<`)과 `>&2` 같은 기술자 복제는 뺀다. */
  targets: string[];
}

/** heredoc 의 본문 줄들을 건너뛴다 — 구분자 줄(`<<-` 는 앞의 탭을 뗀다)까지. 다음 읽을 자리를 돌려준다. */
function skipHeredocBodies(
  command: string,
  from: number,
  heredocs: Array<{ delimiter: string; stripTabs: boolean }>,
): number {
  let index = from;
  for (const heredoc of heredocs) {
    while (index < command.length) {
      const nl = command.indexOf("\n", index);
      const line = (nl === -1 ? command.slice(index) : command.slice(index, nl)).replace(/\r$/, "");
      index = nl === -1 ? command.length : nl + 1;
      if ((heredoc.stripTabs ? line.replace(/^\t+/, "") : line) === heredoc.delimiter) break;
    }
  }
  return index;
}

function scanShell(command: string): Segment[] {
  const segments: Segment[] = [];
  let words: string[] = [];
  let targets: string[] = [];
  let word = "";
  let inWord = false;
  /** 다음 단어를 어떻게 다룰지 — write: 리다이렉션 목적지, skip: 입력 · 기술자 복제 · here-string(버린다). */
  let next: "write" | "skip" | null = null;
  let heredocs: Array<{ delimiter: string; stripTabs: boolean }> = [];
  let quote: string | null = null;

  const endWord = () => {
    if (!inWord) return;
    if (next === "write") targets.push(word);
    else if (next === null) words.push(word);
    next = null;
    word = "";
    inWord = false;
  };
  const endSegment = () => {
    endWord();
    next = null;
    if (words.length > 0 || targets.length > 0) segments.push({ words, targets });
    words = [];
    targets = [];
  };

  let i = 0;
  const n = command.length;
  while (i < n) {
    const ch = command[i] as string;
    if (quote !== null) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < n) {
        word += command[i + 1];
        i += 1;
      } else word += ch;
      i += 1;
      continue;
    }
    if (ch === "\\") {
      const following = command[i + 1];
      if (following !== undefined && following !== "\n") {
        word += following;
        inWord = true;
      }
      i += 2; // 줄 이음(`\` + 줄바꿈)은 아무것도 남기지 않는다
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      inWord = true;
      i += 1;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      endWord();
      i += 1;
      continue;
    }
    if (ch === "#" && !inWord) {
      while (i < n && command[i] !== "\n") i += 1; // 주석은 줄 끝까지 — 줄바꿈은 아래에서 처리한다
      continue;
    }
    if (ch === "\n") {
      endSegment();
      i = skipHeredocBodies(command, i + 1, heredocs);
      heredocs = [];
      continue;
    }
    if (ch === ";" || ch === "|" || ch === "(" || ch === ")" || ch === "`") {
      endSegment();
      i += 1;
      continue;
    }
    if (ch === "&") {
      if (command[i + 1] === ">") {
        // `&>` · `&>>` — 표준 출력과 오류를 한 파일로
        endWord();
        i += command[i + 2] === ">" ? 3 : 2;
        next = "write";
        continue;
      }
      endSegment();
      i += 1;
      continue;
    }
    if (ch === ">") {
      // 숫자만 붙은 단어(`2>`)는 파일 기술자라 인자가 아니다.
      if (inWord && /^\d+$/.test(word)) {
        word = "";
        inWord = false;
      } else endWord();
      i += 1;
      if (command[i] === ">" || command[i] === "|") i += 1;
      if (command[i] === "&") {
        i += 1;
        next = "skip"; // `>&2` · `>&-` — 기술자 복제, 파일이 아니다
      } else next = "write";
      continue;
    }
    if (ch === "<") {
      endWord();
      if (command.startsWith("<<<", i)) {
        i += 3;
        next = "skip";
        continue;
      }
      if (command.startsWith("<<", i)) {
        i += 2;
        const stripTabs = command[i] === "-";
        if (stripTabs) i += 1;
        while (command[i] === " " || command[i] === "\t") i += 1;
        let delimiter = "";
        let delimiterQuote: string | null = null;
        while (i < n) {
          const c = command[i] as string;
          if (delimiterQuote) {
            if (c === delimiterQuote) delimiterQuote = null;
            else delimiter += c;
          } else if (c === '"' || c === "'") {
            delimiterQuote = c;
          } else if (/[\s;|&()<>]/.test(c)) {
            break;
          } else if (c !== "\\") {
            delimiter += c; // 구분자 앞의 `\EOF` 의 `\` 는 따옴표와 같은 뜻이라 글자만 남긴다
          }
          i += 1;
        }
        if (delimiter !== "") heredocs.push({ delimiter, stripTabs });
        continue;
      }
      i += 1;
      if (command[i] !== "(") next = "skip"; // `< 파일` — 읽기. `<( … )` 는 괄호가 새 명령을 연다
      continue;
    }
    word += ch;
    inWord = true;
    i += 1;
  }
  endSegment();
  return segments;
}

/** 명령 앞에 붙는 말들 — 건너뛰고 진짜 명령 단어를 본다. */
const COMMAND_PREFIXES = new Set([
  "env",
  "command",
  "exec",
  "builtin",
  "nohup",
  "time",
  "nice",
  "then",
  "do",
  "else",
  "elif",
  "if",
  "while",
  "until",
  "!",
  "{",
  "}",
]);
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** 명령 이름과 인자 — 앞의 `FOO=1` · `env` · `time` 따위를 건너뛴다. 없으면 null. */
function commandOf(words: string[]): { name: string; args: string[] } | null {
  let index = 0;
  while (index < words.length) {
    const word = words[index] as string;
    const previous = words[index - 1];
    // `command -v sudo` 는 있는지 묻는 것이지 실행이 아니다.
    if (previous === "command" && (word === "-v" || word === "-V")) return null;
    if (
      ENV_ASSIGNMENT.test(word) ||
      COMMAND_PREFIXES.has(word) ||
      (previous !== undefined && COMMAND_PREFIXES.has(previous) && word.startsWith("-"))
    ) {
      index += 1;
      continue;
    }
    break;
  }
  const head = words[index];
  if (head === undefined) return null;
  const name = path.posix.basename(head.replaceAll("\\", "/")).replace(/\.exe$/i, "");
  return { name, args: words.slice(index + 1) };
}

/** 인자를 플래그와 피연산자로 나눈다 — `--` 뒤는 모두 피연산자. */
function splitArgs(args: string[]): { flags: string[]; operands: string[] } {
  const flags: string[] = [];
  const operands: string[] = [];
  let rest = false;
  for (const arg of args) {
    if (rest) operands.push(arg);
    else if (arg === "--") rest = true;
    else if (arg.startsWith("-") && arg.length > 1) flags.push(arg);
    else operands.push(arg);
  }
  return { flags, operands };
}

/**
 * Bash 의 경로 말 — `$HOME` 을 홈으로 풀고, 그 밖의 변수 · 명령 치환이 든 것은 풀 수 없으니 null(판정하지
 * 않는다). Windows 의 Git Bash 가 쓰는 `/c/Users/…` 는 `C:\Users\…` 로, `/tmp` 는 임시 폴더로 푼다.
 */
function bashPath(raw: string, ctx: Ctx, scope: WriteScope): string | null {
  let value = raw.replace(/^(?:\$HOME|\$\{HOME\})(?=[\\/]|$)/, "~");
  if (value.includes("$") || value.includes("`")) return null;
  if (ctx.platform === "win32") {
    value = value.replace(/^\/([A-Za-z])(?=\/|$)/, "$1:");
    const temp = (scope.tempRoots ?? defaultTempRoots(ctx.platform))[0];
    if (temp !== undefined) value = value.replace(/^\/(?:var\/)?tmp(?=\/|$)/, temp);
  }
  return value;
}

/** 훑는 동안 따라가는 작업 폴더 — `cd` 가 옮기고, 알 수 없으면 null(상대 경로는 판정하지 않는다). */
type Base = string | null;

/** Bash 가 말한 경로의 절대 경로 — 풀 수 없으면 null. */
function absoluteOf(raw: string, ctx: Ctx, scope: WriteScope, base: Base): string | null {
  const spelled = bashPath(raw, ctx, scope);
  if (spelled === null) return null;
  const expanded = expandTilde(spelled, ctx);
  if (ctx.api.isAbsolute(expanded)) return ctx.api.resolve(expanded);
  return base === null ? null : ctx.api.resolve(base, expanded);
}

/** 지워도 · 덮어써도 되는 곳 밖인가. 풀 수 없으면 아니다(애매하면 통과). */
function outside(
  raw: string,
  ctx: Ctx,
  scope: WriteScope,
  base: Base,
  followFinalLink: boolean,
): boolean {
  const absolute = absoluteOf(raw, ctx, scope, base);
  if (absolute === null) return false;
  // `rm link` 은 링크만 지운다 — 마지막 마디는 따라가지 않고 그 부모만 푼다.
  const real = followFinalLink
    ? ctx.realpath(absolute)
    : ctx.api.join(ctx.realpath(ctx.api.dirname(absolute)), ctx.api.basename(absolute));
  return !insideRoots(real, ctx);
}

/** `cd` 가 옮겨 간 폴더 — 인자가 없으면 홈, 풀 수 없으면(`cd -` · 변수) null. */
function movedTo(operand: string | undefined, ctx: Ctx, scope: WriteScope, base: Base): Base {
  if (operand === undefined) return ctx.home;
  return operand === "-" ? null : absoluteOf(operand, ctx, scope, base);
}

/** 파일이 아닌 쓰기 목적지 — 버리는 곳 · 표준 출력 · 터미널. */
function isDevice(raw: string, platform: Platform): boolean {
  return (
    /^\/dev\/(?:null|stdout|stderr|tty|zero|full|fd\/\d+)$/.test(raw) ||
    (platform === "win32" && /^nul$/i.test(raw))
  );
}

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
/** 안에 든 명령 글을 다시 보는 깊이 — `bash -c "bash -c '…'"` 정도까지. */
const NESTED_DEPTH = 2;

function commandDenied(
  command: string,
  ctx: Ctx,
  scope: WriteScope,
  start: Base,
  depth: number,
): boolean {
  let base = start;
  for (const segment of scanShell(command)) {
    for (const target of segment.targets) {
      if (!isDevice(target, ctx.platform) && outside(target, ctx, scope, base, true)) return true;
    }
    const call = commandOf(segment.words);
    if (call === null) continue;
    const { flags, operands } = splitArgs(call.args);
    switch (call.name) {
      case "sudo":
      case "doas":
        return true;
      case "cd":
      case "pushd":
        base = movedTo(operands[0], ctx, scope, base);
        break;
      case "popd":
        base = null;
        break;
      case "rm":
        // 지우는 쪽은 재귀일 때만 본다 — 파일 하나 지우는 `rm ~/x` 는 애매한 경계라 통과.
        if (
          flags.some((flag) => flag === "--recursive" || /^-[A-Za-z]*[rR][A-Za-z]*$/.test(flag)) &&
          operands.some((operand) => outside(operand, ctx, scope, base, false))
        ) {
          return true;
        }
        break;
      case "chmod":
      case "chown":
      case "chgrp":
        // 첫 피연산자(모드 · 소유자)는 상대 경로로 풀려 클론 안이라 걸리지 않는다 — 나머지가 대상이다.
        if (
          flags.some((flag) => flag === "--recursive" || /^-[A-Za-z]*R[A-Za-z]*$/.test(flag)) &&
          operands.some((operand) => outside(operand, ctx, scope, base, true))
        ) {
          return true;
        }
        break;
      case "eval":
        if (
          depth < NESTED_DEPTH &&
          commandDenied(call.args.join(" "), ctx, scope, base, depth + 1)
        ) {
          return true;
        }
        break;
      default:
        if (SHELLS.has(call.name) && depth < NESTED_DEPTH) {
          // `bash -c '…'` · `sh -lc '…'` — -c 뒤의 글이 명령이다.
          const at = call.args.findIndex((arg) => /^-[A-Za-z]*c[A-Za-z]*$/.test(arg));
          const payload = at === -1 ? undefined : call.args[at + 1];
          if (payload !== undefined && commandDenied(payload, ctx, scope, base, depth + 1)) {
            return true;
          }
        }
    }
  }
  return false;
}

/**
 * Bash 명령의 판정 — sudo, 클론 밖을 지우는 `rm -r`, 클론 밖의 `chmod/chown/chgrp -R`, 클론 밖 파일로
 * 가는 리다이렉션만 거절한다. 그 밖의 모든 것(풀리지 않는 변수 · tee · cp · 스크립트)은 통과.
 * 상대 경로는 작업 폴더(`scope.base`, 명령 안의 `cd` 가 옮긴 곳 포함) 기준으로 푼다.
 */
export function bashCommandVerdict(command: string, scope: WriteScope): WriteVerdict {
  const ctx = context(scope);
  return commandDenied(command, ctx, scope, ctx.base, 0)
    ? { allow: false, reason: OUTSIDE_COMMAND_REFUSAL }
    : { allow: true };
}

// ---------------------------------------------------------------------------
// Claude PreToolUse 훅의 판정 — 순수 함수
// ---------------------------------------------------------------------------

function deny(reason: string): GitGuardHookOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

/**
 * PreToolUse 훅 하나가 두 matcher(셸 도구 `Bash`·`PowerShell` · 파일 쓰기 도구) 모두에서 부르는 판정. 셸 도구는
 * git 가드가 먼저(문장 · 기준 그대로) 보고, 이어서 뻔한 파괴를 본다 — 두 도구 모두 입력 칸이 `command` 다.
 * 파일 쓰기 도구는 클론 · 임시 폴더 밖이면 거절한다. 그 밖의 도구는 빈 객체로 통과.
 */
export function sessionGuardHookDecision(
  toolName: string,
  toolInput: unknown,
  scope: WriteScope,
): GitGuardHookOutput {
  const input: Record<string, unknown> =
    toolInput !== null && typeof toolInput === "object"
      ? (toolInput as Record<string, unknown>)
      : {};
  if (isShellTool(toolName)) {
    const git = gitGuardHookDecision(toolName, input);
    if (git.hookSpecificOutput) return git;
    const command = typeof input.command === "string" ? input.command : "";
    const verdict = bashCommandVerdict(command, scope);
    return verdict.allow ? {} : deny(verdict.reason);
  }
  const verdict = fileWriteVerdict(toolName, input, scope);
  return verdict.allow ? {} : deny(verdict.reason);
}
