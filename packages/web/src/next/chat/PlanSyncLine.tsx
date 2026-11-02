import type { PlanSync, PlanSyncDoc, PlanSyncLink } from "@colonova-design/protocol";
import { FileText, Link2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { L } from "../labels";
import { Spin } from "../ui/icons";

/** 같이 고치기 곁줄이 쓰는 손 — 대화 칸이 데몬 · 기획서 칸과 이어 준다. */
export interface PlanSyncHand {
  open: (doc: PlanSyncDoc) => void;
  undo: (entryId: string) => Promise<void>;
  unlink: (link: PlanSyncLink) => Promise<void>;
  pick: (requestId: string, pageId: string) => Promise<void>;
  docs: () => Promise<Array<{ pageId: string; title: string; path: string }>>;
  /**
   * 곁줄 발행(2026-11-02 · 같이 고치기 UX 계획 C3) — 화면 자리를 떠나지 않고 발행 확인 창을 띄운다.
   * 약속은 발행이 끝났는지를 돌려준다(곁줄 문구가 바뀐다). 쓰기 게이트가 꺼져 있으면 이 손이 없다.
   */
  publish?: (doc: PlanSyncDoc) => Promise<boolean>;
}

/**
 * 같이 고치기의 곁줄(2026-10-30 사용자 결정) — 결과 카드 아래에서 이 화면 요청이 기획서 초안도 고쳤는지 말한다.
 * 바꿀 것이 없던 문서는 서지 않는다. 초안까지만 자동이라 발행 전이라는 말을 함께 둔다.
 */
export function PlanSyncLine({
  sync,
  requestId,
  screenTitle,
  hand,
}: {
  sync: PlanSync;
  requestId: string;
  /** 연결 줄의 화면 이름 — 주소 대신 사람이 읽는 제목. */
  screenTitle: (route: string) => string;
  hand: PlanSyncHand;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [cut, setCut] = useState<ReadonlySet<string>>(new Set());
  // 곁줄 발행(C3) — 발행이 끝난 문서는 문구가 「…」 발행했어요 로 바뀐다.
  const [published, setPublished] = useState<ReadonlySet<string>>(new Set());
  const docs = sync.docs.filter((doc) => doc.outcome !== "unchanged");
  const adopted = docs.some((doc) => doc.outcome === "adopted" && !published.has(keyOf(doc)));
  if (docs.length === 0 && sync.linked.length === 0 && sync.ask === undefined) return null;

  const run = (key: string, work: () => Promise<void>, failed: string) => {
    setBusy(key);
    setNote(null);
    work()
      .catch(() => setNote(failed))
      .finally(() => setBusy(null));
  };

  return (
    <section className="nx-psync" aria-label={L.planSync.label}>
      {docs.map((doc) => {
        const key = keyOf(doc);
        const isPublished = published.has(key);
        return (
          <div key={key} className="nx-psync-row">
            {doc.outcome === "checking" ? (
              <Spin />
            ) : (
              <FileText className="nx-i" size={14} aria-hidden="true" />
            )}
            <span className="nx-psync-text">
              {lineOf(doc, isPublished)}
              {doc.summary !== undefined && doc.outcome === "adopted" && (
                <span className="nx-psync-sub">{doc.summary}</span>
              )}
              {doc.outcome === "adopted" && doc.kept !== undefined && doc.kept > 0 && (
                <span className="nx-psync-sub">{L.planSync.adoptedKept(doc.kept)}</span>
              )}
              {doc.outcome === "undone" && doc.kept !== undefined && doc.kept > 0 && (
                <span className="nx-psync-sub">{L.planSync.undoneKept(doc.kept)}</span>
              )}
              {doc.outcome === "failed" && doc.detail !== undefined && (
                <span className="nx-psync-sub">{doc.detail}</span>
              )}
            </span>
            {doc.outcome !== "checking" && doc.outcome !== "failed" && doc.docKey !== null && (
              <button
                type="button"
                className="nx-btn nx-btn--sm nx-btn--ghost"
                onClick={() => hand.open(doc)}
              >
                {L.planSync.view}
              </button>
            )}
            {/* 곁줄 발행(C3) — 확인 창은 그대로, 이동만 없앤다. 게이트가 꺼져 있으면 손이 안 선다(같은 계획 §3). */}
            {doc.outcome === "adopted" &&
              doc.docKey !== null &&
              hand.publish !== undefined &&
              !isPublished && (
                <button
                  type="button"
                  className="nx-btn nx-btn--sm nx-btn--ghost"
                  disabled={busy !== null}
                  onClick={() => {
                    const publish = hand.publish;
                    if (publish === undefined) return;
                    run(
                      `publish:${key}`,
                      () =>
                        publish(doc).then((ok) => {
                          if (!ok) throw new Error("publish closed");
                          setPublished((before) => new Set([...before, key]));
                        }),
                      L.planSync.publishFailed,
                    );
                  }}
                >
                  {busy === `publish:${key}` ? <Spin /> : null}
                  {L.planSync.publish}
                </button>
              )}
            {doc.outcome === "adopted" && doc.entryId !== undefined && (
              <button
                type="button"
                className="nx-btn nx-btn--sm nx-btn--ghost"
                disabled={busy !== null}
                onClick={() => {
                  const entryId = doc.entryId;
                  if (entryId !== undefined)
                    run(`undo:${entryId}`, () => hand.undo(entryId), L.planSync.undoFailed);
                }}
              >
                {busy === `undo:${doc.entryId}` ? (
                  <Spin />
                ) : (
                  <Undo2 className="nx-i" size={14} aria-hidden="true" />
                )}
                {L.planSync.undo}
              </button>
            )}
          </div>
        );
      })}
      {sync.linked.map((link) => {
        const key = `${link.pageId}\n${link.route}`;
        return (
          <div key={key} className="nx-psync-row">
            <Link2 className="nx-i" size={14} aria-hidden="true" />
            <span className="nx-psync-text">
              {cut.has(key)
                ? L.planSync.unlinked(link.title)
                : L.planSync.linked(link.title, screenTitle(link.route))}
            </span>
            {!cut.has(key) && (
              <button
                type="button"
                className="nx-btn nx-btn--sm nx-btn--ghost"
                disabled={busy !== null}
                onClick={() =>
                  run(
                    `cut:${key}`,
                    () =>
                      hand.unlink(link).then(() => setCut((before) => new Set([...before, key]))),
                    L.planSync.unlinkFailed,
                  )
                }
              >
                {L.planSync.unlink}
              </button>
            )}
          </div>
        );
      })}
      {sync.ask !== undefined && docs.length === 0 && <AskRow requestId={requestId} hand={hand} />}
      {adopted && <p className="nx-psync-foot">{L.planSync.unpublished}</p>}
      {note !== null && (
        <p className="nx-psync-foot" role="status">
          {note}
        </p>
      )}
    </section>
  );
}

/** 문서 줄의 열쇠 — 발행 표시가 문서마다 붙는다. */
function keyOf(doc: PlanSyncDoc): string {
  return doc.pageId ?? doc.docKey ?? doc.title;
}

function lineOf(doc: PlanSyncDoc, published = false): string {
  switch (doc.outcome) {
    case "checking":
      return L.planSync.checking(doc.title);
    case "adopted":
      // 곁줄 발행(C3) — 발행이 끝나면 문구가 바뀐다.
      return published ? L.planSync.publishedDone(doc.title) : L.planSync.adopted(doc.title);
    case "proposed":
      return L.planSync.proposed(doc.title);
    case "failed":
      return L.planSync.failed(doc.title);
    case "undone":
      return L.planSync.undone(doc.title);
    case "unchanged":
      return "";
  }
}

/** 이어진 기획서가 없을 때 — 고르면 그 문서와 이 화면을 잇고 같이 고친다. */
function AskRow({ requestId, hand }: { requestId: string; hand: PlanSyncHand }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [list, setList] = useState<Array<{ pageId: string; title: string; path: string }> | null>(
    null,
  );
  const [phase, setPhase] = useState<"idle" | "loading" | "failed" | "sent">("idle");

  useEffect(() => {
    if (!open || list !== null) return;
    setPhase("loading");
    hand
      .docs()
      .then((docs) => {
        setList(docs);
        setPhase("idle");
      })
      .catch(() => setPhase("failed"));
  }, [open, list, hand]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const rows = list ?? [];
    return (
      needle === "" ? rows : rows.filter((doc) => doc.title.toLowerCase().includes(needle))
    ).slice(0, 8);
  }, [list, filter]);

  if (phase === "sent") {
    return (
      <div className="nx-psync-row">
        <Spin />
        <span className="nx-psync-text">{L.planSync.pickSent}</span>
      </div>
    );
  }
  return (
    <div className="nx-psync-ask">
      <div className="nx-psync-row">
        <FileText className="nx-i" size={14} aria-hidden="true" />
        <span className="nx-psync-text">{L.planSync.ask}</span>
        <button
          type="button"
          className="nx-btn nx-btn--sm nx-btn--ghost"
          aria-expanded={open}
          onClick={() => setOpen((before) => !before)}
        >
          {L.planSync.pick}
        </button>
      </div>
      {open && (
        <fieldset className="nx-psync-pick" aria-label={L.planSync.pickTitle}>
          <input
            className="nx-input nx-psync-filter"
            type="search"
            value={filter}
            placeholder={L.planSync.pickFilter}
            aria-label={L.planSync.pickFilter}
            onChange={(event) => setFilter(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
          />
          {phase === "loading" && <p className="nx-psync-foot">{L.planSync.pickLoading}</p>}
          {phase === "failed" && <p className="nx-psync-foot">{L.planSync.pickFailed}</p>}
          {phase === "idle" && list !== null && shown.length === 0 && (
            <p className="nx-psync-foot">{L.planSync.pickEmpty}</p>
          )}
          <ul className="nx-psync-list">
            {shown.map((doc) => (
              <li key={doc.pageId}>
                <button
                  type="button"
                  className="nx-psync-doc"
                  title={doc.path}
                  onClick={() => {
                    setPhase("sent");
                    hand.pick(requestId, doc.pageId).catch(() => setPhase("failed"));
                  }}
                >
                  <FileText className="nx-i" size={14} aria-hidden="true" />
                  <span>{doc.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      )}
    </div>
  );
}
