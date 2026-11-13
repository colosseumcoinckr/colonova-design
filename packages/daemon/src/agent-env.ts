/**
 * 데몬이 띄우는 에이전트 자식의 환경 (PLAN-UI U12). Claude Code 는 스스로
 * 업데이트한다 — 앱의 `업데이트` 줄과 CLI 의 자기 업데이터가 둘 다 돌면 서로
 * 바꾸는 세계가 되므로, 데몬이 띄우는 모든 Claude 자식(세션 · 단답 턴 · 로그인
 * · 설치)에서 자기 업데이트를 끈다.
 */

/** 자기 업데이트를 끈 환경 — 받은 객체는 건드리지 않고 새 객체를 돌려준다. */
export function withoutSelfUpdate(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return { ...env, DISABLE_AUTOUPDATER: "1" };
}

/**
 * 앱의 자격 재정의 키 (credentials.ts 가 읽는 것들). AI 자식과 레포 명령이
 * 데몬의 process.env 를 그대로 물려받으면 셸을 쓰는 화면 AI 나 AI 가 쓴 코드를
 * 실행하는 미리보기 서버가 이 비밀을 읽는다 — 모든 AI 자식과 레포 명령의
 * 환경에서 거른다 (2026-10-23 · 최종 구현 계획 F0).
 */
export const APP_SECRET_ENV_KEYS = [
  "COLONOVA_DESIGN_CONFLUENCE_EMAIL",
  "COLONOVA_DESIGN_CONFLUENCE_TOKEN",
  "COLONOVA_DESIGN_REPO_PAT",
] as const;

/** 앱 비밀 키를 거른 환경 — 받은 객체는 건드리지 않고 delete 로 지운 새 객체를 돌려준다. */
export function withoutAppSecrets(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const copy = { ...env };
  for (const key of APP_SECRET_ENV_KEYS) delete copy[key];
  return copy;
}
