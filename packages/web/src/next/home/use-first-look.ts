import { useEffect, useRef, useState } from "react";
import type { Daemon } from "../../lib/daemon-client";
import { askFirstLook } from "../lib/first-look";

/** 그림 주소가 실제로 풀리는가 — 풀리지 않는 그림은 줄에 세우지 않는다(깨진 그림 대신 사진 없는 줄). */
function decodes(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0);
    image.onerror = () => resolve(false);
    image.src = url;
  });
}

/**
 * 서비스의 첫 화면 사진(2026-10-07 베타 준비 분석 · 첫 5분) — `서비스가 떴어요` 줄의 한 장. 지금 프로젝트이고, 서비스가 떠
 * 있고, 데몬이 첫 화면을 읽었을 때만 묻는다(읽은 것이 없으면 서버가 첫 주소에 정상으로 답하지 못한 것이다). 사진은 늦게
 * 온다 — 줄은 먼저 서고 사진이 도착하면 붙는다. 못 찍었거나 풀리지 않으면 계속 null 이다. 서버가 새로 뜨면 열쇠가 달라져
 * 새로 묻고, 같은 서버에서는 홈이 오가도 한 번만 묻는다(`askFirstLook`).
 */
export function useFirstLook(daemon: Daemon, slug: string | null): string | null {
  const repo = daemon.repo;
  const enabled =
    slug !== null &&
    slug === daemon.activeSlug &&
    repo?.phase === "ready" &&
    repo.firstScreen !== undefined;
  const key = `${slug}|${repo?.root}|${repo?.previewEpoch}|${repo?.firstScreen?.path}`;
  const api = useRef(daemon.api);
  api.current = daemon.api;
  const [shot, setShot] = useState<{ key: string; url: string | null } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void askFirstLook(key, () => api.current.firstLook())
      .then((url) => (url !== null && live ? decodes(url).then((ok) => (ok ? url : null)) : null))
      .then((url) => {
        if (live) setShot({ key, url });
      });
    return () => {
      live = false;
    };
  }, [enabled, key]);
  return enabled && shot?.key === key ? shot.url : null;
}
