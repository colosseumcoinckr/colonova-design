import type { CSSProperties, ReactNode } from "react";
import { L } from "./labels";
import { Spin } from "./ui/icons";

/** 인라인에는 화면을 덮는 최소만(충돌 안내판과 같다) — 나머지 옷은 `styles.css` 의 `.nx-fs*`. */
const PANEL: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--bg, #faf9f5)",
  color: "var(--text, #26241f)",
  fontFamily:
    "Pretendard Variable, Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

/**
 * 데스크톱에서 첫 연결이 안 됐을 때의 안내판(2026-10-06 겹판 조사) — 데스크톱은 데몬이 페이지를 직접
 * 주므로 주소를 붙여 넣을 일이 없는데, 예전에는 개발자용 연결 화면(`pnpm dev:daemon` · `ws://`
 * 붙여넣기)이 그대로 떠 비개발자에게 막다른 길이었다. 자동 재연결은 뒤에서 계속 돈다 — 이 판은
 * 기다려도 된다는 것, 지금 다시 해 볼 수 있다는 것, 안 되면 다시 열라는 것만 말한다.
 */
export function ConnectingScreen({ onRetry }: { onRetry: () => void }): ReactNode {
  return (
    <div
      style={PANEL}
      className="nx-fs"
      role="status"
      aria-live="polite"
      aria-labelledby="nx-conn-title"
      aria-describedby="nx-conn-body"
    >
      <span className="nx-fs-badge nx-fs-badge--calm" aria-hidden="true">
        <Spin />
      </span>
      <h1 id="nx-conn-title">{L.connect.title}</h1>
      <p id="nx-conn-body">{L.connect.body}</p>
      <div className="nx-fs-act">
        <button type="button" className="nx-fs-btn nx-fs-btn--pri" onClick={onRetry}>
          {L.connect.retry}
        </button>
        <button type="button" className="nx-fs-btn" onClick={() => window.location.reload()}>
          {L.crash.reopen}
        </button>
      </div>
      <p className="nx-fs-hint">{L.connect.waiting}</p>
    </div>
  );
}
