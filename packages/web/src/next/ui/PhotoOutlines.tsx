import type { CSSProperties } from "react";
import type { Box } from "../lib/photo-diff";

/** 윤곽 SVG 의 가로 눈금 — 사진의 가로를 이 값으로 센다(세로는 사진의 비율을 따른다). */
const VIEW = 1000;
/** 윤곽을 변경 픽셀 둘레에서 이만큼(눈금) 띄운다 — 얇은 변화에서도 선이 변화를 가리지 않는다. */
const PAD = 5;
/** 사진 가장자리에 붙은 상자도 선이 반쯤 잘리지 않게 가장자리에서 이만큼(눈금) 안쪽에 둔다. */
const EDGE = 3;

/**
 * 사진 위에 얹는 달라진 곳 윤곽(2026-10-08 베타 준비 분석). 캔버스에 굽지 않고 사진 위의 SVG 도형으로 두어
 * 테마의 토큰을 입고(`.nx-diff-box`), 확대해도 선이 또렷하다.
 *
 * SVG 로 두는 까닭: 결과 카드의 사진은 `object-fit: cover; object-position: top` 이라 칸이 사진의 비율과 다르면 아래나
 * 옆이 잘린다 — 퍼센트로 자리를 잡은 상자는 그때 어긋난다. `preserveAspectRatio="xMidYMin slice"` 는 CSS 의 같은 규칙을
 * 브라우저가 그대로 계산하므로 칸이 어떻게 변해도 윤곽이 사진 위의 같은 자리에 선다. 비교 대화상자는 사진과 같은 크기 ·
 * 같은 변환(`style`)을 줘서 겹친다.
 *
 * 상자의 좌표는 수정 후 사진 기준의 0..1 이다(`photo-diff.ts`). 화면 낭독에는 숨긴다 — 곳 수는 곁의 한 줄이 말한다.
 */
export function DiffOutlines({
  size,
  boxes,
  warn,
  className = "",
  style,
}: {
  /** 수정 후 사진의 원래 크기 — 비율만 쓴다. */
  size: { width: number; height: number };
  boxes: readonly Box[];
  /** 요청한 곳 밖의 상자 — 경고색으로 그린다. */
  warn: ReadonlySet<Box>;
  className?: string;
  style?: CSSProperties;
}) {
  const height = (VIEW * size.height) / size.width;
  return (
    <svg
      className={`nx-diff-svg${className ? ` ${className}` : ""}`}
      style={style}
      viewBox={`0 0 ${VIEW} ${height}`}
      preserveAspectRatio="xMidYMin slice"
      aria-hidden="true"
      focusable="false"
    >
      {boxes.map((box) => {
        const x0 = Math.max(EDGE, box.x * VIEW - PAD);
        const y0 = Math.max(EDGE, box.y * height - PAD);
        const x1 = Math.min(VIEW - EDGE, (box.x + box.w) * VIEW + PAD);
        const y1 = Math.min(height - EDGE, (box.y + box.h) * height + PAD);
        return (
          <rect
            key={`${box.x}:${box.y}`}
            className={`nx-diff-box${warn.has(box) ? " nx-diff-box--warn" : ""}`}
            x={x0}
            y={y0}
            width={Math.max(0, x1 - x0)}
            height={Math.max(0, y1 - y0)}
            rx={8}
          />
        );
      })}
    </svg>
  );
}
