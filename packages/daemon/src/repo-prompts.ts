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
/** 넘기기 제목·본문의 길이 상한 — 본문은 레포 템플릿의 섹션을 채우면 2,000자를 넘어 3,000자로(2026-10-13). */
export const HANDOFF_TITLE_MAX_CHARS = 72;
export const HANDOFF_BODY_MAX_CHARS = 3_000;
/** 레포의 PR 템플릿을 초안 프롬프트에 싣는 글자 상한 — 안내 주석이 긴 템플릿이 diff 자리를 밀어내지 않게. */
export const HANDOFF_TEMPLATE_MAX_CHARS = 3_000;
/**
 * 레포에 PR 템플릿이 없을 때의 본문 뼈대 — 조직 공통 템플릿(colosseumcoinckr/.github 의 PULL_REQUEST_TEMPLATE.md ·
 * CONTRIBUTING.md 「PR 본문은 조직 공통 템플릿(Summary · Changes · Test plan · 영향 범위)을 채웁니다」, 2026-10-13
 * 조직 레포 분석). API 로 여는 PR 에는 GitHub 이 템플릿을 넣어 주지 않으므로 도구가 같은 뼈대를 준다.
 */
export const DEFAULT_PR_SKELETON = [
  "## Summary",
  "",
  "## Changes",
  "",
  "## Test plan",
  "",
  "## 영향 범위",
].join("\n");
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
 * The save-time memo's whole instruction (비개발자 저장): one Korean line
 * that can stand alone as a commit subject — no file-name lists, no
 * quoting, nothing but the line. 계획(describe_changes)의 커밋과 같은
 * `type: 변경` 꼴이다(2026-10-13 실사용자 피드백) — 폴백 커밋 하나가 기록에서
 * 다른 말투로 서지 않게. The diff is the only thing this turn may read, so
 * it rides in the prompt, exactly like the summary's.
 */
export function memoPrompt(files: DiffFile[]): string {
  return [
    "아래 변경 내용이 보관(커밋)됩니다. 커밋 제목으로 쓸 한국어 한 줄을 적어 주세요.",
    "규칙: 한 줄만 답하고 `type: 변경` 꼴로 씁니다. type 은 feat(기능) · fix(오류) · refactor(구조) · style(코드 서식) · docs(문서) · test(시험) · chore(그 밖) 중 실제 변경에 맞는 하나(화면의 기능이나 배치를 바꿨으면 feat)이고, 변경은 바뀐 결과를 명사형으로 끝맺은 40자 안팎의 한 줄입니다. 따옴표 · 목록 기호 · 파일 이름 나열 · 줄표(—)는 쓰지 않습니다. 예: feat: 회원 관리 화면 추가",
    "",
    `바뀐 화면·파일: ${files.map((file) => file.path).join(", ")}`,
    "",
    files.map(renderSummaryFile).join("\n"),
  ].join("\n");
}

/** 템플릿을 상한에서 닫는다 — 생략 사실은 밝힌다(diff 와 같은 잣대). */
function clipTemplate(template: string): string {
  const chars = Array.from(template);
  if (chars.length <= HANDOFF_TEMPLATE_MAX_CHARS) return template;
  return `${chars.slice(0, HANDOFF_TEMPLATE_MAX_CHARS).join("").trimEnd()}\n(템플릿의 나머지는 생략했습니다)`;
}

/**
 * 개발자가 읽는 PR 초안 — 조직 레포의 PR 과 같은 모양으로(2026-10-13 조직 레포 분석: 접근 가능한 20개 레포의
 * 커밋 1,723건 · PR 1,153건과 `colo_global_ui/docs/rules/pull-request/` · `cgs-frontend/docs/rules/process/
 * writing-rule.md`). 제목은 `type: 변경`(scope 는 티켓 자리라 쓰지 않는다 — Jira 는 사용자 결정으로 제외) 을
 * 명사형으로 끝맺고, 본문은 레포의 PR 템플릿(없으면 조직 공통 뼈대)의 섹션을 그대로 채운다. 사이클의 커밋
 * 제목이 변경 단위의 뼈대고(`type:` 없는 줄은 요청 문장이나 작업 기록이라 배경일 뿐), 실제로 남은 변경은 최종
 * diff 로 확인한다. 문장은 조직 글쓰기 규칙대로 — 결론부터, 한 문장에 한 사실, 수식어 · 번역투 · 자기 언급 ·
 * 줄표 없이, 비개발자가 읽어도 이해되게. 지시문 자체도 줄표를 쓰지 않는다 — 모델은 지시문의 말투를 따라
 * 쓴다. diff 와 템플릿은 상한 안에서만 싣는다. 초안은 15초 안에 나와야 하므로 본문은 한 화면 분량이다.
 */
export function handoffPrompt(
  memos: string[],
  files: string[],
  diff: DiffFile[] = [],
  template: string | null = null,
): string {
  const skeleton = template?.trim() ? clipTemplate(template.trim()) : DEFAULT_PR_SKELETON;
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
    "같은 팀 동료에게 리뷰를 부탁하는 PR 제목과 본문을 한국어로 씁니다. 결과만 출력합니다.",
    `첫 줄은 제목입니다. \`type: 변경\` 꼴로 ${HANDOFF_TITLE_MAX_CHARS}자 이내, 되도록 40자 안팎으로 쓰고 scope 괄호는 쓰지 않습니다. type 은 feat(기능 추가) · fix(오류 수정) · refactor(동작이 같은 구조 변경) · style(코드 서식) · docs(문서) · test(테스트) · chore(그 밖) 중 실제 변경에 맞는 하나이고, 화면의 기능이나 배치를 바꾼 것은 style 이나 chore 가 아니라 feat 입니다.`,
    "제목은 이번 요청의 목적 하나를 바뀐 결과로, 명사형으로 끝맺어 씁니다. 좋은 예: fix: 출고 시작 버튼이 선택한 언어로 표시되도록 수정. 나쁜 예: fix: useTranslation 적용 및 StartButton maxWidth 수정. 끝이 다 · 게 · 요 로 끝나면 고칩니다. 프로젝트 이름 · 따옴표 · 'PR 제목:' 같은 머리는 붙이지 않습니다.",
    "빈 줄 뒤의 본문은 아래 PR 템플릿의 섹션 머리와 순서를 그대로 씁니다. 템플릿의 HTML 주석(<!-- -->)은 쓰는 사람에게 주는 안내이니 출력하지 않습니다. 해당 없는 섹션은 비워 두지 말고 섹션째 지웁니다. Jira · Confluence · Figma · 티켓 같은 링크 자리는 모르면 줄째 지우고 지어내지 않습니다.",
    "섹션을 채우는 법: 배경 · 요약 자리(Summary · Context · Background · 설명)에는 왜 바꿨는지와 그래서 누구의 무엇이 나아지는지를 한두 문장으로 씁니다. 변경 자리(Changes · What's Changed · 변경 사항)에는 아래 커밋 제목의 차례대로 커밋 하나에 한 줄씩, 되도록 5줄 안으로 쓰고 오탈자 · 서식 · import 정리는 적지 않습니다. 영향 자리(Impact · 영향 범위)에는 사용자 · 운영에 미치는 영향을 한두 줄로, 없으면 없음이라고 씁니다. 확인 자리(Testing · Test plan · How to Test · 검증)에는 리뷰어가 화면에서 확인할 방법을 적고, 돌리지 않은 테스트를 돌렸다고 쓰지 않습니다. 자동 확인 결과는 도구가 따로 붙입니다. 그 밖의 섹션(Notes · Root Cause · Refactor · Flow · Scope)은 자료에 근거가 있을 때만 채우고 아니면 지웁니다.",
    "문장은 같은 팀 동료가 쓴 것처럼 담백한 합니다체로, 한 문장에 한 사실, 결론부터 씁니다. 비개발자(기획 · QA)가 읽어도 이해되게 쓰고 컴포넌트 이름 · 훅 이름 · API 경로는 적지 않습니다. 매우 · 깔끔하게 · 성공적으로 · 효율적으로 · 다양한 같은 수식어, ~에 대해 · ~되어진다 · ~하는 것이 가능하다 같은 번역투, '이 PR 은' · 'AI' · '도구' 같은 자기 언급, 이모지 · 굵은 글씨 · 인사말, 줄표(—)와 하이픈 두 개(--)를 쓰지 않습니다. 줄표 자리는 콜론이나 문장 나누기로 대신합니다. 요청형('해 줘')은 완료된 변경으로 옮기되 근거 없는 효과나 이유를 만들지 않습니다.",
    "커밋 제목 중 `type:` 으로 시작하는 줄이 변경 단위이고, 그렇지 않은 줄은 요청 문장이나 작업 기록이라 배경일 뿐 구현의 증거가 아닙니다. 실제 변경은 최종 diff 로 확인하고, 되돌린 변경은 빼며, diff 가 없거나 생략된 부분은 단정하지 않습니다. 테스트 실행 · 통과, 화면 확인, 배포는 실제 확인 결과가 자료에 있을 때만 적고, 요청 문장이나 코드 변경만으로 완료했다고 쓰지 않습니다. 본문은 한 화면에 들어오게 짧게 씁니다. 파일 목록은 도구가 따로 붙이므로 적지 않습니다.",
    "",
    "PR 템플릿:",
    skeleton,
    "",
    "이 요청의 커밋 제목 (오래된 것부터):",
    ...memos.map((memo) => `- ${memo}`),
    "",
    "바뀐 파일:",
    ...files,
    "",
    "최종 diff:",
    ...(changes.length > 0 ? changes : ["(내용을 읽지 못했습니다)"]),
  ].join("\n");
}
