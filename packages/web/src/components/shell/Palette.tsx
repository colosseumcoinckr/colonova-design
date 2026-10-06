import type { ProjectSummary, ThreadSummary } from "@colonova-design/protocol";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useModalEscape, useModalFocus } from "../../hooks/use-modal-focus";
import type { Block, Daemon } from "../../lib/daemon-client";
import { timeAgo } from "../../lib/format";
import { composing } from "../../lib/ime";
import { type HiddenThreads, visibleThreads } from "../../lib/thread-visibility";
import { L } from "../../next/labels";
import { keyHint } from "../../next/lib/key-hint";
import {
  neverPrepared,
  type ProjectNote,
  projectCycle,
  projectNote,
} from "../../next/lib/project-note";
import { useClosing } from "../../next/lib/use-closing";
import {
  ChatLineIcon,
  GearIcon,
  HomeIcon,
  KeyDownIcon,
  KeyEnterIcon,
  KeyUpIcon,
  PlusIcon,
  SearchIcon,
  Spin,
} from "../../next/ui/icons";
import { NoteMark, ProjectMark } from "../../next/ui/ProjectMark";
import { caretEdge, excerptAround, matchRange, rank, stepWalk } from "./palette-match";

/** 대화 내용에서 맞은 줄의 순위 — 제목이 맞은 어느 것(palette-match 의 1~5)보다 뒤다. */
const CONTENT_RANK = 6;
/** 제목에서 맞은 자리가 이만큼 뒤로 밀리면 한 줄 말줄임에 가려질 수 있다 — 앞을 줄여 보인다. */
const TITLE_LEAD_LIMIT = 14;

/** 맞은 자리를 품은 글 조각. */
interface Excerpt {
  text: string;
  range: [number, number] | null;
}

/**
 * 목록 본문의 한 줄: 어느 프로젝트의 대화든, 옮겨 갈 프로젝트든. 대화를 먼저 그리고 프로젝트가
 * 뒤따르며, 종류가 바뀌는 자리에 머리가 선다 — 말은 `L`(labels.ts)에서 오고 사이드바와 같다.
 */
type Row =
  | {
      kind: "session";
      key: string;
      slug: string;
      thread: ThreadSummary;
      label: string;
      /** 사이드바의 상태 표식: 도는 중 · 답을 기다리는 중. */
      mark: "live" | "ask" | null;
      /** 지금 보고 있는 대화. */
      now: boolean;
      /** 프레임 전체를 걷는 동안 다른 프로젝트의 대화면 그 프로젝트 — 이름 알약이 선다. */
      other: ProjectSummary | null;
      /** 상태의 말(만드는 중 · 답을 기다려요) — 조용한 대화는 비어 있다. */
      state: string;
      /** 마지막으로 움직인 시각(ms) — 읽을 수 없으면 null. */
      at: number | null;
      /** 제목은 안 맞고 대화 내용이 맞았을 때 — 맞은 줄. */
      match?: Excerpt;
    }
  | {
      kind: "project";
      key: string;
      project: ProjectSummary;
      label: string;
      note: ProjectNote;
    };

/** 가장 최근의 보이는 사용자 · 답 줄 가운데 찾는 말이 든 것 — 맞은 자리를 품은 조각으로. */
function transcriptMatch(query: string, blocks: Block[]): Excerpt | undefined {
  if (!query.trim()) return undefined;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (!block || (block.type !== "user" && block.type !== "text")) continue;
    const text = block.text.replace(/\s+/g, " ").trim();
    // 긴 글에서는 가운데의 홀로 선 자음을 초성으로 읽지 않는다 — 어느 줄에나 맞는다.
    const range = matchRange(query, text, { initials: false });
    if (range) return excerptAround(text, range, 32, 48);
  }
  return undefined;
}

/** 친 글자를 `<mark>` 로 묶는다 — 맞은 덩이가 없으면 글 그대로. */
function Marked({ text, range }: { text: string; range: [number, number] | null }) {
  if (!range) return <>{text}</>;
  return (
    <>
      {text.slice(0, range[0])}
      <mark>{text.slice(range[0], range[1])}</mark>
      {text.slice(range[1])}
    </>
  );
}

/** 목록 밑의 칩: 어디에 있든 프레임이 답하는 명령. */
interface Command {
  key: string;
  label: string;
  /** 하는 일 — 호버 이름표. */
  hint: string;
  /** 같은 곳에 닿는 단축키 — 칩 안에 적힌다. */
  keys: string | null;
  Icon: typeof PlusIcon;
  run: () => void;
}

/**
 * 프레임의 모든 건너뛰기가 한 판 뒤에 산다(⌘K): 모든 프로젝트의 대화(새것부터) · 프로젝트 · 명령
 * 칩. 말은 사이드바의 것(labels.ts)이다 — 찾기 창은 사이드바의 색인이지 둘째 어휘가 아니다.
 *
 * 스스로 `.nx` 뿌리다(`palette.css`): 셸의 토큰과 초기화는 받고, 앱 뿌리의 격자 · 잘림에는 갇히지
 * 않는다. 초점은 입력칸을 떠나지 않는다 — 걸음은 줄에서 칩까지 한 줄로 이어지는
 * `aria-activedescendant` 이고, 화살표가 너무 멀리 가도 Enter 는 밝은 것에 답하고 타이핑은 이어진다.
 *
 * 한글을 치는 동안 조합 중인 글자도 맞고(`결ㅈ`) 초성으로도 찾는다(`ㄱㅈ`) — `palette-match.ts`.
 * 닫을 때는 겹판처럼 물러나고(`useClosing`), 하려던 일은 판이 걷힌 뒤에 한다 — 설정 같은 다음 판이
 * 이 판의 입력칸을 돌아올 자리로 기억하지 않게(2026-10-06 겹판 조사).
 */
export function Palette({
  titleForThread,
  activeSessionId,
  projects,
  hiddenThreads,
  transcripts,
  activeSlug,
  projectSlug = null,
  onOpenThread,
  onCreateSession,
  onOpenHome,
  onActivateProject,
  onOpenSettings,
  onClose,
}: {
  /** 대화가 쓰는 이름: 사용자가 바꾼 이름, 없으면 데몬의 제목. */
  titleForThread: (thread: ThreadSummary) => string;
  activeSessionId: string | null;
  projects: ProjectSummary[];
  /** 낙관 삭제가 이미 거둔 행 — 사이드바·홈과 같은 규칙이 팔레트에도
      산다. 숨김을 모르면 지운 대화가 ⌘K 걸음에 되살아난다. */
  hiddenThreads: HiddenThreads;
  /** 읽어 둔 대화 줄 — 제목이 안 맞으면 내용에서 맞은 줄을 보인다. */
  transcripts: Daemon["sessions"];
  activeSlug: string | null;
  /** 한 프로젝트의 대화만 걷는 길(목록의 더 보기 줄) — 걸음이 그 안에 머문다. null 이면 프레임
      전체. 지금 셸은 이 길을 쓰지 않는다(2026-10-06 조사 — 죽은 길). */
  projectSlug?: string | null;
  /** 대화를 연다 — 다른 프로젝트의 것이면 먼저 옮긴다. */
  onOpenThread: (slug: string, thread: ThreadSummary) => void;
  onCreateSession: () => void;
  /** 홈으로 — 사이드바의 `홈` 행과 같은 걸음. */
  onOpenHome: () => void;
  /** 등록부가 옮겨 앉으면 true — 거절되면 false(또는 거부)로 알리고 판은 열린 채 남는다. */
  onActivateProject: (slug: string) => Promise<boolean>;
  onOpenSettings: () => void;
  onClose: () => void;
}) {
  // 한 프로젝트로 좁힌 걸음은 그 이름을 머리에서 한 번만 말한다 — 줄마다 되풀이하지 않는다.
  const scopedName = projectSlug
    ? (projects.find((entry) => entry.slug === projectSlug)?.name ?? null)
    : null;
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** 옮기는 중인 프로젝트 — 줄에 도는 표식이 서고 다른 눌림은 잠긴다. */
  const [moving, setMoving] = useState<string | null>(null);
  /** 맞는 줄이 없어 칩만 길로 남았을 때, 걷기 시작하기 전에는 아무 칩도 밝지 않다(Enter 한 번이 새 대화를 열지 않게). */
  const [armed, setArmed] = useState(false);
  // 목록이 접힌 자리에서 잘렸다는 것을 말한다 — 가장자리에 걸린 머리가 실수로 보이지 않게.
  const [more, setMore] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const uid = useId();
  useModalFocus(panelRef);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // ── 닫기: 한 길이다. Esc · 스크림 · 줄 · 칩이 모두 `leave` 로 모이고, 겹판처럼 물러난 뒤에
  // 하려던 일을 하고 닫는다. 판이 걷힌 뒤에 해야 다음 판(설정)이 이 판의 입력칸을 돌아올 자리로
  // 기억하지 않는다 — 일과 닫기가 한 묶음에 실려 한 번에 그려진다.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const leaving = useRef(false);
  const after = useRef<(() => void) | null>(null);
  const toComposer = useRef(false);
  const { closing, begin } = useClosing(() => {
    const action = after.current;
    after.current = null;
    action?.();
    onClose();
  });
  const leave = (action?: () => void, andType = false) => {
    if (leaving.current || !alive.current) return;
    leaving.current = true;
    after.current = action ?? null;
    toComposer.current = andType;
    begin();
  };
  const leaveRef = useRef(leave);
  leaveRef.current = leave;
  const dismiss = useCallback(() => leaveRef.current(), []);
  // Esc 는 입력칸의 keydown 에 갇혀 있지 않다(실사 결함): 클릭이 초점을 입력칸 밖으로 옮겨도
  // 닫혀야 한다. 위에 대화상자가 있으면 그쪽의 몫이다 — 맨 위 층 규칙이 가린다.
  useModalEscape(panelRef, dismiss, !closing);
  // ⌘K 는 여는 키이자 닫는 키다 — 닫을 때도 같은 모션으로 물러난다. 셸의 토글(window)이 판을 곧바로 떼어
  // 내지 못하게 문서 단계에서 멈춘다(2026-10-06 겹판 조사).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [dismiss]);
  // 판이 사라질 때 — 물러나는 사이에 ⌘K 로 걷혀 버려도 고른 일은 잃지 않는다. 입력칸으로 가는
  // 일(대화 · 새 대화)은 초점이 돌아온 다음에 알린다: 위의 `useModalFocus` 정리가 먼저 돌아 판을
  // 연 곳으로 초점을 보내므로, 이 정리가 그 뒤에 입력창을 깨운다.
  useEffect(
    () => () => {
      const action = after.current;
      after.current = null;
      action?.();
      if (toComposer.current) window.dispatchEvent(new Event("nx:composer:focus"));
    },
    [],
  );

  const rows: Row[] = useMemo(() => {
    const out: Array<{ row: Row; rank: number; recency: number }> = [];
    // 모든 프로젝트의 대화 — 한 프로젝트로 연 판이면 그 프로젝트의 것만.
    const scope = projectSlug ? projects.filter((entry) => entry.slug === projectSlug) : projects;
    for (const project of scope) {
      // 낙관 삭제의 숨김을 같은 규칙으로 거둔다 — 데몬 목록이 아직 따라오지 않아도 지워진 대화가
      // 걸음에 남지 않게.
      for (const thread of visibleThreads(project.threads, hiddenThreads, project.slug)) {
        const label = titleForThread(thread);
        const titleRank = rank(query, label);
        const line =
          titleRank < 0 ? transcriptMatch(query, transcripts[thread.id]?.blocks ?? []) : undefined;
        if (titleRank < 0 && !line) continue;
        // 새것부터가 이 판의 첫 축이다(오버레이 목업 05): 프로젝트를 가로질러 한 줄의 시간선이지
        // 프로젝트마다 한 더미가 아니다. 읽을 수 없는 시각은 데몬의 순서를 지킨다.
        const stamp = Date.parse(thread.updatedAt);
        out.push({
          rank: titleRank >= 0 ? titleRank : CONTENT_RANK,
          recency: Number.isNaN(stamp) ? 0 : -stamp,
          row: {
            kind: "session",
            key: `${project.slug}:${thread.id}`,
            slug: project.slug,
            thread,
            label,
            // 사이드바가 그리는 표식만 — 도는 것과 답을 기다리는 것.
            mark: thread.state === "running" ? "live" : thread.state === "awaiting" ? "ask" : null,
            now: project.slug === activeSlug && thread.id === activeSessionId,
            other: projectSlug || project.slug === activeSlug ? null : project,
            state:
              thread.state === "running"
                ? L.journey.making
                : thread.state === "awaiting"
                  ? L.sidebar.waitingAnswer
                  : "",
            at: Number.isNaN(stamp) ? null : stamp,
            ...(line ? { match: line } : {}),
          },
        });
      }
    }
    // 한 프로젝트로 좁힌 판은 그 프로젝트를 이미 알고 있어, 옮기는 줄은 방금 한 말을 되풀이할 뿐이다.
    for (const project of projects) {
      const at = rank(query, project.name);
      if (projectSlug || project.slug === activeSlug || at < 0) continue;
      out.push({
        rank: at,
        recency: 0,
        row: {
          kind: "project",
          key: project.slug,
          project,
          label: project.name,
          // 머리(`프로젝트`)를 되풀이하지 않고, 사이드바의 다른 프로젝트 줄이 말하는 그 한마디
          // (만드는 중 · 답을 기다려요 N · 반영됐어요 …)를 싣는다.
          note: projectNote(project, L),
        },
      });
    }
    // 대화가 앞서고 프로젝트가 뒤따른다. 한 종류 안에서는 더 잘 맞는 것이 앞서고, 같은 순위는
    // 시간선을 지킨다 — 정렬은 안정이라 시각 열쇠는 순위가 같을 때만 갈린다(질의 없는 걸음이 그렇다).
    const order = { session: 0, project: 1 } as const;
    return out
      .sort(
        (a, b) => order[a.row.kind] - order[b.row.kind] || a.rank - b.rank || a.recency - b.recency,
      )
      .map((entry) => entry.row);
  }, [
    projects,
    hiddenThreads,
    transcripts,
    activeSlug,
    activeSessionId,
    projectSlug,
    query,
    titleForThread,
  ]);

  // 칩 — 프레임이 답하는 모든 명령. 목록 밖에 서서 목록이 제 굴림을 지키지만 같은 걸음 위에 있다:
  // 화살표가 마지막 줄에서 칩으로 넘어가고 Enter 가 밝은 것을 연다. 상태 확인은 없다(단계 10):
  // 감독자가 확인한다. 말이 칩에 맞으면 칩도 줄처럼 좁혀지고, 빈 말은 나머지를 손 닿는 곳에 둔다.
  const allCommands = useMemo(() => {
    const all: Command[] = [
      // 사이드바의 세 걸음(새 대화 · 홈 · 설정)은 여기서도 닿는다 — 「홈」을 쳐도 빈손이 아니게.
      {
        key: "new",
        label: L.sidebar.newConv,
        hint: L.palette.newConvHint,
        keys: keyHint("⌘T"),
        Icon: PlusIcon,
        run: onCreateSession,
      },
      {
        key: "home",
        label: L.sidebar.home,
        hint: L.palette.homeHint,
        keys: null,
        Icon: HomeIcon,
        run: onOpenHome,
      },
      {
        key: "settings",
        label: L.sidebar.settings,
        hint: L.palette.settingsHint,
        keys: keyHint("⌘,"),
        Icon: GearIcon,
        run: onOpenSettings,
      },
    ];
    return all;
  }, [onCreateSession, onOpenHome, onOpenSettings]);
  const matchedCommands = useMemo(
    () => allCommands.filter((command) => rank(query, command.label) >= 0),
    [allCommands, query],
  );

  // 한 줄 — 줄이 앞서고 칩이 뒤따른다. 줄어드는 목록이 제 끝을 넘은 하이라이트를 쥐지 않는다.
  const hasWord = query.trim() !== "";
  // 말이 줄에도 칩에도 안 맞으면 막다른 길이 되지 않게 칩을 모두 남긴다 — 단, 밝히지는 않는다
  // (맞지 않는 말에서 Enter 한 번이 새 대화를 여는 일은 없다).
  const fallback = hasWord && rows.length === 0 && matchedCommands.length === 0;
  const commands = fallback ? allCommands : matchedCommands;
  const total = rows.length + commands.length;
  const index = fallback && !armed ? -1 : Math.min(highlight, Math.max(0, total - 1));
  const optionId = (at: number) => `nx-pal-opt-${at}`;
  // 보일 것이 하나도 없다고 말한다 — 단, 친 말에 맞는 칩이 있으면 바로 그 칩 위에서
  // 「맞는 것이 없어요」 라고 말하지 않는다.
  const empty = rows.length === 0 && !(hasWord && matchedCommands.length > 0);
  const showsList = rows.length > 0 || empty;

  // 머리별 묶음 — 같은 종류가 이어진 줄이 한 묶음이고, 묶음마다 이름 있는 `group` 이다.
  const sections = useMemo(() => {
    const out: Array<{
      kind: Row["kind"];
      header: string;
      items: Array<{ row: Row; at: number }>;
    }> = [];
    rows.forEach((row, at) => {
      const last = out[out.length - 1];
      if (last && last.kind === row.kind) {
        last.items.push({ row, at });
        return;
      }
      out.push({
        kind: row.kind,
        header:
          row.kind === "project"
            ? L.sidebar.projects
            : scopedName
              ? L.palette.projectConvs(scopedName)
              : hasWord
                ? L.sidebar.convs
                : L.palette.recentConvs,
        items: [{ row, at }],
      });
    });
    return out;
  }, [rows, scopedName, hasWord]);

  const syncMore = useCallback(() => {
    const list = listRef.current;
    setMore(list !== null && list.scrollTop + list.clientHeight < list.scrollHeight - 2);
  }, []);
  // 줄은 글자마다 오가니 접힌 자리는 그릴 때마다 읽는다(같은 값의 set 은 건너뛴다). 창의 높이도
  // 접힌 자리를 옮기고(판이 낮은 창에 양보한다) 관찰자가 그것을 잡는다.
  useLayoutEffect(syncMore);
  useEffect(() => {
    const list = listRef.current;
    if (!list || !showsList) return;
    const watch = new ResizeObserver(syncMore);
    watch.observe(list);
    return () => watch.disconnect();
  }, [syncMore, showsList]);

  // 손이 밝힌 줄은 이미 손 아래에 있다 — 키보드의 걸음(과 새 결과)만 목록을 옮길 수 있다. 접힌
  // 자리 근처에서 호버가 손 밑으로 목록을 슬금슬금 끌고 가지 않게.
  const byPointer = useRef(false);
  const light = (at: number) => {
    if (at === index) return;
    byPointer.current = true;
    setArmed(true);
    setHighlight(at);
  };

  useEffect(() => {
    if (byPointer.current) {
      byPointer.current = false;
      return;
    }
    const list = listRef.current;
    if (!list || index < 0 || index >= rows.length) return;
    // 첫 줄은 머리 밑에 선다 — 머리도 함께 되돌린다.
    if (index === 0) list.scrollTop = 0;
    else list.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index, rows.length]);

  // 낭독 — 말을 바꾸고 잠시 쉬면 결과 수를 한 번 말한다(글자마다 말하면 조합 중에 시끄럽다).
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    if (!hasWord) {
      setAnnounced("");
      return;
    }
    const text = empty ? L.palette.noMatch(query.trim()) : L.palette.resultCount(total);
    const timer = window.setTimeout(() => setAnnounced(text), 300);
    return () => window.clearTimeout(timer);
  }, [hasWord, empty, total, query]);

  const runRow = (row: Row) => {
    if (leaving.current || moving !== null) return;
    setError(null);
    if (row.kind === "session") {
      leave(() => onOpenThread(row.slug, row.thread), true);
      return;
    }
    const slug = row.project.slug;
    setMoving(slug);
    onActivateProject(slug)
      .then((moved) => {
        if (!alive.current) return;
        if (moved) leave();
        else setError(L.toast.switchFailed);
      })
      .catch(() => {
        if (alive.current) setError(L.toast.switchFailed);
      })
      .finally(() => {
        if (alive.current) setMoving(null);
      });
  };
  const runCommand = (command: Command) => {
    if (leaving.current || moving !== null) return;
    setError(null);
    leave(command.run, command.key === "new");
  };
  const runLit = () => {
    if (index < 0) return;
    if (index < rows.length) {
      const row = rows[index];
      if (row) runRow(row);
    } else {
      const command = commands[index - rows.length];
      if (command) runCommand(command);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // 조합 중의 키는 그대로 지나간다: Enter 는 덜 친 말을 열어 버리고 화살표는 IME 의 후보창을
    // 끌어간다.
    if (composing(event)) return;
    // Home/End 는 입력칸의 키이기도 하다 — 커서가 그 가장자리에 서 있을 때만 걷고, 글을 고르는
    // 조합(Shift 등)은 입력칸의 몫이다.
    const edge =
      event.key === "Home" || event.key === "End"
        ? event.shiftKey || event.altKey || event.ctrlKey || event.metaKey
          ? { start: false, end: false }
          : caretEdge(
              event.currentTarget.value,
              event.currentTarget.selectionStart,
              event.currentTarget.selectionEnd,
            )
        : undefined;
    const step = stepWalk(event.key, index, rows.length, commands.length, edge);
    if (step !== null) {
      event.preventDefault();
      setArmed(true);
      setHighlight(step);
    } else if (event.key === "Enter" && total > 0) {
      event.preventDefault();
      runLit();
    }
    // Esc 는 여기서 답하지 않는다: `useModalEscape` 가 문서에서 듣고 맨 위 층만 닫는다. 입력칸이
    // 먼저 닫으면 문서 단계 전에 팔레트가 언마운트되어 아래의 대화상자가 맨 위가 되어 버린다 —
    // 한 번의 키로 두 층이 사라진다.
  };

  const lead = (row: Row) =>
    row.kind === "project" ? (
      <ProjectMark slug={row.project.slug} name={row.label} />
    ) : (
      <ChatLineIcon />
    );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/noNoninteractiveElementInteractions: 스크림은 포인터 전용의 닫기다 — 키보드의 길은 Esc(useModalEscape)다.
    <div
      className={`nx nx-pal${closing ? " nx-pal--out" : ""}`}
      // 스크림이 닫는다. 그 밖의 안쪽 누름이 초점을 입력칸 밖으로 끌어내선 안 된다 — 걸음과 타이핑이
      // 모두 거기 산다. 입력칸 자신은 제 mousedown(커서 · 선택)을 지킨다.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
        else if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
      }}
    >
      <div
        className="nx-pal-panel"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={projectSlug ? L.palette.findInProject : L.palette.find}
      >
        <div className="nx-pal-search">
          <SearchIcon />
          <input
            ref={searchRef}
            className="nx-pal-input"
            value={query}
            placeholder={projectSlug ? L.palette.findInProject : L.palette.find}
            aria-label={projectSlug ? L.palette.findInProject : L.palette.find}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="nx-pal-list"
            aria-activedescendant={total > 0 && index >= 0 ? optionId(index) : undefined}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
              setArmed(false);
              // 말을 바꾸면 지난 실패는 이미 낡은 말이다.
              setError(null);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        {error && (
          <p className="nx-pal-error" role="alert">
            {error}
          </p>
        )}
        {/* 결과 수 · 빈 상태는 눈에만 보이면 안 된다 — 낭독이 한 번 말한다. */}
        <p className="nx-sr" role="status">
          {announced}
        </p>
        <div
          className="nx-pal-box"
          id="nx-pal-list"
          role="listbox"
          aria-label={L.palette.find}
          aria-busy={moving !== null || undefined}
        >
          {showsList && (
            <ul
              className="nx-pal-list"
              role="presentation"
              ref={listRef}
              data-more={more}
              onScroll={syncMore}
            >
              {empty && (
                <li className="nx-pal-empty" role="presentation">
                  <span className="nx-pal-empty-t">
                    <SearchIcon />
                    <span>
                      {hasWord
                        ? L.palette.noMatch(query.trim())
                        : projectSlug
                          ? L.palette.noConvsInProject
                          : L.palette.noConvs}
                    </span>
                  </span>
                  {hasWord && <span className="nx-pal-empty-h">{L.palette.noMatchHelp}</span>}
                </li>
              )}
              {sections.map((section) => (
                <li key={section.kind} className="nx-pal-sect" role="presentation">
                  {/* biome-ignore lint/a11y/useSemanticElements: fieldset 은 제 상자와 legend 를 들여온다 — 묶음의 이름은 머리(aria-labelledby)가 말한다. */}
                  <ul
                    className="nx-pal-grp"
                    role="group"
                    aria-labelledby={`${uid}-${section.kind}`}
                  >
                    <li className="nx-pal-group" id={`${uid}-${section.kind}`} role="presentation">
                      {section.header}
                    </li>
                    {section.items.map(({ row, at }) => {
                      // 친 글자를 맞은 자리에 먹인다 — 이어진 덩이만 모양이 있다(흩어진 것은 없다).
                      // 제목이 길면 맞은 조각이 말줄임 뒤로 숨지 않게 앞을 줄여 보인다.
                      const found = matchRange(query, row.label);
                      const title =
                        found && found[0] > TITLE_LEAD_LIMIT
                          ? excerptAround(row.label, found, 8, row.label.length)
                          : { text: row.label, range: found };
                      const lit = at === index;
                      const busy = row.kind === "project" && row.project.slug === moving;
                      return (
                        // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/useFocusableInteractive: 콤보박스의 옵션 — 키보드는 입력칸이 쥐고(aria-activedescendant) 줄은 손에 답한다.
                        <li
                          key={row.key}
                          id={optionId(at)}
                          data-index={at}
                          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: 같은 listbox — 옵션은 줄이다.
                          role="option"
                          aria-selected={lit}
                          aria-busy={busy || undefined}
                          className={`nx-pal-row${lit ? " nx-pal-row--on" : ""}${row.kind === "session" && row.now ? " nx-pal-row--now" : ""}`}
                          /* enter 가 아니라 move — 목록 위에 가만히 있는 손이 키보드의 화살표에서
                             걸음을 빼앗지 않는다 */
                          onMouseMove={() => light(at)}
                          onClick={() => runRow(row)}
                        >
                          <span className="nx-pal-ic" aria-hidden="true">
                            {lead(row)}
                          </span>
                          {/* 제목 뒤에 표식이 선다(사이드바의 줄처럼) — 표식이 있든 없든 제목은 같은
                              가장자리에서 시작한다. */}
                          <span className="nx-pal-t">
                            <span className="nx-pal-tt">
                              <Marked text={title.text} range={title.range} />
                            </span>
                            {row.kind === "session" && row.mark === "live" && <Spin />}
                            {row.kind === "session" && row.mark === "ask" && (
                              <i className="nx-dot nx-dot--amber" aria-hidden="true" />
                            )}
                          </span>
                          {busy ? (
                            <span className="nx-pal-meta nx-pal-meta--busy">
                              <Spin />
                              {L.palette.moving}
                            </span>
                          ) : row.kind === "project" ? (
                            <span className={`nx-pal-meta nx-tone--${row.note.tone}`}>
                              <NoteMark
                                note={row.note}
                                cycle={
                                  neverPrepared(row.project) ? "none" : projectCycle(row.project)
                                }
                              />
                              {row.note.text}
                            </span>
                          ) : row.now ? (
                            <span className="nx-pal-meta">{L.palette.nowOpen}</span>
                          ) : (
                            <span className="nx-pal-meta">
                              {row.other && (
                                <span className="nx-pal-pill">
                                  <ProjectMark
                                    slug={row.other.slug}
                                    name={row.other.name}
                                    size="sm"
                                  />
                                  <span>{row.other.name}</span>
                                </span>
                              )}
                              <span className="nx-pal-when">
                                {[row.state, row.at === null ? "" : timeAgo(row.at)]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </span>
                            </span>
                          )}
                          {/* 밝은 줄이 무엇에 답하는지 — 자리는 늘 잡아 두어 하이라이트가 옮겨 다녀도 줄의
                              오른쪽 끝이 출렁이지 않는다. */}
                          <span className="nx-pal-go" aria-hidden="true">
                            {lit && (
                              <kbd className="nx-kc">
                                <KeyEnterIcon />
                              </kbd>
                            )}
                          </span>
                          {row.kind === "session" && row.match && (
                            <span className="nx-pal-matchline">
                              <span>{L.palette.messageMatch} · </span>
                              <Marked text={row.match.text} range={row.match.range} />
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {commands.length > 0 && (
            // biome-ignore lint/a11y/useSemanticElements: fieldset 은 제 상자와 legend 를 들여온다 — 여기서는 listbox 안에서 칩의 묶음에 이름만 붙인다.
            <div className="nx-pal-cmds" role="group" aria-label={L.palette.commands}>
              {commands.map((command, c) => {
                const at = rows.length + c;
                const Icon = command.Icon;
                return (
                  <button
                    key={command.key}
                    type="button"
                    id={optionId(at)}
                    data-index={at}
                    role="option"
                    aria-selected={at === index}
                    // 초점은 입력칸이 쥐고 화살표가 걷는다 — 탭 순서의 칩은 둘째 입구일 뿐이다.
                    tabIndex={-1}
                    className={`nx-pal-chip${at === index ? " nx-pal-chip--on" : ""}`}
                    title={command.hint}
                    onMouseMove={() => light(at)}
                    onClick={() => runCommand(command)}
                  >
                    <Icon />
                    {command.label}
                    {command.keys && <kbd>{command.keys}</kbd>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="nx-pal-foot" aria-hidden="true">
          <span>
            <kbd>
              <KeyUpIcon />
              <KeyDownIcon />
            </kbd>
            {L.palette.move}
          </span>
          <span>
            <kbd>
              <KeyEnterIcon />
            </kbd>
            {L.palette.open}
          </span>
          <span>
            <kbd>esc</kbd>
            {L.palette.close}
          </span>
        </div>
      </div>
    </div>
  );
}
