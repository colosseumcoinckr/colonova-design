import { type ChildProcess, spawn } from "node:child_process";
import { get as httpGet } from "node:http";
import { get as httpsGet } from "node:https";
import { run } from "./child.js";
import { currentPlatform, type Platform } from "./environment.js";

/**
 * 미리보기 서버 프로세스의 거둠과 읽기 — `this` 없는 순수 절차라 워크스페이스의
 * 상태 기계를 읽지 않고도 읽히고 검사된다.
 */

/** 프로세스 트리를 거두는 길 — `treeKillPlan` 이 고른다. */
export type TreeKillPlan =
  | { via: "group"; pid: number; signal: NodeJS.Signals }
  | { via: "taskkill"; command: string; args: string[] }
  | { via: "child"; signal: NodeJS.Signals };

/**
 * 트리를 거두는 방법 — 플랫폼마다 다르다. 순수 함수라 어느 기계에서도 시험한다.
 *
 * POSIX: detached 로 띄운 셸과 자식들은 한 프로세스 그룹이라, 그룹에 시그널을 보내는 것이
 * 포트를 푸는 길이다. Windows: 프로세스 그룹이 없다. `child.kill` 은 셸(cmd)만 죽여 dev 서버가
 * 살아 포트를 쥔다 — 그래서 **신호와 무관하게** `taskkill /T /F` 로 트리를 거둔다. SIGTERM 에서도
 * 같은 길인 까닭: 옛 코드는 SIGKILL 에서만 taskkill 을 불렀는데, 정상 경로는 SIGTERM 한 번으로
 * 셸이 죽어 `exit` 이 오면 3초 타이머가 걷혀 taskkill 이 불리지 않았다. 셸이 먼저 죽으면 pid 가
 * 사라져 뒤의 /T 도 자식을 못 따라간다. /F 를 빼 정중히 끝내는 길(WM_CLOSE)은 창 없는 콘솔
 * 프로세스에 닿지 않아 두지 않는다(2026-10-07, 베타 준비 분석). pid 를 모르면 자식 핸들로 신호를
 * 보낼 수밖에 없다.
 */
export function treeKillPlan(
  platform: Platform,
  pid: number | undefined,
  signal: NodeJS.Signals,
): TreeKillPlan {
  if (pid === undefined || !Number.isInteger(pid) || pid <= 0) return { via: "child", signal };
  if (platform === "win32") {
    return { via: "taskkill", command: "taskkill", args: ["/PID", String(pid), "/T", "/F"] };
  }
  return { via: "group", pid, signal };
}

/** taskkill 을 띄운다 — 못 뜨거나 실패(이미 죽음 · 권한)해도 `fallback` 이 최소한 한 걸음은 거둔다. */
function runTaskkill(plan: { command: string; args: string[] }, fallback?: () => void): void {
  const taskkill = spawn(plan.command, plan.args, { stdio: "ignore", windowsHide: true });
  taskkill.once("error", () => fallback?.());
  taskkill.once("exit", (code) => {
    if (code !== 0) fallback?.();
  });
  taskkill.unref();
}

export function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const plan = treeKillPlan(currentPlatform(), child.pid, signal);
  try {
    if (plan.via === "taskkill") runTaskkill(plan, () => child.kill(signal));
    else if (plan.via === "group") process.kill(-plan.pid, plan.signal);
    else child.kill(signal);
  } catch {
    child.kill(signal);
  }
}

/**
 * 우리가 예전에 띄웠던 서버의 흔적(pid 기록)을 거둔다 — 데몬이 hard-die 하면
 * detached 트리는 살아 남아 포트를 계속 쥐고, 다음 bring-up 의 killPreview 는
 * 손에 쥔 핸들이 없어 아무것도 못 한다 (좀비 서버 실사).
 */
export function killPidTree(pid: number, signal: NodeJS.Signals): void {
  const plan = treeKillPlan(currentPlatform(), pid, signal);
  try {
    if (plan.via === "taskkill") runTaskkill(plan);
    else if (plan.via === "group") process.kill(-plan.pid, plan.signal);
  } catch {
    // 이미 죽은 pid — 거둘 것이 없다.
  }
}

/**
 * pid 의 명령줄 — 기록된 pid 가 지금도 우리 미리보기 트리인지의 앵커다.
 * 읽지 못하면(죽었거나 플랫폼이 말을 안 듣거나) null.
 */
export async function pidCommandLine(pid: number): Promise<string | null> {
  if (currentPlatform() === "win32") return null; // wmc 제거 이후의 Windows 는 앵커 없이 보수 간다
  const stdout = await run("ps", ["-p", String(pid), "-o", "command="], { timeout: 5_000 })
    .then((result) => String(result.stdout))
    .catch(() => "");
  const line = stdout.trim();
  return line === "" ? null : line;
}

/**
 * 주어진 URL 이 실제로 응답하는지 — 판별을 세 가지로 나눈 것.
 * "html" 은 브라우저가 열 수 있는 페이지(5xx 미만 + text/html), "ok" 는 그
 * 외의 5xx 미만 응답(API·리다이렉트·정적 파일), null 은 오류·타임아웃.
 * https 의 자체서명 인증서는 개발 서버의 일상이라 검증을 끈다.
 */
export function probePreviewUrl(url: string): Promise<"html" | "ok" | null> {
  const { promise, resolve } = Promise.withResolvers<"html" | "ok" | null>();
  const get = url.startsWith("https:") ? httpsGet : httpGet;
  const request = get(url, { rejectUnauthorized: false }, (response) => {
    response.resume();
    const status = response.statusCode ?? 0;
    if (status >= 500 || status === 0) return resolve(null);
    const type = response.headers["content-type"] ?? "";
    resolve(type.includes("text/html") ? "html" : "ok");
  });
  request.setTimeout(2_000, () => {
    request.destroy();
    resolve(null);
  });
  request.once("error", () => resolve(null));
  return promise;
}

/**
 * 이 데몬이 직접 듣는 포트들 — 미리보기 포트 스캔에서 제외한다. 자식
 * 프로세스(pnpm·node)는 부모의 리스닝 소켓을 fd 로 물려받아 lsof 에 자기
 * 소켓처럼 보이는데(CI 러너 실측 2026-09-21 — 서버 출력이 없으면 스캔이
 * 데몬 자신의 웹 UI 를 미리보기로 판정했다), 그 함정을 아예 닫는다.
 */
export const daemonOwnedPorts = new Set<number>();

/** 주어진 pid 들이 쥐고 있는 TCP LISTEN 포트들 — 프로세스 트리의 소켓 스캔. */
export async function pidListeningPorts(pids: number[]): Promise<number[]> {
  if (pids.length === 0) return [];
  const wanted = new Set(pids);
  const windows = currentPlatform() === "win32";
  const args = windows
    ? ["-a", "-n", "-o"]
    : ["-a", "-p", pids.join(","), "-iTCP", "-sTCP:LISTEN", "-Fn"];
  // netstat 은 .exe 라 셸이 필요 없다 — cmd 한 겹이 틱마다 하나 덜 뜬다(2026-10-07).
  const stdout = await run(windows ? "netstat" : "lsof", args, { timeout: 10_000 })
    .then((result) => String(result.stdout))
    .catch(() => "");
  const ports = new Set<number>();
  for (const line of stdout.split(/\r?\n/)) {
    if (windows) {
      // `TCP  0.0.0.0:3000  0.0.0.0:0  LISTENING  4321` — the local address
      // names the port, the last column owns it.
      const columns = line.trim().split(/\s+/);
      if (columns.length < 5 || columns[3] !== "LISTENING") continue;
      const pid = Number(columns[4] ?? NaN);
      if (!wanted.has(pid)) continue;
      const port = Number((columns[1] ?? "").split(":").pop());
      if (Number.isInteger(port) && port > 0) ports.add(port);
    } else {
      // `-Fn` prints one field per line: `p<pid>` then `n<host>:<port>` —
      // the port sits after the last colon of each `n` line.
      if (!line.startsWith("n")) continue;
      const port = Number(line.slice(1).split(":").pop()?.replace(/]$/, ""));
      if (Number.isInteger(port) && port > 0) ports.add(port);
    }
  }
  return [...ports];
}

/**
 * 프로세스 표를 한 번 읽는 명령 — pid · ppid 두 칸. POSIX 는 ps, Windows 는 PowerShell.
 *
 * 옛 Windows 판은 `shell: true` 로 `Get-CimInstance … | Select-Object …` 를 불렀다. 셸이 cmd 라
 * `|` 를 cmd 가 가로채 PowerShell 에 닿지 못했고, 답은 늘 빈 목록이었다(그래서 포트 스캔이 셸
 * 하나의 소켓만 보았다). 셸 없이 execFile 로 부르고, 파이프는 PowerShell 이 읽는 한 덩어리 명령
 * 안에 둔다. `ConvertTo-Csv` 는 표 형식(터미널 폭에 따라 칸이 잘리거나 정렬이 바뀐다)과 달리
 * 모양이 일정하다(2026-10-07, 베타 준비 분석).
 */
export function processTableCommand(platform: Platform): { command: string; args: string[] } {
  if (platform !== "win32") return { command: "ps", args: ["-axo", "pid=,ppid="] };
  return {
    command: "powershell",
    args: [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Csv -NoTypeInformation",
    ],
  };
}

/**
 * 프로세스 표의 출력에서 부모 → 자식 목록을 만든다. 세 모양을 한 규칙으로 읽는다 — ps 의
 * `  123   1`, PowerShell 표(머리줄 · `---` 구분선 · 오른쪽 정렬), CSV(`"123","1"`). 따옴표 ·
 * 쉼표를 공백으로 바꾼 줄에서 정수 두 개(자식 부모)가 나오지 않으면 — 머리 · 구분선 · 빈 줄 —
 * 건너뛴다. CRLF 와 BOM 도 견딘다.
 */
export function parseProcessTable(text: string): Map<number, number[]> {
  const children = new Map<number, number[]>();
  for (const line of text.split(/\r?\n/)) {
    const columns = line
      .replace(/["',\uFEFF]/g, " ")
      .trim()
      .split(/\s+/)
      .map(Number);
    const child = columns[0];
    const parent = columns[1];
    if (child === undefined || parent === undefined) continue;
    if (!Number.isInteger(child) || !Number.isInteger(parent)) continue;
    const list = children.get(parent) ?? [];
    list.push(child);
    children.set(parent, list);
  }
  return children;
}

/** 부모 → 자식 목록에서 pid 아래의 전체 트리 — 자식, 손자… (pid 자신은 제외). 순환에도 끝난다. */
export function descendantsOf(children: ReadonlyMap<number, number[]>, pid: number): number[] {
  const found: number[] = [];
  const queue = [pid];
  const seen = new Set<number>([pid]);
  while (queue.length > 0) {
    const current = queue.shift() as number;
    for (const child of children.get(current) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      found.push(child);
      queue.push(child);
    }
  }
  return found;
}

/** pid 아래의 전체 프로세스 트리 — 자식, 손자… (pid 자신은 제외). 표를 못 읽으면 빈 목록. */
export async function descendantPids(pid: number): Promise<number[]> {
  const { command, args } = processTableCommand(currentPlatform());
  const stdout = await run(command, args, { timeout: 10_000 })
    .then((result) => String(result.stdout))
    .catch(() => "");
  return descendantsOf(parseProcessTable(stdout), pid);
}
