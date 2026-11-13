/**
 * 옛 기획서 사본의 정리 (2026-10-23 · 기획서 사본 이동 계획 §5) — 사본은 이제
 * 클론 밖 프로젝트 폴더의 `confluence/` 에 산다. 옛 자리는 클론 안 `docs/plans/` 였고
 * `.git/info/exclude` 에 `docs/plans/` 한 줄이 박혀 있었다.
 *
 * 폴더를 통째로 옮기거나 지우면 안 된다 — 연결 레포가 자기 `docs/plans/` 에 문서를
 * 추적할 수 있다(실측: colonova-cdp 가 넷을 추적). 지우는 것은 원장이 아는 문서의
 * `.storage.xml` · `.md` 와 `.storage.xml` 짝, 원장 자신뿐이고 추적 파일은 절대
 * 건드리지 않는다.
 *
 * 순서가 불변식이다: 옛 사본 파일을 먼저 지우고 exclude 줄은 마지막에 뺀다. 거꾸로
 * 하면 exclude 가 빠진 순간 옛 사본이 미추적 파일로 `git status` 에 보이고 보관이
 * 그것을 담아 삭제를 커밋한다. 파일 정리에서 오류가 나면 exclude 를 손대지 않고
 * 던진다 — 다음 준비가 다시 한다.
 *
 * 걷는 것은 흔적이 있을 때뿐이다 — 이 정리는 한 번만 도는 이주다. 흔적은 둘 중
 * 하나다: exclude 의 `docs/plans/` 줄(연결 · 바퀴마다 박는다), `docs/plans` 안의
 * 원장 confluence.json(첫 가져오기 끝에 쓴다). 이 앱이 사본을 둔 클론에는 늘
 * 하나가 남으므로, 둘 다 없으면 이 앱이 사본을 둔 적 없는 레포고 그 안의 미추적
 * 파일은 사람이나 AI 의 것이므로 건드리지 않는다(2026-10-23 · 기획서 사본 이동
 * 계획 §5 · 오케스트레이터 검토).
 *
 * `docs/plans` 가 심볼릭 링크면 걷지 않는다 — readdirSync 가 링크를 따라 레포
 * 밖 파일을 지울 수 있다. git 은 링크된 폴더의 안을 보지 않으므로 exclude 줄만
 * 빼도 드러나는 것이 없다(2026-10-23 · 오케스트레이터 검토).
 *
 * 멱등이다 — 흔적을 거둔 클론은 흔적이 없어 두 번째 부름에서 아무것도 하지 않는다.
 */
import {
  type Dirent,
  lstatSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  type Stats,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { readConfluenceLedger } from "./confluence-ledger.js";

/** 옛 사본 폴더 — 클론 기준 상대 경로. */
export const LEGACY_PLANS_DIR = "docs/plans";

/** 옛 exclude 줄 — 이것과 정확히 같은 줄만 뺀다. */
export const LEGACY_EXCLUDE_LINE = "docs/plans/";

/** 무엇을 거뒀는지의 셈 — 로그는 종류와 수만 남긴다. */
export interface LegacyCleanup {
  removedFiles: number;
  removedDirs: number;
  excludeLine: boolean;
}

/**
 * 옛 사본의 흔적이 있는가 — exclude 의 `docs/plans/` 줄이거나 `docs/plans` 안의
 * 원장(보통 파일)이다. 이 앱이 사본을 둔 때는 늘 둘 중 하나가 남는다.
 */
export function hasLegacyPlans(repoRoot: string): boolean {
  try {
    if (lstatSync(join(repoRoot, LEGACY_PLANS_DIR, "confluence.json")).isFile()) return true;
  } catch {
    // 원장이 없다 — exclude 줄로 판정한다.
  }
  let text: string;
  try {
    text = readFileSync(join(repoRoot, ".git", "info", "exclude"), "utf8");
  } catch {
    return false;
  }
  return text.split("\n").some((line) => line.trim() === LEGACY_EXCLUDE_LINE);
}

/**
 * 옛 사본을 거둔다. `tracked` 는 레포 기준 상대 경로(슬래시) —
 * `git ls-files -z -- docs/plans` 의 목록이다.
 */
export function cleanupLegacyPlans(repoRoot: string, tracked: ReadonlySet<string>): LegacyCleanup {
  // 흔적이 없으면 아무것도 걷지 않는다 — 사본을 둔 적 없는 레포의 미추적 파일은
  // 사람이나 AI 의 것일 수 있다(2026-10-23 · 기획서 사본 이동 계획 §5 · 오케스트레이터 검토).
  if (!hasLegacyPlans(repoRoot)) return { removedFiles: 0, removedDirs: 0, excludeLine: false };
  const plansRoot = join(repoRoot, LEGACY_PLANS_DIR);
  // 링크면 링크 너머를 걷는다 — 파일 지우기 · 폴더 거두기를 건너뛰고 exclude
  // 줄만 뺀다. git 은 링크된 폴더의 안을 보지 않으므로 드러나는 것이 없다.
  let linked = false;
  try {
    linked = lstatSync(plansRoot).isSymbolicLink();
  } catch {
    // 폴더도 링크도 없다 — 걷 것이 없다.
  }
  if (linked) return { removedFiles: 0, removedDirs: 0, excludeLine: dropExcludeLine(repoRoot) };
  let removedFiles = 0;
  for (const file of legacyCandidates(plansRoot)) {
    if (removeCandidate(repoRoot, plansRoot, file, tracked)) removedFiles += 1;
  }
  const removedDirs = sweepEmptyDirs(plansRoot);
  const excludeLine = dropExcludeLine(repoRoot);
  return { removedFiles, removedDirs, excludeLine };
}

/** 지울 후보 — 원장이 아는 문서 둘 + 걸어서 찾은 `.storage.xml` 짝 + 원장 자신(절대 경로). */
function legacyCandidates(plansRoot: string): string[] {
  const candidates = new Set<string>();
  const ledgerFile = join(plansRoot, "confluence.json");
  // 원장이 없거나 깨져도 빈 원장으로 읽힌다 — 여기서 실패할 이유가 없다.
  for (const page of Object.values(readConfluenceLedger(ledgerFile).pages)) {
    const base = join(plansRoot, page.path);
    candidates.add(`${base}.storage.xml`);
    candidates.add(`${base}.md`);
  }
  candidates.add(ledgerFile);
  for (const found of walkStorageXml(plansRoot)) {
    candidates.add(found);
    candidates.add(`${found.slice(0, -".storage.xml".length)}.md`);
  }
  return [...candidates];
}

/** `docs/plans` 아래의 모든 `.storage.xml` — 심볼릭 링크는 따라가지 않는다. */
function walkStorageXml(plansRoot: string): string[] {
  const found: string[] = [];
  const stack = [plansRoot];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile() && entry.name.endsWith(".storage.xml")) found.push(path);
    }
  }
  return found;
}

/**
 * 후보 하나 — 추적 파일 · 심볼릭 링크 · 보통 파일이 아닌 것은 남긴다. 원장의
 * `..` 로 폴더 밖을 가리키는 경로도 건드리지 않는다. 이미 없는 후보는 지운 것과 같다.
 */
function removeCandidate(
  repoRoot: string,
  plansRoot: string,
  file: string,
  tracked: ReadonlySet<string>,
): boolean {
  const inPlans = relative(plansRoot, file);
  if (inPlans === "" || inPlans.startsWith("..") || isAbsolute(inPlans)) return false;
  let stats: Stats;
  try {
    stats = lstatSync(file);
  } catch {
    return false;
  }
  if (!stats.isFile()) return false;
  const repoRel = relative(repoRoot, file).split(sep).join("/");
  if (tracked.has(repoRel)) return false;
  unlinkSync(file);
  return true;
}

/** 빈 폴더를 아래에서부터 거둔다 — 비면 `docs/plans` 도. `docs/` 와 그 위는 목록에 없다. */
function sweepEmptyDirs(plansRoot: string): number {
  const dirs: string[] = [];
  const stack = [plansRoot];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
      const path = join(dir, entry.name);
      dirs.push(path);
      stack.push(path);
    }
  }
  dirs.push(plansRoot);
  // 아래에서부터 — 깊은 폴더가 먼저 비고, 비지 않은 폴더의 조상은 저절로 남는다.
  dirs.sort((a, b) => b.split(sep).length - a.split(sep).length);
  let removed = 0;
  for (const dir of dirs) {
    try {
      rmdirSync(dir);
      removed += 1;
    } catch {
      // 비지 않은 폴더(추적 파일 · 모르는 파일 · 링크)는 그대로 둔다
    }
  }
  return removed;
}

/**
 * exclude 의 `docs/plans/` 한 줄만 뺀다 — 다른 줄과 줄 끝 모양은 그대로. 파일이
 * 없으면 아무것도 안 한다.
 */
function dropExcludeLine(repoRoot: string): boolean {
  const exclude = join(repoRoot, ".git", "info", "exclude");
  let text: string;
  try {
    text = readFileSync(exclude, "utf8");
  } catch {
    return false;
  }
  const lines = text.split("\n");
  const kept = lines.filter((line) => line.trim() !== LEGACY_EXCLUDE_LINE);
  if (kept.length === lines.length) return false;
  writeFileSync(exclude, kept.join("\n"), "utf8");
  return true;
}
