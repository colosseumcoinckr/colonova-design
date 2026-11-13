import { useRef } from "react";
import { L } from "../labels";
import { useCopied } from "../lib/use-copied";
import { CheckIcon, CopyIcon } from "./icons";

/** 2026-11-12 UI 조사 U-195 — 실패는 남겨 말하고, 얻은 글은 직접 선택할 수 있다. */
export function CopyButton({
  text,
  label,
  doneLabel = L.transcript.copied,
  failLabel = L.transcript.copyFailed,
  primary = false,
  small = false,
}: {
  text: string | (() => Promise<string>);
  label: string;
  doneLabel?: string;
  failLabel?: string;
  primary?: boolean;
  small?: boolean;
}) {
  const result = useCopied();
  const fallback = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <button
        type="button"
        className={`nx-btn${primary ? " nx-btn--pri" : ""}${small ? " nx-btn--sm nx-btn--ghost" : ""}`}
        disabled={result.copying}
        aria-busy={result.copying}
        onClick={() => void result.copy(text)}
      >
        {result.copied ? <CheckIcon /> : <CopyIcon />}
        <span>{result.copied ? doneLabel : result.copying ? L.clipboard.copying : label}</span>
      </button>
      <span role="status" className={result.failed ? "nx-copy-failed" : "nx-sr-only"}>
        {result.failed && result.text !== null
          ? failLabel
          : result.copied
            ? doneLabel
            : result.status}
      </span>
      {result.failed && result.text !== null && (
        <div>
          <textarea
            ref={fallback}
            className="nx-input nx-input--area"
            readOnly
            value={result.text}
            aria-label={L.clipboard.select}
            onFocus={(event) => event.currentTarget.select()}
          />
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            onClick={() => {
              fallback.current?.focus();
              fallback.current?.select();
            }}
          >
            {L.clipboard.select}
          </button>
        </div>
      )}
    </>
  );
}
