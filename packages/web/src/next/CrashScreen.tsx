import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import type { CrashReport } from "../lib/crash";
import { crashStore, isRepeatCrash } from "../lib/crash";
import { DEV, L } from "./labels";
import { AlertIcon } from "./ui/icons";

/**
 * 인라인에는 화면을 덮는 최소만 둔다 — 바탕 · 글자색(테마가 못 실린 순간에도 읽히게 폴백 포함).
 * 나머지 옷(배치 · 단추 · 상태)은 `styles.css` 의 `.nx-fs*` 다: 스타일시트까지 못 실렸다면
 * 브라우저 기본 모양으로도 읽히고 눌린다.
 */
const PANEL: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--bg, #faf9f5)",
  color: "var(--text, #26241f)",
  fontFamily:
    "Pretendard Variable, Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

/**
 * 전면 안내판(P-1 · 3.A 7) — 렌더 예외가 화면 전체를 삼킨 순간의 한 장.
 * 상태는 전부 데몬에 있으니 회복은 `다시 열기` 하나로 충분하다(계획 원칙 ①).
 * 개발자용 폴드가 message · stack · componentStack 를 보여 준다.
 *
 * 2026-10-06 겹판 손질 — 초점은 `다시 열기` 에 선다(Enter 한 번에 회복). 같은 문제가 한 분 안에
 * 되풀이되면(`isRepeatCrash` — 다시 열어도 풀리지 않는 문제) 다시 열라는 말을 되풀이하지 않고
 * 담당자에게 전할 길(내용 복사 · 데스크톱의 기록 폴더)을 앞에 둔다.
 */
export function CrashScreen({ report }: { report: CrashReport }): ReactNode {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  // 크래시 직후 초점을 주 단추로 옮긴다 — 낭독기가 제목 · 본문을 읽고 곧바로 누를 수 있게.
  // 포커스 복귀는 필요 없다 — 앱이 죽은 자리다(2026-10-04 ux-review).
  useEffect(() => {
    primary.current?.focus();
  }, []);
  // 첫 마운트를 마치기 전에 죽은 부팅 사고에는 "열리지 않아요" 가 정확한
  // 말이다 — 마운트 신호(markAppMounted)가 아직 서지 않았는지로 가른다.
  const booted = document.documentElement.dataset.appMounted === "1";
  const repeat = isRepeatCrash(report, crashStore().previous());
  const detail = [report.message, report.stack, report.componentStack]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .join("\n\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(detail);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // 클립보드가 막혀 있어도 자세히 안에 내용이 보인다 — 직접 선택해 복사할 수 있다.
    }
  };
  const openLogs = window.colonovaDesignDesktop?.openHome;
  const reopen = (
    <button
      type="button"
      className={`nx-fs-btn${repeat ? "" : " nx-fs-btn--pri"}`}
      ref={repeat ? undefined : primary}
      onClick={() => window.location.reload()}
    >
      {L.crash.reopen}
    </button>
  );
  return (
    <div
      style={PANEL}
      className="nx-fs"
      role="alertdialog"
      aria-labelledby="nx-crash-title"
      aria-describedby="nx-crash-body"
      aria-live="assertive"
    >
      <span className="nx-fs-badge" aria-hidden="true">
        <AlertIcon />
      </span>
      <h1 id="nx-crash-title">
        {repeat ? L.crash.repeatTitle : booted ? L.crash.title : L.crash.bootTitle}
      </h1>
      <p id="nx-crash-body">{repeat ? L.crash.repeatBody : L.crash.body}</p>
      <div className="nx-fs-act">
        {repeat && (
          <button
            type="button"
            className="nx-fs-btn nx-fs-btn--pri"
            ref={primary}
            onClick={() => void copy()}
          >
            {copied ? L.problem.copiedHelp : L.problem.copyHelp}
          </button>
        )}
        {reopen}
      </div>
      {repeat && openLogs && (
        <button type="button" className="nx-fs-link" onClick={() => void openLogs("logs")}>
          {L.crash.openLogs}
        </button>
      )}
      {open ? (
        <div className="nx-fs-fold">
          <pre>{detail}</pre>
          {!repeat && (
            <button type="button" className="nx-fs-link" onClick={() => void copy()}>
              {copied ? L.problem.copiedHelp : L.problem.copyHelp}
            </button>
          )}
        </div>
      ) : (
        <button type="button" className="nx-fs-link" onClick={() => setOpen(true)}>
          {DEV.crash.details}
        </button>
      )}
      <span className="nx-sr" role="status">
        {copied ? L.problem.copiedHelp : ""}
      </span>
    </div>
  );
}
