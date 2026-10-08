import type { ProjectSummary, ThreadSummary } from "@colonova-design/protocol";
import { type ReactNode, useMemo, useState } from "react";
import { toolHeadline } from "../../components/transcript/shared";
import type { Daemon } from "../../lib/daemon-client";
import { timeAgo } from "../../lib/format";
import { bashHeadline, toolLabel } from "../../lib/labels";
import { L } from "../labels";
import { connectionLock } from "../lib/connection-copy";
import { type AskingItem, buildHomeFeed } from "../lib/home-feed";
import { landedFacts } from "../lib/landed";
import { isPreparing } from "../lib/project-note";
import { agentUpdateEvents } from "../lib/update-row";
import { useFreshKeys } from "../lib/use-fresh-keys";
import { useToday } from "../lib/use-today";
import { waitingRows } from "../lib/waiting";
import { Elapsed } from "../status/Elapsed";
import { Count } from "../ui/Count";
import {
  CalmIcon,
  ChatLineIcon,
  CheckIcon,
  ChevronRightIcon,
  InfoIcon,
  SparkIcon,
  Spin,
} from "../ui/icons";
import { ProjectMark } from "../ui/ProjectMark";

type Commands = NonNullable<NonNullable<Daemon["repo"]>["commands"]>;

/**
 * 홈 접힘의 기억 — 홈은 Workspace 의 조건부 렌더라 details 가 오갈 때마다 새로
 * 생긴다. 모듈 자리가 그 기억이라 돌아와도 접힌 모습이 남는다(스크롤 자리는
 * 이번 범위 밖 — 2026-10-04 ux-review).
 */
const foldMemo = { running: true, resume: true, recent: true, landed: true };

/**
 * 권한 카드의 한 줄 — 레포가 정한 명령이면 그 이름(`레포 검사`), 아니면 도구의
 * 한국어 이름. 날 명령줄은 홈에 세우지 않는다(대화의 `자세히 보기` 몫).
 */
function permissionWhat(item: Extract<AskingItem, { kind: "permission" }>, commands?: Commands) {
  if (item.toolName === "Bash") {
    const raw = toolHeadline(item.input).trim();
    const named = bashHeadline(raw, commands);
    if (named !== raw) return named;
  }
  return toolLabel(item.toolName);
}

/** 준비 단계의 이름 — 목업의 `내려받기 · 설치하기 · 미리보기 켜기`. */
function prepareStep(project: ProjectSummary): string {
  const [download, install, preview] = L.inbox.stepNames;
  if (project.phase === "installing") return install;
  if (project.phase === "starting") return preview;
  return download;
}

/** 다른 프로젝트의 마지막 사건 한 줄 — 폴러가 본 것(PLAN P3-2). */
function eventLine(kind: NonNullable<ProjectSummary["lastEventKind"]>): string {
  switch (kind) {
    case "merged":
      return L.inbox.eventMerged;
    case "closed":
      return L.inbox.eventClosed;
    case "replied":
      return L.inbox.eventReplied;
    case "comments":
    case "changes_requested":
      return L.inbox.eventComments;
  }
}

/**
 * 받은 편지함의 한 줄(2026-10-06 홈 개선) — 앞 그림 · 제목(+ 아래 한 줄) · 오른쪽 말. 손이 닿으면 줄이 밝아진다.
 * 앞 그림은 줄의 종류를 말한다(도는 표시 · AI 의 답 · 대화 · 프로젝트 표식) — 같은 프로젝트의 줄마다
 * 프로젝트 표식이 되풀이되던 것을, 표식은 프로젝트가 갈리는 줄에만 남긴다. 누를 수 없는 줄(업데이트 소식)은
 * `onClick` 이 없어 div 로 서고 밝아지지도 않는다.
 */
function Row({
  className,
  lead,
  tone,
  title,
  sub,
  meta,
  onClick,
}: {
  className: string;
  lead: ReactNode;
  /** 앞 그림의 색 — 없으면 연한 잉크. */
  tone?: "accent" | "green";
  title: ReactNode;
  /** 제목 아래의 한 줄 — 줄이 왜 여기 있는지(`답이 왔어요` · 하는 일). */
  sub?: ReactNode;
  /** 오른쪽 끝 — 시각이나 지금 하는 일의 시계. */
  meta?: ReactNode;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className={`nx-ilead${tone ? ` nx-tone--${tone}` : ""}`}>{lead}</span>
      <span className="nx-itext">
        <span className="nx-it">{title}</span>
        {sub ? <span className="nx-isub">{sub}</span> : null}
      </span>
      {meta ? <span className="nx-ir">{meta}</span> : null}
    </>
  );
  return onClick ? (
    <button type="button" className={className} onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * 받은 편지함(U6) — `buildHomeFeed` 를 그대로 쓴다. 맨 위 `답을 기다려요`(확인
 * 카드 — 홈에서 바로 답한다), 한 단 아래 `지금 진행 중`(도는 대화 + 준비 중인
 * 프로젝트) · `이어서 하기`(가장 최근의 대화) · `방금 있던 일`. 활성 프로젝트의 대화만 살아
 * 있는 세션을 가지므로 카드로 답할 수 있는 것도 활성 프로젝트의 것이다; 다른 프로젝트의
 * 기다림은 한 줄로 서고 누르면 그 프로젝트로 옮긴다.
 *
 * 비어 있는 묶음은 서지 않는다(2026-10-06) — `지금 진행 중 0` · `도는 작업이 없어요` 를 홈이 늘 말하던
 * 것을, 있는 것만 서고 모두 비면 차분한 한 줄만 남긴다.
 *
 * 개발자 확인을 기다리는 요청(2026-10-07 UX 점검 3단계)은 `지금 진행 중` 에 한 줄로 선다 — `개발자 확인을 기다려요`
 * 와 며칠째. 사용자의 손이 필요한 일이 아니라서 `답을 기다려요` 의 수에도, 사이드바의 배지에도 세지 않고 눌러서 그
 * 프로젝트로 갈 뿐이다. 도는 표식이 없는 줄이라 AI 가 일하는 줄과 눈으로 갈린다.
 */
export function HomeInbox({
  daemon,
  titleFor,
  onOpenThread,
  onSwitch,
  onOpenWork,
  onShowScreen,
}: {
  daemon: Daemon;
  /** 대화의 표시 이름 — 사용자가 바꾼 이름을 따른다(사이드바와 같은 이름). */
  titleFor?: (thread: ThreadSummary) => string;
  onOpenThread: (slug: string, threadId: string) => void;
  onSwitch: (slug: string) => void;
  /** 이미 열려 있는 프로젝트의 작업 보기로 간다 — `onSwitch` 는 같은 프로젝트면 아무 데도 가지 않는다. */
  onOpenWork: () => void;
  /**
   * 이미 열려 있는 프로젝트의 서비스 화면(미리보기 · 준비 진행)으로 간다 — `처음 켜는 준비` 줄이 부른다(2026-10-07 베타
   * 준비 분석 · 첫 5분). 첫 프로젝트는 늘 활성이라 `onSwitch` 만으로는 이 줄을 눌러도 아무 일도 없었다.
   */
  onShowScreen: () => void;
}) {
  const landed = daemon.repo?.landed;
  const feed = useMemo(
    () =>
      buildHomeFeed(daemon.pending, daemon.sessions, daemon.projects, daemon.activeSlug, L, {
        hidden: daemon.hiddenThreads,
        titleOf: titleFor,
        landed,
      }),
    [
      daemon.pending,
      daemon.sessions,
      daemon.projects,
      daemon.activeSlug,
      daemon.hiddenThreads,
      titleFor,
      landed,
    ],
  );
  const active = daemon.projects.find((project) => project.slug === daemon.activeSlug) ?? null;
  const others = daemon.projects.filter((project) => project.slug !== daemon.activeSlug);
  const otherWaiting = others.filter((project) => project.pendingCount > 0);
  const preparing = daemon.projects.filter(isPreparing);
  const otherWorking = others.filter((project) => project.working && !isPreparing(project));
  // 개발자 소식 — 다른 프로젝트의 마지막 사건과, 지금 보는 프로젝트의 소식(같은 말을 다른 자리가 하고 있지 않을 때만, 2026-10-08).
  // 한 목록에서 최근 것이 위다. 활성 프로젝트의 줄은 이미 열린 프로젝트라 눌러도 옮기지 않고 작업 보기로 간다.
  const eventRows = [
    ...(feed.news
      ? [{ slug: feed.news.slug, name: feed.news.name, kind: feed.news.kind, at: feed.news.at }]
      : []),
    ...others.flatMap((project) =>
      project.lastEventKind !== undefined
        ? [
            {
              slug: project.slug,
              name: project.name,
              kind: project.lastEventKind,
              at: project.lastEventAt ?? "",
            },
          ]
        : [],
    ),
  ].sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0));
  const waitCount = feed.asking.length + otherWaiting.length;
  // 자정이 지나면 갈아 끼워 며칠째가 저절로 는다.
  const today = useToday();
  // 개발자가 확인했거나 자동 검사가 통과하지 못한 요청은 그 말이 부제로 선다(2026-10-08 · A2b) — 신호는 활성 프로젝트의 상태에만 있다.
  const activeHandoff = daemon.repo?.handoff ?? null;
  const activeAttention = daemon.repo?.attention;
  const waitingDev = useMemo(
    () =>
      waitingRows(daemon.projects, today, {
        active:
          daemon.activeSlug && activeHandoff
            ? { slug: daemon.activeSlug, handoff: activeHandoff, attention: activeAttention }
            : null,
        words: L,
      }),
    [daemon.projects, today, daemon.activeSlug, activeHandoff, activeAttention],
  );
  const runCount = feed.running.length + preparing.length + otherWorking.length + waitingDev.length;
  // 도구가 스스로 한 일(J6) — AI 프로그램 업데이트는 할 일이 아니라 한 줄 소식이다.
  const updateEvents = agentUpdateEvents(
    daemon.status?.agentUpdates,
    daemon.status?.providers,
    L.update.doneEvent,
  );
  const recentCount = feed.done.length + eventRows.length + updateEvents.length;
  const lock = connectionLock(daemon.connection, L);

  // 새로 들어온 줄만 내려앉는다 — 카드는 자리를 열며, 단추 줄은 내려앉기만. 열쇠에 목록
  // 이름을 붙여, 도는 대화가 끝나 `방금 있던 일` 로 옮겨 가는 것도 새 줄로 맞는다.
  const rowKeys = [
    ...feed.asking.map((item) =>
      item.kind === "review" ? `review-${item.sessionId}` : item.requestId,
    ),
    ...otherWaiting.map((project) => `wait-${project.slug}`),
    ...feed.running.map((item) => `run-${item.sessionId}`),
    ...preparing.map((project) => `prep-${project.slug}`),
    ...otherWorking.map((project) => `work-${project.slug}`),
    ...waitingDev.map((row) => `dev-${row.slug}`),
    ...feed.resume.map((item) => `resume-${item.sessionId}`),
    ...feed.done.map((item) => `done-${item.sessionId}`),
    ...eventRows.map((row) => `event-${row.slug}`),
    ...updateEvents.map((event) => `update-${event.id}`),
    ...feed.landed.map((item) => `landed-${item.pr}`),
  ];
  const fresh = useFreshKeys(rowKeys, daemon.activeSlug ?? "");
  const rowClass = (key: string) => (fresh.has(key) ? "nx-irow nx-row--new" : "nx-irow");

  // 답이 도착할 때까지 카드는 남는다 — 응답이 길에서 죽었는데 카드부터 거두면
  // 답하지 않은 확인이 사라진다(옛 홈과 같은 규칙). 누른 뒤에는 같은 카드를 두
  // 번 누르지 않게 잠근다.
  const [answering, setAnswering] = useState<ReadonlySet<string>>(() => new Set());
  /** 누른 버튼 — 카드마다 어느 답을 보내는 중인가(고른 모양과 도는 표시의 주인). */
  const [pressed, setPressed] = useState<ReadonlyMap<string, string>>(() => new Map());
  /** 보내기에 성공한 카드 — 접히는 동안을 두고 거둔다. */
  const [folding, setFolding] = useState<ReadonlySet<string>>(() => new Set());
  /** 전하지 못한 카드 — 접지 않고 한 줄을 세워 다시 눌리게 한다. */
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const respond = (requestId: string, mark: string, call: () => Promise<unknown>) => {
    setAnswering((prev) => new Set(prev).add(requestId));
    setPressed((prev) => new Map(prev).set(requestId, mark));
    setFailed((prev) => {
      const next = new Set(prev);
      next.delete(requestId);
      return next;
    });
    void call()
      .then(() => {
        setFolding((prev) => new Set(prev).add(requestId));
        // 접히는 동안만 카드를 남겨 둔다 — 갑자기 사라져 나머지가 튀지 않게.
        window.setTimeout(() => daemon.resolvePending(requestId), 220);
      })
      .catch(() => setFailed((prev) => new Set(prev).add(requestId)))
      .finally(() => {
        setAnswering((prev) => {
          const next = new Set(prev);
          next.delete(requestId);
          return next;
        });
        setPressed((prev) => {
          const next = new Map(prev);
          next.delete(requestId);
          return next;
        });
      });
  };

  const openHere = (sessionId: string) => active && onOpenThread(active.slug, sessionId);

  return (
    <div className="nx-inbox">
      {waitCount > 0 ? (
        <h3 className="nx-ih">
          {L.home.waiting} <Count n={waitCount} />
        </h3>
      ) : (
        <div className={`nx-calm ${lock ? "nx-calm--lock" : "nx-calm--ok"}`}>
          {/* 연결이 열리기 전에는 「비었음」을 알 수 없다 — 낡은 「기다리는 일이 없어요」를 말하지 않는다. */}
          <span className="nx-calm-i">{lock ? <InfoIcon /> : <CalmIcon />}</span>
          {lock ?? L.home.calm}
        </div>
      )}
      {active &&
        feed.asking.map((item) => {
          const key = item.kind === "review" ? `review-${item.sessionId}` : item.requestId;
          const busy =
            (item.kind !== "review" && answering.has(item.requestId)) || folding.has(key);
          const mark = pressed.get(key);
          return (
            <div
              key={key}
              className={`nx-dfold${folding.has(key) ? " nx-dfold--gone" : ""}${fresh.has(key) ? " nx-item--new" : ""}`}
            >
              <div className="nx-dcard">
                <div className="nx-dmeta">
                  <ProjectMark slug={active.slug} name={active.name} size="sm" />
                  <span className="nx-dwhere">
                    {active.name} · {item.title}
                  </span>
                  {item.kind !== "review" && item.requestedAt !== undefined && (
                    <span className="nx-time">{timeAgo(item.requestedAt)}</span>
                  )}
                </div>
                <div className="nx-dq">
                  <SparkIcon />
                  <span>
                    {item.kind === "question"
                      ? (item.quote ?? L.inbox.askMany)
                      : item.kind === "permission"
                        ? L.inbox.askPermission(permissionWhat(item, daemon.repo?.commands))
                        : L.inbox.reviewArrived}
                  </span>
                </div>
                <div className="nx-dopts">
                  {item.kind === "question" &&
                    item.quote !== null &&
                    item.options.map((label) => (
                      <button
                        key={label}
                        type="button"
                        className={`nx-btn${mark === label ? " nx-btn--picked" : ""}`}
                        disabled={busy}
                        onClick={() => {
                          const quote = item.quote;
                          if (quote === null) return;
                          respond(item.requestId, label, () =>
                            daemon.api.respondQuestion(item.requestId, { [quote]: label }, {}),
                          );
                        }}
                      >
                        {label}
                        {mark === label && <Spin />}
                      </button>
                    ))}
                  {item.kind === "permission" && (
                    <>
                      <button
                        type="button"
                        className={`nx-btn nx-btn--pri${mark === "allow" ? " nx-btn--picked" : ""}`}
                        disabled={busy}
                        onClick={() =>
                          respond(item.requestId, "allow", () =>
                            daemon.api.respondPermission(item.requestId, "allow"),
                          )
                        }
                      >
                        {L.inbox.allow}
                        {mark === "allow" && <Spin />}
                      </button>
                      <button
                        type="button"
                        className={`nx-btn${mark === "deny" ? " nx-btn--picked" : ""}`}
                        disabled={busy}
                        onClick={() =>
                          respond(item.requestId, "deny", () =>
                            daemon.api.respondPermission(item.requestId, "deny"),
                          )
                        }
                      >
                        {L.inbox.deny}
                        {mark === "deny" && <Spin />}
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="nx-btn nx-btn--ghost"
                    onClick={() => openHere(item.sessionId)}
                  >
                    {L.inbox.openConv}
                  </button>
                </div>
                {failed.has(key) && (
                  <div className="nx-dfail nx-tone--red" role="status">
                    {L.chat.somethingWrong}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      {otherWaiting.map((project) => (
        <Row
          key={project.slug}
          className={rowClass(`wait-${project.slug}`)}
          lead={<ProjectMark slug={project.slug} name={project.name} size="sm" />}
          title={project.name}
          meta={
            <span className="nx-tone--amber">
              {L.sidebar.waitingAnswerCount(project.pendingCount)}
            </span>
          }
          onClick={() => onSwitch(project.slug)}
        />
      ))}

      {runCount > 0 && (
        <details
          className="nx-fold"
          open={foldMemo.running}
          onToggle={(event) => {
            foldMemo.running = event.currentTarget.open;
          }}
        >
          <summary>
            <ChevronRightIcon />
            {L.home.running} <Count n={runCount} className="nx-cnt--g" />
          </summary>
          {active &&
            feed.running.map((item) => (
              <Row
                key={item.sessionId}
                className={rowClass(`run-${item.sessionId}`)}
                lead={<Spin />}
                title={item.title}
                sub={item.line}
                meta={item.turnStartedAt !== null && <Elapsed startedAt={item.turnStartedAt} />}
                onClick={() => openHere(item.sessionId)}
              />
            ))}
          {preparing.map((project) => (
            <Row
              key={`prep-${project.slug}`}
              className={rowClass(`prep-${project.slug}`)}
              lead={<ProjectMark slug={project.slug} name={project.name} size="sm" />}
              title={project.name}
              sub={L.inbox.firstPrepare}
              meta={
                <>
                  <Spin />
                  {prepareStep(project)}
                </>
              }
              onClick={() =>
                project.slug === active?.slug ? onShowScreen() : onSwitch(project.slug)
              }
            />
          ))}
          {otherWorking.map((project) => (
            <Row
              key={`work-${project.slug}`}
              className={rowClass(`work-${project.slug}`)}
              lead={<ProjectMark slug={project.slug} name={project.name} size="sm" />}
              title={project.name}
              meta={
                <>
                  <Spin />
                  {L.journey.making}
                </>
              }
              onClick={() => onSwitch(project.slug)}
            />
          ))}
          {waitingDev.map((row) => (
            <Row
              key={`dev-${row.slug}`}
              className={rowClass(`dev-${row.slug}`)}
              lead={<ProjectMark slug={row.slug} name={row.name} size="sm" />}
              title={row.name}
              sub={row.note ?? L.cycle.review}
              meta={row.days !== null && L.home.waitingFor(row.days)}
              onClick={() => (row.slug === active?.slug ? onOpenWork() : onSwitch(row.slug))}
            />
          ))}
        </details>
      )}

      {feed.resume.length > 0 && (
        <details
          className="nx-fold"
          open={foldMemo.resume}
          onToggle={(event) => {
            foldMemo.resume = event.currentTarget.open;
          }}
        >
          <summary>
            <ChevronRightIcon />
            {L.home.resume}
          </summary>
          {feed.resume.map((item) => (
            <Row
              key={item.sessionId}
              className={rowClass(`resume-${item.sessionId}`)}
              lead={<ChatLineIcon />}
              title={item.title}
              meta={timeAgo(item.at)}
              onClick={() => openHere(item.sessionId)}
            />
          ))}
        </details>
      )}

      {recentCount > 0 && (
        <details
          className="nx-fold"
          open={foldMemo.recent}
          onToggle={(event) => {
            foldMemo.recent = event.currentTarget.open;
          }}
        >
          <summary>
            <ChevronRightIcon />
            {L.home.recent} <Count n={recentCount} className="nx-cnt--g" />
          </summary>
          {active &&
            feed.done.map((item) => (
              <Row
                key={item.sessionId}
                className={rowClass(`done-${item.sessionId}`)}
                lead={<SparkIcon />}
                tone="accent"
                title={item.title}
                sub={item.line}
                meta={timeAgo(item.at)}
                onClick={() => openHere(item.sessionId)}
              />
            ))}
          {eventRows.map((row) => (
            <Row
              key={`event-${row.slug}`}
              className={rowClass(`event-${row.slug}`)}
              lead={<ProjectMark slug={row.slug} name={row.name} size="sm" />}
              title={row.name}
              sub={eventLine(row.kind)}
              meta={row.at ? timeAgo(Date.parse(row.at)) : ""}
              onClick={() => (row.slug === active?.slug ? onOpenWork() : onSwitch(row.slug))}
            />
          ))}
          {updateEvents.map((event) => (
            <Row
              key={`update-${event.id}`}
              className={rowClass(`update-${event.id}`)}
              lead={<CheckIcon />}
              tone="green"
              title={event.text}
              meta={event.at ? timeAgo(event.at) : ""}
            />
          ))}
        </details>
      )}

      {/* 반영된 일(2026-10-08 · A2b) — 병합돼 서비스가 된 요청들. 새 작업이 시작돼도 지워지지 않는 성취의 기록이다. 없으면 묶음도 없다. */}
      {feed.landed.length > 0 && (
        <details
          className="nx-fold"
          open={foldMemo.landed}
          onToggle={(event) => {
            foldMemo.landed = event.currentTarget.open;
          }}
        >
          <summary>
            <ChevronRightIcon />
            {L.landed.fold} <Count n={feed.landed.length} className="nx-cnt--g" />
          </summary>
          {feed.landed.map((item) => (
            <Row
              key={`landed-${item.pr}`}
              className={rowClass(`landed-${item.pr}`)}
              lead={<CheckIcon />}
              tone="green"
              title={item.title ?? L.landed.untitled}
              sub={landedFacts(item.days, item.screens, {
                took: L.landed.took,
                screens: L.landed.screens,
              })}
              meta={timeAgo(item.at)}
            />
          ))}
        </details>
      )}
    </div>
  );
}
