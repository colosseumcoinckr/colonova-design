/**
 * 더블클릭으로 연 초대 파일(2026-10-08 베타 준비 분석)을 가져오기 흐름에 넣는 순수 부분. 데스크톱의 메인이 판정을 통과시킨
 * 파일의 이름 · 경로 · 바이트를 건네면(`invite.takeOpened`) 여기서 `File` 로 만들어 끌어 놓은 파일과 같은 길
 * (`useInviteImport` 의 `takeFile`)로 보낸다 — 같은 확인 카드 · 같은 오류 문장 · 같은 `파일 지우기`.
 * 렌더러는 경로를 읽지 않는다: 바이트는 메인이 읽어 준 것이고, 경로는 `파일 지우기` 가 쓰려고 함께 온 값이다.
 */

/** 메인이 건네는 한 건(`packages/desktop/src/invite-open.ts` 의 `OpenedInvite`)의 웹 쪽 모양. */
export interface OpenedInviteEntry {
  name: string;
  path: string;
  /** 메인이 읽지 못했으면 null — 빈 파일이 되어 내용 문이 `읽지 못했어요` 로 말한다. */
  bytes: Uint8Array | ArrayBuffer | null;
}

/** 가져오기 흐름에 넣을 한 장 — `path` 는 가져온 뒤 `파일 지우기` 가 쓴다. */
export interface OpenedInviteFile {
  file: File;
  path: string;
}

/** 파일 이름의 상한 — 운영체제의 한 이름 길이(255)다. 이보다 긴 이름은 메인이 건넨 것이 아니다. */
const NAME_MAX = 255;

/**
 * 건너온 한 건을 `File` 로 — 모양이 어긋나면 null(버린다). 메인이 이미 판정을 했지만 렌더러도 모양은 본다.
 * 이름의 확장자 문(`.colonova-invite`)은 `readInviteFile` 이 그대로 지킨다.
 */
export function openedInviteFile(entry: unknown): OpenedInviteFile | null {
  if (!entry || typeof entry !== "object") return null;
  const { name, path, bytes } = entry as Record<string, unknown>;
  if (typeof name !== "string" || name === "" || name.length > NAME_MAX) return null;
  if (typeof path !== "string" || path === "") return null;
  const parts: BlobPart[] = [];
  if (bytes instanceof Uint8Array || bytes instanceof ArrayBuffer) {
    parts.push(new Uint8Array(bytes));
  }
  return { file: new File(parts, name), path };
}

/** `takeOpened` 의 답(배열) 전체를 파일로 — 배열이 아니거나 어긋난 건은 버린다. */
export function openedInviteFiles(list: unknown): OpenedInviteFile[] {
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const opened = openedInviteFile(entry);
    return opened ? [opened] : [];
  });
}

/**
 * 줄에서 지금 꺼낼 한 장 — 가져오기 카드가 닫혀 있고(`idle`) 첫 상태가 온 뒤에만 앞의 한 장을 꺼낸다. 까닭 둘:
 * (1) 카드가 열려 있는 동안 도착한 파일은 그 카드가 끝난 뒤 이어서 연다(끌어 놓기는 열린 카드를 덮지만 OS 가 건넨
 * 파일은 이미 줄에서 빠져나와 다시 올 곳이 없다). (2) 첫 상태(hello)가 오기 전의 프로젝트 목록은 비어 있어, 그때 읽으면
 * 프로젝트가 있는 기계도 첫 실행으로 판정한다. 꺼낸 뒤에도 남은 것은 다음 `idle` 에서 하나씩.
 */
export function nextOpenedInvite<T>(
  queue: readonly T[],
  phase: string,
  statusLoaded: boolean,
): { next: T | null; rest: T[] } {
  if (phase !== "idle" || !statusLoaded || queue.length === 0) {
    return { next: null, rest: [...queue] };
  }
  const [next, ...rest] = queue;
  return { next: next as T, rest };
}
