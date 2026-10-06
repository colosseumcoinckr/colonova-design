/**
 * 라디오 군의 화살표 걸음 — 순수 판정만 산다(2026-10-06 겹판 조사). 모델 칩 팝의 세 줄(AI ·
 * 모델 · 생각 시간)이 같은 문법으로 걷힌다: ← ↑ 는 앞으로, → ↓ 는 뒤로(끝에서 처음으로 돌아온다),
 * Home · End 는 양 끝. 형제 모듈을 부르지 않는다(시험이 src 에서 곧장 읽는다) — 훅은
 * `use-roving.ts` 가 이 판정 위에 선다.
 */

/**
 * 키 하나가 가리키는 칸 — 군이 걷는 키가 아니면 null(군은 그 키를 가로채지 않는다).
 * `from` 은 키를 받은 칸의 차례이고, 군 밖의 값(-1 · 칸 수 이상)이면 어느 칸에서도 오지 않은 것으로
 * 보아 → ↓ 는 첫 칸, ← ↑ 는 끝 칸으로 간다. 칸이 하나뿐이면 제자리를 돌려준다.
 */
export function rovingTarget(key: string, from: number, size: number): number | null {
  if (!Number.isInteger(size) || size <= 0) return null;
  const known = Number.isInteger(from) && from >= 0 && from < size;
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return size - 1;
    case "ArrowRight":
    case "ArrowDown":
      return known ? (from + 1) % size : 0;
    case "ArrowLeft":
    case "ArrowUp":
      return known ? (from - 1 + size) % size : size - 1;
    default:
      return null;
  }
}

/**
 * 로빙 탭 순서에서 Tab 이 닿는 칸 — 손이 옮겨 둔 칸(`at`)이 있으면 그 칸, 없으면 고른 칸, 고른
 * 칸마저 없으면(고른 AI 가 목록에 없다) 첫 칸. 군에 칸이 없으면 0.
 */
export function rovingStop(count: number, selected: number, at: number | null): number {
  if (!(count > 0)) return 0;
  if (at !== null && at >= 0 && at < count) return at;
  return selected >= 0 && selected < count ? selected : 0;
}
