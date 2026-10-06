import { useEffect, useRef, useState } from "react";
import { L } from "../labels";
import { elapsedParts, prepProgress, prepStep } from "../lib/preview-geometry";
import { Spin } from "../ui/icons";
import { SmallCheckIcon } from "./icons";

/** 흐른 시간 한 마디 — `12초` · `1분 5초`. */
export function elapsedText(ms: number): string {
  const { minutes, seconds } = elapsedParts(ms);
  return minutes > 0 ? L.preview.elapsedMin(minutes, seconds) : L.preview.elapsedSec(seconds);
}

/** 1초마다 다시 그리는 시계 — 데몬이 적은 `phaseSince` 부터 센다. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [on]);
  return now;
}

/**
 * 준비 화면(PLAN-UI U8) — 처음 켜는 서비스의 세 걸음 `내려받기 · 설치하기 ·
 * 미리보기 켜기`, 지금 걸음의 흐른 시간(`RepoStatus.phaseSince`), 진행 막대,
 * `준비되는 동안 먼저 말해 두셔도 돼요`. 이미 한 번 켠 서비스를 다시 켜는
 * 동안(앱을 다시 켰다)은 제목만 조용해진다.
 *
 * `finale` — 준비가 끝난 뒤 덮개가 걷히기 전의 마무리 장: 세 걸음의 체크가
 * 모두 켜지고 막대가 초록으로 100% 에 차오른다. 칸이 붙드는 600ms 동안만.
 *
 * 2026-10-06 겹판 손질 — 걸음이 바뀌어도 아이콘만 바뀌어 낭독이 진행을 못 읽었다. 걸음이 바뀔 때만 갱신되는
 * 낭독 전용 한 줄(`n단계 중 i단계 · 이름`)이 진행을 말하고, 막대에도 이름이 붙는다. 흐르는 초는 낭독에서 뺀다
 * (초마다 읽히지 않게). 걸음마다 한 줄 설명이 서서 기다림의 크기를 미리 말한다.
 */
export function PrepareCard({
  phase,
  phaseSince,
  first,
  finale = false,
}: {
  phase: string;
  phaseSince?: string;
  first: boolean;
  finale?: boolean;
}) {
  const now = useNow(true);
  // 데몬이 걸음의 시작을 싣지 않으면 이 카드가 본 순간부터 센다.
  const [seenAt, setSeenAt] = useState(() => ({ phase, at: Date.now() }));
  if (seenAt.phase !== phase) setSeenAt({ phase, at: Date.now() });
  const since = phaseSince ? Date.parse(phaseSince) : Number.NaN;
  const startedAt = Number.isFinite(since) ? since : seenAt.at;
  const elapsed = Math.max(0, now - startedAt);
  const step = finale ? 3 : (prepStep(phase) ?? 0);
  const progress = finale ? 100 : prepProgress(phase, elapsed);
  const names = [L.prepare.stepDownload, L.prepare.stepInstall, L.prepare.stepPreview];
  const notes = [L.prepare.noteDownload, L.prepare.noteInstall, L.prepare.notePreview];
  // 걸음이 바뀔 때만 바뀌는 말 — 낭독 전용 줄과 막대의 값 글자가 같이 읽는다.
  const where = finale
    ? L.prepare.done
    : L.prepare.stepOf(names.length, Math.min(step, names.length - 1) + 1, names[step] ?? "");
  return (
    <div className="nx-prep-card">
      <div className="nx-prep-top">
        {finale ? (
          <span className="nx-sic nx-sic--ok nx-sic--finale" aria-hidden="true">
            <SmallCheckIcon />
          </span>
        ) : (
          <i className="nx-spin nx-spin--lg" aria-hidden="true" />
        )}
        <h3>{first ? L.prepare.title : L.preview.prepAgainTitle}</h3>
        <p>{first ? L.prepare.body : L.preview.prepAgainBody}</p>
      </div>
      <ul className="nx-prep-steps">
        {names.map((name, index) => {
          const state = index < step ? "ok" : index === step ? "run" : "wait";
          return (
            <li key={name} className={`nx-prep-step nx-prep-step--${state}`}>
              {state === "ok" ? (
                <span className="nx-sic nx-sic--ok">
                  <SmallCheckIcon />
                </span>
              ) : state === "run" ? (
                <span className="nx-sic nx-sic--run">
                  <i className="nx-spin" aria-hidden="true" />
                </span>
              ) : (
                <span className="nx-sic nx-sic--wait" />
              )}
              <span className="nx-prep-step-t">
                {name}
                <small className="nx-prep-note">{notes[index]}</small>
              </span>
              {state === "run" && (
                <em aria-hidden="true">
                  {index === 1
                    ? L.preview.stepEta(L.prepare.aboutTwoMinutes, elapsedText(elapsed))
                    : elapsedText(elapsed)}
                </em>
              )}
            </li>
          );
        })}
      </ul>
      <div
        className={`nx-prep-bar${finale ? " nx-prep-bar--done" : ""}`}
        role="progressbar"
        aria-label={L.prepare.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        aria-valuetext={where}
      >
        <i style={{ width: `${progress}%` }} />
      </div>
      <p className="nx-sr" role="status">
        {where}
      </p>
      <p className="nx-prep-hint">{L.prepare.hint}</p>
    </div>
  );
}

/** 다시 시도를 누른 뒤 바쁨을 보이는 길이 — 이 안에 부르는 쪽이 무엇이든 바꾸면(덮개가 바뀐다) 거기서 풀린다. */
const RETRY_BUSY_MS = 8_000;

/**
 * 무대의 한 줄 상태 — 다시 켜는 중(C5) · AI가 막힌 곳을 고치는 중 · 기동 실패.
 * 고침에는 흐른 시간과 2분 뒤의 안내 줄이 붙는다. 실패는 진행 표시를 가짜로
 * 돌리지 않는다 — 문장과 `다시 시도` 손 하나(2026-10-04 ux-review).
 *
 * 2026-10-06 겹판 손질 — 실패는 `role="alert"` 로 읽히고(상태가 아니다), `다시 시도` 는 누른 직후 돌며 잠겨 바쁨을
 * 말한다(눌러도 같은 카드가 그대로라 눌렀는지 알 수 없었다). 그래도 안 뜨면 문장이 그 사실을 말하고 손이
 * 다시 열린다. 흐르는 초는 낭독에서 뺀다(초마다 읽히지 않게).
 */
export function StageNotice({
  kind,
  onRetry,
  since,
}: {
  kind: "restarting" | "fixing" | "failed";
  /** 실패의 다시 시도 — 있는 손만 건넨다(미리보기 다시 불러오기 · 준비 파이프). */
  onRetry?: () => void;
  /** 고침 턴의 발사 시각(밀리초) — 없으면 이 카드가 본 순간부터 센다(2026-10-04 ux-review(2차)). */
  since?: number;
}) {
  const now = useNow(kind === "fixing");
  // 이 카드가 본 순간부터 센다 — 고침이 오른 때가 고침의 시작이다.
  const started = useRef({ kind, at: Date.now() });
  if (started.current.kind !== kind) started.current = { kind, at: Date.now() };
  // 2026-10-04 ux-review(2차): 턴이 카드보다 먼저 시작했으면 그 시각부터 — 못 구하면
  // 마운트 기준의 폴백을 유지한다.
  const turnAt = typeof since === "number" && Number.isFinite(since) ? since : started.current.at;
  const elapsed = Math.max(0, now - turnAt);
  const overdue = kind === "fixing" && elapsed >= 120_000;

  // 다시 시도 — 누르면 돌며 잠긴다. 덮개가 바뀌면(다시 켜는 중 · 고치는 중으로) 거기서 끝나고, 8초가 지나도
  // 그대로 실패면 `아직 안 떠요` 를 말하며 손이 다시 열린다.
  const [retry, setRetry] = useState<"idle" | "busy" | "still">("idle");
  // biome-ignore lint/correctness/useExhaustiveDependencies: 덮개의 종류가 바뀌면 시도는 끝난 것이다.
  useEffect(() => {
    setRetry("idle");
  }, [kind]);
  useEffect(() => {
    if (retry !== "busy") return;
    const timer = window.setTimeout(() => setRetry("still"), RETRY_BUSY_MS);
    return () => window.clearTimeout(timer);
  }, [retry]);

  return (
    <div className="nx-prep-card">
      {kind !== "failed" && <i className="nx-spin nx-spin--lg" aria-hidden="true" />}
      {/* 실패는 알림이다 — 눌러서 읽는 상태가 아니라 곧바로 읽혀야 한다. */}
      <div className="nx-prep-top" role={kind === "failed" ? "alert" : "status"}>
        <h3>
          {kind === "restarting"
            ? L.preview.restartingTitle
            : kind === "fixing"
              ? L.preview.fixingTitle
              : L.preview.failedTitle}
        </h3>
        <p className="nx-prep-lines">
          {kind === "restarting"
            ? L.preview.restartingBody
            : kind === "fixing"
              ? L.preview.fixingBody
              : L.preview.failedBody}
        </p>
        {overdue && <p className="nx-prep-lines">{L.preview.fixingOverdue}</p>}
      </div>
      {kind === "fixing" && (
        <p className="nx-prep-lines" aria-hidden="true">
          {elapsedText(elapsed)}
        </p>
      )}
      {kind === "failed" && retry === "still" && (
        <p className="nx-prep-lines nx-prep-still" role="status">
          {L.prepare.retryStill}
        </p>
      )}
      {kind === "failed" && onRetry && (
        <div className="nx-prep-retry">
          <button
            type="button"
            className="nx-btn"
            disabled={retry === "busy"}
            aria-busy={retry === "busy" || undefined}
            onClick={() => {
              setRetry("busy");
              onRetry();
            }}
          >
            {retry === "busy" && <Spin />}
            {retry === "busy" ? L.prepare.retrying : L.preview.retry}
          </button>
        </div>
      )}
    </div>
  );
}
