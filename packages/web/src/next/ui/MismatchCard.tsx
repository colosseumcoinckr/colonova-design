import type { DraftMismatchRow } from "@colonova-design/protocol";
import { useState } from "react";
import { L } from "../labels";
import { mismatchRowKey } from "../lib/mismatch-model";
import { Spin } from "./icons";
/**
 * 어긋남 카드(2026-11-02 · 같이 고치기 UX 계획 §2) — 기획서와 화면이 다른 규칙을 나란히 보이고 어느 쪽으로
 * 맞출지 사람이 고른다. `화면을 기획서대로` 는 브리프를 화면 대화로 곧바로 보내는 으뜸 손이다(2026-11-03 A안
 * 1A-1(b)) — 곁의 `고쳐서 보내기` 만 입력창에 미리 채운다. 기획서 칸의 읽는 문서 곁 · 화면 자리 기획서 탭 ·
 * 기획 대화 답 아래가 함께 쓴다 — 답 아래(C8)에는 되돌리기가 판에 이미 있어 `기획서를 화면대로` 손이 없다.
 * 카드가 이미 한쪽으로 기운 자리는 손을 줄여 얹는다(계획 §2 「남은 손이 바뀐다」).
 */
export interface MismatchHand {
  /** 기획서를 화면대로 — 그 절을 초안에 바로 고친다(되돌리기 가능). 이 손이 없는 자리는 undefined 다. */
  apply?: (row: DraftMismatchRow) => Promise<void>;
  /** 화면을 기획서대로 — 브리프를 화면 대화로 바로 보낸다(누름=보내기 · 2026-11-03 A안 1A-1(b)).
   * 곧바로 나갔으면 "sent", 입력창을 채우는 데 그쳤으면 "prefilled" 를 돌려준다 — 카드는 "sent" 만
   * 보낸 줄로 그린다(2026-11-12 B6). 실패는 약속이 거절된다. */
  send: (row: DraftMismatchRow) => Promise<"sent" | "prefilled">;
  /** 고쳐서 보내기 — 화면 자리로 옮겨 브리프를 미리 채운다. 보내기는 사람이다. */
  sendEdit: (row: DraftMismatchRow) => Promise<void>;
  /** 안 받기 — 이 화면 · 문서 짝의 카드를 다시 띄우지 않는다. */
  decline: (row: DraftMismatchRow) => Promise<void>;
}

export function MismatchCard({
  title,
  source = "",
  rows,
  note = null,
  hand,
}: {
  title: string;
  /** 기획서 쪽 말을 어느 판에서 읽었는지 — 정본은 초안 우선이라 판을 밝힌다(계획 §2). 빈칸이면 출처 줄이 안 선다. */
  source?: string;
  rows: DraftMismatchRow[];
  /** 절 상한에 걸렸을 때의 한 줄 안내. */
  note?: string | null;
  hand: MismatchHand;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  // 곧바로 나간 줄은 카드가 살아 있는 동안 한 줄 흔적이 남는다(2026-11-12 B6) — 알림이 사라져도
  // 보낸 것이 보이고 다시 눌러 같은 요청이 또 가지 않는다. 입력창 채우기("prefilled")는 세지 않는다.
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set());
  const shown = rows.filter((row) => !hidden.has(mismatchRowKey(row)));
  if (shown.length === 0) return null;

  const run = (key: string, work: () => Promise<void>, failedText: string) => {
    setBusy(key);
    setFailed(null);
    work()
      .catch(() => setFailed(failedText))
      .finally(() => setBusy(null));
  };

  return (
    <section className="nx-mismatch" aria-label={L.compare.cardLabel}>
      <header className="nx-mismatch-hd">
        <b>{L.compare.cardLabel}</b>
        {source !== "" && (
          <span className="nx-mismatch-src">{L.compare.sourceLine(title, source)}</span>
        )}
      </header>
      <ul className="nx-mismatch-list">
        {shown.map((row) => {
          const key = mismatchRowKey(row);
          return (
            <li key={key} className="nx-mismatch-row">
              <p className="nx-mismatch-sec">{row.section}</p>
              <p className="nx-mismatch-pair">
                <span className="nx-mismatch-plan">
                  <b>{L.compare.planSide}</b>
                  {row.plan}
                </span>
                <span className="nx-mismatch-screen">
                  <b>{L.compare.screenSide(row.screenName)}</b>
                  {row.screen}
                </span>
              </p>
              <div className="nx-mismatch-acts">
                {sent.has(key) ? (
                  // 곧바로 나간 줄의 흔적(2026-11-12 B6) — 단추 대신 한 줄이 서고 다시 누를 길은 없다.
                  <p className="nx-mismatch-note" role="status">
                    {L.compare.sentRow}
                  </p>
                ) : (
                  <>
                    {hand.apply !== undefined && (
                      <button
                        type="button"
                        className="nx-btn nx-btn--sm"
                        disabled={busy !== null}
                        onClick={() =>
                          run(
                            `${key}:apply`,
                            () => hand.apply?.(row) ?? Promise.resolve(),
                            L.compare.applyFailed,
                          )
                        }
                      >
                        {busy === `${key}:apply` ? <Spin /> : null}
                        {L.compare.apply}
                      </button>
                    )}
                    <button
                      type="button"
                      className="nx-btn nx-btn--sm"
                      disabled={busy !== null}
                      onClick={() =>
                        run(
                          `${key}:send`,
                          () =>
                            hand.send(row).then((result) => {
                              if (result === "sent") {
                                setSent((before) => new Set([...before, key]));
                              }
                            }),
                          L.compare.sendFailed,
                        )
                      }
                    >
                      {busy === `${key}:send` ? <Spin /> : null}
                      {L.compare.send}
                    </button>
                    <button
                      type="button"
                      className="nx-btn nx-btn--sm nx-btn--ghost"
                      disabled={busy !== null}
                      onClick={() =>
                        run(`${key}:sendEdit`, () => hand.sendEdit(row), L.compare.sendFailed)
                      }
                    >
                      {busy === `${key}:sendEdit` ? <Spin /> : null}
                      {L.compare.sendEdit}
                    </button>
                    <button
                      type="button"
                      className="nx-btn nx-btn--sm nx-btn--ghost"
                      disabled={busy !== null}
                      onClick={() =>
                        run(
                          `${key}:decline`,
                          () =>
                            hand
                              .decline(row)
                              .then(() => setHidden((before) => new Set([...before, key]))),
                          L.compare.declineFailed,
                        )
                      }
                    >
                      {L.compare.decline}
                    </button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {note !== null && <p className="nx-mismatch-note">{note}</p>}
      {failed !== null && (
        <p className="nx-mismatch-note" role="alert">
          {failed}
        </p>
      )}
    </section>
  );
}
