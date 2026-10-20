import { useEffect, useState } from "react";
import { CheckIcon } from "../ui/icons";
import { CopyIcon } from "./icons";

/**
 * 문장 하나를 클립보드에 넣는 단추 — 누르면 `doneLabel` 로 답하고, 잠시 뒤 처음으로 돌아와
 * 다시 누를 수 있다. IT 담당자에게 보낼 설치 문장과 개발자에게 보낼 초대 파일 요청 문장이
 * 함께 쓴다. 클립보드가 거절하면 아무 답도 내지 않는다 — 문장 상자가 `user-select: all` 이라
 * 한 번 눌러 고르면 직접 복사할 수 있다.
 *
 * 2026-10-20 온보딩 손질: 체크리스트 아래의 진단 복사도 쓴다 — 글은 누를 때 모으므로(`text` 가 함수)
 * 상자가 없다. 그래서 그때만 `failLabel` 로 실패를 말한다. `small` 은 낮은 줄의 작은 단추다.
 */
export function CopyButton({
  text,
  label,
  doneLabel,
  failLabel,
  primary = false,
  small = false,
}: {
  text: string | (() => Promise<string>);
  label: string;
  doneLabel: string;
  failLabel?: string;
  primary?: boolean;
  small?: boolean;
}) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  useEffect(() => {
    if (result === null) return;
    const timer = window.setTimeout(() => setResult(null), 2600);
    return () => window.clearTimeout(timer);
  }, [result]);
  const copy = async () => {
    try {
      const value = typeof text === "string" ? text : await text();
      await navigator.clipboard.writeText(value);
      setResult("copied");
    } catch {
      if (failLabel) setResult("failed");
    }
  };
  const copied = result === "copied";
  return (
    <button
      type="button"
      className={`nx-btn${primary ? " nx-btn--pri" : ""}${small ? " nx-btn--sm nx-btn--ghost" : ""}`}
      onClick={() => void copy()}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span aria-live="polite">
        {copied ? doneLabel : result === "failed" && failLabel ? failLabel : label}
      </span>
    </button>
  );
}
