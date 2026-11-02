import { useEffect, useState } from "react";
import type { Daemon } from "../../../lib/daemon-client";
import { attachmentKey } from "./doc-view-model";

/**
 * 첨부 바이트의 기억(2026-10-30 사용자 요청) — 데몬이 앱의 Confluence 자격으로 받아 base64 로 건넨 것을
 * Blob 주소로 바꿔 둔다. 같은 문서의 같은 파일은 한 번만 받는다. 기억은 앱 안에서만 살고 개수 상한을
 * 넘으면 오래된 것부터 놓는다(주소도 거둔다). 토큰은 이 길 어디에도 없다.
 */

export type AttachmentState =
  | { phase: "loading" }
  | { phase: "ready"; url: string; mediaType: string; filename: string }
  | { phase: "too-large" }
  | { phase: "failed" };

type Loaded = Exclude<AttachmentState, { phase: "loading" }>;

/** 기억하는 첨부의 수 — 넘으면 오래된 것부터 놓는다. */
const KEEP = 48;

const cache = new Map<string, Promise<Loaded>>();

function remember(key: string, value: Promise<Loaded>): void {
  cache.set(key, value);
  while (cache.size > KEEP) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const gone = cache.get(oldest);
    cache.delete(oldest);
    void gone?.then((loaded) => {
      if (loaded.phase === "ready") URL.revokeObjectURL(loaded.url);
    });
  }
}

function toBlob(data: string, mediaType: string): Blob {
  const raw = atob(data);
  const bytes = new Uint8Array(raw.length);
  for (let at = 0; at < raw.length; at += 1) bytes[at] = raw.charCodeAt(at);
  return new Blob([bytes], { type: mediaType });
}

/** 첨부 한 벌을 받는다 — 기억이 있으면 그것을, 실패는 기억하지 않는다(다음에 다시 받는다). */
export function loadAttachment(
  api: Daemon["api"],
  pageId: string,
  filename: string,
): Promise<Loaded> {
  const key = attachmentKey(pageId, filename);
  const known = cache.get(key);
  if (known !== undefined) return known;
  const pending: Promise<Loaded> = api
    .docAttachment(pageId, filename)
    .then((reply): Loaded => {
      if (reply.tooLarge) return { phase: "too-large" };
      const url = URL.createObjectURL(toBlob(reply.data, reply.mediaType));
      return { phase: "ready", url, mediaType: reply.mediaType, filename: reply.filename };
    })
    .catch((): Loaded => {
      cache.delete(key);
      return { phase: "failed" };
    });
  remember(key, pending);
  return pending;
}

/** 그림 한 장의 처지 — 보이는 동안 받는다. */
export function useAttachment(
  api: Daemon["api"],
  pageId: string,
  filename: string | null,
): AttachmentState {
  const [state, setState] = useState<AttachmentState>({ phase: "loading" });
  // api 는 렌더마다 새 겉모습이다 — 문서와 파일이 바뀔 때만 받는다.
  // biome-ignore lint/correctness/useExhaustiveDependencies: 문서와 파일이 바뀔 때만
  useEffect(() => {
    if (filename === null) return;
    let live = true;
    setState({ phase: "loading" });
    void loadAttachment(api, pageId, filename).then((loaded) => {
      if (live) setState(loaded);
    });
    return () => {
      live = false;
    };
  }, [pageId, filename]);
  return state;
}

/** 첨부를 이 컴퓨터에 내려받는다 — Blob 주소로 a[download] 를 한 번 누른다. */
export async function downloadAttachment(
  api: Daemon["api"],
  pageId: string,
  filename: string,
): Promise<"ok" | "too-large" | "failed"> {
  const loaded = await loadAttachment(api, pageId, filename);
  if (loaded.phase !== "ready") return loaded.phase === "too-large" ? "too-large" : "failed";
  const anchor = document.createElement("a");
  anchor.href = loaded.url;
  anchor.download = loaded.filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return "ok";
}
