/**
 * «AI 답이 끝났어요» 표시의 판정(2026-11-12 비개발자 사용성 토론 · 끝남 표시).
 * 보고 있지 않던 대화가 이 실행 안에서 도는 중 → 끝남 으로 지난 것만 단다 — 처음
 * 본 `finished` 는 표시하지 않아 앱을 다시 켰을 때 옛 대화가 전부 켜지지 않는다.
 * 메모리 상태면 충분하다(같은 결정). 표시가 이기는 순서(도는 중 → 묻는 중 →
 * 실패 → 끝남)는 그리는 쪽(ConversationList)이 정한다.
 */
export type DoneThreadState = "running" | "awaiting" | "finished" | "idle";

export class UnseenDone {
  /** 대화별로 마지막으로 본 상태 — 전이 관찰은 이 앱 실행 안에서만 안다. */
  private seen = new Map<string, DoneThreadState>();
  /** «끝났어요» 를 단 대화의 열쇠. */
  readonly marked = new Set<string>();

  /**
   * 목록의 지금 상태를 한 번에 읽는다. `viewing` 은 지금 사용자가 보고 있는 대화의
   * 열쇠(그 대화 칸이 눈앞에 있을 때만 — 기획서 자리 · 다른 탭에서는 null 이어야 한다).
   * 바뀐 점이 있으면 true 를 돌려준다.
   */
  observe(
    threads: ReadonlyArray<{ id: string; state: DoneThreadState }>,
    viewing: string | null,
  ): boolean {
    let changed = false;
    const live = new Set<string>();
    for (const thread of threads) {
      live.add(thread.id);
      const before = this.seen.get(thread.id);
      if (before === thread.state) continue;
      this.seen.set(thread.id, thread.state);
      if (before === "running" && thread.state === "finished" && thread.id !== viewing) {
        if (!this.marked.has(thread.id)) {
          this.marked.add(thread.id);
          changed = true;
        }
      }
      if (thread.state === "running" && this.marked.delete(thread.id)) changed = true;
    }
    // 열면(지금 보는 대화가 되면) 표시만 지운다 — `seen` 은 남겨 다른 곳으로 옮긴 뒤에도
    // 그 대화의 전이를 이어서 안다. 목록에서 사라진 대화만 `seen` · `marked` 를 함께 거둔다.
    if (viewing !== null && live.has(viewing) && this.marked.delete(viewing)) changed = true;
    for (const id of [...this.seen.keys()]) {
      if (live.has(id)) continue;
      this.seen.delete(id);
      if (this.marked.delete(id)) changed = true;
    }
    return changed;
  }
}
