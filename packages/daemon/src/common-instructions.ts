import { readTurn } from "@colonova-design/protocol";
/**
 * 앱은 실행과 보관·제출을 맡고 개발 방법은 연결 레포가 정한다.
 * 2026-10-20 사용자 요청: 내장 MCP와 공통 개발 정책을 걷어냈다.
 * 불릿은 옛 대화록의 규칙 블록도 걷을 수 있도록 한 줄씩 쓴다.
 */
export const COMMON_INSTRUCTIONS = `# ColoNova Design 공통 규칙

이 규칙은 비개발자가 작업을 요청하고 결과를 확인하는 앱의 역할만 설명한다. 개발 방법은 연결 레포의 지침·스킬·설정을 우선한다.

- 연결 레포에서 작업한다. 코드 구조·의존성·구현·검사 방법은 해당 에이전트가 읽는 레포 지침과 스킬·설정을 따른다.
- 사용자가 요청한 범위를 고친다. 사용자가 찍은 곳과 첨부 자료를 작업 문맥으로 사용한다.
- 읽는 사람은 비개발자다. 한국어로 무엇을 하려는지 짧게 알리고, 작업 뒤에는 달라진 결과와 직접 확인할 것을 쉬운 말로 설명한다. 기술 정보는 요청받았거나 문제를 이해하는 데 필요할 때 설명한다.
- 화면을 고쳤고 그 주소를 알면 답 끝에 [화면 제목](전체 주소) 링크를 남긴다. 제공받은 미리보기 주소를 사용하고, 확인하지 않은 화면이나 검사 결과를 확인했다고 말하지 않는다.
- 보관·되돌리기·푸시·제출은 앱이 맡는다. git 쓰기 명령은 실행하지 않는다. 제출을 요청받으면 화면의 제출 버튼을 안내한다. 사용자에게 명령 실행이나 파일 수정을 시키지 않는다.
- 사용자가 보낸 문서 파일은 읽는 용도로만 쓴다 — 레포에 복사해 남기지 않는다. 그림은 사용자가 화면에 넣어 달라고 한 것만 저장된 경로에서 레포의 에셋 자리로 복사한다.
- 비밀 키·토큰·자격 증명을 불필요하게 읽거나 답변·파일에 남기지 않는다.`;

/**
 * 턴 원문에서 공통 규칙 블록을 떼어낸다 — 제목 · 커밋 제목 같은 "첫 줄"
 * 파생이 규칙 문구를 사용자의 말인 양 삼키는 일을 끊는다 (베타 테스트 #1).
 * 지나는 것은 둘: 상수와 정확히 같은 블록(지금 빌드가 싼 것), 그리고
 * 헤더로 시작하는 줄 걸음(상수가 바뀌기 전 옛 저장본). 남는 것이 없으면
 * 빈 문자열 — 호출자의 "말이 없다" 폴백이 이어받는다.
 */
export function stripCommonInstructions(text: string): string {
  const lines = text.replace(COMMON_INSTRUCTIONS, "").split(/\r?\n/);
  let index = 0;
  while (index < lines.length && lines[index]?.trim() === "") index += 1;
  if (lines[index]?.startsWith("# ColoNova Design 공통 규칙")) {
    index += 1;
    while (index < lines.length) {
      const row = lines[index]?.trim() ?? "";
      // 규칙 블록의 살목: 설명 문단과 불릿들. 그 밖의 첫 줄이 사용자의 말이다.
      if (row === "" || row.startsWith("- ") || row.startsWith("이 규칙은")) {
        index += 1;
        continue;
      }
      break;
    }
  }
  return lines.slice(index).join("\n").trim();
}

/**
 * "첫 줄 = 제목" 파생의 공통 입구 — 표식 줄을 걷어내고(기계가 싼 글자다)
 * 남은 원문의 규칙 블록을 떼어낸 뒤(stripCommonInstructions) 첫 의미 줄을
 * 돌려준다. 표식과 규칙은 사용자의 말이 아니므로, 대화 제목 · 커밋 제목
 * 어느 쪽도 그것으로 이름 지어서는 안 된다 (베타 테스트 #1). 말이 없으면
 * 빈 문자열 — 호출자의 폴백이 이어받는다.
 */
export function meaningfulFirstLine(text: string): string {
  // 첨부 섹션의 여는 줄(`<attachment …>`)도 기계가 싼 글자다 — 그림만 보낸 첫 턴의 제목이 그것이 되지 않게.
  const withoutMarkers = (text ?? "")
    .split(/\r?\n/)
    .filter((row) => !row.trim().startsWith("<!--") && !row.trim().startsWith("<attachment "))
    .join("\n");
  const line = stripCommonInstructions(withoutMarkers)
    .split(/\r?\n/)
    .find((row) => row.trim() !== "");
  return (line ?? "").trim();
}

/**
 * 자동 저장의 커밋 제목 ① — 그 턴을 연 말의 첫 줄. 기계 턴의 마커(`<!-- … -->`)
 * 줄은 제목이 아니므로 건너뛴다: 그 다음 줄이 브리프의 첫 문장이고, 그것이
 * 이 변경의 가장 정직한 한 줄이다. 80자에서 자른다(계획서 P2-1). 빈 객체는
 * "말이 없다" — runSave 의 폴백(② machineMemo → ③ 기본 문구)이 이어받는다.
 * 공통 규칙 블록도 기계가 싼 글자다 — 마커만 건너뛰면 그 다음 줄이 규칙
 * 헤더가 되어 커밋 제목이 앱 안내문이 되는 일이 남는다 (베타 테스트 #1).
 *
 * 단, 마커 다음 줄이 곧 사용자의 말인 것은 아니다. gate · error · brief 는
 * 도구가 제 자신의 기계(화면 확인 · 받아오기 · 저장 게이트 · 복구)를 보고하는
 * 목소리라 사용자의 요청이 그 안에 없다 — 그 첫 문장을 제목에 얹으면
 * "사용자가 가리킨 화면을 도구가 다시 열어 봤습니다…" 가 커밋을 세 개 연달아
 * 적시는 일이 된다(베타 테스트 B2). 이 셋은 말이 없는 턴으로 세고 폴백에
 * 맡긴다. 자동 검사 반영(ci, 2026-10-07)도 같다 — 검사가 한 말이지 사용자의 요청이 아니다.
 * comments(핀) · review(고치기) 는 문장이 곧 요청의 뜻이므로 그대로
 * 제목이 된다 — 대화 제목의 판정(deliver)과 같은 잣대로, 반대 방향만 취한다.
 */
export function turnSubjectOf(text: string | null): { message: string } | Record<string, never> {
  const { marker } = readTurn(text ?? "");
  if (
    marker?.kind === "gate" ||
    marker?.kind === "error" ||
    marker?.kind === "brief" ||
    marker?.kind === "notice" ||
    marker?.kind === "ci"
  )
    return {};
  // 코멘트 반영 턴은 제목이 고정된 모양이다(PLAN-UI U9) — 작업 기록이 이 머리로 센다.
  if (marker?.kind === "review")
    return { message: commentReflectionSubject(firstReviewBody(text ?? "")) };
  const line = meaningfulFirstLine(text ?? "");
  return line ? { message: line.slice(0, 80) } : {};
}

/** 코멘트 반영 커밋 제목의 머리 (PLAN-UI U9 · U14) — 웹의 작업 기록이 이것으로 센다. */
export const COMMENT_REFLECTION_PREFIX = "코멘트 반영 — ";

/**
 * 개발자 코멘트를 반영한 턴의 커밋 제목 — `코멘트 반영 — <첫 코멘트의 글>`.
 * 줄바꿈 · 겹친 공백은 한 칸으로, 80자에서 자른다(사람의 턴 제목과 같은 상한).
 * 글이 비면 `개발자 코멘트` 로 채운다 — 머리만 남은 제목은 읽을 것이 없다.
 */
export function commentReflectionSubject(comment: string): string {
  const words = comment.replace(/\s+/g, " ").trim();
  return `${COMMENT_REFLECTION_PREFIX}${words || "개발자 코멘트"}`.slice(0, 80);
}

/**
 * 반영 턴 본문의 첫 코멘트 글 — reviewToTurn 이 쓰는 `1. <작성자> (#<id>)[ (<자리>)]: <글>`
 * 줄에서. 모양이 다르면 빈 문자열(제목은 폴백 말로 선다).
 */
function firstReviewBody(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const match = /^1\. \S+ \(#\d+\)(?: \([^)]*\))?: (.*)$/.exec(line.trim());
    if (match) return match[1] ?? "";
  }
  return "";
}
