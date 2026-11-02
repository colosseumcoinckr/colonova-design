/**
 * 탭 머리의 화살표 걸음(2026-11-03 사용자 결정 — 오른쪽 칸 탭을 알약식으로 통일하며 더한다)의
 * 순수 수학 — `role="tablist"` 의 키보드 규칙 한 판이다. 설정 창의 왼쪽 목록과 오른쪽 칸의 탭이
 * 같은 판을 쓴다: 옆 화살표는 다음 탭, Home · End 는 양 끝이다. 끝에 닿으면 처음으로 돌아간다.
 *
 * 문장 · 초점 · 상태는 부르는 쪽의 몫이다 — 이 파일은 키 이름과 몇 번째 탭인지만 판정한다.
 */

/** 화살표 · 양끝 키를 몇 번째 탭으로 옮길지 판정한다. 다른 키면 null — 부르는 쪽이 손을 뗀다. */
export function nextTabIndex(key: string, count: number, at: number): number | null {
  if (count <= 0) return null;
  if (key === "ArrowDown" || key === "ArrowRight") return (at + 1) % count;
  if (key === "ArrowUp" || key === "ArrowLeft") return (at - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}
