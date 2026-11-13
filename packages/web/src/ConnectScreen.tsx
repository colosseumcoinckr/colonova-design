import { useState } from "react";
import { CopyButton } from "./components";
import { PlugIcon, WarnIcon } from "./components/icons";

/**
 * 브라우저 개발 경로의 연결 화면 — 데몬이 인쇄한 client url 을 한 번 붙여넣는다.
 * 데스크톱은 데몬이 페이지를 직접 주므로 이 화면을 보지 않는다(연결이 끊긴
 * 경우만 예외). 개발자의 화면이라 개발자의 말(데몬)을 쓴다 — 어휘 검사
 * (test/vocab-sweep.test.ts)가 이 파일을 건너뛴다. 입력 · 단추는 공통 부품(nx-input ·
 * nx-btn)을 쓴다(2026-10-23 화면 전면 재설계 §4 I).
 */
export function ConnectScreen({
  onConnect,
  error,
}: {
  onConnect: (url: string) => void;
  error: string | null;
}) {
  const [value, setValue] = useState("");

  return (
    <div className="connect nx">
      <h1>
        <span className="brand-name">ColoNova Design</span>
      </h1>
      <p>
        이 컴퓨터에서 데몬을 켠 다음, 데몬이 출력한 주소를 붙여 넣어 주세요. 데몬은 이미 로그인해 둔
        Claude Code를 그대로 사용하므로, 본인 구독으로 실행됩니다.
      </p>

      <div className="connect__step">
        <span className="connect__stepnum">1</span>
        <pre className="connect__cmd">
          <code>pnpm dev:daemon</code>
          <CopyButton value="pnpm dev:daemon" />
        </pre>
      </div>
      <div className="connect__step connect__step--fill">
        <span className="connect__stepnum">2</span>
        <div className="connect__inputrow">
          <input
            className="nx-input"
            /* biome-ignore lint/a11y/noAutofocus: 연결 화면의 첫 입력은 곧바로 토큰을 붙여 넣는 자리다 */
            autoFocus
            value={value}
            placeholder="ws://127.0.0.1:7823?token=…"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && value.trim() && onConnect(value.trim())}
          />
          <button
            type="button"
            className="nx-btn nx-btn--pri"
            disabled={!value.trim()}
            onClick={() => onConnect(value.trim())}
          >
            <span className="ic">
              <PlugIcon />
            </span>
            연결
          </button>
        </div>
      </div>

      {error && (
        <div className="notice notice--error">
          <span className="ic ic--sm ic--danger">
            <WarnIcon />
          </span>
          <span className="notice__text">{error}</span>
        </div>
      )}
    </div>
  );
}
