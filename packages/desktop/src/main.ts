import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { bundledToolEnv, COLONOVA_DESIGN_DATA_DIR } from "@colonova-design/daemon/environment";
import type { DaemonNotice } from "@colonova-design/daemon/server";
// 서브패스로 가져온다 — 루트 진입점은 CLI 라 가져오는 순간 실행된다.
import {
  DaemonServer,
  daemonOwnedPorts,
  eraseProjectConversations,
} from "@colonova-design/daemon/server";
import { app, BrowserWindow, dialog, Menu, safeStorage, session, shell } from "electron";
import { PlannerNotices } from "./app-notify.js";
import { assertResetPaths, finishPendingAppReset, requestAppReset } from "./app-reset.js";
import { SelfUpdates } from "./app-updates.js";
import { loadAppZoom, saveAppZoom, stepZoom } from "./app-zoom.js";
import { benchEndpointBody, benchEndpointPath, benchEndpointPid } from "./bench-endpoint.js";
import { registerDesktopBridge } from "./bridge.js";
import {
  ANSWER,
  quitOptions,
  resetOptions,
  resetUnfinished,
  START_ANSWER,
  startFailedOptions,
} from "./copy.js";
import { startDaemonServer } from "./daemon-start.js";
import { loadNotificationPrefs, loadStoredPort, saveDesktopSettings } from "./desktop-settings.js";
import { APP_BUNDLE_ID } from "./identity.js";
import { InviteOpenQueue, inviteArgvPaths } from "./invite-open.js";
import { GUIDE_URL } from "./links.js";
import { buildMenuTemplate } from "./menu.js";
import { createBrowserDriverFactory, createPreviewDriverFactory } from "./preview-driver.js";
import { PlannerPreviewView, registerPreviewIpc } from "./preview-view.js";
import { SafeStorageCredentialStore } from "./safe-storage-store.js";
import { daemonUrl, guardNavigations, MainWindowHost, windowUrl } from "./windows.js";

// The preview-driver unit imports dist/main.js for this symbol — the seam
// predates the split, so the export stays on the entry module.
export { createBrowserDriverFactory, createPreviewDriverFactory } from "./preview-driver.js";

/**
 * ColoNova Design 데스크톱 앱의 메인 프로세스:
 * - 데몬을 in-process 로 호스팅한다 — 별도 Node 사이드카가 없다. 포트는
 *   임시 포트, 페어링 토큰은 실행마다 새로 만들어 url 로만 전달한다.
 * - 웹 UI 는 데몬이 직접 정적 서빙한다(webDist). 렌더러는
 *   http://127.0.0.1:<port>/?token=<token> 을 연다 — 연결 화면 없음.
 * - 자격 증명은 safeStorage 저장소를 데몬에 주입한다.
 * - 번들 런타임(포터블 node·pnpm, win 은 MinGit)이 resources 에 있으면
 *   COLONOVA_DESIGN_EXTRA_PATH 로 데몬에 알려준다(repo-core.ts 가 PATH 앞에 붙인다).
 * - AI 의 미리보기 창(PLAN D61 · D63)은 preview-driver.ts 가 든다 —
 *   숨은 오프스크린 `BrowserWindow` 가 데몬의 `previewDriverFactory` 로
 *   들어가고, paint 는 PiP 프레임으로 렌더러에 흐른다.
 *
 * 이 파일은 조립만 남는다 — 창은 windows.ts, OS 알림·배지는 app-notify.ts,
 * 자가 교체는 app-updates.ts, 렌더러 다리는 bridge.ts 가 갖는다. 설치 정체성
 * (번들 아이디 · 폴더 이름 · 이주)은 identity.ts 이다.
 */

const LOGS_DIR = join(COLONOVA_DESIGN_DATA_DIR, "logs");

/** 렌더러로 가는 신호 둘(preload.ts 가 같은 이름으로 받는다) — 내용 없이 알리기만 한다. */
const INVITE_OPEN_CHANNEL = "colonovadesign:invite-open";
const COPY_REPORT_CHANNEL = "colonovadesign:copy-report";

// ---------------------------------------------------------------------------
// 데스크톱 설정 — desktop-settings.json 은 창이 없어도 메인이 알아야 하는 값
// (알림 정책, 설정 문서 P0#3)과 다음 실행이 그대로 잡아야 하는 값(데몬 포트)을
// 든다. 알림 정책 자체는 notify-policy 가 들고, 여기서는 읽고 쓰는 자리만 맡는다.
// ---------------------------------------------------------------------------

function desktopSettingsPath(): string {
  return join(app.getPath("userData"), "desktop-settings.json");
}

/**
 * 기록 폴더를 연다 — 첫 줄이 나가기 전에는 없을 수 있어 만든 뒤에 연다. 렌더러 없이 메인이 직접
 * 여는 길이다(창이 없어도 · 렌더러가 죽어 있어도 닿는다). 도움말 메뉴와 시작 실패 상자가 함께 쓴다.
 * bridge 의 desktop:open-home("logs") 이 여는 것과 같은 폴더다.
 */
async function openLogsFolder(): Promise<void> {
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    await shell.openPath(LOGS_DIR);
  } catch {
    // 폴더를 못 열어도 앱이 할 수 있는 일은 없다 — 상자가 폴더의 자리를 글로 적어 둔다.
  }
}

/**
 * 시작하지 못했을 때의 상자 — 막다른 길에 출구를 단다(2026-10-06 겹판 조사): 날 오류만 던지던
 * showErrorBox 는 단추가 하나라 기록 폴더로 데려갈 수 없었다. 상자가 닫힐 때까지 기다린다 —
 * 어느 단추든 앱은 끝나고, 첫 단추는 끝내기 전에 기록 폴더를 연다.
 */
async function showStartFailure(reason: string): Promise<void> {
  try {
    const { response } = await dialog.showMessageBox(startFailedOptions(reason, LOGS_DIR));
    if (response === START_ANSWER.openLogs) await openLogsFolder();
  } catch {
    // 상자를 못 띄워도 끝내는 일은 막지 않는다.
  }
}

let daemonServer: DaemonServer | null = null;

/**
 * 도움말의 `사용 설명서 열기` — 기본 브라우저로 설명서 주소(links.ts, https 한 주소)를 연다. 렌더러 없이 메인이
 * 직접 여는 길이다(창이 없어도 닿는다). 못 열어도 앱이 할 수 있는 일은 없다.
 */
function openGuide(): void {
  void shell.openExternal(GUIDE_URL).catch(() => undefined);
}

/**
 * 리뷰 B3 + ⌘Q 의 구멍: 돌아가는 턴이 앱과 함께 조용히 죽지 않게 한 번
 * 묻는다. 비-mac 의 창 닫기(닫기=종료인 규칙)와 모든 플랫폼의 앱 종료(⌘Q ·
 * 메뉴)가 같은 질문을 공유한다 — mac 은 닫기가 창만 닫으므로 종료 경로에만
 * 묻는다. 한 번 확인한 종료는 이번 실행에서 다시 묻지 않는다.
 */
let stopUnderTurnAllowed = false;
let stopDialogOpen = false;

const host = new MainWindowHost();
const notices = new PlannerNotices(host);
const updates = new SelfUpdates({
  notify: (title, body, onClick) => notices.show(title, body, onClick),
  focusMain: () => host.focusMain(),
  sessionsBusy: () => daemonServer?.anySessionBusy() ?? false,
  allowQuit: () => {
    stopUnderTurnAllowed = true;
  },
});
// reopen 이 만드는 창도 첫 창과 같은 닫기 가드를 단다.
host.onCreated = registerCloseGuard;

/**
 * 초대 파일 더블클릭으로 열기(2026-10-08 베타 준비 분석) — OS 가 건넨 경로를 판정해 줄에 세우고 떠 있는 렌더러에
 * 신호를 보낸다. 줄은 렌더러가 마운트될 때(`desktop:invite-take`) 비워진다 — 앱이 뜨기 전에 온 것도 줄이 쥔다(mac 의
 * open-file 은 ready 보다 먼저 올 수 있다). 판정 · 읽기는 invite-open.ts 의 순수 부분이다. 기록은 종류와 숫자만이다.
 */
const inviteOpen = new InviteOpenQueue();

function offerInviteFiles(
  source: "argv" | "second-instance" | "open-file",
  paths: readonly string[],
): void {
  if (paths.length === 0) return;
  let accepted = 0;
  for (const path of paths) if (inviteOpen.offer(path)) accepted += 1;
  daemonServer?.hostLog("invite-open", { source, offered: paths.length, accepted });
  if (accepted > 0 && host.window && !host.window.isDestroyed()) {
    host.window.webContents.send(INVITE_OPEN_CHANNEL);
  }
}

/**
 * 같은 userData 를 두 데몬이 쓰는 경쟁을 막는다 — 독립 데몬이 daemon.json 의
 * /health 로 세우던 이중 실행 가드의 앱 판본. 두 번째 실행은 첫째의 창으로
 * 합쳐진다. 테스트 실행(단위 임포트 · 격리 userData 스모크)은 잠그지 않는다
 * — 병렬 레인이 같은 앱을 동시에 띄운다.
 */
const underTest =
  process.env.COLONOVA_DESIGN_DESKTOP_UNIT === "1" ||
  Boolean(process.env.COLONOVA_DESIGN_DESKTOP_SMOKE);
if (underTest || app.requestSingleInstanceLock()) {
  // 두 번째 실행의 인자에 초대 파일이 있으면(Windows 에서 앱이 떠 있는 동안의 두 번째 더블클릭) 줄에 세우고 창을
  // 앞으로 — 인자의 상대 경로는 그 실행의 작업 폴더로 푼다.
  app.on("second-instance", (_event, argv, workingDirectory) => {
    offerInviteFiles("second-instance", inviteArgvPaths(argv, workingDirectory));
    host.focusMain();
  });
  // The preview-driver unit imports this module inside its own Electron to
  // reach createPreviewDriverFactory() — the daemon boot below belongs to the
  // app entry only (PLAN D61).
  if (process.env.COLONOVA_DESIGN_DESKTOP_UNIT !== "1") {
    // mac 은 더블클릭 · Dock 에 끌어 놓기가 인자가 아니라 open-file 로 온다 — ready 보다 먼저 올 수 있어 모듈을 읽는
    // 때 단다. 처리하겠다는 뜻으로 preventDefault 를 부른다. Windows 는 첫 실행의 인자(process.argv)에 담겨 온다 —
    // 플래그 · 실행 파일 · 개발 실행의 `.` 는 걸러진다.
    app.on("open-file", (event, path) => {
      event.preventDefault();
      offerInviteFiles("open-file", [path]);
      host.focusMain();
    });
    offerInviteFiles("argv", inviteArgvPaths(process.argv, process.cwd()));
    void app
      .whenReady()
      .then(() => bootApp())
      .catch(async (error: unknown) => {
        // 준비 중 폭발한 오류는 창도 오류 상자도 없이 조용히 사라진다 —
        // 잡아서 보여주고 끝낸다.
        await showStartFailure(error instanceof Error ? error.message : String(error));
        app.quit();
      });
  }
} else {
  // 두 번째 인스턴스 — 첫째에 합쳐지고 여기서 끝난다.
  app.quit();
}

// The smoke suite points this at a throwaway folder: Playwright launches
// Electron without isolating userData, so the app would otherwise start with
// the developer's real credentials.json — the GitHub gate would pass and the
// "fresh machine lands on the wizard" check would hang on any machine that
// has logged in. setPath must precede every userData reader below.
if (process.env.COLONOVA_DESIGN_DESKTOP_SMOKE) {
  app.setPath("userData", process.env.COLONOVA_DESIGN_DESKTOP_SMOKE);
}

/**
 * 재생 벤치의 접속 파일(PLAN-HARNESS §3.A, H-2): 개발 실행이 env 가 가리키는
 * 파일에 데몬의 ws 주소를 한 줄로 적어 두면, `scripts/bench` 의 클라이언트가
 * 그 파일을 읽고 접속한다. 토큰은 실행마다 새로 만들어지므로 파일도 실행마다
 * 덮어 쓰고, 지우는 일은 `will-quit` 의 몫이다. 벤치는 개발 도구일 뿐이라,
 * 못 적어도 앱에는 아무 일도 일어나지 않는다.
 */
let benchEndpointFile: string | null = null;

function writeBenchEndpoint(daemon: string): void {
  const file = benchEndpointPath(process.env, app.isPackaged);
  if (!file) return;
  try {
    const ws = new URL(daemon);
    ws.protocol = "ws:";
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      benchEndpointBody({ url: ws.toString(), pid: process.pid, now: new Date() }),
      { mode: 0o600 },
    );
    // mode 는 새로 만들 때만 걸린다 — 앞선 실행이 남긴 파일의 권한을 여기서 고친다.
    chmodSync(file, 0o600);
    benchEndpointFile = file;
  } catch {
    benchEndpointFile = null;
  }
}

/** 파일이 이 프로세스가 적은 것일 때만 지운다 — 실패는 삼킨다. */
function removeBenchEndpoint(): void {
  const file = benchEndpointFile;
  benchEndpointFile = null;
  if (!file) return;
  try {
    if (benchEndpointPid(readFileSync(file, "utf8")) !== process.pid) return;
    rmSync(file, { force: true });
  } catch {
    // 이미 없거나 못 읽는 파일은 지울 것도 없다.
  }
}

async function bootApp(): Promise<void> {
  const resetPaths = {
    dataDir: COLONOVA_DESIGN_DATA_DIR,
    userData: app.getPath("userData"),
    home: homedir(),
    appPath: app.getAppPath(),
  };
  await finishPendingAppReset(resetPaths, process.env, {
    eraseConversations: eraseProjectConversations,
    clearBrowserData: async () => {
      for (const browser of [session.defaultSession, session.fromPartition("persist:preview")]) {
        await browser.clearStorageData();
        await browser.clearCache();
      }
    },
  }).catch((error: unknown) => {
    throw new Error(resetUnfinished(error instanceof Error ? error.message : String(error)));
  });
  // Windows 토스트 알림은 시작 메뉴 바로 가기의 AUMID 로 귀속된다. NSIS 템플릿은
  // 바로 가기에 appId 를 새기므로 같은 문자열을 여기서 직접 건다 — Squirrel 이
  // 하던 자동 맞춤이 NSIS 에는 없고, 어긋난 채 띄운 알림은 Windows 가 조용히
  // 유실시킨다. mac·linux 에서는 이 호출이 아무 일도 하지 않는다.
  app.setAppUserModelId(APP_BUNDLE_ID);
  // 이 프로세스의 모든 리스너는 미리보기 자식(pnpm·node)이 fd 로 물려받는다 —
  // 포트 스캔이 그들을 미리보기로 착각하지 않게 등록한다(preview-claim 참조).
  for (const arg of process.argv) {
    const port = /^--remote-debugging-port=(\d+)$/.exec(arg)?.[1];
    if (port) daemonOwnedPorts.add(Number(port));
  }
  notices.prefs = loadNotificationPrefs(desktopSettingsPath());
  const token = randomBytes(24).toString("hex");
  const credentials = new SafeStorageCredentialStore(
    safeStorage as never,
    join(app.getPath("userData"), "credentials.json"),
  );

  const resourcesBin = join(process.resourcesPath, "bin");
  const extraPath = existsSync(resourcesBin) ? resourcesBin : undefined;
  if (extraPath) process.env.COLONOVA_DESIGN_EXTRA_PATH = extraPath;
  // 번들 도구 환경(2단계): 이동식 git(darwin) 과 bash(win32) 를 세계의 맨
  // 앞에 둔다 — PATH 앞자리는 기존 resources/bin 보다 더 앞이고, 변수는 있는
  // 값을 덮어쓴다. 데몬·세션·AI 명령이 모두 이 env 를 물려받는다.
  const tools = bundledToolEnv(resourcesBin, process.platform, process.env);
  // 데스크톱 앱이 데몬을 감싸므로 데몬의 자식들도 이 프로세스의 PATH 를
  // 물려받는다 — 번들 런타임을 앞에 두고 시작한다.
  // 구분자는 플랫폼 것을 쓴다 — win32 에서 `:` 로 붙이면 첫 PATH 항목이 깨진다.
  const pathFront = [...tools.pathPrefixes, ...(extraPath ? [extraPath] : [])];
  if (pathFront.length > 0) {
    process.env.PATH = `${pathFront.join(delimiter)}${delimiter}${process.env.PATH}`;
  }
  Object.assign(process.env, tools.env);

  const webDist = existsSync(join(app.getAppPath(), "web-dist"))
    ? join(app.getAppPath(), "web-dist")
    : undefined;

  // AI 의 미리보기 (PLAN D61): 세션 도구는 pane 의 페이지를 drive 하고,
  // 창은 모두 이 파일이 만든다 — pane 을 찾는 getter 를 넘기면
  // 드라이버는 Electron 을 몰라도 된다 (PLAN D61).
  const browserDrivers = createBrowserDriverFactory(() => plannerPreview);
  const previewDriverFactory = createPreviewDriverFactory();
  const onNotice = (notice: DaemonNotice) => {
    notices.notifyPlanner(notice);
    // 연기된 업데이트가 있으면 이 전이가 "모두 내려앉음"이었는지 본다.
    void updates.maybeRunDeferred();
  };
  const makeServer = (port: number) =>
    new DaemonServer({
      host: "127.0.0.1",
      port,
      token,
      webDist,
      credentialStore: credentials,
      previewDriverFactory,
      browserDriverFactory: browserDrivers,
      onNotice,
      // 브라우저 MCP 자식의 serverInfo.version 이 앱 버전을 말하게 한다
      // (DaemonConfig.appVersion — COLONOVA_APP_VERSION 으로 자식까지 간다).
      appVersion: app.getVersion(),
      // 개발 전용 면은 패키징되지 않은 실행(`pnpm dev:desktop` ·
      // `pnpm --filter @colonova-design/desktop dev`)에만(DaemonConfig.devAgents).
      devAgents: !app.isPackaged,
    });

  /**
   * 지난 실행이 저장한 포트로 먼저 뜬다 — 저장 포트가 점유돼 있으면 임시
   * 포트로 물러나고, 실제로 잡힌 포트를 다시 저장해 다음 실행이 같은 자리로
   * 수렴하게 한다.
   */
  const storedPort = loadStoredPort(desktopSettingsPath());
  let server: DaemonServer;
  try {
    server = await startDaemonServer(makeServer, storedPort);
  } catch (error) {
    // 데몬이 뜨지 못하면 창을 띄워도 빈 화면이다 — 상자로 알리고 끝낸다. 상자는 닫힐 때까지
    // 기다리므로 exit 이 뒤에서 기다리고, 그 안에 기록 폴더를 여는 단추가 있다(showStartFailure).
    if (!underTest) {
      await showStartFailure(error instanceof Error ? error.message : String(error));
    }
    app.exit(1);
    return;
  }
  const boundPort = server.address().port;
  if (boundPort !== storedPort) saveDesktopSettings(desktopSettingsPath(), { port: boundPort });
  daemonServer = server;
  const daemon = daemonUrl(server, token);
  const url = windowUrl(daemon);
  writeBenchEndpoint(daemon);

  const window = host.create();
  host.adopt(window, url);
  // 사용자의 미리보기 (PLAN D64 → webview): 렌더러의 <webview> 게스트를
  // 클레임하는 주인이다 — 펜스와 클레임을 창의 webContents에 건다.
  const plannerPreview = new PlannerPreviewView(
    () => host.window,
    // 미리보기의 기록 한 줄은 데몬의 파일 기록으로 모은다(종류와 숫자만).
    (message, fields) => daemonServer?.hostLog(message, fields),
  );
  // 앱 배율(U19) — ⌘= · ⌘- · ⌘0 이 앱 전체를 키운다. 창의 webContents 와
  // 미리보기 게스트(미리보기 배율과 곱해)가 함께 움직이고 값은
  // desktop-settings.json 에 남는다 — 포트가 실행마다 바뀌는 origin 에
  // Electron 의 배율 저장을 맡길 수 없다(desktop-settings 과 같은 이유).
  let appZoomFactor = loadAppZoom(desktopSettingsPath());
  const applyAppZoom = (target: BrowserWindow | null): void => {
    if (target && !target.isDestroyed()) target.webContents.setZoomFactor(appZoomFactor);
  };
  // 창이 다시 열려도 배율이 남게 — 새 창에 즉시 건다. navigation 이 배율을
  // 지우는 순간이 있으면 did-finish-load 마다 되살린다.
  const keepAppZoom = (target: BrowserWindow): void => {
    applyAppZoom(target);
    target.webContents.on("did-finish-load", () => applyAppZoom(target));
  };
  const stepAppZoom = (direction: "in" | "out" | "reset"): void => {
    appZoomFactor = stepZoom(appZoomFactor, direction);
    applyAppZoom(host.window);
    plannerPreview.setAppZoom(appZoomFactor);
    saveAppZoom(desktopSettingsPath(), appZoomFactor);
  };
  plannerPreview.setAppZoom(appZoomFactor);
  keepAppZoom(window);
  registerPreviewIpc(plannerPreview);
  plannerPreview.attachWindow(window);
  // reopen 이 만드는 창도 같은 닫기 가드·같은 펜스를 단다.
  host.onCreated = (created) => {
    registerCloseGuard(created);
    plannerPreview.attachWindow(created);
    keepAppZoom(created);
  };
  // 단축키는 메뉴가 소유한다 (PLAN D85 ⓒ · U19): 새로 고침 · 되감기는 미리보기
  // 뷰를, 배율은 앱 전체를 겨눈다 — 기본 메뉴의 ⌘R · ⌘+ 가 도구 UI 만 건드리던
  // 시절은 끝난다.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenuTemplate({
        preview: {
          reload: () => plannerPreview.reload(),
          history: (delta) => plannerPreview.history(delta),
        },
        app: {
          zoomIn: () => stepAppZoom("in"),
          zoomOut: () => stepAppZoom("out"),
          zoomReset: () => stepAppZoom("reset"),
        },
        gotoAddress: () =>
          host.window?.webContents.send("colonova-preview:key", {
            key: "l",
            meta: true,
          }),
        openSettings: () =>
          host.window?.webContents.send("colonova-preview:key", {
            key: ",",
            meta: true,
          }),
        newSession: () =>
          host.window?.webContents.send("colonova-preview:key", {
            key: "t",
            meta: true,
          }),
        // 도움말의 세 항목 — 설명서 · 기록 폴더는 메인이 직접 연다(렌더러가 죽어 있어도 닿는다). 진단 복사는 웹이
        // 글을 모으니 신호만 보낸다(창이 없으면 창을 다시 연다).
        openGuide,
        openLogs: () => void openLogsFolder(),
        copyReport: () => {
          const target = host.window;
          if (target && !target.isDestroyed()) target.webContents.send(COPY_REPORT_CHANNEL);
          else host.focusMain();
        },
        packaged: app.isPackaged,
      }),
    ),
  );
  // 새 창과 같은 창 네비게이션을 전부 가둔다 — guardNavigations 가 두 잠금을
  // 든다. 채팅의 링크도 window.open 을 지나 OS 브라우저로 나간다 — 설정
  // `앱에서 링크 열기`가 켜진 클릭만 렌더러가 preview:open-external 로 돌린다.
  guardNavigations(window, new URL(url).origin);
  // 데스크톱 스위트의 손잡이(desktop-comments.mjs 가 app.evaluate 로 닿는다).
  // main 의 globalThis 는 렌더러에서 보이지 않으니 제품 면에는 나오지 않는다.
  const suiteHandle = globalThis as Record<string, unknown>;
  suiteHandle.colonovaDesignPlannerPreview = plannerPreview;
  await window.loadURL(url);
  // The pane outlives the window — on mac ⌘W destroys it and the dock
  // icon builds another (createWindow's closure follows `host.window`).
  // Its guests die with the old window and the registry forgets them
  // (`destroyed`), so all the new page needs is the park itself.
  // host 가 들고 reopen 이 만드는 창에도 같은 정리가 닿는다.
  host.onClosed = () => {
    plannerPreview.unmount();
  };
  registerCloseGuard(window);

  registerDesktopBridge({
    updates,
    notices,
    focusMain: () => host.focusMain(),
    bundleId: APP_BUNDLE_ID,
    logsDir: LOGS_DIR,
    settingsPath: desktopSettingsPath,
    lastRendererCrash: () => host.takeRendererCrash(),
    inviteOpen,
    log: (message, fields) => daemonServer?.hostLog(message, fields),
    requestReset: async () => {
      assertResetPaths(resetPaths, process.env);
      // 취소가 첫 단추 · 기본 · Esc 의 답이다(종료 확인과 같은 문법 — copy.ts). 도는 AI 일이 있으면
      // 그 일도 멈춘다고 말한다.
      const options = resetOptions(daemonServer?.anySessionBusy() ?? false);
      const result = host.window
        ? await dialog.showMessageBox(host.window, options)
        : await dialog.showMessageBox(options);
      if (result.response !== ANSWER.other) return { cancelled: true };
      requestAppReset(resetPaths, process.env);
      stopUnderTurnAllowed = true;
      app.relaunch();
      app.quit();
      return { restarting: true };
    },
  });
  void updates.reportSwapResult();
  updates.schedule();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void host.reopen();
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("browser-window-focus", () => {
  notices.markRead();
});

function guardStopUnderTurn(event: { preventDefault(): void }, proceed: () => void): void {
  if (stopUnderTurnAllowed || !daemonServer?.anySessionBusy()) return;
  // 다이얼로그가 이미 떠 있는 두 번째 종료 시도도 막는다 — 통과시키면 확인
  // 없이 실행 중인 턴을 죽이는 뒷문이 된다.
  if (stopDialogOpen) {
    event.preventDefault();
    return;
  }
  event.preventDefault();
  stopDialogOpen = true;
  // 취소가 첫 단추 · 기본 · Esc 의 답이다 — 초기화 확인과 같은 문법(copy.ts).
  void dialog
    .showMessageBox(quitOptions())
    .then(({ response }) => {
      if (response === ANSWER.other) {
        stopUnderTurnAllowed = true;
        proceed();
      }
    })
    .finally(() => {
      stopDialogOpen = false;
    });
}

function registerCloseGuard(window: BrowserWindow): void {
  window.on("close", (event) => {
    if (process.platform === "darwin") return;
    guardStopUnderTurn(event, () => window.close());
  });
}

/** ⌘Q · 메뉴의 종료 — mac 의 창 닫기가 여기 오지 않으므로 플랫폼 무관 단다. */
app.on("before-quit", (event) => {
  guardStopUnderTurn(event, () => app.quit());
});

/**
 * 종료가 데몬을 데리고 나간다. 앱은 데몬을 제 프로세스 안에서 키우는데,
 * 미리보기 서버는 그 데몬이 띄운 별개의 프로세스다 — 아무도 `stop()` 을
 * 부르지 않으면 앱이 사라진 뒤에도 그 서버들이 포트를 쥔 채 남는다(테스트
 * 기계에서 하루치 실행이 수백 개를 남긴 것이 그 증거였다). `will-quit` 은
 * 창이 다 닫힌 뒤, 프로세스가 끝나기 직전이다: 한 번만 막아 세우고,
 * 정리가 끝나면 스스로 다시 나간다.
 */
let daemonStopped = false;
app.on("will-quit", (event) => {
  removeBenchEndpoint();
  if (daemonStopped || !daemonServer) return;
  event.preventDefault();
  void daemonServer.stop().finally(() => {
    daemonStopped = true;
    app.quit();
  });
});
