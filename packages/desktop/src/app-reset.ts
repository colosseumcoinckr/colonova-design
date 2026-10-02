import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MARKER = "reset-pending";

export interface ResetPaths {
  dataDir: string;
  userData: string;
  home: string;
  appPath: string;
}

function inside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function real(path: string): string {
  const absolute = resolve(path);
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = dirname(absolute);
  return parent === absolute ? absolute : join(real(parent), basename(absolute));
}

/** Only the app-owned root is erased. Custom external data locations need manual care. */
export function assertResetPaths(paths: ResetPaths, env: NodeJS.ProcessEnv): void {
  const root = real(paths.dataDir);
  if (basename(resolve(paths.dataDir)) !== ".colonova-design") {
    throw new Error("기본 데이터 폴더 이름이 아닌 개발 실행에서는 초기화할 수 없어요.");
  }
  if ([paths.home, paths.userData, paths.appPath].some((path) => inside(root, real(path)))) {
    throw new Error("데이터 폴더 위치를 확인할 수 없어 초기화를 멈췄어요.");
  }
  // A symlink root could make the UI promise a different deletion scope.
  if (existsSync(paths.dataDir) && lstatSync(paths.dataDir).isSymbolicLink()) {
    throw new Error("데이터 폴더가 다른 위치에 연결되어 있어 앱에서 초기화할 수 없어요.");
  }
  const overrides = [
    "PROJECTS_SETTINGS",
    "PROJECTS_DIR",
    "REPO_DIR",
    "REPO_URL",
    "REPO_PAT",
    "REPO_SETTINGS",
    "RUN_DIR",
    "UNDO_LOG",
    "PERMISSION_LOG",
    "PLAN_USAGE",
    "LOG_DIR",
  ];
  if (overrides.some((key) => Boolean(env[`COLONOVA_DESIGN_${key}`]))) {
    throw new Error("별도 데이터 위치나 연결 정보를 지정한 개발 실행에서는 초기화할 수 없어요.");
  }
}

/** Persist intent only. The next process erases after the current daemon has stopped. */
export function requestAppReset(paths: ResetPaths, env: NodeJS.ProcessEnv): void {
  assertResetPaths(paths, env);
  mkdirSync(paths.userData, { recursive: true });
  writeFileSync(
    join(paths.userData, MARKER),
    JSON.stringify({ version: 1, dataDir: real(paths.dataDir) }),
    { mode: 0o600 },
  );
}

/** Called before creating a daemon or renderer. A failure retains intent for the next launch. */
export async function finishPendingAppReset(
  paths: ResetPaths,
  env: NodeJS.ProcessEnv,
  deps: {
    eraseConversations(cwd: string): Promise<void>;
    clearBrowserData(): Promise<void>;
  },
): Promise<boolean> {
  const marker = join(paths.userData, MARKER);
  if (!existsSync(marker)) return false;
  assertResetPaths(paths, env);
  const intent = JSON.parse(readFileSync(marker, "utf8")) as {
    version?: unknown;
    dataDir?: unknown;
  } | null;
  if (intent?.version !== 1 || intent.dataDir !== real(paths.dataDir)) {
    throw new Error("초기화를 확인한 데이터 위치와 현재 위치가 달라 정리를 멈췄어요.");
  }
  const projects = join(paths.dataDir, "projects");
  const clones = [join(paths.dataDir, "repo")];
  if (existsSync(projects) && !lstatSync(projects).isSymbolicLink()) {
    for (const entry of readdirSync(projects, { withFileTypes: true })) {
      if (entry.isDirectory()) clones.push(join(projects, entry.name, "repo"));
    }
  }
  for (const clone of clones) {
    // Never erase histories belonging to an external directory linked into app data.
    if (inside(real(paths.dataDir), real(clone))) await deps.eraseConversations(clone);
  }
  await deps.clearBrowserData();
  await rm(paths.dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  for (const name of ["credentials.json", "desktop-settings.json"]) {
    await rm(join(paths.userData, name), { force: true });
  }
  await rm(marker, { force: true });
  return true;
}
