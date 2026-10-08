import { execFile } from "node:child_process";
import { promisify } from "node:util";

/**
 * 자식 프로세스를 띄우는 자리의 공통부 (베타 준비 분석 2026-10-07).
 *
 * Windows 에서 GUI 앱이 콘솔 앱(git · node · where …)을 띄우면 그때마다 검은 콘솔 창이
 * 깜빡인다. `windowsHide` 가 그 창을 숨기는 옵션인데 기본이 꺼져 있어 호출마다 줘야 한다 —
 * 하나만 빠져도 깜빡임이 남으므로 모든 자식 호출이 옵션을 갖는지는 소스 계약 시험
 * (`child-hide.test.ts`)이 지킨다. 이 기본값의 효과는 Windows 에서만 보인다(다른 곳은 무시).
 */

const execFileAsync = promisify(execFile);

/**
 * `promisify(execFile)` 과 같은 모양 — `windowsHide` 가 기본으로 켜져 있다. 호출이 따로 주면
 * 그 값이 이긴다. 모든 `run(...)` 이 이 하나를 쓴다(파일마다 `promisify(execFile)` 을 두지 않는다).
 */
export const run = ((file: string, ...rest: unknown[]) => {
  const args = Array.isArray(rest[0]) ? rest[0] : [];
  const options = (Array.isArray(rest[0]) ? rest[1] : rest[0]) as object | undefined;
  return execFileAsync(file, args, { windowsHide: true, ...options });
}) as unknown as typeof execFileAsync;

// ---------------------------------------------------------------------------
// 셸(cmd.exe)을 거치는 호출의 따옴표
// ---------------------------------------------------------------------------

/**
 * cmd 가 따옴표 없이는 단어를 가르거나 명령으로 읽는 글자 — 공백 · `& | < > ^ ( )` · 구분자
 * `, ; =` 와 확장 글자 `% !`(따옴표 안에서도 풀리지만 감싸서 해로울 것은 없다).
 */
const CMD_SPECIAL = /[\s"&|<>^(),;=%!]/;

/** cmd 줄에 실을 수 없는 글자 — 따옴표 하나가 줄의 인용 상태를 뒤집고, 줄바꿈은 명령을 끊는다. */
const CMD_UNSAFE = /["\r\n\0]/;

/**
 * 한 낱말을 cmd 줄에 실을 모양으로 — 공백 · `&` 같은 글자가 있으면 큰따옴표로 감싼다. 끝의 `\` 는
 * 닫는 따옴표를 가리지 않게 두 번 적는다(`"C:\a b\"` 는 따옴표가 이스케이프돼 줄이 열린 채 끝난다).
 * 따옴표 · 줄바꿈은 안전하게 이스케이프할 길이 없어 던진다 — 호출자는 고정 인자와 경로만 싣고,
 * Windows 경로에는 그 글자가 올 수 없다. `%이름%` 은 cmd 가 따옴표 안에서도 풀므로 경로에 환경
 * 변수 이름과 같은 `%…%` 가 들어 있으면 막힌다(없는 이름이면 그대로 남는다).
 */
export function quoteForCmd(arg: string): string {
  if (CMD_UNSAFE.test(arg)) throw new Error("셸 명령 줄에 실을 수 없는 글자가 들어 있습니다");
  if (arg === "") return '""';
  if (!CMD_SPECIAL.test(arg)) return arg;
  return `"${arg.replace(/\\+$/, (slashes) => slashes + slashes)}"`;
}

/** 자식을 띄우는 계획 — `spawn(command, args, { shell })` 에 그대로 넘긴다. */
export interface ShellPlan {
  command: string;
  args: string[];
  shell: boolean;
}

/**
 * Windows 에서 이 명령을 어떻게 띄울지 — `.exe` 는 셸 없이 직접, 그 밖(`.cmd` 셔임 · 확장자 없는
 * 이름)은 cmd 를 거치되 명령과 인자를 모두 따옴표로 감싼다. Node 의 `shell: true` 는 낱말을 공백으로
 * 이어 붙일 뿐 따옴표를 달지 않아, `C:\Users\홍 길동\…\claude.exe auth login` 이 `C:\Users\홍` 에서
 * 갈라졌다. 직접 띄우면 종료 신호가 셸이 아니라 프로그램에 닿는 이득도 있다. Windows 가 아니면
 * 그대로다. 순수 함수라 플랫폼을 인자로 받는다 — 어느 기계에서도 시험한다.
 */
export function shellPlan(platform: string, command: string, args: readonly string[]): ShellPlan {
  if (platform !== "win32" || /\.(?:exe|com)$/i.test(command)) {
    return { command, args: [...args], shell: false };
  }
  return { command: quoteForCmd(command), args: args.map(quoteForCmd), shell: true };
}
