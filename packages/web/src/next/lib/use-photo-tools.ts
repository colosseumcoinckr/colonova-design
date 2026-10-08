import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { L } from "../labels";
import {
  composeShare,
  copyPhoto,
  knownDiff,
  type PhotoDiff,
  photoDiff,
  readShareTheme,
  type ShareInput,
} from "./photo-canvas";
import { type Box, type DiffSummary, outsideRegions, summarizeDiff } from "./photo-diff";

/** 윤곽이 쓰는 사진 둘의 도구 상태 — 결과 카드와 비교 대화상자가 같은 훅을 쓴다(2026-10-08 베타 준비 분석). */
export interface PhotoTools {
  /** 비교를 마쳐 윤곽을 쓸 수 있는 쌍 — 계산 중이거나 비교할 수 없으면 null 이고 단추도 서지 않는다. */
  diff: PhotoDiff | null;
  summary: DiffSummary | null;
  /** 그릴 상자들 — 화면 대부분이 달라졌으면 비어 있다(전체를 두른 상자는 소음이다). */
  boxes: readonly Box[];
  /** 그 가운데 요청이 가리킨 곳 밖의 것 — 핀 위치가 없으면 늘 비어 있다. */
  warn: ReadonlySet<Box>;
  /** 윤곽을 켰나 — 기본은 꺼짐. */
  on: boolean;
  toggle: () => void;
}

const NO_BOXES: readonly Box[] = [];
const NO_WARN: ReadonlySet<Box> = new Set();

/**
 * 사진 쌍(수정 전 · 수정 후)의 달라진 곳. 사진이 와야 비로소 한 번, 브라우저가 한가할 때 비동기로 계산하고(캐시는 쌍 단위)
 * 실패는 조용히 윤곽 없음이다. `pins` 는 요청이 가리킨 곳(수정 후 사진 기준 정규화) — 없으면 요청 밖 경고도 없다.
 */
export function usePhotoTools(
  before: string | null,
  after: string | null,
  pins?: readonly Box[],
): PhotoTools {
  const [diff, setDiff] = useState<PhotoDiff | null>(() =>
    before && after ? knownDiff(before, after) : null,
  );
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!before || !after) {
      setDiff(null);
      return;
    }
    const known = knownDiff(before, after);
    if (known) {
      setDiff(known);
      return;
    }
    setDiff(null);
    let cancelled = false;
    void photoDiff(before, after).then((value) => {
      if (!cancelled) setDiff(value);
    });
    return () => {
      cancelled = true;
    };
  }, [before, after]);

  const summary = diff ? summarizeDiff(diff) : null;
  const boxes = diff && summary?.kind === "regions" ? diff.regions : NO_BOXES;
  const warn = useMemo(() => {
    if (!diff || !pins || boxes.length === 0) return NO_WARN;
    return new Set(outsideRegions(boxes, pins, { aspect: diff.height / diff.width }));
  }, [diff, pins, boxes]);
  const toggle = useCallback(() => setOn((now) => !now), []);
  return { diff: summary ? diff : null, summary, boxes, warn, on, toggle };
}

/** 사진 복사 — 합성은 눌림의 손짓 안에서 시작하고(클립보드의 허락), 끝나면 토스트가 말한다. */
export function useCopyPhoto(onToast?: (text: string) => void): {
  busy: boolean;
  copy: (input: ShareInput) => void;
} {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const toast = useRef(onToast);
  toast.current = onToast;
  const copy = useCallback((input: ShareInput) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    const blob = composeShare(input, readShareTheme());
    // 클립보드가 없어 약속이 끝내 아무에게도 안 읽혀도 처리되지 않은 거절로 남지 않게.
    blob.catch(() => undefined);
    void copyPhoto(blob)
      .then((ok) => toast.current?.(ok ? L.photo.copied : L.photo.copyFailed))
      .finally(() => {
        running.current = false;
        setBusy(false);
      });
  }, []);
  return { busy, copy };
}

/** 켠 윤곽 위의 한 줄 — `3곳이 달라졌어요` · `거의 달라진 곳이 없어요` · `화면 대부분이 달라졌어요`. */
export function diffText(summary: DiffSummary): string {
  if (summary.kind === "none") return L.photo.diffNone;
  if (summary.kind === "wide") return L.photo.diffWide;
  return L.photo.diffCount(summary.count);
}
