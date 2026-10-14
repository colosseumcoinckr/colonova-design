import type { SessionCommand } from "@colonova-design/protocol";

/**
 * 입력창의 `/` 와 `@`(2026-10-14 사용자 요청) — 커서 앞에서 지금 고르는 중인 조각을 찾고, 고른 것을
 * 그 자리에 넣는다. 목록의 출처는 데몬이다(`/` 는 `sessions.commands`, `@` 는 `repo.files`).
 * 순수 — `next-composer-suggest.test.ts` 가 src 에서 곧장 읽는다.
 */

/** 고르는 중인 조각 — `start` 는 표식(`/` · `@`)의 자리, `end` 는 조각이 끝나는 자리(커서 뒤까지). */
export interface Trigger {
  kind: "command" | "file";
  start: number;
  end: number;
  /** 표식과 커서 사이의 글자 — 목록을 거르는 말이다. */
  query: string;
}

/**
 * 커서 앞의 조각을 읽는다. `/` 는 말의 맨 앞에서만 — 데몬(`viewing-line.ts`)과 AI 가 슬래시 명령으로
 * 읽는 자리와 같다. `@` 는 말의 맨 앞이나 빈칸 뒤에서만(`a@b.com` 은 열지 않는다). 조각에 빈칸이
 * 들어오면 닫힌다.
 */
export function triggerAt(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret);
  const end = caret + (/^\S*/.exec(text.slice(caret))?.[0].length ?? 0);
  const slash = /^\s*\/(\S*)$/.exec(before);
  if (slash) {
    const query = slash[1] ?? "";
    return { kind: "command", start: caret - query.length - 1, end, query };
  }
  const at = /(?:^|\s)@(\S*)$/.exec(before);
  if (at) {
    const query = at[1] ?? "";
    return { kind: "file", start: caret - query.length - 1, end, query };
  }
  return null;
}

/** 폴더는 끝에 `/` 를 단다(데몬의 `browseFiles` 와 같은 약속) — 고르면 그 안으로 들어간다. */
export function isFolder(value: string): boolean {
  return value.endsWith("/");
}

/**
 * 고른 것을 조각 자리에 넣는다. 명령 · 파일 뒤에는 빈칸 하나를 두어 이어 쓰게 하고(뒤에 이미 빈칸이
 * 있으면 그 뒤로 커서만 옮긴다), 폴더는 빈칸 없이 둬서 목록이 그 안을 이어 보인다.
 */
export function completeAt(
  text: string,
  trigger: Trigger,
  value: string,
): { text: string; caret: number } {
  const sigil = trigger.kind === "command" ? "/" : "@";
  const head = text.slice(0, trigger.start) + sigil + value;
  const rest = text.slice(trigger.end);
  if (trigger.kind === "file" && isFolder(value)) return { text: head + rest, caret: head.length };
  if (/^\s/.test(rest)) return { text: head + rest, caret: head.length + 1 };
  return { text: `${head} ${rest}`, caret: head.length + 1 };
}

type CommandRow = Pick<SessionCommand, "name" | "aliases">;

/**
 * `/` 뒤의 글자로 명령을 거른다 — 이름이 그 글자로 시작하는 것이 먼저, 다른 이름(aliases)이 시작하는
 * 것이 다음, 이름 어딘가에 든 것이 마지막. 같은 이름은 한 번만. 빈 글자면 데몬이 준 차례 그대로다.
 */
export function matchCommands<T extends CommandRow>(commands: T[], query: string, limit = 50): T[] {
  const needle = query.toLowerCase();
  const seen = new Set<string>();
  const ranked: Array<{ command: T; rank: number; at: number }> = [];
  for (const [at, command] of commands.entries()) {
    if (!command.name || seen.has(command.name)) continue;
    seen.add(command.name);
    const name = command.name.toLowerCase();
    const rank = name.startsWith(needle)
      ? 0
      : command.aliases.some((alias) => alias.toLowerCase().startsWith(needle))
        ? 1
        : name.includes(needle)
          ? 2
          : -1;
    if (rank >= 0) ranked.push({ command, rank, at });
  }
  ranked.sort((a, b) => a.rank - b.rank || a.at - b.at);
  return ranked.slice(0, limit).map((row) => row.command);
}

/** 파일 · 폴더 한 줄의 이름과 그 위 폴더 — 줄은 이름을 굵게, 위 폴더를 옅게 보인다. */
export function fileParts(value: string): { name: string; parent: string; folder: boolean } {
  const folder = isFolder(value);
  const bare = folder ? value.slice(0, -1) : value;
  const cut = bare.lastIndexOf("/");
  return { name: bare.slice(cut + 1), parent: cut === -1 ? "" : bare.slice(0, cut + 1), folder };
}
