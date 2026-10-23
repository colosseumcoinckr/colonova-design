/**
 * 기획서 폴더 경로 (2026-10-18 기획서 동기화 · 계획 항목 10) — Confluence 트리를
 * `docs/plans/` 아래 상대 경로로 바꾼다. 페이지 id 는 이동해도 변하지 않으므로
 * (2026-10-18 실측) 경로는 가져올 때마다 이 계산으로 다시 만든다.
 *
 * 순수 모듈이다 — 형제 임포트도 의존성도 없다.
 */

export interface PlanNode {
  id: string;
  title: string;
  /** 종류 — 폴더도 이름 한 걸음이고, 경로 계산은 페이지와 같다(2026-10-23 최종 구현 계획 F0). */
  kind: "page" | "folder" | "unsupported";
  /** 원래 종류 — unsupported 가 Confluence 의 말을 그대로 실는다. */
  type?: string;
  children: PlanNode[];
}

/**
 * 위험 문자 걷기 — `\\ / : * ? " < > |` 와 제어문자는 `-` 로 바꾸고, 끝의 점 · 공백은
 * 잘라낸다(Windows 예방). 한글은 그대로 산다.
 */
/** 폴더 이름의 길이 상한 — 파일 이름 255바이트와 그 아래 경로의 여유까지 본 값.
 * 넘는 제목은 잘리고(세대4 설계자 지적 · livelock 막음), uniqueName 이 id 를 붙여 구별한다. */
export const CONFLUENCE_NAME_MAX_CHARS = 60;

function sweepName(name: string): string {
  const swept = name
    // biome-ignore lint/suspicious/noControlCharactersInRegex: 제어 문자가 폴더 이름에 못 쓰이게 `-` 로 바꾸는 게 이 정규식의 목적이다.
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/gu, "-")
    .replace(/[.\s]+$/u, "")
    .trim();
  return swept.length > CONFLUENCE_NAME_MAX_CHARS
    ? swept.slice(0, CONFLUENCE_NAME_MAX_CHARS)
    : swept;
}

/**
 * 폴더 밖의 단독 걸음(뿌리 문서의 파일 이름) — 걷기 규칙은 sweepName 과 같고, 비면 페이지 id 다.
 * 가져오기 루프가 이 함수 하나를 쓴다 — 규칙이 두 벌로 갈라지지 않게(2026-10-19 고침).
 */
export function planName(title: string, id: string): string {
  const swept = sweepName(title);
  return swept === "" ? id : swept;
}

/** 한 폴더에서 이름은 하나뿐 — 걷고 나서 빈 이름이면 페이지 id 로 대신하고, 이미 쓰인
 * 이름이면 페이지 id 를 붙인다(잘려도 같은 규칙). */
function uniqueName(name: string, id: string, used: Set<string>): string {
  let candidate = name === "" ? id : name;
  while (used.has(candidate)) candidate = `${candidate}-${id}`;
  used.add(candidate);
  return candidate;
}

function place(
  node: PlanNode,
  parent: readonly string[],
  used: Set<string>,
  paths: Map<string, string>,
): void {
  const name = uniqueName(sweepName(node.title), node.id, used);
  const path = [...parent, name].join("/");
  paths.set(node.id, path);
  // 자식들의 폴더는 갓 만든 경로 — 충돌 검사도 폴더마다 새로 시작한다.
  const childUsed = new Set<string>();
  for (const child of node.children) place(child, [...parent, name], childUsed, paths);
}

/**
 * 트리 → 폴더 경로. 반환 맵: 페이지 id → docs/plans 아래 상대 경로
 * ("<공간>/<뿌리>/<계층>/…/<제목>"). 뿌리 자신의 경로는 `<공간>/<뿌리 제목>` 이다.
 * 순수 함수다 — 문서가 이동하면 같은 id 가 새 트리에서 새 경로로 다시 계산된다.
 */
export function planPaths(root: PlanNode, space: string): Map<string, string> {
  const paths = new Map<string, string>();
  const spacePart = sweepName(space);
  place(root, spacePart === "" ? [] : [spacePart], new Set<string>(), paths);
  return paths;
}
