import type { DeveloperReview, RepoHistoryEntry } from "@colonova-design/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { focusReadDue } from "../../lib/quiet-read";
import { type LedgerRead, reviewsRead } from "../lib/work-ledger";

/**
 * `이번 작업` 의 장부(PLAN-UI U2 · U14) — 제출한 요청의 개발자 코멘트와 이번
 * 사이클의 작업 기록. 셸이 한 번 부르고, 여정(코멘트 수) · 제출 확인(화면 밖
 * 변경) · `이번 작업` 팝오버가 같은 값을 읽는다.
 *
 * 코멘트는 옛 셸의 조용한 읽기(ScreenPanel 의 readHandoffState)와 같은 길로
 * 읽는다 — `repo.handoffStatus` 가 GitHub 을 읽어 `reviews` 를 돌려주고,
 * 감독자의 틱을 깨운다. 그래서 타이머로 부르지 않는다: 프로젝트 · 요청이 바뀔
 * 때, 대화록에 코멘트가 도착했을 때(`review.arrived`), 창이 돌아올 때(20분에
 * 한 번), 팝오버를 열 때(1분에 한 번)만.
 */
export interface WorkLedger {
  /** 열린(또는 방금 반영된) 요청의 코멘트 — 요청이 없으면 빈 목록. */
  reviews: DeveloperReview[];
  /** 이번 사이클의 차례들(최근 것부터) — 아직 읽지 않았으면 null. */
  history: RepoHistoryEntry[] | null;
  /** 대화록에 닿은 가장 최근 제출(`cycle.handed`)의 시각 — 영수증의 시각. */
  handedAt: string | null;
  /**
   * 코멘트 읽기의 상태 — 요청이 없으면 읽을 것이 없어 `ready`. 읽는 중과 읽지 못함이 `reviews` 의 빈 값과
   * 섞이지 않게 한다(팝이 `아직 없어요` 라는 거짓 빈 상태를 말하던 것).
   */
  status: LedgerRead;
  /** 팝오버가 열렸다 — 기록은 늘, 코멘트는 1분에 한 번 다시 읽는다(실패한 뒤에는 곧장). */
  refresh: () => void;
  /** 읽지 못했을 때의 `다시 시도` — 1분 제한 없이 곧장 다시 읽는다. */
  retry: () => void;
}

const OPEN_READ_THROTTLE_MS = 60_000;

export function useWorkLedger(daemon: Daemon): WorkLedger {
  const { api, activeSlug, repo, sessions, diffStatus } = daemon;
  const handoff = repo?.handoff ?? null;
  const [reviews, setReviews] = useState<DeveloperReview[]>([]);
  const [history, setHistory] = useState<RepoHistoryEntry[] | null>(null);
  const lastReviewRead = useRef(0);
  const slugRef = useRef(activeSlug);
  slugRef.current = activeSlug;
  // 코멘트를 읽은 요청의 열쇠(프로젝트 · 요청 번호) — 읽은 적 · 읽지 못한 적을 열쇠로 기억하면 프로젝트나
  // 요청이 바뀔 때 저절로 처음으로 돌아간다.
  const readKey = `${activeSlug}:${handoff?.number ?? ""}`;
  const keyRef = useRef(readKey);
  keyRef.current = readKey;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const failed = failedKey === readKey;
  const failedRef = useRef(failed);
  failedRef.current = failed;

  const readReviews = useCallback(
    (hasHandoff: boolean) => {
      if (!hasHandoff) {
        setReviews([]);
        return;
      }
      const asked = slugRef.current;
      const askedKey = keyRef.current;
      lastReviewRead.current = Date.now();
      void api
        .handoffStatus()
        .then((report) => {
          if (slugRef.current !== asked) return;
          setReviews(report?.reviews?.filter((review) => review.pr === report.number) ?? []);
          if (keyRef.current !== askedKey) return;
          setLoadedKey(askedKey);
          setFailedKey(null);
        })
        .catch((error) => {
          // 원문은 기록으로 — 다음 읽기가 스스로 고친다(옛 readHandoffState 와 같다). 팝은 `읽지 못했어요` 로 말한다.
          console.error("[colonova-design] review read", error);
          if (keyRef.current === askedKey) setFailedKey(askedKey);
        });
    },
    [api],
  );

  const readHistory = useCallback(() => {
    const asked = slugRef.current;
    void api
      .saveHistory()
      .then((answer) => {
        if (slugRef.current === asked) setHistory(answer.entries);
      })
      .catch((error) => console.error("[colonova-design] history read", error));
  }, [api]);

  // 대화록에 닿은 코멘트 도착 · 제출 영수증 — 읽기의 방아쇠이자 영수증의 시각.
  const { humanCount, handedAt } = useMemo(() => {
    let count = 0;
    let latest: string | null = null;
    for (const view of Object.values(sessions)) {
      for (const block of view.blocks) {
        if (block.type === "human") count += 1;
        else if (
          block.type === "milestone" &&
          block.subtype === "handed" &&
          (latest === null || Date.parse(block.at) > Date.parse(latest))
        ) {
          latest = block.at;
        }
      }
    }
    return { humanCount: count, handedAt: latest };
  }, [sessions]);

  const hasHandoff = handoff !== null;
  const handoffKey = `${activeSlug}:${handoff?.number ?? ""}:${handoff?.state ?? ""}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: handoffKey · humanCount 는 값이 아니라 방아쇠다.
  useEffect(() => {
    readReviews(hasHandoff);
  }, [readReviews, hasHandoff, handoffKey, humanCount]);

  // 복원이나 화면 밖 변경도 저장 기록을 갱신한다. 화면 목록만으로는 놓칠 수 있다.
  const savedCommit = diffStatus?.stage === "published" ? diffStatus.commit : null;
  const historyKey = `${activeSlug}:${repo?.branch ?? ""}:${repo?.cycleScreens?.[0]?.at ?? ""}:${humanCount}:${savedCommit ?? ""}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: historyKey 는 방아쇠다.
  useEffect(() => {
    readHistory();
  }, [readHistory, historyKey]);

  // 다른 프로젝트의 장부를 한 순간도 보이지 않는다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeSlug 는 방아쇠다.
  useEffect(() => {
    setReviews([]);
    setHistory(null);
  }, [activeSlug]);

  useEffect(() => {
    const onFocus = () => {
      // 읽지 못한 채라면 창이 돌아올 때 곧장 다시 읽는다 — 잠깐의 실패가 20분을 기다리게 하지 않는다.
      if (failedRef.current || focusReadDue(lastReviewRead.current, Date.now()))
        readReviews(hasHandoff);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [readReviews, hasHandoff]);

  const refresh = useCallback(() => {
    readHistory();
    // 읽지 못한 채라면 1분을 기다리게 하지 않는다 — 팝을 다시 여는 것이 곧 다시 시도다.
    if (failed || Date.now() - lastReviewRead.current >= OPEN_READ_THROTTLE_MS)
      readReviews(hasHandoff);
  }, [readHistory, readReviews, hasHandoff, failed]);
  const retry = useCallback(() => {
    // 실패 표시를 먼저 거둔다 — 눌렀다는 답으로 읽는 중이 다시 서고, 또 실패하면 다시 실패로 돌아온다.
    setFailedKey(null);
    readHistory();
    readReviews(hasHandoff);
  }, [readHistory, readReviews, hasHandoff]);

  const status = reviewsRead({ hasHandoff, loaded: loadedKey === readKey, failed });
  return { reviews, history, handedAt, status, refresh, retry };
}
