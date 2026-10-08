import { lstatSync, readFileSync, type Stats } from "node:fs";
import * as nodePath from "node:path";
import { INVITE_SUFFIX, invitePathProblem } from "./invite-discard.js";

/**
 * 초대 파일 더블클릭으로 열기(2026-10-08 베타 준비 분석) — 파일 연결(electron-builder `fileAssociations`)이 OS 의
 * 더블클릭을 앱으로 보내면, 그 경로가 세 길로 온다: mac 은 `open-file` 이벤트, Windows 는 시작 인자(`argv`),
 * 이미 떠 있을 때의 두 번째 더블클릭은 `second-instance` 의 `argv`. 이 파일은 Electron 을 모르는 순수 부분이다 —
 * 경로 거르기 · 줄 세우기 · 한 파일 읽기. 메인(`main.ts`)이 이벤트를 붙이고, 렌더러는 `desktop:invite-take` 로
 * 줄을 가져가 웹의 가져오기 컨트롤러(끌어 놓기와 같은 확인 카드 흐름)에 넣는다.
 *
 * 보안의 줄: 렌더러는 경로를 건네지도 읽지도 않는다. 렌더러가 얻는 것은 OS 가 건넨 경로 중 위의 판정을 통과한
 * 파일 하나하나의 이름 · 경로 · 바이트뿐이다(임의의 파일을 읽는 문이 없다).
 */

/** 렌더러로 건너가는 초대 파일 한 장의 바이트 상한 — 초대 파일은 글 몇 줄이다(1 MB 면 넉넉하다). */
export const INVITE_OPEN_MAX_BYTES = 1024 * 1024;

/** 줄이 쌓이는 상한 — 더블클릭을 수십 번 눌러도 메모리가 자라지 않는다. */
export const INVITE_OPEN_QUEUE_MAX = 8;

type PathApi = Pick<typeof nodePath, "isAbsolute" | "resolve" | "basename">;

/**
 * 시작 인자 · 두 번째 실행의 인자에서 초대 파일 경로만 건진다. 플래그(`--remote-debugging-port=…` 같은 `-` 로
 * 시작하는 것)와 확장자가 다른 인자(실행 파일 · 개발 실행의 `.`)는 버리고, 상대 경로는 그 실행의 작업 폴더
 * (`cwd` — 두 번째 실행은 `second-instance` 가 건네는 `workingDirectory`)로 풀어 절대 경로로 만든다.
 * 판정은 지우기와 같은 `invitePathProblem` 이다. 같은 경로는 한 번만.
 */
export function inviteArgvPaths(
  argv: readonly unknown[],
  cwd: string,
  api: PathApi = nodePath,
): string[] {
  const found: string[] = [];
  for (const arg of argv) {
    if (typeof arg !== "string" || arg.startsWith("-") || !arg.endsWith(INVITE_SUFFIX)) continue;
    const absolute = api.isAbsolute(arg) ? arg : api.resolve(cwd, arg);
    if (invitePathProblem(absolute, api) !== null || found.includes(absolute)) continue;
    found.push(absolute);
  }
  return found;
}

/**
 * OS 가 열라고 건넨 초대 파일의 줄. 앱이 아직 뜨는 중이어도(mac 의 `open-file` 은 `ready` 보다 먼저 올 수 있다)
 * 렌더러가 마운트될 때까지 쥐고 있다가 `take` 로 한 번에 내준다 — 렌더러를 다시 불러도(크래시 복구) 줄은 그대로다.
 */
export class InviteOpenQueue {
  private paths: string[] = [];

  /** 줄에 세운다 — 판정을 통과하고 아직 줄에 없고 상한이 차지 않았을 때만. 세웠으면 true. */
  offer(path: unknown, api: PathApi = nodePath): boolean {
    if (invitePathProblem(path, api) !== null) return false;
    const value = path as string;
    if (this.paths.includes(value) || this.paths.length >= INVITE_OPEN_QUEUE_MAX) return false;
    this.paths.push(value);
    return true;
  }

  /** 줄을 통째로 내주고 비운다. */
  take(): string[] {
    const taken = this.paths;
    this.paths = [];
    return taken;
  }

  get size(): number {
    return this.paths.length;
  }
}

/** 렌더러로 건너가는 초대 파일 한 장. */
export interface OpenedInvite {
  /** 파일 이름(폴더 없이) — 웹이 `File` 의 이름으로 쓴다(이름의 확장자 문이 그대로 지킨다). */
  name: string;
  /** 디스크 위치 — 메인이 판정한 같은 경로다. 가져온 뒤 `파일 지우기` 가 쓴다. */
  path: string;
  /** 파일 바이트. 읽지 못했으면(사라짐 · 일반 파일이 아님 · 너무 큼) null — 웹이 같은 오류 카드로 말한다. */
  bytes: Uint8Array | null;
}

/** 읽기의 손 — 시험이 가짜 파일 시스템을 끼운다. */
export interface InviteReadIo {
  lstat(path: string): Pick<Stats, "isFile" | "size">;
  read(path: string): Uint8Array;
}

const NODE_IO: InviteReadIo = { lstat: lstatSync, read: readFileSync };

/**
 * 줄에서 나온 경로 한 장을 렌더러로 보낼 모양으로 — 판정을 한 번 더 하고(방어), 일반 파일이고(심볼릭 링크 · 폴더는
 * 아니다) 상한 이하일 때만 바이트를 읽는다. 읽지 못해도 던지지 않는다: 이름과 `bytes: null` 이 가고, 웹이 내용을 못 읽은
 * 파일과 같은 오류 카드로 말한다(그래서 더블클릭이 말없이 사라지지 않는다).
 */
export function readOpenedInvite(
  path: string,
  io: InviteReadIo = NODE_IO,
  api: PathApi = nodePath,
): OpenedInvite {
  const name = api.basename(path);
  if (invitePathProblem(path, api) !== null) return { name, path, bytes: null };
  try {
    const stat = io.lstat(path);
    if (!stat.isFile() || stat.size > INVITE_OPEN_MAX_BYTES) return { name, path, bytes: null };
    // 렌더러로 가는 바이트는 순수한 Uint8Array 로 복사한다 — Buffer(Node 의 하위 클래스)를 IPC 에 싣지 않는다.
    return { name, path, bytes: new Uint8Array(io.read(path)) };
  } catch {
    return { name, path, bytes: null };
  }
}
