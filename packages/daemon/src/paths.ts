import { lstatSync, readlinkSync, realpathSync } from "node:fs";
import { basename, dirname, join, parse, resolve, sep } from "node:path";

/**
 * Path containment that a symlink cannot talk its way past.
 *
 * Lexical prefix checks (/a/b starts with /a) fail in both directions on a
 * real machine: macOS hands out /tmp and /private/tmp for the same folder,
 * so the lexical check refuses legitimate work; and a symlink created inside
 * the workspace but pointing outside passes the check while writing somewhere
 * else entirely. Every containment decision therefore resolves both sides
 * through the filesystem first.
 */

/**
 * realpath where it exists; otherwise realpath of the deepest existing
 * ancestor with the missing tail appended — so a not-yet-created target
 * inside the root still compares inside, and one outside still doesn't.
 *
 * 꼬리의 첫 마디가 끊어진 심볼릭 링크(아직 없는 파일을 가리키는 링크)일 수 있다. realpath 는 없는 이름과
 * 똑같이 던지므로 그냥 붙이면 클론 밖을 가리키는 링크가 안쪽으로 읽힌다(2026-10-08 검토 FIX1). 그래서 그
 * 마디를 읽어(lstat · readlink — Windows 접합점도 링크로 읽힌다) 한 단계씩 따라가고, 가리키는 곳도 같은
 * 규칙으로 푼다. 따라가는 것은 MAX_LINK_HOPS 단계까지다.
 */
export function realpathBestEffort(path: string): string {
  return resolveThroughLinks(resolve(path), MAX_LINK_HOPS);
}

/**
 * 끊어진 링크를 따라가는 최대 단계 — 순환과 끝없는 사슬을 끊는다. 이 안에서 풀리지 않는 링크(순환 ·
 * 더 깊은 사슬)는 파일 시스템의 뿌리를 돌려준다. 뿌리는 어떤 울타리의 안도 아니라서 쓰기 판정은 막는 쪽이
 * 되고(그런 링크로는 어차피 쓸 수 없다), 사슬을 길게 이어 판정을 빠져나가는 길도 없다.
 */
const MAX_LINK_HOPS = 8;

/** realpath, 없으면(끊어진 링크 · 순환 포함) null. */
function realpathOrNull(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

/** 이름이 링크면 그 링크가 가리키는 글(상대 경로일 수 있다), 링크가 아니거나 읽을 수 없으면 null. */
function linkTarget(link: string): string | null {
  try {
    return lstatSync(link).isSymbolicLink() ? readlinkSync(link) : null;
  } catch {
    return null;
  }
}

/** 있는 데까지 풀고 없는 꼬리를 붙인다 — 꼬리의 첫 마디가 끊어진 링크면 그 대상으로 갈아탄다. */
function resolveThroughLinks(absolute: string, hops: number): string {
  const tail: string[] = [];
  let current = absolute;
  for (;;) {
    const real = realpathOrNull(current);
    if (real !== null) {
      if (tail.length === 0) return real;
      const [head = "", ...rest] = tail;
      const target = linkTarget(join(real, head));
      if (target === null) return join(real, ...tail);
      if (hops === 0) return parse(absolute).root;
      // 상대 링크는 링크가 있는 폴더(real) 기준이다. 절대 경로(접합점 포함)는 resolve 가 그대로 둔다.
      return resolveThroughLinks(join(resolve(real, target), ...rest), hops - 1);
    }
    // 이 마디는 없다 — 한 단계 위에서 다시 본다
    const parent = dirname(current);
    if (parent === current) return absolute;
    tail.unshift(basename(current));
    current = parent;
  }
}

/**
 * True when `target` is `root` or inside it, after resolving both sides.
 * A relative target is resolved against `root` first, as callers always
 * intend it.
 */
export function containsPath(root: string, target: string): boolean {
  const realRoot = realpathBestEffort(root);
  const candidate =
    target.startsWith(sep) || /^[A-Za-z]:[\\/]/.test(target) ? target : resolve(root, target);
  const realTarget = realpathBestEffort(candidate);
  return realTarget === realRoot || realTarget.startsWith(realRoot + sep);
}
