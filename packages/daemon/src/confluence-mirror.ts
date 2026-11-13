/**
 * 기획서 사본의 자리(2026-10-23 · 기획서 사본 이동 계획 §4) — 프로젝트 폴더의 `confluence/`.
 *
 * 클론 밖이라 보관 · 제출에 타지 않는다. exclude 줄 · 보관 거름 · 쓰기 가드의 예외가 필요 없다.
 * 기획 작업 데이터(`plans/` — 초안 · 대화 · 발행 의도)와는 형제다. 화면 세션에는 이 폴더만 붙이고
 * `plans/` 는 붙이지 않는다(정본 269줄 — 기획 대화와 화면 대화를 섞지 않는다).
 *
 * 인자는 늘 프로젝트 폴더(`registry.paths(slug).root`)다. 클론 뿌리를 넘기면 안 된다 — 옛 도우미
 * (`confluenceLedgerFile(repoRoot)`)와 이름을 달리 한 이유다. 빠뜨린 옛 호출은 컴파일 오류로 드러난다.
 *
 * 순수 모듈이다 — 디스크를 만지지 않는다.
 */
import { join } from "node:path";

/** 프로젝트 폴더 안 사본 폴더의 이름. */
export const MIRROR_DIR = "confluence";

/** 원장 파일의 이름 — 사본 뿌리 바로 아래. */
export const MIRROR_LEDGER_NAME = "confluence.json";

/** 사본 뿌리 — `<프로젝트 폴더>/confluence`. */
export function confluenceMirrorRoot(projectRoot: string): string {
  return join(projectRoot, MIRROR_DIR);
}

/** 원장 파일 — `<프로젝트 폴더>/confluence/confluence.json`. */
export function confluenceMirrorLedger(projectRoot: string): string {
  return join(confluenceMirrorRoot(projectRoot), MIRROR_LEDGER_NAME);
}
