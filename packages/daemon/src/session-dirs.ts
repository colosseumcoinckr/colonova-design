/**
 * 화면 세션의 함께 여는 폴더(2026-10-23 · 기획서 사본 이동 계획 §6) — 사본 뿌리 하나.
 *
 * SDK 의 Options.additionalDirectories 는 절대 경로를 요구하고 없는 경로를 어떻게 다루는지
 * 적혀 있지 않다 — 사본 폴더가 있을 때만 넣는다. `plans/`(기획 대화 · 초안)는 절대 넣지 않는다
 * (정본 269줄 — 기획 대화와 화면 대화를 섞지 않는다).
 *
 * 순수 모듈이다 — 디스크 확인은 주입한다.
 */
import { existsSync } from "node:fs";
import { confluenceMirrorRoot } from "./confluence-mirror.js";

/** 화면 세션에 함께 여는 폴더 — 사본 폴더가 있을 때만 [사본 뿌리]. 프로젝트를 모르면 []. */
export function screenSessionDirs(
  projectRoot: string | null,
  exists: (path: string) => boolean = existsSync,
): string[] {
  if (projectRoot === null) return [];
  const mirrorRoot = confluenceMirrorRoot(projectRoot);
  return exists(mirrorRoot) ? [mirrorRoot] : [];
}
