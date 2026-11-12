import { createLatestRequest } from "../lib/latest-request.ts";

/** 2026-11-12 UI 조사 U-013 — 대기 중 이동과 대상 교체를 함께 가린다. */
export function createFrozenRequest() {
  const requests = createLatestRequest<string>();
  let current: { scope: string; api: object } | null = null;
  return {
    update(scope: string, api: object) {
      if (current?.scope !== scope || current.api !== api) {
        requests.invalidate();
        current = { scope, api };
      }
    },
    begin(scope: string, epoch: number) {
      return { ticket: requests.begin(scope), epoch };
    },
    accepts(request: { ticket: { readonly scope: string }; epoch: number }, epoch: number) {
      return (
        current !== null &&
        request.epoch === epoch &&
        requests.isCurrent(request.ticket, current.scope)
      );
    },
    invalidate() {
      requests.invalidate();
    },
  };
}
