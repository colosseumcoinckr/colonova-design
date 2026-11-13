/**
 * 두 문장의 낱말 견주기(2026-10-31 기획서 칸 개선 2단계 · C) — Confluence 판과 견주기가 쓰는 순수
 * 도우미. 낱말(공백으로 나눈 조각) 단위의 최장 공통 부분열로 한 번 견주어, 지운 글과 더한 글을
 * 차례로 돌려준다. 리액트 없이 잰다 — 시험은 src 에서 곧장 읽는다.
 */

/** 견주기의 한 조각 — 같은 글이거나 지워졌거나 더해졌다. */
export type DiffPiece =
  | { kind: "same"; text: string }
  | { kind: "del"; text: string }
  | { kind: "ins"; text: string };

/** 견주기의 끊기 — 낱말과 그 사이의 공백을 모두 조각으로 남긴다(붙여 그릴 때 띄어쓰기가 살아나게). */
function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/gu) ?? [];
}

/**
 * 낱말 견주기 — LCS 표 하나로 같은 · 지운 · 더한 조각을 차례로 낸다. 두 문장이 같으면 같은 조각
 * 하나로 줄인다. 길이는 문단의 글이므로(수백 낱말) 표의 부담이 실질적이지 않다.
 */
export function diffWords(before: string, after: string): DiffPiece[] {
  if (before === after) return before === "" ? [] : [{ kind: "same", text: before }];
  const left = tokenize(before);
  const right = tokenize(after);
  // 표 — table[i][j] 는 left 앞쪽 i 개와 right 앞쪽 j 개의 LCS 길이다.
  const width = right.length + 1;
  const table = new Uint32Array((left.length + 1) * width);
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const same = left[i - 1] === right[j - 1];
      const above = table[(i - 1) * width + j] ?? 0;
      const beside = table[i * width + (j - 1)] ?? 0;
      const corner = table[(i - 1) * width + (j - 1)] ?? 0;
      table[i * width + j] = same ? corner + 1 : Math.max(above, beside);
    }
  }
  const raw: DiffPiece[] = [];
  const push = (kind: DiffPiece["kind"], text: string) => {
    raw.push({ kind, text });
  };
  let i = left.length;
  let j = right.length;
  while (i > 0 && j > 0) {
    const same = left[i - 1] === right[j - 1];
    const above = table[(i - 1) * width + j] ?? 0;
    const beside = table[i * width + (j - 1)] ?? 0;
    if (same) {
      push("same", left[i - 1] ?? "");
      i -= 1;
      j -= 1;
    } else if (beside >= above) {
      push("ins", right[j - 1] ?? "");
      j -= 1;
    } else {
      push("del", left[i - 1] ?? "");
      i -= 1;
    }
  }
  while (i > 0) {
    push("del", left[i - 1] ?? "");
    i -= 1;
  }
  while (j > 0) {
    push("ins", right[j - 1] ?? "");
    j -= 1;
  }
  // 뒤에서부터 걸었으므로 먼저 도로 세우고, 그 다음에 이웃한 같은 종류를 붙인다 — 붙여 그릴 때
  // 문장의 순서가 살아나게(2026-10-31 2단계).
  const pieces: DiffPiece[] = [];
  for (const piece of raw.reverse()) {
    const last = pieces.at(-1);
    if (last !== undefined && last.kind === piece.kind) last.text += piece.text;
    else pieces.push({ ...piece });
  }
  return pieces;
}

/** 견주어 볼 가치가 있는가 — 조각이 하나뿐(모두 같음)이면 견주지 않는다. */
export function hasChanges(pieces: readonly DiffPiece[]): boolean {
  return pieces.some((piece) => piece.kind !== "same");
}
