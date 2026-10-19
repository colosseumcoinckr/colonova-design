import { open } from "node:fs/promises";
import { join } from "node:path";
import { run } from "./child.js";
import { currentPlatform, type Platform, resolveGitExecutable } from "./environment.js";

/**
 * 작업 폴더 데우기 — Windows 에서 프로젝트 준비의 첫 파일 읽기를 앞당긴다(2026-10-20, Windows 실측).
 *
 * Windows Defender 는 파일을 처음 열 때 검사한다. 한 파일에 약 8~10ms 다. 레포의 준비
 * 명령(사전 생성 스크립트 · 개발 서버)은 소스를 하나씩 차례로 읽어 그 시간을 다 기다린다.
 * 실측(colonova-cdp, 소스 4,025개): 차례로 읽기 34.7초, 32개씩 함께 읽기 11.4초, 검사가 끝난 뒤
 * 다시 읽기 1.0초. 검사 결과는 프로세스를 가리지 않으므로 먼저 함께 열어 두면 뒤의 명령이 빨라진다.
 * 여는 것만으로 검사가 일어난다(열고 닫은 뒤 차례로 읽기 0.98초).
 * 새 클론에서 설치와 함께 돌리면 설치(prepare 스크립트 포함)가 75.6초에서 41.0초가 됐다.
 * 재시작의 미리보기 기동에서는 사전 생성 스크립트가 50초쯤 기다렸다(평소 6~7초).
 * macOS 는 이런 검사가 없어 아무것도 하지 않는다.
 */

/** 한 번에 여는 파일 수 — 위 실측의 32. */
export const WARM_CONCURRENCY = 32;

/**
 * 데울 파일 수의 상한. 아주 큰 레포에서 데우기가 서버 자신의 읽기와 오래 겹치지 않게 한다.
 * colonova-cdp 의 추적 파일은 5,375개다.
 */
export const WARM_FILE_LIMIT = 20_000;

/** 파일들을 열었다 닫는다 — 열 수 없는 것(지워짐 · 폴더 · 권한)은 건너뛴다. 연 수를 돌려준다. */
export async function openEach(
  paths: readonly string[],
  concurrency = WARM_CONCURRENCY,
): Promise<number> {
  let next = 0;
  let opened = 0;
  const worker = async () => {
    while (next < paths.length) {
      const path = paths[next++] as string;
      try {
        const handle = await open(path, "r");
        await handle.close();
        opened += 1;
      } catch {
        // 데우기는 덤이다 — 못 연 파일은 뒤의 명령이 평소대로 읽는다.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, worker));
  return opened;
}

/** `git ls-files -z` 의 출력 → 클론 안의 절대 경로(상한까지). */
export function trackedFilePaths(root: string, listing: string, limit = WARM_FILE_LIMIT): string[] {
  return listing
    .split("\0")
    .filter((rel) => rel !== "")
    .slice(0, limit)
    .map((rel) => join(root, rel));
}

export type WarmResult = { files: number; opened: number; ms: number };

/**
 * 클론의 추적 파일을 함께 열어 Windows 의 첫 읽기 검사를 미리 치른다. Windows 가 아니면
 * 아무것도 하지 않고 null 이다. 목록을 못 읽으면 던진다 — 호출자는 기다리지 않고 버린다.
 * git 은 RepoCore.git 을 거치지 않는다. 그 길은 출력 줄을 준비 카드의 진행 줄로 방송한다.
 */
export async function warmTrackedFiles(
  root: string,
  platform: Platform = currentPlatform(),
): Promise<WarmResult | null> {
  if (platform !== "win32") return null;
  const start = performance.now();
  const git = (await resolveGitExecutable()) ?? "git";
  const { stdout } = await run(git, ["-c", "core.longpaths=true", "-C", root, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    timeout: 30_000,
  });
  const paths = trackedFilePaths(root, String(stdout));
  const opened = await openEach(paths);
  return { files: paths.length, opened, ms: Math.round(performance.now() - start) };
}
