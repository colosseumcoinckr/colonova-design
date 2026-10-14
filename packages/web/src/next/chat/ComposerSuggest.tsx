import type { SessionCommand } from "@colonova-design/protocol";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import {
  completeAt,
  fileParts,
  isFolder,
  matchCommands,
  type Trigger,
  triggerAt,
} from "../lib/composer-suggest";
import { keyHint } from "../lib/key-hint";
import { FileSmIcon, FolderIcon, FwdIcon } from "./icons";

/** `@` 한 번에 받는 줄 수 — 데몬의 `repo.files` 상한(500) 안에서 한 화면이 넉넉히 넘는 만큼. */
const FILE_LIMIT = 50;
/** 글자를 치는 동안은 잠깐 기다렸다 묻는다 — 폴더를 열 때(`@` · `dir/`)는 곧바로. */
const FILE_WAIT_MS = 120;

export type SuggestRow =
  | { kind: "command"; key: string; value: string; hint: string; description: string }
  | { kind: "file"; key: string; value: string };

export interface Suggest {
  /** 열린 목록 — 닫혀 있으면 null. 줄이 없어도 열린다(빈 상태 · 찾는 중을 말한다). */
  open: {
    kind: Trigger["kind"];
    query: string;
    rows: SuggestRow[];
    loading: boolean;
    /** 밝은 줄 — 줄이 없으면 -1. */
    active: number;
  } | null;
  listId: string;
  optionId: (index: number) => string;
  /** 입력칸의 글 · 커서가 바뀌었다(onChange · onSelect). 범위를 고르는 중이면 닫는다. */
  track: (el: HTMLTextAreaElement) => void;
  /** 초점이 떠났다 · 다른 대화로 옮겼다 — 목록을 닫는다. */
  close: () => void;
  /** 열린 목록이 키를 가져갔으면 참 — 부르는 쪽은 그 키로 더 하지 않는다(보내지 않는다). */
  key: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  pick: (index: number) => void;
  hover: (index: number) => void;
}

/**
 * 입력창의 `/` · `@` 목록(2026-10-14 사용자 요청). 초점은 언제나 입력칸에 남는다 — 콤보박스의
 * 모양(`aria-activedescendant`)이라 화살표가 줄을 걷는 동안에도 글자를 이어 칠 수 있다. 그래서
 * 초점을 가져가는 `ui/Popover`(role=menu) 대신 입력창 안의 판 하나로 선다.
 *
 * - `/` 는 말의 맨 앞에서만, 목록은 지금 AI 가 알려 준 명령어(`sessions.commands`)다.
 * - `@` 는 연결한 서비스의 파일 · 폴더(`repo.files`) — 폴더를 고르면 그 안을 이어 보인다.
 *   고른 것은 글자(`@src/…`)로만 들어간다 — AI 가 그 이름을 보고 직접 연다.
 */
export function useComposerSuggest({
  api,
  commands,
  text,
  commandsOn,
  apply,
}: {
  api: Pick<Daemon["api"], "findFiles">;
  commands: SessionCommand[];
  text: string;
  /** `/` 를 열어도 되는지 — 핀이 붙은 말은 표식 있는 글로 감싸져 명령으로 읽히지 않는다. */
  commandsOn: boolean;
  /** 고른 것을 넣은 글과 커서 — 부르는 쪽이 입력칸에 쓴다. */
  apply: (next: { text: string; caret: number }) => void;
}): Suggest {
  // 커서는 그것을 잰 글과 함께 쥔다 — 글이 밖에서 바뀌면(초안 전환 · 다시 불러오기) 낡은 커서로
  // 목록을 열지 않는다.
  const [at, setAt] = useState<{ text: string; caret: number } | null>(null);
  // Esc 로 닫은 조각의 자리 — 그 조각을 지울 때까지 다시 열지 않는다.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [lit, setLit] = useState<{ key: string; index: number }>({ key: "", index: 0 });
  const [files, setFiles] = useState<{ query: string; rows: string[] } | null>(null);
  const listId = useId();

  const found = at && at.text === text ? triggerAt(text, at.caret) : null;
  const trigger =
    found && found.start !== dismissed && (found.kind === "file" || commandsOn) ? found : null;
  const triggerKey = trigger ? `${trigger.kind}:${trigger.start}:${trigger.query}` : "";

  const fileQuery = trigger?.kind === "file" ? trigger.query : null;
  useEffect(() => {
    if (fileQuery === null) {
      setFiles(null);
      return;
    }
    let live = true;
    const wait = fileQuery === "" || isFolder(fileQuery) ? 0 : FILE_WAIT_MS;
    const timer = setTimeout(() => {
      api
        .findFiles(fileQuery, FILE_LIMIT)
        .then((rows) => {
          if (live) setFiles({ query: fileQuery, rows });
        })
        .catch(() => {
          if (live) setFiles({ query: fileQuery, rows: [] });
        });
    }, wait);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [fileQuery, api]);

  // 글자를 더 치는 동안은 앞 답의 줄이 남는다 — 줄마다 깜빡이지 않게. 처음 열 때만 `찾는 중`.
  const rows: SuggestRow[] = !trigger
    ? []
    : trigger.kind === "command"
      ? matchCommands(commands, trigger.query).map((command) => ({
          kind: "command",
          key: command.name,
          value: command.name,
          hint: command.argumentHint,
          description: command.description,
        }))
      : (files?.rows ?? []).map((value) => ({ kind: "file", key: value, value }));
  const loading = trigger?.kind === "file" && files?.query !== trigger.query;
  const index =
    rows.length === 0 ? -1 : lit.key === triggerKey ? Math.min(lit.index, rows.length - 1) : 0;

  const pick = (at: number) => {
    const row = rows[at];
    if (!trigger || !row) return;
    const next = completeAt(text, trigger, row.value);
    // 폴더를 골랐으면 같은 조각이 그 안을 거르는 말이 된다 — 커서를 새 글과 함께 쥐어 목록이 이어 선다.
    setAt({ text: next.text, caret: next.caret });
    apply(next);
  };

  return {
    open: trigger
      ? { kind: trigger.kind, query: trigger.query, rows, loading, active: index }
      : null,
    listId,
    optionId: (at) => `${listId}-${at}`,
    track: (el) => {
      const caret = el.selectionStart === el.selectionEnd ? el.selectionStart : null;
      if (caret === null) {
        setAt(null);
        return;
      }
      const value = el.value;
      setAt((prev) =>
        prev && prev.text === value && prev.caret === caret ? prev : { text: value, caret },
      );
      if (!triggerAt(value, caret)) setDismissed(null);
    },
    close: () => setAt(null),
    key: (event) => {
      if (!trigger) return false;
      if (event.key === "Escape") {
        // 미리보기 · 서랍의 Esc 는 물러난다 — 이 Esc 는 목록만 닫는다.
        event.preventDefault();
        event.stopPropagation();
        setDismissed(trigger.start);
        return true;
      }
      if (event.altKey || event.metaKey || event.ctrlKey || rows.length === 0) return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setLit({ key: triggerKey, index: (index + step + rows.length) % rows.length });
        return true;
      }
      if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
        event.preventDefault();
        pick(index);
        return true;
      }
      return false;
    },
    pick,
    hover: (at) => {
      if (at !== index) setLit({ key: triggerKey, index: at });
    },
  };
}

/**
 * 목록의 판 — 대화 칸에서는 입력창 위로(`up`), 홈에서는 아래로 선다. 줄을 눌러도 입력칸이 초점을
 * 잃지 않게 판의 mousedown 을 막는다.
 */
export function SuggestList({ suggest, up }: { suggest: Suggest; up: boolean }) {
  const list = useRef<HTMLDivElement>(null);
  const open = suggest.open;
  const active = open?.active ?? -1;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 밝은 줄이 바뀔 때마다 보이는 자리로 당긴다.
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);
  if (!open) return null;
  const words = L.composer.suggest;
  const name = open.kind === "command" ? words.commands : words.files;
  const empty = open.rows.length === 0;
  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions lint/a11y/noStaticElementInteractions: 초점을 입력칸에 남기는 막이다 — 키보드는 입력칸이 쥔다.
    <div
      className={`nx-suggest${up ? " nx-suggest--up" : ""}`}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="nx-suggest-head" aria-hidden="true">
        <span>{name}</span>
        {open.kind === "file" && isFolder(open.query) && (
          <span className="nx-suggest-where">{open.query}</span>
        )}
      </div>
      <div
        ref={list}
        id={suggest.listId}
        className="nx-suggest-list"
        role="listbox"
        aria-label={name}
        aria-busy={open.loading || undefined}
      >
        {open.rows.map((row, at) => {
          const lit = at === open.active;
          const file = row.kind === "file" ? fileParts(row.value) : null;
          return (
            // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/useFocusableInteractive: 콤보박스의 옵션 — 키보드는 입력칸이 쥐고(aria-activedescendant) 줄은 손에 답한다.
            <div
              key={row.key}
              id={suggest.optionId(at)}
              role="option"
              aria-selected={lit}
              className={`nx-suggest-row${lit ? " nx-suggest-row--on" : ""}`}
              // enter 가 아니라 move — 가만히 있는 손이 화살표의 걸음을 빼앗지 않는다(찾기와 같다).
              onMouseMove={() => suggest.hover(at)}
              onClick={() => suggest.pick(at)}
            >
              {row.kind === "command" ? (
                <>
                  <span className="nx-suggest-name">
                    /{row.value}
                    {row.hint && <span className="nx-suggest-hint"> {row.hint}</span>}
                  </span>
                  <span className="nx-suggest-sub">{row.description}</span>
                </>
              ) : (
                <>
                  <span className="nx-suggest-ic">
                    {file?.folder ? <FolderIcon /> : <FileSmIcon />}
                  </span>
                  <span className="nx-suggest-name">{file?.name}</span>
                  <span className="nx-suggest-sub">{file?.parent}</span>
                  {file?.folder && (
                    <span className="nx-suggest-ic">
                      <FwdIcon />
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      {empty && (
        <div className="nx-suggest-empty" role="status">
          {open.loading
            ? words.filesLoading
            : open.kind === "command"
              ? words.commandsNone
              : words.filesNone}
        </div>
      )}
      <div className="nx-suggest-keys" aria-hidden="true">
        {keyHint(words.keys)}
      </div>
    </div>
  );
}
