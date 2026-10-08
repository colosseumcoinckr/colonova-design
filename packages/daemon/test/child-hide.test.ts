import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * 소스 계약 — 자식 프로세스를 띄우는 모든 호출이 `windowsHide` 를 갖는다 (2026-10-07, 베타 준비 분석).
 *
 * Windows 에서 GUI 앱이 콘솔 앱(git · node · where · taskkill …)을 띄우면 그때마다 검은 콘솔 창이
 * 깜빡인다. `windowsHide: true` 가 그 창을 숨기는데 기본이 꺼져 있고, 옛 코드는 한 곳(agent-install)에만
 * 있었다. 이 시험은 데몬과 데스크톱의 src 를 읽어 spawn 류 호출마다 옵션이 있는지, 그리고 `execFile`
 * 계열이 `child.ts` 의 `run`(기본값을 얹는다) 밖에서 쓰이지 않는지 본다. 프로세스를 띄우지 않는다.
 *
 * 새 spawn 호출을 더했다가 이 시험이 빨개지면 옵션에 `windowsHide: true` 를 준다. 정말 숨기면 안 되는
 * 호출(GUI 앱을 띄우는 것)이나 Windows 에서 돌 수 없는 호출이면 아래 EXCEPTIONS 에 이유와 함께 더한다 —
 * 쓰이지 않는 예외는 이 시험이 스스로 잡는다.
 */

const SOURCES = [
  fileURLToPath(new URL("../src/", import.meta.url)),
  fileURLToPath(new URL("../../desktop/src/", import.meta.url)),
];

/** `windowsHide` 없이 불려도 되는 호출 — 호출자 파일 · 부르는 이름 · 첫 인자 모양 · 이유. */
const EXCEPTIONS: Array<{ file: string; callee: string; first: RegExp; reason: string }> = [
  {
    file: "daemon/src/dispatch.ts",
    callee: "spawn",
    first: /^command\b/,
    reason:
      "폴더 열기 — explorer · open · xdg-open 은 GUI 앱이다. windowsHide 는 첫 창까지 숨겨 폴더가 안 보인다.",
  },
  {
    file: "daemon/src/onboarding.ts",
    callee: "spawnLike",
    first: /^"xcode-select"/,
    reason: "macOS 전용 — 설치 대화상자(GUI)를 연다. Windows 에서는 돌지 않는다.",
  },
  {
    file: "daemon/src/credentials.ts",
    callee: "spawn",
    first: /^this\.security\b/,
    reason: "macOS 키체인(/usr/bin/security) 전용 — Windows 의 저장소는 데스크톱의 safeStorage 다.",
  },
  {
    file: "desktop/src/app-updates.ts",
    callee: "spawn",
    first: /^"\/bin\/bash"/,
    reason: "macOS 교체 스크립트 — Windows 가지는 바로 위에서 windowsHide 로 PowerShell 을 띄운다.",
  },
];

/** `execFile` 계열은 child.ts 의 `run` 만 쓴다 — 기본값(windowsHide)이 거기 한 곳에 있다. */
const RAW_EXEC_IMPORTS = new Set([
  "execFile",
  "execFileSync",
  "exec",
  "execSync",
  "spawnSync",
  "fork",
]);

const CALLEES = "spawnSync|spawnLike|spawnFn|execFileSync|execFile|execSync|exec|spawn|fork";

/** 주석과 문자열 · 정규식 리터럴을 건너뛰며 코드만 남긴다 — 길이 · 줄바꿈은 그대로. */
function scan(src: string): { code: string; masked: string } {
  const code = src.split("");
  const masked = src.split("");
  const blank = (list: string[], from: number, to: number) => {
    for (let k = from; k < to; k += 1) if (list[k] !== "\n") list[k] = " ";
  };
  const regexAfterWord = new Set([
    "return",
    "typeof",
    "case",
    "in",
    "of",
    "delete",
    "void",
    "throw",
    "new",
    "else",
    "do",
    "yield",
    "await",
  ]);
  const regexAfterChar = new Set([
    "",
    "(",
    "[",
    "{",
    ",",
    ";",
    ":",
    "=",
    "!",
    "&",
    "|",
    "?",
    "+",
    "-",
    "*",
    "%",
    "<",
    ">",
    "~",
    "^",
  ]);
  const n = src.length;
  let prev = "";
  let word = "";
  let i = 0;
  while (i < n) {
    const c = src[i] as string;
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      let j = i;
      while (j < n && src[j] !== "\n") j += 1;
      blank(code, i, j);
      blank(masked, i, j);
      i = j;
      continue;
    }
    if (c === "/" && d === "*") {
      const close = src.indexOf("*/", i + 2);
      const j = close < 0 ? n : close + 2;
      blank(code, i, j);
      blank(masked, i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c) j += src[j] === "\\" ? 2 : 1;
      blank(masked, i + 1, j);
      i = j + 1;
      prev = c;
      word = "";
      continue;
    }
    if (c === "`") {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (depth === 0 && src[j] === "`") break;
        if (src[j] === "$" && src[j + 1] === "{") {
          depth += 1;
          j += 2;
          continue;
        }
        if (depth > 0 && src[j] === "}") depth -= 1;
        j += 1;
      }
      blank(masked, i + 1, j);
      i = j + 1;
      prev = "`";
      word = "";
      continue;
    }
    if (c === "/") {
      const startsRegex =
        regexAfterChar.has(prev) || (/[A-Za-z]/.test(prev) && regexAfterWord.has(word));
      if (startsRegex) {
        let j = i + 1;
        let inClass = false;
        while (j < n && src[j] !== "\n") {
          const e = src[j];
          if (e === "\\") {
            j += 2;
            continue;
          }
          if (e === "[") inClass = true;
          else if (e === "]") inClass = false;
          else if (e === "/" && !inClass) break;
          j += 1;
        }
        blank(masked, i + 1, j);
        i = j + 1;
        while (i < n && /[a-z]/.test(src[i] as string)) i += 1;
        prev = "/";
        word = "";
        continue;
      }
    }
    if (/\w|\$/.test(c)) word = /\w|\$/.test(src[i - 1] ?? "") ? word + c : c;
    else if (!/\s/.test(c)) word = "";
    if (!/\s/.test(c)) prev = /\w|\$/.test(c) ? "a" : c;
    i += 1;
  }
  return { code: code.join(""), masked: masked.join("") };
}

interface Site {
  callee: string;
  /** 인자 전체의 글(주석 뺀 원문). */
  args: string;
  /** 인자 전체의 글(문자열 · 정규식 안을 지운 것) — `windowsHide` 를 찾는 곳. */
  maskedArgs: string;
}

/** spawn 류 호출 — 이름 · 인자. 메서드 호출(`x.exec(`)은 제외하고 `this.` 로 부르는 것만 센다. */
function callSites(src: string): Site[] {
  const { code, masked } = scan(src);
  const sites: Site[] = [];
  const call = new RegExp(`(?<![\\w$.])(?:this\\.)?(${CALLEES})\\s*\\(`, "g");
  for (let hit = call.exec(masked); hit !== null; hit = call.exec(masked)) {
    const start = hit.index + hit[0].length;
    let depth = 1;
    let end = start;
    while (end < masked.length && depth > 0) {
      if (masked[end] === "(") depth += 1;
      else if (masked[end] === ")") depth -= 1;
      end += 1;
    }
    sites.push({
      callee: hit[1] as string,
      args: code.slice(start, end - 1).trim(),
      maskedArgs: masked.slice(start, end - 1),
    });
  }
  return sites;
}

/** `node:child_process` 에서 값으로 가져오는 이름들 — `import type` 과 `type X` 는 뺀다. */
function childProcessImports(src: string): string[] {
  const { code } = scan(src);
  const names: string[] = [];
  const named = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*["'](?:node:)?child_process["']/g;
  for (let hit = named.exec(code); hit !== null; hit = named.exec(code)) {
    if (hit[1]) continue;
    for (const part of (hit[2] as string).split(",")) {
      const item = part.trim();
      if (item === "" || item.startsWith("type ")) continue;
      names.push((item.split(/\s+as\s+/)[0] as string).trim());
    }
  }
  if (/import\s+(?:\*\s+as\s+\w+|\w+)\s+from\s*["'](?:node:)?child_process["']/.test(code)) {
    names.push("*");
  }
  return names;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts") ? [path] : [];
  });
}

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const files = SOURCES.flatMap(sourceFiles).map((path) => ({
  path,
  rel: relative(repoRoot, path).split(sep).join("/"),
  src: readFileSync(path, "utf8"),
}));

test("스캐너: 주석 · 문자열 · 정규식 안의 spawn 은 세지 않고, 인자의 괄호를 바르게 센다", () => {
  const find = (src: string) => callSites(src).map((site) => site.callee);
  assert.deepEqual(find('spawn("a", [], { windowsHide: true })'), ["spawn"]);
  assert.deepEqual(find('// spawn("a")\n/* execFile("b") */'), []);
  assert.deepEqual(
    find("const s = \"spawn(1)\"; const t = 'execFile(2)'; const u = `exec(\u0024{x})`;"),
    [],
  );
  assert.deepEqual(find("const r = /spawn\\(/.test(line); const q = a / b / c;"), []);
  assert.deepEqual(find("x.spawn(1); y.exec(2); this.spawnFn(3)"), ["spawnFn"]);
  assert.deepEqual(find("function f() { return /execFile(/.test(x) } spawn(1)"), ["spawn"]);
  const [site] = callSites(
    'spawn(cmd, [a(b), "c)"], {\n  stdio: "ignore",\n  windowsHide: true,\n})',
  );
  assert.match(site?.maskedArgs ?? "", /\bwindowsHide\b/);
  assert.equal(
    callSites('spawn(cmd, ["// windowsHide"])')[0]?.maskedArgs.includes("windowsHide"),
    false,
  );
  assert.equal(
    callSites("spawn(cmd) // windowsHide")[0]?.maskedArgs.includes("windowsHide"),
    false,
  );
  assert.deepEqual(
    childProcessImports(
      'import { type ChildProcess, execFile, spawn as sp } from "node:child_process";',
    ),
    ["execFile", "spawn"],
  );
  assert.deepEqual(
    childProcessImports('import type { ChildProcess, spawn } from "node:child_process";'),
    [],
  );
  assert.deepEqual(childProcessImports('import * as cp from "child_process";'), ["*"]);
});

test("스캐너는 진짜 소스를 읽고 있다 — 알려진 호출 자리를 본다", () => {
  assert.ok(files.length > 60, `소스 파일 수: ${files.length}`);
  const sites = (rel: string) => callSites(files.find((file) => file.rel === rel)?.src ?? "");
  for (const rel of [
    "daemon/src/repo-core.ts",
    "daemon/src/repo-bringup.ts",
    "daemon/src/preview-claim.ts",
    "daemon/src/onboarding.ts",
    "daemon/src/handoff-preview.ts",
    "daemon/src/agent/jsonrpc.ts",
    "daemon/src/type-check.ts",
    "desktop/src/app-updates.ts",
  ]) {
    assert.ok(sites(rel).length > 0, `${rel}: spawn 류 호출을 찾지 못했다 — 스캐너가 어긋났다`);
  }
});

test("모든 spawn 류 호출이 windowsHide 를 갖는다 — 예외는 이유와 함께 명단에 있다", () => {
  const unused = new Set(EXCEPTIONS.map((_, index) => index));
  const missing: string[] = [];
  for (const file of files) {
    for (const site of callSites(file.src)) {
      if (/\bwindowsHide\b/.test(site.maskedArgs)) continue;
      const index = EXCEPTIONS.findIndex(
        (item) =>
          item.file === file.rel && item.callee === site.callee && item.first.test(site.args),
      );
      if (index >= 0) {
        unused.delete(index);
        continue;
      }
      missing.push(`${file.rel}: ${site.callee}(${site.args.replace(/\s+/g, " ").slice(0, 60)}…)`);
    }
  }
  assert.deepEqual(
    missing,
    [],
    "windowsHide: true 가 빠진 호출 — 옵션에 더하거나 EXCEPTIONS 에 이유와 함께 적는다",
  );
  assert.deepEqual(
    [...unused].map((index) => EXCEPTIONS[index]?.file),
    [],
    "쓰이지 않는 예외 — 호출이 사라졌거나 모양이 바뀌었다",
  );
});

test("execFile 계열은 child.ts 의 run 만 쓴다 — 기본값이 거기 한 곳에 있다", () => {
  const offenders: string[] = [];
  for (const file of files) {
    if (file.rel === "daemon/src/child.ts") continue;
    for (const name of childProcessImports(file.src)) {
      if (RAW_EXEC_IMPORTS.has(name) || name === "*") offenders.push(`${file.rel}: ${name}`);
    }
  }
  assert.deepEqual(offenders, [], 'execFile 은 `import { run } from "./child.js"` 로 부른다');
});

test("run 의 기본값이 windowsHide 다", () => {
  const child = files.find((file) => file.rel === "daemon/src/child.ts");
  assert.ok(child, "child.ts 가 있다");
  assert.match(
    scan(child.src).masked,
    /execFileAsync\([^)]*\{\s*windowsHide:\s*true,\s*\.\.\.options\s*\}/,
  );
});
