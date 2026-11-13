#!/usr/bin/env node
// CI 순수 시험 선별기(2026-10-24) — 로컬 `pnpm test` 와 같은 glob 전수에서
// 머리에 `CI-순수-제외` 표식이 든 파일만 빼고 나머지 경로를 한 줄씩 뱉는다.
// ci.yml 은 이 출력을 `node --test` 에 그대로 건넨다. 새 시험은 표식이 없으면
// 저절로 CI 에 들어가고, 프로세스를 띄우는 시험만 표식을 달아 로컬에 둔다.
import { readdirSync, readFileSync } from "node:fs";

/** 표식 — 프로세스를 띄우는 시험의 머리 주석에 든 말. */
const MARKER = "CI-순수-제외";

/** 로컬 `pnpm test` 의 glob 과 같은 네 곳(루트 package.json 참조). */
const PLACES = [
  { dir: "packages/daemon/test", ext: ".test.ts" },
  { dir: "packages/desktop/test", ext: ".test.ts" },
  { dir: "packages/web/test", ext: ".test.ts" },
  { dir: "scripts/bench", ext: ".test.mjs" },
];

const files = [];
for (const { dir, ext } of PLACES) {
  const names = readdirSync(dir)
    .filter((name) => name.endsWith(ext))
    .sort();
  for (const name of names) files.push(`${dir}/${name}`);
}

let excluded = 0;
for (const file of files) {
  if (readFileSync(file, "utf8").includes(MARKER)) {
    excluded += 1;
    continue;
  }
  console.log(file);
}
process.stderr.write(`순수 ${files.length - excluded} · 제외(표식) ${excluded}\n`);
