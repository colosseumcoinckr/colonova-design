export type CopyState = { phase: "idle" | "copying" | "copied" | "failed"; text: string | null };
export type CopySource = string | (() => Promise<string>);

/** 2026-11-12 UI 조사 U-195 — 중복 누름 · 실패 · 늦은 완료 · 타이머를 한 곳에서 다룬다. */
export function createCopyController({
  write,
  changed,
  failed,
  schedule,
  cancel,
}: {
  write: (text: string) => Promise<void>;
  changed: (state: CopyState) => void;
  failed: () => void;
  schedule: (reset: () => void) => unknown;
  cancel: (timer: unknown) => void;
}) {
  let live = true;
  let busy = false;
  let timer: unknown = null;
  const clear = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  return {
    async copy(source: CopySource): Promise<void> {
      if (!live || busy) return;
      busy = true;
      clear();
      changed({ phase: "copying", text: null });
      let text: string | null = null;
      try {
        text = typeof source === "string" ? source : await source();
        if (!live) return;
        await write(text);
        if (!live) return;
        changed({ phase: "copied", text: null });
        timer = schedule(() => {
          timer = null;
          if (live) changed({ phase: "idle", text: null });
        });
      } catch {
        if (!live) return;
        changed({ phase: "failed", text });
        failed();
      } finally {
        busy = false;
      }
    },
    dispose() {
      live = false;
      clear();
    },
  };
}
