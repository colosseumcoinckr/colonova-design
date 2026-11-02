import type { DocLabel } from "@colonova-design/protocol";
import { useEffect, useRef, useState } from "react";
import type { Daemon } from "../../../lib/daemon-client";
import { L } from "../../labels";
import { CloseIcon, PlusIcon, Spin } from "../../ui/icons";
import { labelProblem, labelResultLine } from "./doc-view-model";

/**
 * 문서 머리의 라벨(2026-10-30 사용자 요청) — Confluence 라벨을 알약으로 읽고, 발행 게이트가 켜졌으면
 * 더하고 뺀다. 같은 명령 아이디는 한 번만 보내고, 결과를 모르면 다시 보내지 않고 다시 읽기를 청한다.
 */
export function DocLabels({
  daemon,
  pageId,
  labels,
  writable,
  onRefresh,
}: {
  daemon: Daemon;
  pageId: string;
  /** doc.read 의 라벨 — 읽지 못했으면 null, 옛 데몬이면 undefined. */
  labels: DocLabel[] | null | undefined;
  writable: boolean;
  onRefresh: (pageId: string) => void;
}) {
  const apiRef = useRef(daemon.api);
  apiRef.current = daemon.api;
  const [shown, setShown] = useState<DocLabel[]>(labels ?? []);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);
  // 한 명령의 열쇠 — 같은 일을 다시 누르면 같은 열쇠가 가서 두 번 쓰지 않는다. 다른 일이면 새 열쇠다.
  const command = useRef<{ key: string; id: string } | null>(null);

  useEffect(() => {
    setShown(labels ?? []);
  }, [labels]);

  if (labels === undefined) return null;
  if (labels === null) return <p className="nx-dm-line">{L.confluence.labelsUnavailable}</p>;

  const names = shown.map((label) => label.name);
  const problem = text === "" ? null : labelProblem(text, names);

  const send = async (op: "add" | "remove", label: string) => {
    const key = `${op}:${label}`;
    if (command.current?.key !== key) {
      command.current = { key, id: crypto.randomUUID().toLowerCase() };
    }
    const commandId = command.current.id;
    setBusy(true);
    setLine(null);
    try {
      const result =
        op === "add"
          ? await apiRef.current.docLabelAdd({ pageId, commandId, label })
          : await apiRef.current.docLabelRemove({ pageId, commandId, label });
      const fail = labelResultLine(result);
      if (fail === null) {
        command.current = null;
        setLine(L.confluence.labelApplied(op));
        setShown((before) =>
          op === "add"
            ? [...before, { name: label, prefix: "global" }]
            : before.filter((one) => one.name !== label),
        );
        if (op === "add") {
          setText("");
          setAdding(false);
        }
        onRefresh(pageId);
      } else {
        setLine(fail);
      }
    } catch {
      setLine(L.confluence.labelFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nx-dm-labels" title={L.confluence.labels}>
      {shown.length === 0 && !adding && (
        <span className="nx-dm-line">{L.confluence.labelsNone}</span>
      )}
      {shown.map((label) => {
        const removable = writable && label.prefix === "global";
        return (
          <span
            key={`${label.prefix}:${label.name}`}
            className={`nx-dm-label${removable ? "" : " nx-dm-label--plain"}`}
          >
            {label.name}
            {removable && (
              <button
                type="button"
                className="nx-ibtn nx-ibtn--xs"
                aria-label={L.confluence.labelRemove(label.name)}
                title={L.confluence.labelRemove(label.name)}
                disabled={busy}
                onClick={() => void send("remove", label.name)}
              >
                <CloseIcon />
              </button>
            )}
          </span>
        );
      })}
      {adding ? (
        <form
          className="nx-dm-labels"
          onSubmit={(event) => {
            event.preventDefault();
            const label = text.trim().toLowerCase();
            if (labelProblem(label, names) === null) void send("add", label);
          }}
        >
          <input
            className="nx-input nx-dm-label-in"
            value={text}
            placeholder={L.confluence.labelPlaceholder}
            aria-label={L.confluence.labelPlaceholder}
            maxLength={255}
            // biome-ignore lint/a11y/noAutofocus: 더하기를 누른 사람의 다음 손은 이 칸이다
            autoFocus
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                setAdding(false);
                setText("");
              }
            }}
          />
          <button
            type="submit"
            className="nx-btn nx-btn--sm"
            disabled={busy || text.trim() === "" || problem !== null}
          >
            {busy ? <Spin /> : null}
            {L.confluence.labelSave}
          </button>
          <button
            type="button"
            className="nx-btn nx-btn--sm nx-btn--ghost"
            onClick={() => {
              setAdding(false);
              setText("");
            }}
          >
            {L.confluence.labelCancel}
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="nx-btn nx-btn--sm nx-btn--ghost"
          disabled={!writable || busy}
          title={writable ? L.confluence.labelAdd : L.confluence.labelOff}
          onClick={() => {
            setLine(null);
            setAdding(true);
          }}
        >
          <PlusIcon />
          {L.confluence.labelAdd}
        </button>
      )}
      {problem !== null && (
        <span className="nx-dm-line nx-dm-line--bad" role="alert">
          {L.confluence.labelProblem[problem]}
        </span>
      )}
      {line !== null && (
        <span className="nx-dm-line" role="status">
          {line}
        </span>
      )}
    </div>
  );
}
