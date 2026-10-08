/**
 * 비밀 모양 낱말의 한 곳(2026-10-08 검토 FIX1). 데몬 로그(`daemon/src/log.ts` 의 `sanitizeText`)와 웹의 진단
 * 복사 글(`web/src/next/lib/diagnostics-text.ts` 의 `scrubText`)이 같은 규칙을 읽는다 — 따로 두면 두 면이
 * 갈라진다(`tool-names.ts` 와 같은 이유). 따로 있을 때 웹은 데몬이 아는 접두(`rk-` · `AKIA` · 슬랙 웹훅)를
 * 몰랐고, 둘 다 GitHub 의 `gho_` · `ghs_` · `ghu_` · `ghr_` 와 GitLab 의 `glpat-` · npm 의 `npm_` 를 몰랐다.
 *
 * 걸러내는 쪽은 협조적인 실수를 막는 마지막 방어다 — 로그 · 오류 문장이 SDK · git · GitHub 을 지나오며 토큰을
 * 그대로 실어 올 때 눌러 닫는다. 낱말 경계는 따지지 않는다(토큰이 다른 글자에 붙어 와도 가린다) — 지나치게
 * 가리는 쪽이 새는 쪽보다 싸다. 대신 접두가 흔한 낱말과 겹치지 않게 길이 하한을 둔다(`npm_config_…` 같은
 * 환경 변수 이름은 `npm_` 뒤가 20자에 못 미쳐 지난다).
 */

/** 가린 자리에 쓰는 말. */
export const SECRET_PLACEHOLDER = "{secret}";

const SECRET_SHAPES = new RegExp(
  [
    "gh[pousr]_[A-Za-z0-9_]+", // GitHub: ghp_ 개인 · gho_ OAuth · ghu_ 사용자 · ghs_ 설치 · ghr_ 갱신
    "github_pat_[A-Za-z0-9_]{20,}",
    "glpat-[A-Za-z0-9_-]{8,}", // GitLab 개인 토큰
    "npm_[A-Za-z0-9]{20,}", // npm 토큰은 접두 뒤 36자 — 환경 변수 이름(`npm_config_…`)과 겹치지 않는 하한
    "sk-[A-Za-z0-9_-]{8,}",
    "rk-[A-Za-z0-9_-]{8,}",
    "AKIA[0-9A-Z]{16}",
    "AIza[0-9A-Za-z_-]{10,}",
    "xox[bp]-[A-Za-z0-9-]+",
    "hooks\\.slack\\.com\\/services\\/[A-Za-z0-9/]+",
    "Bearer\\s+[A-Za-z0-9._~+/=-]+",
  ].join("|"),
  "g",
);

/**
 * 글 안의 비밀 모양 낱말을 `{secret}` 으로 누른다. `Bearer` 쪽은 어휘를 남긴다(`Bearer {secret}`) —
 * 어떤 종류의 비밀이었는지의 단서다. 비밀이 없으면 글은 그대로다.
 */
export function maskSecretShapes(text: string): string {
  return text.replace(SECRET_SHAPES, (matched) =>
    /^Bearer\s/.test(matched) ? `Bearer ${SECRET_PLACEHOLDER}` : SECRET_PLACEHOLDER,
  );
}
