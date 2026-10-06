import type { RepoHistoryEntry, RepoStatus } from "@colonova-design/protocol";
import { ShieldCheck } from "lucide-react";
import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { overlayOpen, useModalFocus } from "../../hooks/use-modal-focus";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import { historyKindOf } from "../lib/history-kind";
import { historyAsSheet } from "../lib/preview-geometry";
import {
  affectedScreens,
  entryScreens,
  entryTitle,
  type HistoryNode,
  historyDays,
  relativeTime,
  revertSummary,
} from "../lib/revert-summary";
import { useFreshKeys } from "../lib/use-fresh-keys";
import { InlineConfirm } from "../ui/InlineConfirm";
import { openComparison } from "./ComparisonDialog";
import {
  CloseIcon,
  CommentNodeIcon,
  CompareIcon,
  HistoryEmptyIcon,
  HistoryIcon,
  MergeNodeIcon,
  RestoreNodeIcon,
  SmallCheckIcon,
  UndoIcon,
} from "./icons";

/**
 * `nx:history:open` — 정산 줄의 메뉴(단계 2)와 `이번 작업`(단계 4)이 서랍을 연다. 결과 카드의 `방금 한 것 되돌리기` 는
 * `detail: { restoreTo, count }` 로 되돌아갈 곳(보관의 sha)과 그 위로 쌓인 차례 수를 건네 그 줄의 확인을 미리 열어 달라고
 * 부탁한다.
 */
export const HISTORY_OPEN_EVENT = "nx:history:open";
/**
 * `nx:history:changed` — 되돌리기가 기록을 바꿨다. 결과 카드가 `방금 한 것` 의 되돌아갈 곳을 다시 읽는다(되돌리면 맨 위가
 * 새 `되돌렸어요` 차례가 되어 그 요청의 단추가 사라진다).
 */
export const HISTORY_CHANGED_EVENT = "nx:history:changed";

const pad = (n: number) => String(n).padStart(2, "0");
/** 시각 한 마디 — `14:05`. */
export function clockOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
/** 날의 머리 — 오늘 · 어제 · 9월 23일. */
function dayOf(iso: string, now: Date): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start(now) - start(date)) / 86_400_000);
  if (diff === 0) return L.history.today;
  if (diff === 1) return L.history.yesterday;
  return L.history.dayOf(date.getMonth() + 1, date.getDate());
}

/** 열려 있는 동안 반 분마다 다시 읽는 지금 — `방금 · 3분 전` 이 저절로 늙는다. */
function useClock(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [on]);
  return now;
}

/** 한 줄의 시각 — 방금 · 3분 전 · 14:05. */
function whenOf(iso: string, now: number): string {
  const when = relativeTime(iso, now);
  if (when.kind === "now") return L.history.justNow;
  if (when.kind === "minutes") return L.history.minutesAgo(when.minutes);
  return clockOf(iso);
}

/** 타임라인의 마디 — 사용자의 요청은 속이 빈 점, 앱이 만든 사건은 그림이 든 알. */
function NodeMark({ node }: { node: HistoryNode }) {
  const glyph: Record<HistoryNode, ReactNode> = {
    request: null,
    merge: <MergeNodeIcon />,
    restore: <RestoreNodeIcon />,
    comment: <CommentNodeIcon />,
  };
  return (
    <span className={`nx-hnode nx-hnode--${node}`} aria-hidden="true">
      {glyph[node]}
    </span>
  );
}

/**
 * 작업 기록 서랍(PLAN-UI U9) — 미리보기 위로 미끄러져 들어온다. 항목은
 * `repo.history` 그대로(제목 = 사용자의 말), 둘째 줄은 그 차례의 시각과 화면
 * (`RepoStatus.cycleScreens`), 제출의 순간은 구분선이다. 맨 위(지금 서 있는
 * 곳)를 뺀 어느 줄이든 누르면 그 자리에 확인이 열리고, 확인은 시각이 아니라
 * 제목으로 묻는다 — 되돌아가는 일의 크기(화면 수 · 변경 수 · 코멘트 반영)는 칩으로,
 * 시각은 확정 단추가 말한다. 되돌리기는 `repo.restore { sha }` — 새 차례로 쌓여 역사는
 * 지워지지 않는다.
 *
 * 2026-10-06 겹판 손질 — 확인 카드를 서랍의 결정 순간답게 올렸다(포인트 선 · 칩 · 안심 한 줄 ·
 * 시각이 적힌 확정 단추), 줄은 타임라인(점을 잇는 선 · `지금` · 방금/3분 전)이 되었고, 좁은 칸(≤480px)
 * 에서는 뒤를 어둡게 하는 시트가 된다. 닫힌 뒤 초점은 그 줄의 되돌리기 단추로 돌아간다.
 *
 * 2026-10-06 작업 기록 손질 — ① 줄 하나가 단추 하나다(제목 + 시각 · 화면, 끝에 조용한 `되돌리기`) —
 * 줄마다 테두리 단추가 둘씩 서던 벽을 걷었다. 요청은 속이 빈 점, 앱이 만든 사건(가져옴 · 되돌림 ·
 * 코멘트 반영)은 그림이 든 알이다. ② 날의 머리는 굴러도 위에 붙고(sticky), 확인을 연 동안 그 뒤
 * 줄(되돌리면 사라질 것)은 흐려져 되돌리는 일의 크기가 타임라인에서 바로 보인다. ③ 열고 닫는 길 —
 * 스크림도 닫을 때 걷히고, 되돌리기가 끝나면 서랍이 접혀 되돌린 화면이 곧바로 보이며, 홈으로 나가거나
 * 프로젝트를 옮기면 접힌다(숨은 칸의 열린 서랍이 Tab 초점을 붙들던 일 · 다른 프로젝트의 줄이 비치던
 * 일을 없앴다). ↑ ↓ Home End 로 줄을 훑는다.
 */
export function HistoryDrawer({
  id,
  open,
  offstage = false,
  onClose,
  daemon,
  repo,
  submits,
  onRestored,
  toast,
  returnRef,
  arm = null,
  onArmed,
}: {
  /** 서랍의 id — 여는 단추의 `aria-controls` 가 가리킨다. */
  id?: string;
  open: boolean;
  /** 이 칸이 숨었다(홈이 떠 있다) — 열린 채 숨지 않고 접는다. */
  offstage?: boolean;
  onClose: () => void;
  daemon: Daemon;
  repo: RepoStatus | null;
  /** 이번 사이클의 제출 시각들(ISO) — 구분선의 자리. */
  submits: string[];
  /** 되돌리기가 끝났다 — 칸은 미리보기를 다시 읽는다. */
  onRestored: () => void;
  toast: (text: string) => void;
  /** 닫히면 초점이 되돌아가는 단추 — 서랍을 연 곳(시계). */
  returnRef?: RefObject<HTMLElement | null>;
  /**
   * 열면서 받은 되돌아갈 곳(결과 카드의 `방금 한 것 되돌리기`) — 기록을 읽어 온 뒤 그 줄의 확인을 연다. `count` 는 그 곳
   * 위로 쌓였을 것이라 카드가 본 차례 수다(-1 이면 모른다) — 지금 읽은 기록과 맞을 때만 확인이 `방금 한 것` 이라 말한다.
   */
  arm?: { sha: string; count: number } | null;
  /** 건넨 곳을 썼거나 버렸다 — 다음 열기에 낡은 것이 남지 않게 부른 쪽이 비운다. */
  onArmed?: () => void;
}) {
  const { api } = daemon;
  const slug = daemon.activeSlug;
  // 읽어 온 줄은 어느 프로젝트의 것인지 함께 든다 — 프로젝트를 옮겨도 이전 프로젝트의 줄이 새 줄이 올 때까지 비치지 않게.
  const [loaded, setLoaded] = useState<{
    slug: string | null;
    entries: RepoHistoryEntry[];
  } | null>(null);
  // 닫혀 있는 동안은 프로젝트를 따지지 않는다 — 프로젝트를 옮기며 접히는 서랍이 빈 판으로 미끄러져 나가지 않게. 열려 있을 때만
  // 읽어 온 줄이 지금 프로젝트의 것이어야 한다(옮긴 직후 지난 프로젝트의 줄이 비치지 않게).
  const lastSlug = useRef(slug);
  const moved = lastSlug.current !== slug; // 프로젝트가 바뀐 바로 이 그림 — 아래 효과가 곧 서랍을 접는다.
  const entries =
    loaded !== null && (!open || moved || loaded.slug === slug) ? loaded.entries : null;
  const [readFailed, setReadFailed] = useState(false);
  const [restoreFailed, setRestoreFailed] = useState(false);
  // 확인이 열린 줄은 자리(index)가 아니라 보관의 이름(sha)으로 안다 — 새 차례가 쌓여 줄이 밀려도 확인이 옆 줄로 옮겨 앉지 않는다.
  const [confirm, setConfirm] = useState<string | null>(null);
  // `방금 한 것` 으로 연 확인의 줄 — 그 줄의 확인만 되돌아갈 곳의 제목 대신 `방금 한 것을 되돌릴까요?` 로 묻는다.
  const [lastSha, setLastSha] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const now = useClock(open);

  // 열 때마다, 그리고 새 차례가 쌓일 때마다(보관 수가 움직인다) 다시 읽는다.
  const saved = repo?.pendingChanges ?? 0;
  const branch = repo?.branch ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 여는 순간 · 새 차례 · 되돌린 뒤에 읽는다.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setReadFailed(false);
    api
      .saveHistory()
      .then((next) => !cancelled && setLoaded({ slug, entries: next.entries }))
      .catch((cause) => {
        if (cancelled) return;
        console.error("[colonova-design] history read", cause);
        setReadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, api, tick, saved, branch, repo?.cycleScreens?.length, slug]);
  useEffect(() => {
    if (!open) {
      setConfirm(null);
      setRestoreFailed(false);
    }
  }, [open]);

  // 열린 채로 칸이 숨는 순간(홈 · 가려진 탭)과 프로젝트가 바뀐 순간에 접는다 — 숨은 칸의 열린 서랍은 Tab 초점을 눈에 안 보이는
  // 곳으로 끌어갔고, 옮긴 프로젝트에는 지난 프로젝트의 기록이 열려 있었다. 숨은 칸에서 열린 것(탭을 옮기며 여는 길)은 접지 않는다.
  const wasOffstage = useRef(offstage);
  useEffect(() => {
    const hid = offstage && !wasOffstage.current;
    lastSlug.current = slug;
    wasOffstage.current = offstage;
    if (open && (hid || moved)) onClose();
  }, [open, offstage, slug, moved, onClose]);

  // 서랍을 열고 닫을 때 · 프로젝트가 바뀔 때마다 오르는 판 — 오래 걸리는 되돌리기가 끝났을 때 그사이 서랍을 닫았다 다시 열었거나
  // 프로젝트를 옮겼다면, 끝난 일이 지금 보는 서랍을 닫거나 다른 프로젝트의 화면을 다시 읽지 않게 한다.
  const session = useRef(0);
  const nowSlug = useRef(slug);
  nowSlug.current = slug;
  // biome-ignore lint/correctness/useExhaustiveDependencies: 열림 · 닫힘 · 프로젝트가 바뀐 순간만 센다.
  useEffect(() => {
    session.current += 1;
  }, [open, slug]);

  const panel = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // 2026-10-04 ux-review(2차): working 잠김의 사유는 서랍 머리의 한 줄이 이미 말한다 —
  // 잠긴 줄에 aria-describedby 로 묶어 줄에서도 들리게 한다.
  const workingWhyId = useId();
  // 열리면 제목에 초점을 준다(화면 낭독기가 서랍의 이름부터 말하게). 닫히면
  // 서랍을 연 단추로 돌려 놓는 것과 열린 동안의 Tab 가두기는 useModalFocus
  // 가 맡는다 — 2026-10-04 ux-review: 트랩이 없어 초점이 뒤 막대로 샜다.
  const title = useRef<HTMLHeadingElement>(null);
  // 뒤가 살아 있는 옆 서랍이다 — 서랍 안에서만 Tab 이 돌고, 밖(입력창 · 막대의 다른 단추)의 Tab 은 끌어오지 않는다.
  useModalFocus(panel, open && !offstage, returnRef, { reenter: false });
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    if (!open) return;
    // 새로 열면 맨 위(지금)부터 — 지난번에 굴려 둔 자리에서 열리면 가장 새 줄이 안 보인다.
    scroller.current?.scrollTo({ top: 0 });
    // 두 프레임 뒤에 — 동작을 줄인 창은 자식마다 `visibility` 가 0.01ms 전환을 가져, 첫 프레임의 스타일 계산에서 전환이 막 시작하는
    // 순간에는 제목이 아직 hidden 이라 초점이 붙지 않았다(한 프레임 뒤에도 같았다). 서랍은 아직 옆에서 들어오는 중이니 초점이
    // 칸을 옆으로 끌어가지 않게 한다.
    let inner = 0;
    const outer = window.requestAnimationFrame(() => {
      inner = window.requestAnimationFrame(() => title.current?.focus({ preventScroll: true }));
    });
    return () => {
      window.cancelAnimationFrame(outer);
      window.cancelAnimationFrame(inner);
    };
  }, [open]);

  // 칸이 좁으면(≤480px) 서랍은 옆 서랍이 아니라 시트다 — 뒤를 어둡게 하고 바깥을 누르면 닫힌다.
  // 스크림은 `.nx-modal-back` 이 아니다: 그 이름을 쓰면 모든 단축키 · Esc 가 겹판이 열린 줄로 알고 꺼진다.
  const [sheet, setSheet] = useState(false);
  useLayoutEffect(() => {
    const column = panel.current?.parentElement;
    if (!column) return;
    const read = () => setSheet(historyAsSheet(column.getBoundingClientRect().width));
    read();
    const observer = new ResizeObserver(read);
    observer.observe(column);
    return () => observer.disconnect();
  }, []);

  // Esc: 확인이 열려 있으면 확인을, 아니면 서랍을 닫는다 — 입력 중인 글자는 건드리지 않는다.
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // 한글 조합 중의 Esc 는 조합을 취소하는 키다 — 서랍까지 닫지 않는다.
      if (event.isComposing) return;
      // PreviewFrame 이 문서를 대상으로 Esc 를 다시 쏜다 — 문서에 closest 는
      // 없으니 Element 만 좁혀 받는다(2026-10-04 ux-plan PR 2).
      const target = event.target instanceof Element ? event.target : null;
      // 다시 쏜 키의 대상은 문서라 target 이 없다 — 입력 중이 아니다(예전엔 `undefined !== null` 이 참이라 게스트에 초점이
      // 있을 때의 Esc 가 서랍을 닫지 못했다).
      const typing =
        target !== null && target.closest("input, textarea, [contenteditable]") !== null;
      if (typing && !panel.current?.contains(target)) return;
      // 좁은 창의 사이드바 서랍이 이 칸을 가리고 있으면(main 이 inert) 그 서랍이 Esc 에 답한다.
      if (panel.current?.closest("[inert]")) return;
      if (overlayOpen()) return;
      if (confirmRef.current === null) onClose();
      else {
        setConfirm(null);
        setRestoreFailed(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // 확인이 열리면 카드가 보이는 데까지 목록을 굴린다 — 목록 아래쪽 줄에서 열면 카드가 바닥 줄 밑에 가려져 눌러도
  // 아무 일도 없는 것처럼 보였다. 동작을 줄인 창은 곧바로 굴린다.
  // 되돌리기가 실패하면 카드에 알림이 붙어 자란다 — 그때도 단추가 바닥 줄 밑에 잘리지 않게 다시 굴린다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 확인이 열린 순간과 실패가 카드를 키운 순간만 본다.
  useEffect(() => {
    if (confirm === null) return;
    const card = panel.current?.querySelector(".nx-hconfirm");
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    card?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [confirm, restoreFailed]);

  // 되돌리는 동안 눌린 확정 단추가 잠기며 초점이 허공(body)에 떨어졌다 — 안 잠기는 `그만두기` 로 모셔 두면 실패가 돌아와도
  // 키보드가 카드 안에 있다.
  useEffect(() => {
    if (restoring === null) return;
    panel.current
      ?.querySelector<HTMLElement>(".nx-hconfirm .nx-iconf-act .nx-btn:not(.nx-btn--pri)")
      ?.focus({ preventScroll: true });
  }, [restoring]);

  // 읽어 온 기록에서 확인이 가리키던 차례가 사라졌다(반영돼 기록이 지워진 때 …) — 보이지 않는 확인이 Esc 를 한 번 삼키지 않게.
  useEffect(() => {
    if (confirm !== null && entries !== null && !entries.some((entry) => entry.sha === confirm))
      setConfirm(null);
  }, [confirm, entries]);

  // 확인을 연 줄의 단추 — 확인이 접히면(그만두기 · Esc) 초점이 여기로 돌아온다.
  const returnTo = useRef<HTMLButtonElement | null>(null);
  const restore = useCallback(
    async (entry: RepoHistoryEntry) => {
      // 시작한 판 — 되돌리기는 오래 걸릴 수 있다(데몬이 AI 가 쉬길 기다린다). 끝났을 때 서랍을 닫았다 다시 열었거나 프로젝트를
      // 옮겼다면 그 결과가 지금 보는 서랍을 건드리면 안 된다.
      const started = session.current;
      const project = nowSlug.current;
      setRestoreFailed(false);
      setRestoring(entry.sha);
      try {
        const result = await api.restore(entry.sha);
        const here = session.current === started;
        if (result.stage === "failed") {
          // 카드가 사라진 판이면 알림은 토스트로 — 보이지 않는 곳에 실패를 남기지 않는다.
          if (here) setRestoreFailed(true);
          else toast(L.history.restoreFailed);
          return;
        }
        setConfirm(null);
        window.dispatchEvent(new CustomEvent(HISTORY_CHANGED_EVENT));
        toast(L.history.revertedToast(clockOf(entry.at)));
        // 미리보기를 다시 읽는 일은 되돌린 프로젝트가 아직 열려 있을 때만이다.
        if (nowSlug.current === project) onRestored();
        // 되돌린 화면은 서랍 뒤에서 다시 그려진다 — 서랍을 접어 곧바로 보게 한다(초점은 서랍을 연 단추로, 사용자가 이미
        // 다른 곳을 잡았으면 그대로). 되돌린 일은 기록에 남으니 다시 열면 맨 위에 `이전 모습으로 되돌렸어요` 가 내려앉는다.
        if (here) onClose();
        await api.repoStatus().catch(() => undefined);
        setTick((n) => n + 1);
      } catch (cause) {
        console.error("[colonova-design] restore", cause);
        if (session.current === started) setRestoreFailed(true);
        else toast(L.history.restoreFailed);
      } finally {
        setRestoring(null);
      }
    },
    [api, onClose, onRestored, toast],
  );

  const working =
    daemon.projects.find((project) => project.slug === daemon.activeSlug)?.working === true;
  // 줄을 잠그는 까닭 — AI 가 일하는 중이거나, 되돌리는 중인데 확인 카드를 이미 접은 때(카드가 보이면 카드가 말한다).
  const lockWhy = working
    ? L.history.working
    : restoring !== null && confirm === null
      ? L.history.restoring
      : null;
  const workingWhy = lockWhy !== null ? workingWhyId : undefined;
  const merged = repo?.handoff?.state === "merged";
  const list = entries ?? [];
  // 확인이 닫히면 `방금 한 것` 표지도 버린다 — 다른 줄을 고르면 그 줄의 제목으로 묻는다.
  useEffect(() => {
    if (confirm === null) setLastSha(null);
  }, [confirm]);
  // 결과 카드가 건넨 되돌아갈 곳을 읽어 온 기록에서 찾아 그 줄의 확인을 연다 — 줄을 찾아 누르는 걸음을 줄인다. 낡은 목록(지난번에
  // 읽어 둔 것)에 아직 없으면 새로 읽은 목록을 기다리고, 서랍이 열리지 않았거나 닫히면 건넨 곳을 버린다. AI 가 일하는 중이면 확인
  // 없이 서랍만 열린다(줄이 잠겨 있고 이유는 머리의 한 줄이 말한다).
  // biome-ignore lint/correctness/useExhaustiveDependencies: 건넨 곳 · 열림 · 읽은 기록이 바뀔 때만 본다.
  useEffect(() => {
    if (arm === null) return;
    if (!open) {
      onArmed?.();
      return;
    }
    if (entries === null) return;
    const at = entries.findIndex((entry) => entry.sha === arm.sha);
    if (at === -1) return;
    onArmed?.();
    if (working) return;
    setRestoreFailed(false);
    setConfirm(arm.sha);
    // 카드가 본 차례 수와 지금 읽은 기록이 맞을 때만 `방금 한 것` 이라 말한다 — 그사이 쌓인 것이 있으면 줄의 제목으로 묻는다.
    setLastSha(arm.count === at ? arm.sha : null);
  }, [arm, open, entries, working]);
  // 새로 쌓인 줄만 내려앉는다 — 처음 읽어 온 줄은 새것이 아니다(읽는 중 → 읽음으로 scope 가 바뀐다).
  const fresh = useFreshKeys(
    list.map((entry) => entry.sha),
    `${daemon.activeSlug}:${entries === null ? "loading" : "ready"}`,
  );
  const today = new Date(now);
  const nodeOf = (index: number): HistoryNode => {
    const entry = list[index];
    if (!entry) return "request";
    return (
      historyKindOf(entry.message, entry.kind, {
        restore: L.history.restorePrefix,
        comment: L.history.commentPrefix,
      }) ?? "request"
    );
  };
  // 날마다 묶고, 이어진 반영 차례는 한 줄로 접는다(순수 판정 — `lib/revert-summary.ts`).
  const days = historyDays(list, submits, nodeOf);
  const entryIndexes = days.flatMap((day) =>
    day.items.flatMap((item) => (item.kind === "entry" ? [item.index] : [])),
  );
  const firstIndex = entryIndexes[0] ?? -1;
  const lastIndex = entryIndexes.at(-1) ?? -1;
  // 확인이 열린 줄 — 그보다 새로운 줄은 되돌리면 사라진다(흐리게 그려 일의 크기를 타임라인에서 보인다).
  const confirmIndex = confirm === null ? -1 : list.findIndex((entry) => entry.sha === confirm);
  // 그 줄이 든 날과 날 안의 자리 — 되돌리면 사라질 구간(맨 위부터 그 줄까지)의 타임라인 선을 포인트색으로 잇는다.
  const targetDay =
    confirmIndex < 0
      ? -1
      : days.findIndex((day) =>
          day.items.some((item) => item.kind === "entry" && item.index === confirmIndex),
        );
  const targetAt =
    targetDay < 0
      ? -1
      : (days[targetDay]?.items.findIndex(
          (item) => item.kind === "entry" && item.index === confirmIndex,
        ) ?? -1);
  const loading = entries === null && !readFailed;

  // ↑ ↓ Home End — 줄에서 줄로. Tab 은 줄마다 한 번씩만 서고(줄 단추 · 비교 단추), 화살표가 건너뛴다.
  // 안의 줄 단추에서 올라온 키를 목록 칸 하나가 듣는다(줄마다 달지 않는다).
  useEffect(() => {
    const list = scroller.current;
    if (!list) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      const from = event.target instanceof HTMLElement ? event.target : null;
      if (!from?.matches("button.nx-hmain")) return;
      const rows = Array.from(list.querySelectorAll<HTMLElement>("button.nx-hmain"));
      const at = rows.indexOf(from);
      const to =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? rows.length - 1
            : at + (event.key === "ArrowDown" ? 1 : -1);
      const next = rows[to];
      if (!next) return;
      event.preventDefault();
      next.focus();
    };
    list.addEventListener("keydown", onKey);
    return () => list.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {/* 스크림은 포인터 전용의 닫기 손이다 — 키보드의 닫기는 Esc 와 ✕ 가 맡는다. 서랍이 닫혀도 마운트된 채
          불투명도로 걷힌다(닫을 때 곧바로 사라지면 서랍이 아직 나가는 동안 뒤 화면이 번쩍 밝아졌다). */}
      {sheet && (
        <div
          className={`nx-hist-scrim${open ? " nx-hist-scrim--on" : ""}`}
          aria-hidden="true"
          onMouseDown={(event) => {
            // 누름의 기본 동작(초점을 body 로 옮김)이 닫으며 돌려 보낸 초점을 다시 가져가지 않게.
            event.preventDefault();
            onClose();
          }}
        />
      )}
      <aside
        ref={panel}
        id={id}
        className={`nx-hist${open ? " nx-hist--open" : ""}`}
        data-sheet={sheet ? "true" : undefined}
        aria-labelledby={titleId}
        aria-hidden={!open}
        inert={!open}
      >
        <div className="nx-hist-h">
          <span className="nx-hist-tile" aria-hidden="true">
            <HistoryIcon />
          </span>
          <h3 id={titleId} ref={title} tabIndex={-1}>
            {L.history.title}
          </h3>
          <span className="nx-grow" />
          <button
            type="button"
            className="nx-ibtn"
            title={L.history.close}
            aria-label={L.history.close}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="nx-hist-sub">{L.history.sub}</div>
        {lockWhy !== null && (
          <p className="nx-hist-lock" id={workingWhyId} role="status">
            <span className="nx-hist-lockdot" aria-hidden="true" />
            {lockWhy}
          </p>
        )}
        <div className="nx-hist-list" ref={scroller} aria-busy={loading || undefined}>
          {loading && (
            <div className="nx-hist-skel" aria-hidden="true">
              {[0, 1, 2, 3].map((n) => (
                <div className="nx-hist-skelrow" key={n}>
                  <span />
                  <i />
                  <i />
                </div>
              ))}
            </div>
          )}
          <p className="nx-sr" role="status">
            {loading ? L.history.loading : ""}
          </p>
          {entries !== null && list.length === 0 && (
            <div className="nx-hist-empty">
              <span className="nx-hist-empty-ic" aria-hidden="true">
                <HistoryEmptyIcon />
              </span>
              <p>{merged ? L.history.emptyMerged : L.history.empty}</p>
            </div>
          )}
          {days.map((day, dayIndex) => {
            const label = dayOf(day.at, today);
            return (
              <section className="nx-hgroup" key={day.id}>
                {label !== "" && (
                  <h4 className={`nx-hday${targetDay >= dayIndex ? " nx-hday--undo" : ""}`}>
                    {label}
                  </h4>
                )}
                <ol className="nx-hol">
                  {day.items.map((row, at) => {
                    if (row.kind === "submit") {
                      // 되돌리는 줄보다 위(더 새로운) 구분선은 사라질 구간의 선에 든다.
                      const above =
                        targetDay >= 0 &&
                        (dayIndex < targetDay || (dayIndex === targetDay && at < targetAt));
                      return (
                        <li
                          className={`nx-hsubmit${above ? " nx-hsubmit--undo" : ""}`}
                          key={`submit-${row.at}`}
                        >
                          <SmallCheckIcon />
                          <span className="nx-hsubmit-t">
                            {L.history.submittedAt(clockOf(row.at))}
                          </span>
                          <span className="nx-hsubmit-rule" aria-hidden="true" />
                        </li>
                      );
                    }
                    const entry = list[row.index];
                    if (!entry) return null;
                    const originalTitle = entryTitle(entry.message);
                    const entryName =
                      row.node === "merge"
                        ? row.folded > 0
                          ? // 접힌 행이 대표하는 반영 차례의 총 횟수 — folded 는 함께 접인 나머지다.
                            L.history.eventMergeFold(row.folded + 1)
                          : L.history.eventMerge
                        : row.node === "restore"
                          ? L.history.eventRestore
                          : row.node === "comment"
                            ? L.history.eventComment
                            : originalTitle;
                    // 코멘트 반영의 제목은 같은 말뿐이라 줄을 가를 수 없다 — 머리말 뒤의 코멘트 요지를 둘째 줄로 싣는다.
                    const detail =
                      row.node === "comment" && originalTitle.startsWith(L.history.commentPrefix)
                        ? originalTitle.slice(L.history.commentPrefix.length).trim()
                        : "";
                    const current = row.index === 0;
                    const screens = entryScreens(entry, repo?.cycleScreens);
                    const comparableScreens =
                      repo?.cycleScreens?.filter((screen) => screen.sha === entry.sha) ?? [];
                    const confirming = confirm === entry.sha;
                    const clock = clockOf(entry.at);
                    const locked = restoring !== null || working;
                    const pick = () => {
                      if (current || locked) return;
                      setRestoreFailed(false);
                      setConfirm((was) => (was === entry.sha ? null : entry.sha));
                    };
                    const classes = ["nx-hitem"];
                    if (current) classes.push("nx-hitem--cur");
                    if (row.node !== "request") classes.push("nx-hitem--ev");
                    if (row.index === firstIndex) classes.push("nx-hitem--first");
                    if (row.index === lastIndex) classes.push("nx-hitem--last");
                    if (confirming) classes.push("nx-hitem--target");
                    if (confirmIndex >= 0 && row.index < confirmIndex)
                      classes.push("nx-hitem--undo");
                    if (fresh.has(entry.sha)) classes.push("nx-row--new");
                    const body = (
                      <>
                        <span className="nx-ht">{entryName}</span>
                        {detail !== "" && (
                          <span className="nx-hd2" title={detail}>
                            {detail}
                          </span>
                        )}
                        <span className="nx-hmeta">
                          {current && <span className="nx-hnow">{L.history.now}</span>}
                          <time className="nx-htime" dateTime={entry.at} title={clock}>
                            {whenOf(entry.at, now)}
                          </time>
                          {screens.length > 0 && (
                            <span className="nx-hs" title={screens.join(" · ")}>
                              {screens.join(" · ")}
                            </span>
                          )}
                          {!current && (
                            <span className="nx-hgo" aria-hidden="true">
                              <UndoIcon />
                              {L.history.toHere}
                            </span>
                          )}
                        </span>
                      </>
                    );
                    return (
                      <li className={classes.join(" ")} key={entry.sha}>
                        <NodeMark node={row.node} />
                        {current ? (
                          <div className="nx-hmain nx-hmain--cur">{body}</div>
                        ) : (
                          <button
                            type="button"
                            className="nx-hmain"
                            ref={(button) => {
                              // 확인이 접힐 때 React 가 ref 를 비우므로(null) 비우지 않는다 — 확인 카드가 접힌 뒤
                              // 초점을 돌려 보낼 때까지 이 단추를 붙들고 있어야 한다.
                              if (button && confirming) returnTo.current = button;
                            }}
                            aria-label={L.history.revertLabel(
                              clock,
                              entryName,
                              [detail, screens.join(" · ")].filter(Boolean).join(" · "),
                            )}
                            aria-expanded={confirming}
                            aria-disabled={locked || undefined}
                            aria-describedby={workingWhy}
                            onClick={pick}
                          >
                            {body}
                          </button>
                        )}
                        {comparableScreens.length > 0 && (
                          <div className="nx-hacts">
                            {comparableScreens.map((screen) => {
                              // 화면이 여럿이면 눈에 보이는 말이 곧 이름이다(`결제 내역 전·후 보기`) — 이름이 보이는 말을 품어야 한다.
                              const several = comparableScreens.length > 1;
                              const label = several
                                ? L.history.compareScreen(screen.title)
                                : L.compare.open;
                              return (
                                <button
                                  key={screen.route}
                                  type="button"
                                  className="nx-btn nx-btn--sm nx-btn--ghost nx-hcmp"
                                  title={several ? label : undefined}
                                  aria-label={several ? undefined : `${screen.title} · ${label}`}
                                  onClick={() =>
                                    openComparison({
                                      route: screen.route,
                                      title: screen.title,
                                      sha: entry.sha,
                                    })
                                  }
                                >
                                  <span className="nx-hcmp-ic">
                                    <CompareIcon />
                                  </span>
                                  <span className="nx-hcmp-t">{label}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {confirming && (
                          <RevertCard
                            entry={entry}
                            list={list}
                            index={row.index}
                            last={lastSha === entry.sha}
                            askEvent={row.node !== "request"}
                            title={originalTitle}
                            cycleScreens={repo?.cycleScreens}
                            restoring={restoring === entry.sha}
                            working={working}
                            failed={restoreFailed}
                            returnTo={returnTo}
                            onConfirm={() => void restore(entry)}
                            onCancel={() => {
                              setConfirm(null);
                              setRestoreFailed(false);
                            }}
                          />
                        )}
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
          {/* 2026-10-04 ux-review(2차): 목록 읽기 실패에는 다시 읽는 손을 옆에 둔다. */}
          {readFailed && (
            <div className="nx-hist-error" role="status">
              {L.history.readFailed}
              <button
                type="button"
                className="nx-btn nx-btn--sm"
                onClick={() => setTick((n) => n + 1)}
              >
                {L.vocab.retry}
              </button>
            </div>
          )}
          {/* 되돌리기 실패는 확인 카드 안에서 말한다 — 카드를 접은 뒤에 실패가 돌아왔을 때만 바닥에 남는다. */}
          {restoreFailed && confirm === null && (
            <div className="nx-hist-error" role="alert">
              {L.history.restoreFailed}
            </div>
          )}
        </div>
        <div className="nx-hist-foot">{L.history.foot}</div>
      </aside>
    </>
  );
}

/**
 * 되돌리기 확인 — 서랍 안에서 되돌릴 수 없는 순간이 아니라 되돌릴 수 있는 결정의 순간이다: 포인트 선과
 * 옅은 포인트 바탕으로 한 줄 위의 위계를 주고(`InlineConfirm` 의 중립 톤), 일의 크기를 칩으로 말한 뒤
 * 안심 한 줄로 닫는다. 확정 단추는 어느 시점인지 시각을 이름에 싣는다.
 */
function RevertCard({
  entry,
  list,
  index,
  last,
  askEvent,
  title,
  cycleScreens,
  restoring,
  working,
  failed,
  returnTo,
  onConfirm,
  onCancel,
}: {
  entry: RepoHistoryEntry;
  list: RepoHistoryEntry[];
  index: number;
  /** 결과 카드의 `방금 한 것 되돌리기` 로 열렸다 — 되돌아갈 곳의 제목 대신 되돌리는 일을 말한다. */
  last: boolean;
  /** 제목이 앱이 만든 사건(가져옴 · 되돌림 · 코멘트)이면 제목으로 묻지 않는다. */
  askEvent: boolean;
  title: string;
  cycleScreens: RepoStatus["cycleScreens"];
  restoring: boolean;
  working: boolean;
  failed: boolean;
  returnTo: RefObject<HTMLElement | null>;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const summary = revertSummary(list, index, L.history.commentPrefix);
  const names = affectedScreens(list, index, cycleScreens);
  return (
    <InlineConfirm
      className="nx-hconfirm"
      tone="neutral"
      title={
        last
          ? L.history.confirmAskLast
          : askEvent
            ? L.history.confirmAskEvent
            : L.history.confirmAsk(title)
      }
      confirmLabel={
        restoring ? (
          L.history.restoring
        ) : (
          <>
            <UndoIcon />
            {L.history.revertAt(clockOf(entry.at))}
          </>
        )
      }
      cancelLabel={L.history.cancel}
      busy={restoring}
      busyWhy={working ? L.history.working : undefined}
      onConfirm={onConfirm}
      onCancel={onCancel}
      returnRef={returnTo}
    >
      <ul className="nx-hchips">
        {names.length > 0 && <li className="nx-hchip">{L.history.chipScreens(names.length)}</li>}
        <li className="nx-hchip">{L.history.chipChanges(summary.count)}</li>
        {summary.withComments && (
          <li className="nx-hchip nx-hchip--warn">{L.history.chipComments}</li>
        )}
      </ul>
      <p className="nx-hconfirm-names">
        {names.length > 0 ? L.history.affected(names.join(" · ")) : L.history.affectedUnknown}
      </p>
      <p className="nx-hconfirm-safe">
        <ShieldCheck
          className="nx-i nx-hconfirm-ic"
          size={14}
          strokeWidth={1.9}
          aria-hidden="true"
        />
        {L.history.reassure}
      </p>
      {failed && (
        <p className="nx-snote nx-snote--red" role="alert">
          {L.history.restoreFailed}
        </p>
      )}
    </InlineConfirm>
  );
}
