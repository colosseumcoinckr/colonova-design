/**
 * `방금 한 것 되돌리기`(2026-10-06 UX 점검)가 돌아갈 곳. 작업 기록의 되돌리기는 「그 시점 이후를 전부」 되돌리므로
 * 옛 결과 카드에 `이 요청 되돌리기` 를 달면 뒤의 작업까지 사라지는데 이름이 그것을 숨긴다. 그래서 단추는 **마지막**
 * 결과에만 서고, 그 요청의 보관이 프로젝트 기록의 맨 위를 이룰 때만 — 되돌리면 정확히 그 요청만 사라질 때만 — 선다.
 *
 * `entries` 는 `repo.history` 그대로(최신이 앞). `screens` 는 `RepoStatus.cycleScreens` — 요청이 만진 화면의 줄이
 * 그 요청의 보관(`sha`)을 안다. 한 요청이 보관을 여럿 남길 수 있어(고침 턴) 맨 위부터 이어지는 그 요청의 보관을
 * 모두 지나친 곳이 돌아갈 곳이다. 맨 위가 그 요청의 것이 아니거나(그 뒤에 다른 일이 쌓였다) 돌아갈 차례가 없으면
 * null — 단추를 세우지 않고 작업 기록이 맡는다.
 */
export function undoTargetFor(
  entries: ReadonlyArray<{ sha: string }>,
  screens: ReadonlyArray<{ sha?: string; requestId?: string }> | undefined,
  requestId: string,
): { sha: string; count: number } | null {
  const mine = new Set<string>();
  for (const screen of screens ?? []) {
    if (screen.requestId === requestId && screen.sha) mine.add(screen.sha);
  }
  if (mine.size === 0) return null;
  let count = 0;
  while (count < entries.length && mine.has(entries[count]?.sha ?? "")) count += 1;
  const target = entries[count]?.sha;
  return count === 0 || target === undefined ? null : { sha: target, count };
}
