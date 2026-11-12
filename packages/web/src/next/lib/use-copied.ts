import { useCallback, useEffect, useRef, useState } from "react";
import { L } from "../labels";
import { type CopySource, type CopyState, createCopyController } from "./copy-controller";

export const COPIED_MS = 1500;

/** 2026-11-12 UI 조사 U-195 — status 를 항상 그려 성공 · 실패를 낭독한다. */
export function useCopied(onFail?: () => void, ms: number = COPIED_MS) {
  const [state, setState] = useState<CopyState>({ phase: "idle", text: null });
  const controller = useRef<ReturnType<typeof createCopyController> | null>(null);
  const fail = useRef(onFail);
  fail.current = onFail;
  useEffect(() => {
    const current = createCopyController({
      write: (text) => navigator.clipboard.writeText(text),
      changed: setState,
      failed: () => fail.current?.(),
      schedule: (reset) => window.setTimeout(reset, ms),
      cancel: (timer) => window.clearTimeout(timer as number),
    });
    controller.current = current;
    return () => current.dispose();
  }, [ms]);
  const copy = useCallback((text: CopySource) => controller.current?.copy(text), []);
  const copied = state.phase === "copied";
  const failed = state.phase === "failed";
  const copying = state.phase === "copying";
  const status = copying
    ? L.clipboard.copying
    : copied
      ? L.transcript.copied
      : failed
        ? state.text === null
          ? L.clipboard.prepareFailed
          : L.transcript.copyFailed
        : "";
  return { copied, failed, copying, status, text: state.text, copy };
}
