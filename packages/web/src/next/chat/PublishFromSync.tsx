import type { PlanSyncDoc } from "@colonova-design/protocol";
import { useEffect, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import { PublishDialog } from "../plans/draft/PublishDialog";
import type { ShellNav } from "../slots";

/**
 * 곁줄 발행의 감싸개 팝(2026-11-02 · 같이 고치기 UX 계획 C3) — 발행 확인 부품을 그대로 화면 자리에
 * 띄운다. 계약 · 게이트 · 확인 창은 하나도 줄이지 않고 이동만 없앤다. 발행은 그 문서의 초안 전체를
 * 올리므로 같이 고친 것 밖의 바뀐 곳이 있으면 한 줄로 말한다(재료는 발행 미리보기와 결과의 걸음 수).
 */
export function PublishFromSync({
  daemon,
  nav,
  doc,
  changes,
  onDone,
}: {
  daemon: Daemon;
  nav: ShellNav;
  /** 곁줄의 문서 줄 — 발행 손이 누른 것이다. */
  doc: PlanSyncDoc;
  /** 같이 고침으로 들어간 걸음 수 — 미리보기의 바뀐 곳과 견주어 밖의 바뀐 곳을 센다. */
  changes: number;
  /** 창이 닫힐 때 한 번 — 발행이 끝났는지를 돌려준다(곁줄 문구가 바뀐다). */
  onDone: (published: boolean) => void;
}) {
  const api = daemon.api;
  const docKey = doc.docKey ?? "";
  const [ready, setReady] = useState<{
    site: string;
    baseTitle: string | null;
    pendingCommandId: string | null;
    banner: string | null;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [published, setPublished] = useState(false);

  // 창이 설 때 초안과 발행 미리보기를 한 번 읽는다 — 감싸개가 채울 값과 밖의 바뀐 곳 한 줄.
  useEffect(() => {
    let alive = true;
    Promise.all([api.draftGet(docKey), api.draftPublishPreview(docKey)])
      .then(([view, preview]) => {
        if (!alive) return;
        const total = preview.changes.changed + preview.changes.inserted + preview.changes.deleted;
        const outside = Math.max(0, total - changes);
        setReady({
          site: view.site,
          baseTitle: view.baseTitle,
          pendingCommandId: view.pendingCommandId,
          banner: outside > 0 ? L.planSync.publishOutside(outside) : null,
        });
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [api, docKey, changes]);

  // 초안을 못 읽으면 팝을 열 수 없다 — 닫고 곁줄이 실패 문구를 말하게 한다.
  useEffect(() => {
    if (failed) onDone(false);
  }, [failed, onDone]);

  if (failed || ready === null) return null;
  return (
    <PublishDialog
      daemon={daemon}
      docKey={docKey}
      site={ready.site}
      baseTitle={ready.baseTitle}
      pendingCommandId={ready.pendingCommandId}
      nav={nav}
      banner={ready.banner}
      onClose={() => {
        const was = published;
        onDone(was);
        if (was) nav.toast(L.planSync.publishedDone(doc.title));
      }}
      // 발행이 끝나면 편집기의 다시 읽기처럼 여기서는 마쳤음만 기억한다 — 곁줄 문구는 닫힐 때의 약속이 바꾼다.
      onRefresh={() => setPublished(true)}
    />
  );
}
