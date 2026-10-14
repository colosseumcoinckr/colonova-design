/**
 * 브라우저 MCP 서버의 기동 명세 빌더 (인앱 브라우저 전환 3단계).
 *
 * 데몬이 세션을 열 때 claude·acp·codex에 stdio MCP 서버 하나를 주입한다.
 * 세 프로바이더의 와이어 형태가 달라서(claude 레코드 / acp 배열 / codex
 * config 객체) 주입 명세 하나를 세 형태로 바꿔 주는 게 이 파일의 전부다.
 * 주입 여부는 host가 browserDriverFactory를 주입했는지(데스크톱 앱 여부)가
 * 정하고, 세션 스코프 시크릿은 세션 생성 시점에 데몬이 발급해 env에 실린다.
 *
 * 명세는 `node <browser-mcp.js>` 형태다 — MCP stdio는 실행 파일을 요구하므로
 * 스크립트 경로는 args에 실고 command는 node 바이너리를 가린다. 데스크톱 앱
 * 안에서 process.execPath는 Electron이라 node가 아니다: 레포의 다른 자식과
 * 같은 순서(COLONOVA_DESIGN_EXTRA_PATH의 번들 node 먼저 — environment.ts의
 * resolveNodeVersion 관례)로 가리고, 둘 다 없으면 PATH의 node에 맡긴다.
 */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 프로바이더에 등록할 MCP 서버 이름 — claude 도구 이름의 `mcp__colonova-browser__*` 접두가 된다. */
export const BROWSER_MCP_SERVER_NAME = "colonova-browser";

/** 주입 명세 — LaunchConfig.browserMcp로 세션까지 실려 간다. */
export interface BrowserMcpEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** 이 파일(→ dist/browser-launch.js) 옆의 stdio 서버 스크립트 — tsc가 같은 디렉터리 구조로 놓는다. */
const browserMcpScript = (() => {
  const inside = fileURLToPath(new URL("./browser-mcp.js", import.meta.url));
  // 패키징된 앱에서는 asar 안의 경로가 나온다 — plain node 자식은 asar 를
  // 못 읽으므로 electron-builder 의 asarUnpack 이 놓은 .unpacked 로 돌린다.
  return inside.includes("app.asar") ? inside.replace("app.asar", "app.asar.unpacked") : inside;
})();

/** MCP 자식의 node 바이너리 가리기 — 배포 번들 → 실행 중인 node → PATH 순. */
function resolveNodeBinary(): string {
  const binary = process.platform === "win32" ? "node.exe" : "node";
  const extraDirs = (process.env.COLONOVA_DESIGN_EXTRA_PATH ?? "")
    .split(process.platform === "win32" ? ";" : ":")
    .filter(Boolean)
    .map((dir) => join(dir, binary));
  const candidates = [...extraDirs, join(dirname(process.execPath), binary)];
  // 마지막 폴백은 실행 중인 바이너리 자신 — Electron 메인에서는 execPath 가
  // 앱 실행 파일이라 ELECTRON_RUN_AS_NODE=1 로 node 처럼 쓴다(아래 env).
  return candidates.find((candidate) => existsSync(candidate)) ?? process.execPath;
}

/**
 * 주입 명세를 만든다. `browserAvailable`은 host가 browserDriverFactory를
 * 주입했는지 — 아니면 null로, 세션은 브라우저 도구 없이 열린다. 시크릿은
 * 세션마다 새로 발급된 것이어야 하므로 호출자가 그때그때 넣는다.
 */
export function browserMcpEntry(
  browserAvailable: boolean,
  daemonUrl: string,
  secret: string,
  /** 이 세션에 submit_for_review 를 실을지 (PLAN L6 · O6 — 프로젝트의
   *  lifecycle.submitFromChat). MCP 자식이 이 env 를 읽는다. */
  submitFromChat: boolean,
  /** 앱 · 데몬의 버전 — 자식이 serverInfo.version 으로 말한다(COLONOVA_APP_VERSION).
   *  모르면 env 도 없고 자식은 "0" 으로 산다. */
  appVersion?: string,
): BrowserMcpEntry | null {
  if (!browserAvailable) return null;
  return {
    command: resolveNodeBinary(),
    args: [browserMcpScript],
    env: {
      COLONOVA_DAEMON_URL: daemonUrl,
      COLONOVA_BROWSER_SECRET: secret,
      // execPath 폴백이 Electron 바이너리일 때 node 로 돌게 하는 스위치 —
      // 진짜 node 에게는 무해하다.
      ELECTRON_RUN_AS_NODE: "1",
      ...(submitFromChat ? { COLONOVA_BROWSER_SUBMIT: "1" } : {}),
      ...(appVersion ? { COLONOVA_APP_VERSION: appVersion } : {}),
    },
  };
}

/** claude — query options.mcpServers의 레코드 값(SDK McpStdioServerConfig). */
export function claudeBrowserMcpServer(entry: BrowserMcpEntry): {
  type: "stdio";
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return { type: "stdio", command: entry.command, args: entry.args, env: { ...entry.env } };
}

/** codex — thread/start config.mcp_servers의 표 객체(config.toml의 mcp_servers 표와 같은 형태). */
export function codexBrowserMcpServer(entry: BrowserMcpEntry): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return { command: entry.command, args: entry.args, env: { ...entry.env } };
}

/**
 * 브라우저 MCP 자식이 못 떴는가 — claude 의 init 메시지(`mcp_servers` 의 상태)를 읽는다.
 * 자식이 죽으면 세션은 도구 상자 없이 조용히 돈다(2026-10-14 MCP 점검 — init 의 서버
 * 상태를 아무도 읽지 않았다). `pending` 은 아직 모르는 것이라 아니다 — init 은 턴마다
 * 오므로 다음 턴이 다시 말한다. 이 서버를 싣지 않은 세션(목록에 없음)도 아니다.
 */
export function claudeBrowserMcpDown(message: unknown): boolean {
  const m = message as { type?: unknown; subtype?: unknown; mcp_servers?: unknown };
  if (m?.type !== "system" || m.subtype !== "init" || !Array.isArray(m.mcp_servers)) return false;
  const server = m.mcp_servers.find(
    (row: { name?: unknown }) => row?.name === BROWSER_MCP_SERVER_NAME,
  ) as { status?: unknown } | undefined;
  if (server === undefined) return false;
  return server.status !== "connected" && server.status !== "pending";
}

/**
 * 같은 판정의 codex 판 — `mcpServer/startupStatus/updated` 알림의 params 를 읽는다.
 * `failed` 만 본다: `cancelled` 는 스레드를 닫을 때도 오고, `starting` 은 아직 모르는 것이다.
 * threadId 가 있으면 이 스레드의 것만 본다.
 */
export function codexBrowserMcpDown(params: unknown, threadId: string | null): boolean {
  const p = params as { name?: unknown; status?: unknown; threadId?: unknown };
  if (p?.name !== BROWSER_MCP_SERVER_NAME || p.status !== "failed") return false;
  return typeof p.threadId !== "string" || threadId === null || p.threadId === threadId;
}
