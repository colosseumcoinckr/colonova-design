import type { DiffFile } from "@colonova-design/protocol";

/**
 * 기계가 쓰는 한 턴짜리 프롬프트들 (PLAN D53): 저장 메모, 넘기기 본문 초안.
 * 둘 다 문자열을 받아 문자열을 내는 순수 함수라 여기 모여 산다 — 프롬프트의
 * 말이 바뀌는 것과 워크스페이스의 절차가 바뀌는 것은 서로 다른 이유로
 * 일어나는 변경이다.
 */

/** 한 파일이 프롬프트에서 차지할 수 있는 글자 — 전면 재작성 하나가 나머지를
 *  밀어내지 않게. */
const SUMMARY_HUNK_CHAR_LIMIT = 4_096;
/** 저장 메모의 길이 상한. */
export const MEMO_MAX_CHARS = 500;
/** 넘기기 초안이 읽는 파일 수의 상한. */
export const HANDOFF_FILE_LIMIT = 60;
/** 넘기기 제목·본문의 길이 상한. */
export const HANDOFF_TITLE_MAX_CHARS = 72;
export const HANDOFF_BODY_MAX_CHARS = 2_000;
/** 짧은 기계 턴에 싣는 최종 diff의 전체 글자 상한. */
const HANDOFF_DIFF_MAX_CHARS = 16_384;

/**
 * The diff as the machine turn reads it: `git diff`-shaped lines, each file
 * capped at SUMMARY_HUNK_CHAR_LIMIT so one wholesale rewrite cannot crowd
 * the rest out of the prompt.
 */
function renderSummaryFile(file: DiffFile): string {
  if (file.binary) return `파일: ${file.path} (바이너리 — 내용 생략)`;
  const lines: string[] = [`파일: ${file.path}`];
  let size = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      const piece =
        line.length > SUMMARY_HUNK_CHAR_LIMIT ? `${line.slice(0, SUMMARY_HUNK_CHAR_LIMIT)}…` : line;
      if (size + piece.length > SUMMARY_HUNK_CHAR_LIMIT) {
        lines.push("(이 파일의 나머지는 생략했습니다)");
        return lines.join("\n");
      }
      size += piece.length;
      lines.push(piece);
    }
  }
  return lines.join("\n");
}

/**
 * The save-time memo's whole instruction (비개발자 저장): one Korean
 * sentence that can stand alone as a commit subject — no file-name lists,
 * no quoting, nothing but the sentence. The diff is the only thing this
 * turn may read, so it rides in the prompt, exactly like the summary's.
 */
export function memoPrompt(files: DiffFile[]): string {
  return [
    "아래 변경 내용이 보관(커밋)됩니다. 보관 메모로 쓸 한국어 한 문장을 적어 주세요.",
    "규칙: 한 줄만 답하고, 따옴표·목록 기호·접두어를 붙이지 않으며, 파일 이름을 나열하지 않습니다. 예: 회원 관리 화면 추가",
    "",
    `바뀐 화면·파일: ${files.map((file) => file.path).join(", ")}`,
    "",
    files.map(renderSummaryFile).join("\n"),
  ].join("\n");
}

/**
 * 개발자가 읽는 PR 초안. 요청 문장인 보관 메모는 배경이고, 실제로 남은
 * 변경은 최종 diff로 확인한다. 제목은 한 목적을 말하고 본문은 그 이유와
 * 결과를 설명한다. diff는 파일별 · 전체 상한 안에서만 싣는다.
 */
export function handoffPrompt(memos: string[], files: string[], diff: DiffFile[] = []): string {
  const changes: string[] = [];
  let remaining = HANDOFF_DIFF_MAX_CHARS;
  for (const file of diff) {
    const piece = `변경 종류: ${file.status}\n${renderSummaryFile(file)}`;
    if (piece.length > remaining) {
      changes.push("(최종 diff의 나머지는 생략했습니다)");
      break;
    }
    changes.push(piece);
    remaining -= piece.length;
  }
  return [
    "동료 개발자에게 리뷰를 부탁하는 PR 제목과 본문을 한국어로 작성하세요. 결과만 출력하세요.",
    `첫 줄은 atomic commit 스타일의 제목: type(scope): 구체적인 변경. 전체 ${HANDOFF_TITLE_MAX_CHARS}자 이내로 쓰고, scope가 불명확하면 type: 변경으로 씁니다.`,
    "type은 feat(기능 추가), fix(오류 수정), refactor(동작을 유지하는 구조 변경), style(코드 서식), docs(문서), test(테스트), chore(그 밖의 유지보수) 중 실제 변경에 맞게 고릅니다. 화면의 기능이나 배치를 바꾼 것을 코드 서식인 style로 분류하지 않습니다.",
    "제목은 이번 PR의 핵심 목적 하나를 짧게 적습니다. 예: feat(members): 회원 목록에 이름 검색 추가 / fix(submit): 중복 제출 방지. 프로젝트 이름, 따옴표, 'PR 제목:' 같은 설명은 붙이지 않습니다.",
    "빈 줄 뒤의 본문은 변경 이유와 결과를 먼저 1~2문장으로 설명하고, 필요하면 구체적인 변경을 2~4개 항목으로 적습니다. 서로 독립적인 변경이 섞였다면 본문에서 구분하고, 하나의 작업인 척 묶지 않습니다.",
    "짧은 PR은 한 문단으로 충분합니다. 검토할 동작이나 제한이 자료에 있을 때만 '### 확인할 점'을 덧붙입니다. 파일 목록은 도구가 별도로 붙이므로 반복하지 않습니다.",
    "사람이 직접 쓴 리뷰 요청처럼 담백하게 씁니다. '본 PR은', '사용자 경험 향상', '개선 및 최적화', '성공적으로 구현'처럼 두루뭉술한 문구 대신 무엇이 어떻게 달라지는지 적습니다. 요청형('해 줘')을 완료된 변경으로 옮기되 근거 없는 효과나 이유를 만들지 않습니다.",
    "보관 메모는 사용자 요청과 중간 작업 기록이며 구현 완료의 증거가 아닙니다. 최종 diff를 우선하고, 되돌린 변경은 제외합니다. diff가 없거나 생략된 부분은 단정하지 않습니다. 테스트 실행·통과, 화면 확인, 배포는 실제 확인 결과가 자료에 있을 때만 적고, 요청 문장이나 코드 변경만으로 완료했다고 쓰지 않습니다.",
    "",
    "보관 메모 (요청과 작업 배경):",
    ...memos.map((memo) => `- ${memo}`),
    "",
    "바뀐 파일:",
    ...files,
    "",
    "최종 diff:",
    ...(changes.length > 0 ? changes : ["(내용을 읽지 못했습니다)"]),
  ].join("\n");
}
