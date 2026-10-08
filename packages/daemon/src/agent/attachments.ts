import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { type ChatEvent, readTurn } from "@colonova-design/protocol";

/**
 * 첨부의 드라이버 공통 준비 (혼합 첨부). 어떤 SDK 도 임의 바이너리 콘텐츠
 * 블록은 받지 않으므로, 첨부는 세 갈래로 나뉜다:
 *
 * - `image/*` → 비전 블록 (각 드라이버의 기존 경로). 사용자가 고른 그림은 디스크에도
 *   적고 경로를 말로 건넨다(2026-10-07 베타 준비 분석) — AI 는 그림을 볼 수는 있어도 파일을
 *   줄 수 없어서 `이 로고로 바꿔 줘` 가 안 됐다. 보기는 보기대로 비전 블록이 맡는다.
 * - 디코드되는 텍스트 → 턴의 말에 인라인 섹션으로.
 * - 그 밖의 것(PDF·zip·대용량 텍스트) → 디스크에 적고 경로를 말로 건넨다.
 *   에이전트는 어차피 파일 도구를 갖고 있으므로 이 길이 전 프로바이더에서
 *   동작한다.
 */

/** 인라인으로 실을 수 있는 텍스트 첨부의 상한 — 넘으면 머리를 이 만큼만 실고
 * 나머지는 디스크로 간다(잘렸다는 표식과 함께, 아래 참조). */
const MAX_INLINE_BYTES = 256 * 1024;
/** 디스크에 적은 첨부의 수명 — 다음 적을 때 함께 거둔다. */
const STAGED_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface TurnAttachment {
  name: string;
  mediaType: string;
  /** base64, without the data-url prefix. */
  data: string;
}

export interface PreparedAttachments {
  /** Vision blocks, in attach order — each driver maps these to its own shape. */
  images: TurnAttachment[];
  /**
   * Text sections to append to the turn's words: inlined text files and
   * the disk paths of staged binaries and pictures, one `<attachment>` block each.
   * A staged picture also stays in `images` — seeing and copying are separate.
   */
  sections: string[];
}

/**
 * 디스크에 놓은 그림에 붙는 한 문장(AI 가 읽는다, 2026-10-07 베타 준비 분석). 공통 규칙의 「문서 파일은
 * 레포에 복사해 남기지 않는다」 와 부딪히지 않게 복사는 사용자가 화면에 쓰라고 한 때만이다.
 */
const IMAGE_STAGED_NOTE =
  "이 이미지는 이 경로에 저장됐어요 — 사용자가 화면에 넣어 달라고 하면 이 파일을 레포의 에셋 자리로 복사해 쓰세요.";
/** 핀의 크롭(`pin-<id>.jpg`)은 카드의 썸네일 재료지 사용자가 고른 그림이 아니다. */
const PIN_CROP_NAME = /^pin-[\w-]+\.jpe?g$/i;

/** NUL 이 없고 UTF-8 로 온전히 디코드되는 것만 텍스트다 — PDF 의 %PDF 머리도 NUL 을 품는다. */
function looksText(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * 첨부가 놓이는 곳. git 저장소라면 `.git` 안 — git status 가 보지 않는
 * 유일한 작업실 내부 공간이다(워크트리의 `.git` 파일은 파일이므로 폴백으로).
 * 그 밖의 cwd 는 숨김 `.colonova-design/` 아래.
 */
function attachmentDir(cwd: string): string {
  try {
    const git = join(cwd, ".git");
    if (statSync(git).isDirectory()) return join(git, "colonova-design-attachments");
  } catch {
    // .git 이 없거나 읽을 수 없다 — 폴백으로.
  }
  return join(cwd, ".colonova-design", "attachments");
}

/** 파일명은 계획자가 붙인 이름을 닮되 경로 밖의 문자는 걸러낸다. */
function safeName(name: string): string {
  const cleaned = basename(name)
    .replace(/[^\w.\-가-힣]/gu, "_")
    .slice(0, 80);
  return cleaned || "attachment";
}

/** 지난 첨부를 거둔다 — 실패는 다음 적기로 미룬다(첨부 하나가 쓸모를 다한 뒤의 청소일 뿐). */
function prune(dir: string): void {
  try {
    const cutoff = Date.now() - STAGED_TTL_MS;
    for (const entry of readdirSync(dir)) {
      try {
        if (statSync(join(dir, entry)).mtimeMs < cutoff) rmSync(join(dir, entry), { force: true });
      } catch {
        // 한 파일의 청소 실패가 첨부 전체를 막지는 않는다.
      }
    }
  } catch {
    // 디렉터리 자체를 읽지 못하면 거둘 것도 없다.
  }
}

/**
 * 지난 첨부를 지금 거둔다 — 거둠은 다음 첨부를 적을 때 돌므로, 첨부가 더
 * 오지 않는 클론에는 7일이 지나도 남는다. 감독자의 위생(PLAN 단계 9)이 하루
 * 한 번 부른다.
 */
export function pruneStagedAttachments(cwd: string): void {
  prune(attachmentDir(cwd));
}

/** 적은 순서의 번호 — 같은 밀리초에 같은 이름(붙여넣은 그림은 모두 `image.png`)이 와도 덮어쓰지 않는다. */
let stagedSeq = 0;

/** 바이너리 첨부를 디스크에 적고 절대 경로를 돌려준다. */
function stage(cwd: string, name: string, bytes: Buffer): string {
  const dir = attachmentDir(cwd);
  mkdirSync(dir, { recursive: true });
  prune(dir);
  stagedSeq += 1;
  const path = join(dir, `${Date.now()}-${stagedSeq}-${safeName(name)}`);
  writeFileSync(path, bytes);
  return path;
}

/**
 * 기계가 쓴 턴(화면 확인 · 오류 · 브리프 …)이 실은 그림은 화면의 사진이라 보기만 한다. 사용자가 고른 그림은
 * 사용자의 턴과 핀 턴(`comments` — 핀 옆에 새 로고를 붙이는 쓰임)에 실린다.
 */
function machineVoice(turnText: string | undefined): boolean {
  const kind = readTurn(turnText ?? "").marker?.kind;
  return kind !== undefined && kind !== "comments";
}

/**
 * 그림을 디스크에도 놓고 경로 섹션을 돌려준다. 못 놓으면 null — 비전 블록은 그대로 가므로 그림이 사라지지는
 * 않는다(문서 첨부와 달리 파일 하나 못 적었다고 턴을 막지 않는다).
 */
function stageImage(cwd: string, attachment: TurnAttachment): string | null {
  try {
    const bytes = Buffer.from(attachment.data, "base64");
    if (bytes.length === 0) return null;
    const path = stage(cwd, attachment.name, bytes);
    const name = attachment.name.replace(/["\r\n]/g, "_");
    return `<attachment name="${name}" type="${attachment.mediaType}" path="${path}">${IMAGE_STAGED_NOTE}</attachment>`;
  } catch {
    return null;
  }
}

/**
 * 첨부 목록을 비전 블록과 말 섹션으로 나눈다. 순서는 붙인 순서대로 —
 * 계획자가 나열한 것이 에이전트가 읽는 것이다. `turnText` 는 이 첨부가 실리는 턴의 말 —
 * 기계가 쓴 턴의 그림(화면 사진)과 핀의 크롭은 디스크에 놓지 않고 보기만 한다.
 */
export function prepareAttachments(
  cwd: string,
  attachments: TurnAttachment[] | undefined,
  turnText?: string,
): PreparedAttachments {
  const images: TurnAttachment[] = [];
  const sections: string[] = [];
  const keepPictures = !machineVoice(turnText);
  for (const attachment of attachments ?? []) {
    if (attachment.mediaType.startsWith("image/")) {
      images.push(attachment);
      if (keepPictures && !PIN_CROP_NAME.test(attachment.name)) {
        const section = stageImage(cwd, attachment);
        if (section !== null) sections.push(section);
      }
      continue;
    }
    const bytes = Buffer.from(attachment.data, "base64");
    const type = attachment.mediaType || "application/octet-stream";
    if (looksText(bytes)) {
      if (bytes.length <= MAX_INLINE_BYTES) {
        sections.push(
          `<attachment name="${attachment.name}" type="${type}">\n${bytes.toString("utf8")}\n</attachment>`,
        );
        continue;
      }
      // 텍스트가 예산을 넘으면 통째로 디스크행 대신 머리를 실는다 — ZCode
      // resultBudget 의 truncate 전략: 잘렸다는 표식과 전체 크기를 함께 주면
      // 모델이 스스로 path 의 파일을 열어 이어 읽는다("전부 못 보았다"와
      // "앞은 보았고 더 있다"는 다른 턴 값이다). 바이트 단위로 자르므로 경계의
      // 한 글자가 UTF-8 로 쪼개질 수 있다 — 끝의 U+FFFD 하나뿐이다.
      const path = stage(cwd, attachment.name, bytes);
      const head = bytes.subarray(0, MAX_INLINE_BYTES).toString("utf8");
      sections.push(
        `<attachment name="${attachment.name}" type="${type}" path="${path}" originalBytes="${bytes.length}">\n${head}\n</attachment>\n[첨부가 길어 앞부분만 실었다 — 전체 ${bytes.length}바이트 중 앞 ${MAX_INLINE_BYTES}바이트. 나머지는 path 의 파일을 파일 도구로 이어 읽을 수 있다.]`,
      );
      continue;
    }
    const path = stage(cwd, attachment.name, bytes);
    sections.push(
      `<attachment name="${attachment.name}" type="${type}" path="${path}">첨부 파일이 이 경로에 저장됐습니다 — 파일 도구로 읽어 주세요.</attachment>`,
    );
  }
  return { images, sections };
}

/** 턴의 말과 첨부 섹션을 한 문장으로 합친다 — 첨부만 있는 턴도 말이 비지 않는다. */
export function composeTurnText(text: string, prepared: PreparedAttachments): string {
  if (prepared.sections.length === 0) return text;
  const body = prepared.sections.join("\n\n");
  return text.trim() === "" ? body : `${text}\n\n${body}`;
}

// ---------------------------------------------------------------------------
// 다시 연 대화의 재생 — 섹션을 사용자의 말에서 걷는다 (2026-10-08 검토 · F10)
// ---------------------------------------------------------------------------

/** 섹션의 여는 말 — 싣는 쪽(`prepareAttachments`)과 걷는 쪽이 같은 모양을 읽는다. */
const SECTION_HEAD = '<attachment name="';
const SECTION_CLOSE = "</attachment>";
/** 섹션과 섹션 사이 — `composeTurnText` 가 `\n\n` 으로 이어 붙인다. */
const SECTION_GAP = `\n\n${SECTION_HEAD}`;
/** 길어서 잘린 텍스트 첨부의 닫는 태그 뒤에 따라붙는 한 줄의 머리. */
const TRUNCATION_NOTE = "\n[첨부가 길어 앞부분만 실었다 — ";

/** 한 줄짜리 섹션(그림 · 바이너리)의 끝 — 여는 태그와 같은 줄에서 닫혀야 한다. 못 읽으면 null. */
function singleLineEnd(text: string, from: number): number | null {
  const newline = text.indexOf("\n", from);
  const end = newline === -1 ? text.length : newline;
  return text.slice(from, end).endsWith(SECTION_CLOSE) ? end : null;
}

/**
 * 여러 줄 섹션(텍스트 첨부)의 끝. 본문은 사용자의 파일이라 `</attachment>` 가 그 안에 있을 수 있다 — 닫는 태그
 * 뒤에 글이 끝나거나, 잘림 표식 한 줄 뒤에 글이 끝나거나, 다음 섹션이 이어질 때만 섹션의 끝으로 읽는다.
 */
function multiLineEnd(text: string, from: number): number | null {
  const closing = `\n${SECTION_CLOSE}`;
  let close = text.indexOf(closing, from);
  while (close !== -1) {
    let end = close + closing.length;
    if (text.startsWith(TRUNCATION_NOTE, end)) {
      const newline = text.indexOf("\n", end + 1);
      end = newline === -1 ? text.length : newline;
    }
    if (end === text.length || text.startsWith(SECTION_GAP, end)) return end;
    close = text.indexOf(closing, close + 1);
  }
  return null;
}

/**
 * 여는 태그 하나 — `<attachment name="…" type="…" [path="…"] [originalBytes="…"]>`. 못 읽으면 null. 한 줄 안에서만
 * 찾고 낱말마다 `indexOf` 로 한 번씩만 훑는다(되돌아가는 정규식은 긴 줄에서 제곱으로 느려진다).
 */
function readOpenTag(text: string, at: number): { name: string; type: string; end: number } | null {
  const newline = text.indexOf("\n", at);
  const lineEnd = newline === -1 ? text.length : newline;
  const nameFrom = at + SECTION_HEAD.length;
  const typeMark = text.indexOf('" type="', nameFrom);
  if (typeMark === -1 || typeMark >= lineEnd) return null;
  const typeFrom = typeMark + '" type="'.length;
  const typeEnd = text.indexOf('"', typeFrom);
  if (typeEnd === -1 || typeEnd >= lineEnd) return null;
  let cursor = typeEnd + 1;
  if (text.startsWith(' path="', cursor)) {
    // 경로에도 따옴표가 들 수 있다 — 뒤에 `>` 나 ` originalBytes=` 가 이어지는 닫는 따옴표를 찾는다.
    let quote = text.indexOf('"', cursor + ' path="'.length);
    while (
      quote !== -1 &&
      quote < lineEnd &&
      text[quote + 1] !== ">" &&
      !text.startsWith(' originalBytes="', quote + 1)
    ) {
      quote = text.indexOf('"', quote + 1);
    }
    if (quote === -1 || quote >= lineEnd) return null;
    cursor = quote + 1;
  }
  if (text.startsWith(' originalBytes="', cursor)) {
    const digitsFrom = cursor + ' originalBytes="'.length;
    let digitsEnd = digitsFrom;
    while (digitsEnd < lineEnd && /[0-9]/.test(text[digitsEnd] ?? "")) digitsEnd += 1;
    if (digitsEnd === digitsFrom || text[digitsEnd] !== '"') return null;
    cursor = digitsEnd + 1;
  }
  if (text[cursor] !== ">") return null;
  return {
    name: text.slice(nameFrom, typeMark),
    type: text.slice(typeFrom, typeEnd),
    end: cursor + 1,
  };
}

/** `from` 에서 시작해 글 끝까지 섹션으로만 이루어졌으면 그 섹션들(이름 · 종류)을, 아니면 null. */
function readSections(text: string, from: number): Array<{ name: string; type: string }> | null {
  const sections: Array<{ name: string; type: string }> = [];
  let at = from;
  for (;;) {
    const open = readOpenTag(text, at);
    if (open === null) return null;
    sections.push({ name: open.name, type: open.type });
    const end = text.startsWith("\n", open.end)
      ? multiLineEnd(text, open.end)
      : singleLineEnd(text, open.end);
    if (end === null) return null;
    if (end === text.length) return sections;
    if (!text.startsWith(SECTION_GAP, end)) return null;
    at = end + 2;
  }
}

/** 글이 섹션의 끝맺음(`</attachment>` 또는 잘림 안내 한 줄)으로 끝나는가 — 아니면 섹션 덩이가 있을 수 없다. */
function endsLikeSections(text: string): boolean {
  if (text.endsWith(SECTION_CLOSE)) return true;
  const note = text.lastIndexOf(TRUNCATION_NOTE);
  return (
    note >= SECTION_CLOSE.length &&
    text.startsWith(SECTION_CLOSE, note - SECTION_CLOSE.length) &&
    text.indexOf("\n", note + 1) === -1
  );
}

/** 섹션 덩이의 시작으로 따져 볼 자리의 수 — 말 속의 태그 모양 글이 아무리 많아도 훑는 일이 제한된다. */
const MAX_CANDIDATES = 64;

export interface StrippedAttachments {
  /** 섹션을 걷어 낸, 사용자가 쓴 글(보던 화면 줄은 따로 뗀다). */
  text: string;
  /** 그림 섹션의 수. */
  images: number;
  /** 그림이 아닌 첨부의 이름 — 섹션의 차례대로. */
  files: string[];
}

/**
 * 벤더 대화록은 AI 가 받은 글 그대로라 말 끝에 `<attachment …>` 섹션들이 남는다 — 사용자의 말이 아니다.
 * 섹션은 늘 글의 맨 끝에 `\n\n` 으로 이어 붙으므로(`composeTurnText`), 빈 줄 뒤에서 시작해 **글 끝까지** 섹션으로만
 * 이루어진 덩이만 떼어 낸다 — 사용자가 말 속에 쓴 `<attachment …>` · `</attachment>` 글은 뒤에 말이 이어지므로 남는다.
 */
export function stripAttachmentSections(text: string): StrippedAttachments {
  if (!endsLikeSections(text)) return { text, images: 0, files: [] };
  let from = text.indexOf(SECTION_HEAD);
  for (let tried = 0; from !== -1 && tried < MAX_CANDIDATES; tried += 1) {
    if (from === 0 || (from >= 2 && text.startsWith("\n\n", from - 2))) {
      const sections = readSections(text, from);
      if (sections !== null) {
        return {
          text: from === 0 ? "" : text.slice(0, from - 2),
          images: sections.filter((section) => section.type.startsWith("image/")).length,
          files: sections
            .filter((section) => !section.type.startsWith("image/"))
            .map((section) => section.name),
        };
      }
    }
    from = text.indexOf(SECTION_HEAD, from + 1);
  }
  return { text, images: 0, files: [] };
}

/**
 * 다시 연 대화의 재생에서 사용자 말의 첨부 섹션을 뗀다 — 경로와 안내 문장이 말풍선과 내보낸 글에 사용자의 말처럼
 * 서지 않게. 섹션이 말하던 첨부는 라이브 에코와 같은 칸으로 말한다: 그림은 `images`(벤더가 센 비전 블록이 더 많으면
 * 그 수), 그 밖은 `files` 의 이름. 보던 화면 꼬리(`stripReplayedViewing`)와 같은 자리에서 부른다.
 */
export function stripReplayedAttachments(events: ChatEvent[]): ChatEvent[] {
  return events.map((event) => {
    if (event.kind !== "user.echo" || !event.text.includes(SECTION_HEAD)) return event;
    const stripped = stripAttachmentSections(event.text);
    if (stripped.text === event.text) return event;
    return {
      ...event,
      text: stripped.text,
      images: Math.max(event.images, stripped.images),
      ...(stripped.files.length > 0 ? { files: [...(event.files ?? []), ...stripped.files] } : {}),
    };
  });
}
