import type { InviteSupport } from "@colonova-design/protocol";

/**
 * 개발팀 창구의 판정(2026-11-12 설계 결정 ㉱) — 초대 파일의 창구 칸을 네 자리
 * (준비 화면의 `개발팀이 끼는 곳` · `막혔나요?` · 설정 → 연결 · 막힘 문장)가
 * 함께 쓰는 순수 모듈이다. 무엇을 보일지를 여기서만 정하고, 문장은 `L.support`
 * 가 맡는다.
 *
 * 창구는 두 곳에서 올 수 있다 — 놓은 초대 파일(가져오기 전의 미리보기)과
 * 이미 저장된 기계 설정(`DaemonStatus.support`). 초대장의 것이 먼저다:
 * 방금 놓은 파일의 창구가 아직 데몬에 저장되지 않았어도 준비 화면이 그
 * 이름을 세운다(`authorName` 을 읽는 것과 같은 두 곳).
 */

/** 판정의 결과 — 어느 변형을 보일지와 링크의 주소. 문장은 화면이 L 에서 꺼낸다. */
export interface SupportView {
  /** 이름만 · 대화방만 · 둘 다 · 주소만. 주소만이면 문장 자리에 `대화방 열기` 하나가 선다. */
  kind: "name" | "room" | "both" | "url";
  name?: string;
  room?: string;
  /** `https://` 주소 — 있으면 자리마다 `대화방 열기` 가 선다. */
  url?: string;
}

type SupportLike = InviteSupport | null | undefined;

/**
 * 창구 판정 — 칸이 있고 보일 것이 하나라도 있으면 그 변형을 돌려준다. 이름 ·
 * 대화방 · 주소가 모두 버려지면(null 과 같게) 아무것도 서지 않는다. 주소는
 * 읽는 쪽(parseSupport)과 같은 판정으로 거른다: `https://` 로 시작하고
 * 300자를 넘지 않는 것만 — 정상 경로(초대 판독 · 데몬 저장)는 이미 걸러진
 * 값이라 손으로 고친 저장값 같은 비정상 입력을 여기서 한 번 더 막는다.
 */
export function supportFor(...candidates: SupportLike[]): SupportView | null {
  const support = candidates.find((item) => item != null) ?? null;
  if (support === null) return null;
  const name = support.name?.trim() || undefined;
  const room = support.room?.trim() || undefined;
  const rawUrl = support.url?.trim();
  const url = rawUrl && rawUrl.length <= 300 && rawUrl.startsWith("https://") ? rawUrl : undefined;
  if (name !== undefined && room !== undefined)
    return { kind: "both", name, room, ...(url ? { url } : {}) };
  if (name !== undefined) return { kind: "name", name, ...(url ? { url } : {}) };
  if (room !== undefined) return { kind: "room", room, ...(url ? { url } : {}) };
  if (url !== undefined) return { kind: "url", url };
  return null;
}
