/**
 * 시험의 링크 만들기 — macOS · Linux 는 예전 그대로 `symlinkSync(target, path)` 다(2026-10-19 Windows 시험).
 *
 * Windows 의 심볼릭 링크(파일 · 폴더 모두)는 개발자 모드나 관리자 권한이 있어야 만들어진다. 없으면 EPERM 이다.
 * 접합점(junction)은 권한 없이 만들어진다. AI 도 `mklink /J` 로 만들 수 있으므로 쓰기 울타리가 막아야 하는
 * 모양이다. Node 는 접합점을 lstat 에서 링크로, readlink 에서 절대 경로 대상으로 읽는다. 끊어진 접합점은
 * realpath 가 ENOENT, 순환은 ELOOP 로 던진다 — 심볼릭 링크와 같다(2026-10-19 이 PC 실측).
 *
 * 그래서 Windows 에서는 이렇게 만든다.
 * - 있는 폴더를 가리키면 늘 접합점 — 권한이 있는 PC 에서도 접합점 경로를 시험한다.
 * - 있는 파일을 가리키면 파일 심볼릭 링크 — 권한이 없으면 만들지 않고 false 를 돌려준다(부르는 시험이 건너뛴다).
 * - 아직 없는 대상(끊어진 링크)은 예전 그대로 심볼릭 링크 — 권한이 없으면 접합점. 접합점은 절대 경로만
 *   가리키므로 상대 대상은 링크가 있는 폴더 기준으로 푼다.
 */

import { existsSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** 파일 링크를 못 만들어 건너뛸 때의 이유 — `t.skip` 에 그대로 싣는다. */
export const NO_FILE_SYMLINK = "Windows 에서 파일 심볼릭 링크 권한 없음(개발자 모드 · 관리자 아님)";

let symlinkAllowed: boolean | undefined;

/** 이 계정이 심볼릭 링크를 만들 수 있는가 — Windows 만 한 번 실제로 만들어 본다. POSIX 는 늘 된다. */
export function symlinksAllowed(): boolean {
  if (process.platform !== "win32") return true;
  if (symlinkAllowed === undefined) {
    const dir = mkdtempSync(join(tmpdir(), "link-probe-"));
    try {
      writeFileSync(join(dir, "target"), "");
      symlinkSync(join(dir, "target"), join(dir, "link"), "file");
      symlinkAllowed = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EPERM") throw error;
      symlinkAllowed = false;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  return symlinkAllowed;
}

/**
 * `path` 에 `target` 을 가리키는 링크를 만든다. `target` 은 글 그대로다(상대면 링크가 있는 폴더 기준).
 * 만들었으면 true, Windows 에서 권한 없이 있는 파일을 가리키려 하면 아무것도 만들지 않고 false.
 */
export function makeLink(target: string, path: string): boolean {
  if (process.platform !== "win32") {
    symlinkSync(target, path);
    return true;
  }
  const absolute = resolve(dirname(path), target);
  const exists = existsSync(absolute);
  if (exists && statSync(absolute).isDirectory()) {
    symlinkSync(absolute, path, "junction");
    return true;
  }
  if (symlinksAllowed()) {
    symlinkSync(target, path);
    return true;
  }
  if (exists) return false;
  symlinkSync(absolute, path, "junction");
  return true;
}
