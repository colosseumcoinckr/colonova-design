import type {
  DeveloperReview,
  LandedWork,
  PermissionSuggestion,
  ProjectSummary,
  ThreadSummary,
} from "@colonova-design/protocol";
import type { PendingPermission, PendingQuestion, SessionView } from "../../lib/daemon-client";
import { toolLabel } from "../../lib/labels";
import {
  type HiddenThreads,
  SYSTEM_THREAD_TITLES,
  visibleThreads,
} from "../../lib/thread-visibility";
import type { L } from "../labels";
import { previewDoc } from "./ask-preview";
import { type ResumeItem, resumeItems } from "./home-resume";
import { type ActiveNews, activeNewsOf, type LandedLine, landedLines } from "./landed";

type Pending = PendingPermission | PendingQuestion;

/** 「방금 있던 일」의 상한 — 최근 10개까지만 선다(2026-10-04 ux-review(2차)). */
const DONE_LIMIT = 10;
/** 이보다 오래된 끝난 줄은 「방금」이 아니다 — 이틀. */
const DONE_MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
/** 문장의 주인 — `L.home`. 칸을 통째로 건네므로 죽은 문장 시험이 지킨다. */
// 2026-10-04 ux-review: doneArrived 를 지우고 inbox.answered 를 쓴다 — 자격에 inbox 를 더한다.
export type HomeFeedWords = Pick<typeof L, "home" | "inbox">;

/** 질문형 결정 카드 — 즉답 칩은 단일 질문·단일 선택일 때만 있다. */
interface AskingQuestion {
  kind: "question";
  requestId: string;
  sessionId: string;
  title: string;
  /** 인용할 질문 원문 — 즉답 칩이 없는 다중 질문/다중 선택일 때는 null. */
  quote: string | null;
  /** 즉답 칩의 라벨들 — quote 가 null 이면 항상 빈 배열. */
  options: string[];
  questionCount: number;
  /** 요청이 만들어진 시각 (epoch ms) — 데몬이 찍는 시계, 없으면 카드가 숨긴다. */
  requestedAt?: number;
}

/** 권한형 결정 카드 — 인용할 문장이 없다; 헤드라인은 카드가 포맷한다. */
interface AskingPermission {
  kind: "permission";
  requestId: string;
  sessionId: string;
  title: string;
  toolName: string;
  input: unknown;
  suggestions: PermissionSuggestion[];
  /** AskingQuestion.requestedAt 와 같은 시계. */
  requestedAt?: number;
}

/** 코멘트 도착 카드 — 그 대화의 마지막 블록이 아직 답 없는 개발자 코멘트다. */
interface AskingReview {
  kind: "review";
  sessionId: string;
  title: string;
  reviews: DeveloperReview[];
}

export type AskingItem = AskingQuestion | AskingPermission | AskingReview;

/** "지금 진행 중" 카드 한 장. */
export interface RunningItem {
  sessionId: string;
  title: string;
  line: string;
  turnStartedAt: number | null;
}

/** "방금 있던 일" 카드 한 장 — `at`은 `ThreadSummary.updatedAt`에서 온 실제 시각. */
export interface DoneItem {
  sessionId: string;
  title: string;
  line: string;
  at: number;
}

/**
 * 크로스 프로젝트 인박스(PLAN P3-2)의 요약 행 한 장 — 비활성 프로젝트는 살아
 * 있는 세션이 없어 결정 카드의 인용·즉답을 못 그리므로, 대신 프로젝트 자체가
 * 폴러(`pollOpenHandoffs`)로부터 받은 세 숫자만 보인다: 이름 · 답을 기다리는
 * 스레드 수 · 마지막으로 감지된 개발자 쪽 사건. `lastEventKind`가 없으면 아직
 * 폴러가 아무 사건도 못 본 프로젝트 — 그 줄은 pendingCount 만으로 그린다.
 */
export interface OtherProjectItem {
  slug: string;
  name: string;
  pendingCount: number;
  lastEventKind?: "merged" | "closed" | "changes_requested" | "comments" | "replied";
  lastEventAt?: string;
}

/** 지금 보는 프로젝트의 개발자 소식 한 줄 — 다른 프로젝트의 소식과 한 목록에 선다(2026-10-08 · A2b). */
export interface ActiveNewsItem extends ActiveNews {
  slug: string;
  name: string;
}

export interface HomeFeed {
  asking: AskingItem[];
  running: RunningItem[];
  done: DoneItem[];
  /** 이어서 하기 — 다른 묶음에 서지 않은 가장 최근의 사람 대화(2026-10-06 홈 개선). */
  resume: ResumeItem[];
  /**
   * 반영된 일 — 지금 보는 프로젝트에서 병합된 요청, 최신순 최근 여덟(2026-10-08 · A2b). 비면 묶음이 서지 않는다.
   * 다른 프로젝트는 살아 있는 상태가 없어 기억을 모른다.
   */
  landed: LandedLine[];
  /**
   * 지금 보는 프로젝트의 개발자 소식(병합 · 반려 · 코멘트 · 다시 제출됨) — 같은 말을 홈의 다른 자리(`반영된 일` ·
   * 개발자 코멘트 카드)가 이미 하고 있거나 이틀이 지났으면 없다(`activeNewsOf`).
   */
  news: ActiveNewsItem | null;
  /** 활성 프로젝트를 뺀 나머지 — pending 도 마지막 사건도 없는 프로젝트는
      0건 숨김 규칙을 따라 걸러진다. */
  otherProjects: OtherProjectItem[];
}

/**
 * 지금 진행 중 카드의 한 줄 — 서브에이전트(Task 도구) 경유 작업이면 그 설명을
 * 그대로 쓰고, 아니면 마지막으로 돈 도구의 한국어 이름으로 낮춘다.
 * 아무 신호도 없으면(막 시작해 블록이 쌓이기 전) 빈 문장을 보이지 않는다.
 * 문장은 `L.home` 이 정한다(2026-10-02) — 이 파일은 next 의 것이다.
 */
function lastActionLine(view: SessionView, words: HomeFeedWords): string {
  const task = view.tasks.find((item) => item.description.trim().length > 0);
  if (task) return task.description.trim();
  for (let i = view.blocks.length - 1; i >= 0; i--) {
    const block = view.blocks[i];
    if (block?.type === "tool") return words.home.workingTool(toolLabel(block.name));
  }
  return words.home.working;
}

/**
 * `pending`·`sessions`·`projects`를 홈의 네 그룹으로 접는다. 순수 함수라
 * React 없이도 그룹핑 규칙(0건 숨김, 다중 질문/선택 판별, 활성 프로젝트
 * 스코프)을 검증할 수 있다.
 *
 * 결정 카드의 인용·즉답(`asking`)과 진행/완료 줄(`running`/`done`)은 활성
 * 프로젝트로 계속 좁힌다 — 비활성 프로젝트엔 살아 있는 세션이 없으므로
 * 폴러(`pollOpenHandoffs`)로부터 온 세 숫자(pendingCount·lastEventKind·
 * lastEventAt, PLAN P3-2)만으로 나머지 프로젝트를 한 줄씩 요약한다 — 그
 * 대화를 열려면 먼저 그 프로젝트로 전환해야 한다.
 */
export function buildHomeFeed(
  pending: Pending[],
  sessions: Record<string, SessionView>,
  projects: ProjectSummary[],
  activeSlug: string | null,
  words: HomeFeedWords,
  options: {
    /** 지워 낸 대화 — 데몬의 목록이 따라오기 전에도 홈에서 거둔다(사이드바와 같은 판정). */
    hidden?: HiddenThreads;
    /** 대화의 표시 이름 — 사용자가 바꾼 이름을 따른다(사이드바와 같은 이름). */
    titleOf?: (thread: ThreadSummary) => string;
    /** 활성 프로젝트의 반영된 일(`RepoStatus.landed`) — 없으면 묶음이 서지 않는다. */
    landed?: ReadonlyArray<LandedWork>;
    /** 소식의 나이를 재는 지금(ms) — 시험이 고정한다. */
    now?: number;
  } = {},
): HomeFeed {
  const activeProject = projects.find((project) => project.slug === activeSlug) ?? null;
  const threads = activeProject
    ? visibleThreads(activeProject.threads, options.hidden ?? {}, activeProject.slug)
    : [];
  const titleOf = options.titleOf ?? ((thread: ThreadSummary) => thread.title);
  const threadById = new Map(threads.map((thread) => [thread.id, thread]));
  const titleFor = (sessionId: string) => {
    const thread = threadById.get(sessionId);
    return thread ? titleOf(thread) : words.home.untitled;
  };

  // 질문형·권한형: 데몬이 준 순서는 도착 순이지 발생 순이 아니다 —
  // 타임스탬프가 없는 한 "최신이 맨 위"는 근사값일 뿐이니, 도착이 늦은
  // 쪽(배열의 뒤)을 먼저 보인다.
  const askingFromPending: AskingItem[] = [];
  for (const item of pending) {
    if (!threadById.has(item.sessionId)) continue;
    if (item.kind === "question") {
      const [first] = item.questions;
      const multi = item.questions.length > 1 || Boolean(first?.multiSelect);
      // 그림 시안이 달린 질문은 그림을 보고 골라야 한다(2026-10-08 베타 준비) — 홈의 즉답 칩은 라벨만 보여
      // 눈 감고 답하게 되므로, 그 질문은 인용 없이 열어서 답하게 한다(다중 질문과 같은 길).
      const visual =
        first?.options.some(
          (option) => option.preview !== undefined && previewDoc(option.preview) !== null,
        ) ?? false;
      const quick = !multi && !visual;
      askingFromPending.push({
        kind: "question",
        requestId: item.requestId,
        sessionId: item.sessionId,
        title: titleFor(item.sessionId),
        quote: quick ? (first?.question ?? null) : null,
        options: quick ? (first?.options.map((option) => option.label) ?? []) : [],
        questionCount: item.questions.length,
        requestedAt: item.requestedAt,
      });
    } else {
      askingFromPending.push({
        kind: "permission",
        requestId: item.requestId,
        sessionId: item.sessionId,
        title: titleFor(item.sessionId),
        toolName: item.toolName,
        input: item.input,
        suggestions: item.suggestions,
        requestedAt: item.requestedAt,
      });
    }
  }
  askingFromPending.reverse();

  // 코멘트 도착: 사이드바가 "답이 왔습니다"를 판정하는 것과 같은 규칙 —
  // 그 대화의 가장 마지막 블록이 아직 아무 턴도 뒤따르지 않은 사람 메시지일
  // 때만 "나를 기다리는 일"이다.
  const askingFromReviews: AskingItem[] = [];
  for (const [sessionId, view] of Object.entries(sessions)) {
    if (!threadById.has(sessionId)) continue;
    const last = view.blocks.at(-1);
    if (last?.type === "human") {
      askingFromReviews.push({
        kind: "review",
        sessionId,
        title: titleFor(sessionId),
        reviews: last.reviews,
      });
    }
  }

  const running: RunningItem[] = [];
  const done: DoneItem[] = [];
  for (const thread of threads) {
    const view = sessions[thread.id];
    if (view?.state === "running") {
      running.push({
        sessionId: thread.id,
        title: titleOf(thread),
        line: lastActionLine(view, words),
        turnStartedAt: view.turnStartedAt,
      });
    } else if (
      thread.state === "finished" &&
      // 도구가 스스로 연 대화(`리뷰 반영` …)가 조용히 끝난 것은 사용자가 확인할 답이 아니다 —
      // 못 끝낸 것만 남는다(다시 시도할 수 있다).
      (!SYSTEM_THREAD_TITLES[thread.title] || view?.state === "error")
    ) {
      // ThreadSummary.updatedAt 은 실제 타임스탬프다(pending 과 달리) — 근사가
      // 아니라 정확한 "얼마 전"을 보일 수 있다. 선로의 요약은 실패도 finished 로
      // 부르므로, 살아 있는 세션 뷰가 error 를 말하면 사이드바와 같은 말을 쓴다(U10).
      done.push({
        sessionId: thread.id,
        title: titleOf(thread),
        line: view?.state === "error" ? words.home.doneFailed : words.inbox.answered,
        at: Date.parse(thread.updatedAt) || 0,
      });
    }
  }
  running.sort((a, b) => (b.turnStartedAt ?? 0) - (a.turnStartedAt ?? 0));
  done.sort((a, b) => b.at - a.at);
  // 2026-10-04 ux-review(2차): 「방금 있던 일」은 최근 것만 머문다 — 최대 10개(기존
  // 상수 스타일: 파일 머리의 상수), 그리고 이틀이 지난 줄은 거둔다. 몇 주 전 문장이
  // 진짜 방금 있던 일을 밀어 내지 않게.
  const recentDone = done
    .slice(0, DONE_LIMIT)
    .filter((item) => Date.now() - item.at < DONE_MAX_AGE_MS);

  // 크로스 프로젝트 인박스(PLAN P3-2): 활성 프로젝트를 뺀 나머지
  // 중 pending 도 마지막 사건도 없는 프로젝트는 그룹별 0건 숨김 규칙을
  // 따라 걸러진다. pending 이 있는 쪽을 먼저, 그 다음 최근 사건순.
  const otherProjects: OtherProjectItem[] = projects
    .filter((project) => project.slug !== activeSlug)
    .filter((project) => project.pendingCount > 0 || project.lastEventKind !== undefined)
    .map((project) => ({
      slug: project.slug,
      name: project.name,
      pendingCount: project.pendingCount,
      ...(project.lastEventKind
        ? { lastEventKind: project.lastEventKind, lastEventAt: project.lastEventAt }
        : {}),
    }))
    .sort((a, b) => {
      if (a.pendingCount !== b.pendingCount) return b.pendingCount - a.pendingCount;
      return (Date.parse(b.lastEventAt ?? "") || 0) - (Date.parse(a.lastEventAt ?? "") || 0);
    });

  const asking = [...askingFromPending, ...askingFromReviews];
  // 반영된 일과 활성 프로젝트의 소식(2026-10-08 · A2b) — `otherProjects` 의 활성 제외는 결정 카드 · 진행 줄(살아 있는 세션이
  // 있다)의 까닭이었고, 소식 줄만 활성에도 연다. 같은 말을 다른 자리가 하고 있으면 세우지 않는다(`activeNewsOf`).
  const landed = landedLines(options.landed);
  const newsKind = activeProject
    ? activeNewsOf({
        kind: activeProject.lastEventKind,
        at: activeProject.lastEventAt,
        landed: landed.length,
        reviewCard: askingFromReviews.length > 0,
        now: options.now ?? Date.now(),
      })
    : null;
  const news =
    activeProject && newsKind
      ? { ...newsKind, slug: activeProject.slug, name: activeProject.name }
      : null;
  // 이어서 하기 — 이미 다른 묶음에 선 대화는 뺀다. 이틀이 지나 「방금」에서 거둔 끝난 대화는 여기로 온다.
  const taken = new Set([
    ...asking.map((item) => item.sessionId),
    ...running.map((item) => item.sessionId),
    ...recentDone.map((item) => item.sessionId),
  ]);
  const resume = resumeItems(threads, taken, SYSTEM_THREAD_TITLES, titleOf);

  return {
    asking,
    running,
    done: recentDone,
    resume,
    landed,
    news,
    otherProjects,
  };
}
