import { useEffect, useState } from "react";
import { CheckIcon } from "../ui/icons";
import { CopyIcon } from "./icons";

/**
 * 문장 하나를 클립보드에 넣는 단추 — 누르면 `doneLabel` 로 답하고, 잠시 뒤 처음으로 돌아와
 * 다시 누를 수 있다. IT 담당자에게 보낼 설치 문장과 개발자에게 보낼 초대 파일 요청 문장이
 * 함께 쓴다. 클립보드가 거절하면 아무 답도 내지 않는다 — 문장 상자가 `user-select: all` 이라
 * 한 번 눌러 고르면 직접 복사할 수 있다.
 */
export function CopyButton({
  text,
  label,
  doneLabel,
  primary = false,
}: {
  text: string;
  label: string;
  doneLabel: string;
  primary?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2600);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className={`nx-btn${primary ? " nx-btn--pri" : ""}`}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => setCopied(true))
          .catch(() => undefined);
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
      <span aria-live="polite">{copied ? doneLabel : label}</span>
    </button>
  );
}
