import { useEffect, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import { readPhotos } from "../lib/result-photos";
import { CompareIcon, EditIcon, EyeIcon, FwdIcon, ImageIcon, NoPhotoIcon, RedoIcon } from "./icons";

export type LoadComparison = Daemon["api"]["comparison"];

/**
 * 고친 화면 한 장 — 사진이 위, 제목과 `현재 화면 열기` 가 가운데, 이어 하기 둘이 아래.
 * 카드 전체가 한 번에 눌린다(제목 단추의 ::after 가 카드를 덮는다) — 탭 정지는 하나이고,
 * 다시 읽기 · 전/후 토글 · 이어 하기 단추는 그 위에 따로 선다. 사진은 이 요청이 끝났을 때의 것만
 * 싣고 오늘의 화면은 싣지 않는다 — 어느 때의 사진인지는 묶음이 한 번만 말한다.
 *
 * 수정 전 사진이 있으면 사진 위의 `수정 전 | 수정 후` 로 카드 안에서 넘겨 본다(2026-10-06 UX 점검 — 제품의
 * 핵심 장면인 전 · 후가 12px 링크 뒤의 대화상자에만 있었다). 같은 자리 · 같은 크기로 갈아 끼워지므로 달라진
 * 곳이 눈에 띈다. 수정 전 사진이 없으면 토글 없이 `수정 후 모습` 이름표만 선다. 나란히 · 겹쳐서 · 확대는
 * `수정 전·후 보기` 대화상자의 몫이다.
 */
export function ResultScreen({
  title,
  route,
  requestId,
  loadComparison,
  onOpen,
  onCompare,
  onEdit,
}: {
  title: string;
  route: string;
  requestId?: string;
  loadComparison: LoadComparison;
  onOpen: () => void;
  onCompare: () => void;
  onEdit?: () => void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [picture, setPicture] = useState<string | null>(null);
  // 수정 전 사진 — 없으면 null 이고 토글도 없다. `showing` 은 지금 사진에 선 쪽이다.
  const [before, setBefore] = useState<string | null>(null);
  const [showing, setShowing] = useState<"after" | "before">("after");
  const [loading, setLoading] = useState(Boolean(requestId));
  const [unavailable, setUnavailable] = useState(false);
  // 읽다 실패한 사진을 다시 읽는 횟수 — 값이 바뀌면 아래 효과가 처음부터 다시 돈다.
  const [attempt, setAttempt] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt 는 읽지 않고 다시 돌리는 열쇠다.
  useEffect(() => {
    setPicture(null);
    setBefore(null);
    setShowing("after");
    setLoading(Boolean(requestId));
    setUnavailable(false);
    if (!requestId || !card.current) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        void loadComparison({ route, requestId })
          .then((record) => {
            if (cancelled) return;
            const photos = readPhotos(record, { requestId, route });
            if (photos.after) {
              setPicture(photos.after);
              setBefore(photos.before);
            }
          })
          .catch(() => {
            if (!cancelled) setUnavailable(true);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      { rootMargin: "200px" },
    );
    observer.observe(card.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [route, requestId, loadComparison, attempt]);

  return (
    <div ref={card} className="nx-result-screen">
      <div
        className={`nx-result-photo${
          picture ? "" : loading ? " nx-result-photo--loading" : " nx-result-photo--empty"
        }`}
      >
        {picture ? (
          <>
            {/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Handles image decoding failure, not user interaction. */}
            <img
              className="nx-result-img"
              src={showing === "before" && before ? before : picture}
              alt=""
              onError={() => {
                // 수정 전 사진만 못 그리면 그 사진만 거두고 수정 후로 돌아온다 — 카드를 비우지 않는다.
                if (showing === "before" && before) {
                  setBefore(null);
                  setShowing("after");
                  return;
                }
                setPicture(null);
                setUnavailable(true);
              }}
            />
            {before ? (
              <div className="nx-result-ba" role="group" aria-label={L.compare.flipGroup}>
                <button
                  type="button"
                  aria-pressed={showing === "before"}
                  onClick={() => setShowing("before")}
                >
                  {L.compare.before}
                </button>
                <button
                  type="button"
                  aria-pressed={showing === "after"}
                  onClick={() => setShowing("after")}
                >
                  {L.compare.after}
                </button>
              </div>
            ) : (
              <span className="nx-result-photo-label">{L.transcript.shotCaptured}</span>
            )}
          </>
        ) : (
          <span className="nx-result-placeholder">
            {loading ? <ImageIcon /> : <NoPhotoIcon />}
            <span>
              {loading
                ? L.transcript.shotLoading
                : unavailable
                  ? L.transcript.shotFailed
                  : L.transcript.shotNoPhoto}
            </span>
            {unavailable && !loading && (
              <button
                type="button"
                className="nx-result-retry"
                onClick={() => setAttempt((count) => count + 1)}
              >
                <RedoIcon />
                {L.vocab.retry}
              </button>
            )}
          </span>
        )}
      </div>
      <button
        type="button"
        className="nx-result-open"
        onClick={onOpen}
        aria-label={`${title} · ${L.transcript.shotGo}`}
      >
        <b>{title}</b>
        <span className="nx-result-go">
          <EyeIcon />
          {L.requestResult.latest}
          <FwdIcon />
        </span>
      </button>
      <div className="nx-result-acts">
        {onEdit && (
          <button
            type="button"
            className="nx-result-act"
            onClick={onEdit}
            aria-label={`${title} · ${L.requestResult.edit}`}
          >
            <EditIcon />
            <span className="nx-result-act-label">{L.requestResult.edit}</span>
          </button>
        )}
        <button
          type="button"
          className="nx-result-act"
          onClick={onCompare}
          aria-label={`${title} · ${L.compare.open}`}
        >
          <CompareIcon />
          <span className="nx-result-act-label">{L.compare.open}</span>
        </button>
      </div>
    </div>
  );
}
