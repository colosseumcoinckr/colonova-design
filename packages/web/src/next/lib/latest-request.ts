/** 2026-11-12 UI 조사 — 요청 순서와 대상이 모두 맞는 답만 받는다. */
export function createLatestRequest<Scope>() {
  let latest: { scope: Scope } | null = null;
  return {
    begin(scope: Scope) {
      latest = { scope };
      return latest;
    },
    isCurrent(ticket: { readonly scope: Scope }, scope: Scope): boolean {
      return ticket === latest && Object.is(ticket.scope, scope);
    },
    /** 대상 변경 · 닫힘 · 언마운트 때 호출한다. 같은 대상으로 돌아와도 옛 답은 버린다. */
    invalidate() {
      latest = null;
    },
  };
}
