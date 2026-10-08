/**
 * 초대장 사전 점검 — 초대 파일을 만들기 전에 연결 코드와 레포를 GitHub 에 미리 물어 본다
 * (베타 준비 분석 2026-10-07 B0). 개발자가 연결 코드의 권한을 틀리게 만들면 사용자는 첫
 * 제출에서 `연결 코드가 만료돼…` 를 보는데(진짜 이유는 권한 부족) 새 파일을 받아도 같은 문장이
 * 나온다. 그 거짓 증상과 개발자 쪽 함정을 초대장을 만드는 순간 잡는다.
 *
 * 브라우저(site/invite.js)와 Node 22(scripts/make-invite.mjs · 시험)에서 같이 도는 순수 ES
 * 모듈이다(invite-format.mjs 와 같은 결). GitHub 호출은 주입한 `request` 로만 한다:
 *
 *   request(method, path, body?) → Promise<{ status, headers, json }>
 *
 * headers 의 키는 소문자, json 은 읽은 본문(JSON 이 아니면 null)이다. 전송 실패(네트워크 ·
 * 시간 초과)는 throw 해도 된다 — 이 모듈이 `확인할 수 없어요` 로 바꿔 돌려준다.
 *
 * 부작용 0: GET 과, 일부러 검증 단계에서 거절되게 만든 예행 POST 셋만 보낸다 — 없는 브랜치로
 * 풀 리퀘스트 열기 · 없는 객체로 ref 만들기 · 제목 없는 이슈. 권한이 있으면 GitHub 가 검증(422)
 * 에서 거절하고, 세밀한 토큰에 권한이 없으면 그 앞에서 403 `Resource not accessible by
 * personal access token` 으로 거절한다. 어느 쪽이든 PR · 브랜치 · 이슈 · 코멘트는 만들어지지
 * 않는다. 근거와 한계는 docs/DEVELOPERS.md 「초대장 사전 점검」.
 *
 * 결과의 한 줄은 { id, status, text } 이고 status 는 네 가지다 — pass(✅ 통과) · warn(⚠️ 경고) ·
 * fail(⛔ 확정 실패) · unknown(❔ 확인할 수 없음). fail 만 초대 파일 만들기를 막는다.
 * 문장은 개발자가 읽는다(이 사이트는 개발자 화면이라 개발 어휘를 쓴다).
 */

/** 점검 결과의 네 가지 — 표시 기호. */
export const MARK = { pass: "✅", warn: "⚠️", fail: "⛔", unknown: "❔" };
/** 낭독용 이름 — 기호만으로는 읽히지 않는다. */
export const STATUS_LABEL = {
  pass: "통과",
  warn: "경고",
  fail: "막힘",
  unknown: "확인할 수 없음",
};

/**
 * 미리보기 명령이 숨은 스크립트 이름 — packages/daemon/src/repo-config.ts 의 PREVIEW_SCRIPTS 와
 * 같은 후보다(시험이 두 목록을 맞춰 본다).
 */
export const PREVIEW_SCRIPTS = ["dev", "start", "serve", "preview"];
/** 패키지 매니저의 락파일 — repo-config.ts 의 LOCKFILES 와 같은 이름들. */
export const LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "bun.lock"];
/** 환경 변수가 필요해 보이는 견본 파일. */
export const ENV_SAMPLES = [".env.example", ".env.sample"];
/**
 * 앱에 실려 나가는 Node 의 메이저 — 릴리스 워크플로우(desktop-release.yml)의 setup-node 가
 * 고른 것이 번들된다(bundle-runtimes.mjs 는 그 node 실행 파일을 그대로 복사한다). 시험이
 * 워크플로우의 값과 맞는지 본다.
 */
export const BUNDLED_NODE_MAJOR = 24;

/** 점검 한 줄. */
const item = (id, status, text) => ({ id, status, text });

// ---------------------------------------------------------------------------
// 전송 — 실패는 던지지 않고 값으로 돌려준다
// ---------------------------------------------------------------------------

/** headers 의 키를 소문자로 — 주입한 request 가 어떤 모양을 줘도 읽을 수 있게. */
function lowerKeys(headers) {
  const out = {};
  if (headers && typeof headers === "object") {
    for (const [key, value] of Object.entries(headers)) out[String(key).toLowerCase()] = String(value);
  }
  return out;
}

async function ask(request, method, path, body) {
  try {
    const reply = await request(method, path, body);
    const status = Number(reply?.status);
    if (!Number.isFinite(status)) return { status: 0, headers: {}, json: null, failed: true };
    return { status, headers: lowerKeys(reply.headers), json: reply.json ?? null, failed: false };
  } catch {
    return { status: 0, headers: {}, json: null, failed: true };
  }
}

/** GitHub 가 오류 본문에 싣는 message — 없으면 빈 문자열. */
function messageOf(reply) {
  return typeof reply.json?.message === "string" ? reply.json.message : "";
}

/** 한도(1차 · 2차 rate limit)에 걸렸는가 — 403 과 429 둘 다 그렇게 답한다. */
function limitedBy(reply) {
  if (reply.status === 429) return true;
  if (reply.status !== 403) return false;
  return reply.headers["x-ratelimit-remaining"] === "0" || /rate limit|abuse/i.test(messageOf(reply));
}

/** GitHub 의 영어 message 를 개발자가 대조할 수 있게 짧게 덧붙인다. */
function quote(reply) {
  const message = messageOf(reply).replace(/\s+/g, " ").trim();
  return message === "" ? "" : ` (GitHub: ${message.slice(0, 120)})`;
}

/** 전송 실패 · 한도 · 그 밖의 알 수 없는 답 — 어느 점검에서나 같은 `확인할 수 없어요`. */
function unknownItem(id, reply, subject) {
  if (reply.failed) {
    return item(id, "unknown", `GitHub 에 닿지 못해 ${subject} 확인하지 못했어요 — 네트워크를 보고 다시 점검해 주세요`);
  }
  if (limitedBy(reply)) {
    return item(id, "unknown", `GitHub 사용 한도에 걸려 ${subject} 확인하지 못했어요 — 잠시 뒤 다시 점검해 주세요`);
  }
  return item(id, "unknown", `${subject} 확인하지 못했어요 — GitHub 가 ${reply.status} 로 답했어요${quote(reply)}`);
}

// ---------------------------------------------------------------------------
// 주소 · 날짜 · 범위 — 순수한 작은 도우미
// ---------------------------------------------------------------------------

/**
 * GitHub 주소(https · ssh · scp 꼴 · owner/repo 줄임)에서 { owner, repo } — GitHub 가 아니면 null.
 * 점검은 GitHub 레포에만 한다(file:// · 로컬 경로 · 다른 호스트는 건너뛴다).
 */
export function githubRepoOf(url) {
  const text = String(url ?? "").trim();
  const full = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:[^@/]*@)?(?:www\.)?github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(
    text,
  );
  if (full) return { owner: full[1], repo: full[2] };
  const short = /^([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(text);
  return short && !text.includes(":") ? { owner: short[1], repo: short[2] } : null;
}

/** GitHub API 의 기본 주소 — 소개 페이지가 연결 코드를 보내는 진짜 곳. */
export const DEFAULT_API_BASE = "https://api.github.com";

/**
 * 소개 페이지가 연결 코드를 보낼 API 주소 — 기본은 진짜 GitHub 다. 페이지를 127.0.0.1 · localhost 에서
 * 연 개발자만 `?api=` 로 가짜 GitHub 를 겨눌 수 있고(검증하는 길), 그 값은 **루프백 출처**
 * (`http://127.0.0.1:<포트>` · `http://localhost:<포트>`)여야 한다. 그 밖 — 다른 호스트 · https ·
 * 자격 정보(`user@`)가 붙은 주소 · 읽을 수 없는 값 — 은 무시하고 기본을 쓴다. 요청마다
 * `Authorization: Bearer <코드>` 가 이 주소로 가므로 출처를 가리지 않으면 만들어진 링크 하나로 코드가
 * 남의 서버에 간다(2026-10-08 검토 FIX1). 돌려주는 것은 출처뿐이다(경로 · 쿼리는 버린다).
 */
export function apiBaseFor(hostname, requested) {
  if (!/^(127\.0\.0\.1|localhost)$/.test(String(hostname ?? ""))) return DEFAULT_API_BASE;
  if (typeof requested !== "string" || requested === "") return DEFAULT_API_BASE;
  let url;
  try {
    url = new URL(requested);
  } catch {
    return DEFAULT_API_BASE;
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "http:" || !loopback || url.username !== "" || url.password !== "") {
    return DEFAULT_API_BASE;
  }
  return url.origin;
}

/** 클래식 토큰의 범위 —`x-oauth-scopes` 가 있으면 목록(빈 문자열은 빈 목록), 세밀한 토큰은 null. */
export function scopesOf(headers) {
  const raw = lowerKeys(headers)["x-oauth-scopes"];
  if (raw === undefined) return null;
  return raw
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);
}

/** `2026-12-31 00:00:00 UTC` 꼴의 만료 머리글 → epoch ms — 못 읽으면 null. */
function parseExpiry(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const iso = raw.trim().replace(/ UTC$/, "Z").replace(" ", "T");
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : at;
}

/**
 * npm semver 범위(engines.node)가 번들 Node 의 메이저를 받는가 — true · false · null(읽을 수
 * 없다). 마이너 · 패치는 열려 있다고 본다(번들은 그 메이저의 최신이다): 경고가 거짓으로 뜨는
 * 것보다 놓치는 쪽이 낫다. `||` 는 OR, 공백 · 쉼표는 AND, `A - B` 는 구간이다.
 */
export function nodeRangeAllows(range, major = BUNDLED_NODE_MAJOR) {
  if (typeof range !== "string") return null;
  const text = range.trim();
  if (text === "") return true;
  let unreadable = false;
  for (const alternative of text.split("||")) {
    const verdict = alternativeAllows(alternative.trim(), major);
    if (verdict === true) return true;
    if (verdict === null) unreadable = true;
  }
  return unreadable ? null : false;
}

/** `^A.B.C` · `>=A` · `1.x` 같은 비교 한 칸의 값 — { op, major, minor, patch } 또는 null. */
function readComparator(token) {
  const match = /^(>=|<=|>|<|=|\^|~)?v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-[\w.-]+)?$/.exec(token);
  if (!match) return null;
  const num = (value) => (value === undefined || /^[xX*]$/.test(value) ? null : Number(value));
  return { op: match[1] ?? "", major: num(match[2]), minor: num(match[3]), patch: num(match[4]) };
}

function comparatorAllows(parsed, major) {
  const { op, major: want, minor, patch } = parsed;
  if (want === null) return op !== "<"; // `*` · `x` — `<*` 는 말이 안 되지만 막지는 않는다.
  switch (op) {
    case ">=":
      return major >= want;
    case ">":
      // `>24` 는 `>=25.0.0` 이다(부분 버전은 그 안을 다 넘어야 한다) — `>24.1` 은 24.2 가 받는다.
      return minor === null ? major > want : major >= want;
    case "<=":
      return major <= want;
    case "<":
      // `<24.0.0` 은 24.x 의 어떤 버전도 받지 않는다 — 그 밖에는 24.0.0 이 있다.
      return major < want || (major === want && (minor ?? 0) + (patch ?? 0) > 0);
    default:
      // `^` · `~` · 맨 숫자 · `=` — 모두 그 메이저의 안이다(0.x 의 `^` 는 메이저가 0 이라 24 가 아니다).
      return major === want;
  }
}

function alternativeAllows(text, major) {
  if (text === "") return true;
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(text);
  if (hyphen) {
    const low = readComparator(hyphen[1]);
    const high = readComparator(hyphen[2]);
    if (!low || !high || low.major === null || high.major === null) return null;
    return major >= low.major && major <= high.major;
  }
  let unreadable = false;
  for (const token of text.split(/[\s,]+/).filter(Boolean)) {
    const parsed = readComparator(token);
    if (!parsed) {
      unreadable = true;
      continue;
    }
    if (!comparatorAllows(parsed, major)) return false;
  }
  return unreadable ? null : true;
}

/**
 * `.npmrc` 본문에서 설치에 영향을 주는 줄 — 인증 정보(literal 은 값 자체가 비밀이므로 본문을
 * 돌려주지 않고 종류만) · 환경 변수 인증 · 공개가 아닌 레지스트리의 호스트.
 */
export function npmrcFindings(text) {
  const hosts = new Set();
  let literalAuth = false;
  let envAuth = false;
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (/(^|:)_(authToken|auth|password)$/i.test(key)) {
      if (/\$\{[^}]+\}/.test(value)) envAuth = true;
      else if (value !== "") literalAuth = true;
      continue;
    }
    if (/(^|:)registry$/i.test(key)) {
      const host = hostOfRegistry(value);
      if (host !== null && !PUBLIC_REGISTRIES.has(host)) hosts.add(host);
    }
  }
  return { literalAuth, envAuth, hosts: [...hosts] };
}

const PUBLIC_REGISTRIES = new Set(["registry.npmjs.org", "registry.yarnpkg.com", "registry.npmmirror.com"]);

function hostOfRegistry(value) {
  const text = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value.replace(/^\/\//, "")}`;
  try {
    return new URL(text).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** 파일 본문(base64) → 글자 — 브라우저와 Node 22 에 공통인 atob + TextDecoder. */
function decodeContents(json) {
  if (typeof json?.content !== "string" || json.encoding !== "base64") return null;
  try {
    const binary = atob(json.content.replace(/\s/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** 예행 요청이 지나칠 수 없는 이름 · 값 — 요청마다 다른 꼬리를 붙여 실제 가지와 겹치지 않게 한다. */
function nonce() {
  const bytes = new Uint8Array(6);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// 1. 연결 코드 — 유효한가 · 누구의 것인가 · 언제까지인가
// ---------------------------------------------------------------------------

/**
 * GET /user 한 번으로 코드의 주인과 종류와 만료일을 읽는다. 401 은 확정 실패, 그 밖의 알 수
 * 없는 답은 `확인할 수 없어요`다. 돌려주는 login · scopes 는 레포 점검과 리뷰어 점검이 쓴다.
 */
export async function checkToken(request, { now = Date.now() } = {}) {
  const reply = await ask(request, "GET", "/user");
  if (reply.status === 401) {
    return {
      login: null,
      scopes: null,
      items: [
        item(
          "token",
          "fail",
          "연결 코드를 GitHub 가 받아 주지 않아요(401) — 값을 잘못 붙였거나 만료 · 철회된 코드예요. 새로 만들어 주세요",
        ),
      ],
    };
  }
  const login = typeof reply.json?.login === "string" && reply.json.login !== "" ? reply.json.login : null;
  if (reply.status < 200 || reply.status >= 300 || login === null) {
    return { login: null, scopes: null, items: [unknownItem("token", reply, "연결 코드를")] };
  }
  const scopes = scopesOf(reply.headers);
  const kind =
    scopes === null ? "세밀한 코드" : `클래식 코드 · 범위 ${scopes.length > 0 ? scopes.join(", ") : "없음"}`;
  const items = [item("token", "pass", `이 연결 코드는 @${login} 계정의 것이에요 (${kind})`)];
  // 만료일 — 머리글이 없거나(만료 없는 코드) 브라우저가 못 읽으면 말하지 않는다(U17).
  const end = parseExpiry(reply.headers["github-authentication-token-expiration"]);
  if (end !== null) {
    const days = Math.ceil((end - now) / 86_400_000);
    const date = new Date(end);
    const when = `${date.getMonth() + 1}월 ${date.getDate()}일`;
    if (days <= 0) {
      items.push(item("expiry", "fail", "이 연결 코드는 이미 만료됐어요 — 새 코드를 만들어 주세요"));
    } else if (days <= 30) {
      items.push(
        item(
          "expiry",
          "warn",
          `이 연결 코드는 ${when}에 만료돼요(${days}일 남음) — 만료 전에 새 코드로 초대 파일을 다시 보내야 해요. 더 긴 만료일을 권해요`,
        ),
      );
    } else {
      items.push(
        item(
          "expiry",
          "pass",
          `이 연결 코드는 ${when}까지예요(${days}일 남음) — 만료일을 달력에 적어 두세요. 새 초대 파일은 개발자의 일이에요`,
        ),
      );
    }
  }
  return { login, scopes, items };
}

// ---------------------------------------------------------------------------
// 2. 레포 — 닿는가 · 제출을 열 수 있는가 · 올릴 수 있는가 · 알릴 수 있는가 · 루트 점검
// ---------------------------------------------------------------------------

/**
 * 레포 하나를 점검한다 — 부르는 쪽이 token 점검의 login · scopes 를 건넨다. 레포가 보이지
 * 않으면(404 · 403 · 전송 실패) 예행은 보내지 않고 그 한 줄로 끝낸다.
 * 돌려주는 info 는 기본 브랜치(초대의 baseBranch 채우기)와 공개 여부다.
 */
export async function checkRepo(request, { owner, repo, baseBranch, scopes = null, login = null }) {
  const base = `/repos/${owner}/${repo}`;
  const reply = await ask(request, "GET", base);
  const items = [];
  if (reply.status === 404) {
    items.push(
      item(
        "repo",
        "fail",
        `레포가 안 보여요(404) — 주소가 틀렸거나 이 연결 코드가 ${owner}/${repo} 를 못 봐요. 비공개 레포는 GitHub 가 '없음'과 '권한 없음'을 같은 404 로 답해서 둘을 구분할 수 없어요. 주소를 확인하고, 세밀한 코드면 접근할 레포에 이 레포가 들어 있는지 · 조직 승인이 필요한지 봐 주세요`,
      ),
    );
    return { info: null, items };
  }
  if (reply.status === 403 && !limitedBy(reply)) {
    const saml = /saml|sso/i.test(messageOf(reply));
    items.push(
      item(
        "repo",
        "fail",
        saml
          ? `조직의 SSO 승인이 필요해요(403) — 코드 설정에서 이 조직에 Authorize 해 주세요${quote(reply)}`
          : `레포에 접근할 수 없어요(403) — 이 연결 코드에 이 레포의 접근 권한이 없어요${quote(reply)}`,
      ),
    );
    return { info: null, items };
  }
  const data = reply.json;
  if (reply.status !== 200 || typeof data?.full_name !== "string") {
    items.push(unknownItem("repo", reply, "레포를"));
    return { info: null, items };
  }
  const info = {
    fullName: data.full_name,
    private: data.private === true,
    archived: data.archived === true,
    defaultBranch: typeof data.default_branch === "string" && data.default_branch !== "" ? data.default_branch : "main",
    hasIssues: data.has_issues !== false,
    push: typeof data.permissions?.push === "boolean" ? data.permissions.push : null,
  };
  items.push(
    item(
      "repo",
      "pass",
      `레포가 보여요 — ${info.fullName} (${info.private ? "비공개" : "공개"} · 기본 브랜치 ${info.defaultBranch})`,
    ),
  );
  if (info.fullName.toLowerCase() !== `${owner}/${repo}`.toLowerCase()) {
    items.push(
      item("moved", "warn", `이 레포는 ${info.fullName} 로 옮겨졌어요 — 새 주소로 다시 고르는 걸 권해요`),
    );
  }
  if (info.archived) {
    items.push(item("archived", "fail", "보관(archived)된 레포예요 — 읽기 전용이라 제출이 올라가지 못해요"));
    return { info, items };
  }
  // 클래식 코드의 범위 — 쓰려면 repo(공개 레포는 public_repo 도 된다).
  if (scopes !== null && !scopes.includes("repo") && !(info.private === false && scopes.includes("public_repo"))) {
    items.push(
      item(
        "push",
        "fail",
        `클래식 코드에 repo 범위가 없어요 — 이 레포에 쓸 수 없어요(지금 범위: ${scopes.length > 0 ? scopes.join(", ") : "없음"})`,
      ),
    );
    return { info, items };
  }
  if (info.push === false) {
    items.push(
      item(
        "push",
        "fail",
        `이 연결 코드로는 이 레포에 쓸 수 없어요 — ${login ? `@${login} 계정에 쓰기 권한이 없거나, ` : ""}코드에 Contents 쓰기 권한이 없어요. 쓰기 권한이 있는 계정의 코드를 써 주세요`,
      ),
    );
    return { info, items };
  }
  // 기본 브랜치가 아닌 base 를 골랐다면 그 브랜치가 있는지 — 없으면 제출이 열리지 못한다.
  const wanted = typeof baseBranch === "string" ? baseBranch.trim() : "";
  if (wanted !== "" && wanted !== info.defaultBranch) {
    const branch = await ask(request, "GET", `${base}/branches/${encodeURIComponent(wanted)}`);
    if (branch.status === 404) {
      items.push(
        item("base", "fail", `기본 브랜치 '${wanted}' 가 이 레포에 없어요 — 제출이 이 브랜치로 열리지 못해요`),
      );
    } else if (branch.status === 200) {
      items.push(item("base", "pass", `기본 브랜치 '${wanted}' 가 있어요`));
    } else {
      items.push(unknownItem("base", branch, `기본 브랜치 '${wanted}' 를`));
    }
  }
  const effectiveBase = wanted !== "" ? wanted : info.defaultBranch;
  items.push(await dryRunPullRequest(request, base, effectiveBase));
  items.push(await dryRunContents(request, base));
  items.push(await checkNotify(request, base, { scopes, info }));
  items.push(...(await checkRoot(request, base, { info, scopes })));
  if (info.private === false) {
    items.push(item("public", "warn", "공개 레포예요 — 올라가는 제출은 누구나 볼 수 있어요"));
  }
  return { info, items };
}

/**
 * 제출(풀 리퀘스트)을 열 수 있는가 — 없는 브랜치를 head 로 줘서 일부러 실패시킨다. 권한이
 * 있으면 검증(head invalid)에서 422, 세밀한 코드에 Pull requests 쓰기가 없으면 그 앞에서
 * 403 `Resource not accessible by personal access token` 이다. 어느 쪽이든 아무것도 만들어지지
 * 않는다 — 201 이 오는 일은 없지만, 온다면 만들어진 것을 숨기지 않고 알린다.
 */
async function dryRunPullRequest(request, base, baseBranch) {
  const reply = await ask(request, "POST", `${base}/pulls`, {
    title: "colonova-design invite check (dry run - never created)",
    head: `colonova-design-invite-check-${nonce()}`,
    base: baseBranch,
    body: "This request is rejected on purpose by the invite check - nothing is created.",
  });
  if (reply.status === 422) {
    const baseInvalid = Array.isArray(reply.json?.errors)
      ? reply.json.errors.some((error) => error?.field === "base")
      : false;
    if (baseInvalid) {
      return item("pr", "fail", `기본 브랜치 '${baseBranch}' 를 GitHub 가 받아 주지 않아요 — 초대의 기본 브랜치를 확인해 주세요`);
    }
    return item(
      "pr",
      "pass",
      "제출(풀 리퀘스트)을 열 수 있어요 — 없는 브랜치로 하는 예행으로 권한 검사를 확인했어요",
    );
  }
  if (reply.status === 403 && /resource not accessible/i.test(messageOf(reply))) {
    return item(
      "pr",
      "fail",
      `제출(풀 리퀘스트)을 열 권한이 없어요(403) — 세밀한 코드는 Pull requests: Read and write, 클래식 코드는 repo 범위가 필요해요. 권한을 고치면 같은 코드가 바로 풀려요${quote(reply)}`,
    );
  }
  if (reply.status >= 200 && reply.status < 300) {
    const url = typeof reply.json?.html_url === "string" ? ` ${reply.json.html_url}` : "";
    return item(
      "pr",
      "unknown",
      `예행이 예상 밖으로 ${reply.status} 를 받았어요 — 풀 리퀘스트가 만들어졌을 수 있으니 레포를 확인해 주세요${url}`,
    );
  }
  return unknownItem("pr", reply, "제출(풀 리퀘스트)을 열 수 있는지");
}

/**
 * 도구가 작업을 레포에 올릴 수 있는가(Contents 쓰기) — 없는 객체를 가리키는 ref 를 만들게 해
 * 일부러 실패시킨다: 권한이 있으면 422 `Object does not exist`, 없으면 403. 이 권한이 없으면
 * 첫 자동 보관의 푸시부터 거절돼 버린다.
 */
async function dryRunContents(request, base) {
  const reply = await ask(request, "POST", `${base}/git/refs`, {
    ref: `refs/heads/colonova-design-invite-check-${nonce()}`,
    sha: "0".repeat(40),
  });
  if (reply.status === 422) {
    return item(
      "contents",
      "pass",
      "보관한 작업을 레포에 올릴 수 있어요 — Contents 쓰기 권한을 예행으로 확인했어요",
    );
  }
  if (reply.status === 403 && /resource not accessible/i.test(messageOf(reply))) {
    return item(
      "contents",
      "fail",
      `작업을 레포에 올릴 수 없어요(403) — Contents: Read and write 권한이 없어요(클래식 코드는 repo 범위). 첫 자동 보관의 푸시부터 거절돼요${quote(reply)}`,
    );
  }
  if (reply.status === 409) {
    return item("contents", "warn", "레포가 비어 있어요(커밋이 하나도 없어요) — 기본 브랜치를 먼저 만들어 주세요");
  }
  if (reply.status >= 200 && reply.status < 300) {
    return item(
      "contents",
      "unknown",
      `예행이 예상 밖으로 ${reply.status} 를 받았어요 — 브랜치가 만들어졌을 수 있으니 레포를 확인해 주세요`,
    );
  }
  return unknownItem("contents", reply, "작업을 올릴 수 있는지(Contents 쓰기)");
}

/**
 * 문제가 생겼을 때 도구가 이 레포에 알림(이슈 · 코멘트)을 남길 수 있는가. 클래식 코드는 범위가
 * 답이다(repo — 공개 레포는 public_repo). 세밀한 코드는 범위 머리글이 없으므로 제목 없는 이슈를 만들게 해 일부러 실패시킨다
 * — 권한이 있으면 422, 없으면 403. 이 점검이 통과하면 사이트가 Slack 주소를 필수로 요구하지
 * 않는다(없으면 경고만 한다).
 */
async function checkNotify(request, base, { scopes, info }) {
  if (scopes !== null) {
    // 여기까지 온 클래식 코드는 이 레포에 쓸 수 있는 범위(repo · 공개 레포의 public_repo)를 이미 지났다.
    return item(
      "notify",
      "pass",
      `문제가 생기면 이 레포에 알림을 남길 수 있어요 — 클래식 코드의 ${scopes.includes("repo") ? "repo" : "public_repo"} 범위가 있어요`,
    );
  }
  if (!info.hasIssues) {
    return item(
      "notify",
      "warn",
      "이 레포는 이슈가 꺼져 있어요 — 열린 제출이 있을 때만 코멘트로 알릴 수 있어요. Slack 주소를 넣어 두면 안전해요",
    );
  }
  const reply = await ask(request, "POST", `${base}/issues`, {});
  if (reply.status === 422) {
    return item(
      "notify",
      "pass",
      "문제가 생기면 이 레포에 알림(이슈)을 남길 수 있어요 — Issues 쓰기 권한을 예행으로 확인했어요",
    );
  }
  if (reply.status === 403 && /resource not accessible/i.test(messageOf(reply))) {
    return item(
      "notify",
      "warn",
      `이슈를 만들 권한이 없어 알림이 레포에 닿지 않아요(403) — Issues: Read and write 를 켜거나 Slack 주소를 넣어 주세요${quote(reply)}`,
    );
  }
  if (reply.status === 410) {
    return item(
      "notify",
      "warn",
      "이 레포는 이슈가 꺼져 있어요 — 열린 제출이 있을 때만 코멘트로 알릴 수 있어요. Slack 주소를 넣어 두면 안전해요",
    );
  }
  if (reply.status >= 200 && reply.status < 300) {
    const url = typeof reply.json?.html_url === "string" ? ` ${reply.json.html_url}` : "";
    return item(
      "notify",
      "unknown",
      `예행이 예상 밖으로 ${reply.status} 를 받았어요 — 이슈가 만들어졌을 수 있으니 레포를 확인해 주세요${url}`,
    );
  }
  return unknownItem("notify", reply, "알림을 남길 수 있는지");
}

/** 레포 루트 — 락파일 · 미리보기 스크립트 · engines · .npmrc · 환경 변수 견본. 모두 경고까지다. */
async function checkRoot(request, base, { scopes }) {
  const listing = await ask(request, "GET", `${base}/contents`);
  if (listing.status !== 200 || !Array.isArray(listing.json)) {
    return [
      listing.status === 404
        ? item("root", "warn", "레포의 루트 파일이 없어요(빈 레포일 수 있어요) — 락파일 · 미리보기 스크립트를 점검하지 못했어요")
        : unknownItem("root", listing, "레포 루트의 락파일 · 미리보기 스크립트를"),
    ];
  }
  const names = new Set(listing.json.map((entry) => (typeof entry?.name === "string" ? entry.name : "")));
  const items = [];
  const lock = LOCKFILES.find((name) => names.has(name));
  items.push(
    lock
      ? item("lockfile", "pass", `락파일이 있어요(${lock})`)
      : item(
          "lockfile",
          "warn",
          "락파일이 없어요 — 앱은 락파일이 없으면 설치를 돌리지 않아 미리보기가 안 떠요. pnpm-lock.yaml · package-lock.json · yarn.lock · bun.lock 중 하나를 커밋해 주세요",
        ),
  );
  if (!names.has("package.json")) {
    items.push(
      item(
        "preview",
        "warn",
        "루트에 package.json 이 없어요 — 앱은 루트의 scripts 에서 미리보기 명령을 읽어요. 앱이 하위 폴더에 있다면 루트에 dev 스크립트를 두거나, 초대의 '지켜 줄 것'에 어느 폴더를 띄우는지 적어 주세요",
      ),
    );
  } else {
    const file = await ask(request, "GET", `${base}/contents/package.json`);
    const text = file.status === 200 ? decodeContents(file.json) : null;
    let manifest = null;
    try {
      manifest = text === null ? null : JSON.parse(text);
    } catch {
      manifest = null;
    }
    if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
      items.push(
        file.status === 200
          ? item("preview", "warn", "루트 package.json 을 읽지 못했어요 — JSON 이 깨졌는지 봐 주세요")
          : unknownItem("preview", file, "루트 package.json 을"),
      );
    } else {
      const scripts = manifest.scripts && typeof manifest.scripts === "object" ? manifest.scripts : {};
      const preview = PREVIEW_SCRIPTS.find((name) => typeof scripts[name] === "string");
      const monorepo = names.has("pnpm-workspace.yaml") || names.has("turbo.json") || Boolean(manifest.workspaces);
      items.push(
        preview
          ? item("preview", "pass", `미리보기 스크립트가 있어요(${preview})`)
          : item(
              "preview",
              "warn",
              `루트 package.json 에 미리보기 스크립트(${PREVIEW_SCRIPTS.join(" · ")})가 없어요 — 사용자 화면에서 AI 가 먼저 고치려 들 수 있어요${
                monorepo
                  ? ". 모노레포로 보여요: 루트에 dev 스크립트를 두거나, 초대의 '지켜 줄 것'에 어느 폴더의 앱을 띄우는지 적어 주세요"
                  : ""
              }`,
            ),
      );
      const range = manifest.engines?.node;
      if (typeof range === "string" && nodeRangeAllows(range) === false) {
        items.push(
          item(
            "engines",
            "warn",
            `package.json 의 engines.node('${range.slice(0, 60)}')가 앱에 들어 있는 Node ${BUNDLED_NODE_MAJOR} 를 받지 않아요 — 설치가 경고 · 거절될 수 있어요(yarn 은 막아요)`,
          ),
        );
      }
    }
  }
  if (names.has(".npmrc")) {
    const file = await ask(request, "GET", `${base}/contents/.npmrc`);
    const found = file.status === 200 ? npmrcFindings(decodeContents(file.json) ?? "") : null;
    if (found !== null) items.push(...npmrcItems(found, scopes));
  }
  const env = ENV_SAMPLES.find((name) => names.has(name));
  if (env) {
    items.push(
      item("env", "warn", `환경 변수가 필요해 보여요(${env}) — 앱은 비밀을 몰라서 화면이 예시 데이터로 뜰 수 있어요`),
    );
  }
  return items;
}

/** .npmrc 의 발견 → 경고 줄들. 인증 값은 어떤 경우에도 문장에 싣지 않는다. */
function npmrcItems(found, scopes) {
  const items = [];
  if (found.literalAuth) {
    items.push(
      item(
        "npmrc",
        "warn",
        ".npmrc 에 인증 정보가 그대로 적혀 있어요 — 비밀이 레포에 올라가 있고, 사용자 PC 에서는 그 레지스트리 설치가 막힐 수 있어요",
      ),
    );
  }
  if (found.envAuth) {
    items.push(
      item(
        "npmrc",
        "warn",
        ".npmrc 가 환경 변수(${…})로 레지스트리에 인증해요 — 사용자 PC 에는 그 값이 없어 설치가 인증 오류로 멈출 수 있어요",
      ),
    );
  }
  for (const host of found.hosts) {
    if (host === "npm.pkg.github.com") {
      const ok = scopes !== null && (scopes.includes("read:packages") || scopes.includes("write:packages"));
      items.push(
        ok
          ? item("npmrc", "pass", ".npmrc 가 GitHub 패키지 레지스트리를 써요 — 클래식 코드의 packages 읽기 범위가 있어요")
          : item(
              "npmrc",
              "warn",
              ".npmrc 가 GitHub 패키지 레지스트리를 써요 — 앱은 연결 코드로 인증하는데, GitHub 패키지는 클래식 토큰(read:packages 범위)만 받아요. 지금 코드로는 설치가 인증 오류로 멈출 수 있어요",
            ),
      );
    } else {
      items.push(
        item(
          "npmrc",
          "warn",
          `.npmrc 가 사설 레지스트리(${host})를 가리켜요 — 앱은 GitHub 패키지 레지스트리만 자동으로 인증해서, 사용자 PC 에서 설치가 인증 오류로 멈출 수 있어요`,
        ),
      );
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// 3. 리뷰어 — 요청 없이 계산한다(리뷰어 칸이 바뀔 때마다 다시 부른다)
// ---------------------------------------------------------------------------

/** `@Dev1 ` · `dev1` 을 같은 로그인으로 — GitHub 로그인은 대소문자를 가르지 않는다. */
const loginKey = (value) => String(value ?? "").trim().replace(/^@/, "").toLowerCase();

/**
 * 토큰 주인이 리뷰어에 들어 있으면 경고다 — GitHub 는 풀 리퀘스트를 연 사람에게 리뷰 요청을
 * 보내지 않아서 그 사람에게는 알림이 가지 않는다. 막지는 않는다(2026-10-08 검토 FIX1, 확정 실패에서
 * 낮춤): 앱은 표식 있는 앱 코멘트만 건너뛰어(app-comment.ts) 토큰 주인이 표식 없이 쓴 코멘트는
 * AI 반영 루프에 닿고, 데몬의 requestReviewers 는 PR 작성자를 이미 빼고 요청한다.
 */
export function checkReviewers({ login, reviewers }) {
  const list = (reviewers ?? []).map((value) => String(value).trim().replace(/^@/, "")).filter(Boolean);
  if (list.length === 0 || login === null || login === undefined || login === "") return [];
  const same = list.filter((value) => loginKey(value) === loginKey(login));
  if (same.length > 0) {
    return [
      item(
        "reviewers",
        "warn",
        `리뷰어에 연결 코드 주인(@${same[0]})이 들어 있어요 — GitHub 은 PR 작성자에게 리뷰 요청을 보내지 않아서 이 사람에게는 알림이 가지 않아요(코멘트는 앱이 읽어요)`,
      ),
    ];
  }
  return [item("reviewers", "pass", "리뷰어는 연결 코드의 주인과 다른 계정이에요")];
}

// ---------------------------------------------------------------------------
// 4. 한 번에 — 터미널 생성기와 시험이 쓴다(페이지는 위의 조각을 캐시하며 따로 부른다)
// ---------------------------------------------------------------------------

/** 항목들의 수 — { pass, warn, fail, unknown }. */
export function tally(lists) {
  const counts = { pass: 0, warn: 0, fail: 0, unknown: 0 };
  for (const list of lists) for (const entry of list) counts[entry.status] += 1;
  return counts;
}

/**
 * 프로젝트 하나를 점검한다(네트워크 몫만 — 리뷰어는 checkReviewers 가 요청 없이 따로 센다).
 * GitHub 레포가 아니면 건너뛰고, 연결 코드를 읽지 못했으면 묻지 않는다 — 어느 레포나 같은
 * 401 이고, 전송 실패 · 한도는 레포마다 한 줄로 알린다(코드가 거절된 것은 연결 코드 줄이 이미 말했다).
 * `token` 은 checkToken 의 결과다.
 */
export async function checkProject(request, { token, repoUrl, baseBranch }) {
  const slug = githubRepoOf(repoUrl);
  if (slug === null) {
    return {
      repoUrl,
      slug: null,
      info: null,
      items: [item("repo", "unknown", "GitHub 레포가 아니라 점검하지 않았어요")],
    };
  }
  const label = `${slug.owner}/${slug.repo}`;
  if (token.login === null) {
    const rejected = token.items.some((entry) => entry.id === "token" && entry.status === "fail");
    return {
      repoUrl,
      slug: label,
      info: null,
      items: rejected
        ? []
        : [item("repo", "unknown", "연결 코드를 확인하지 못해 이 레포는 점검하지 않았어요")],
    };
  }
  const repo = await checkRepo(request, {
    owner: slug.owner,
    repo: slug.repo,
    baseBranch,
    scopes: token.scopes,
    login: token.login,
  });
  return { repoUrl, slug: label, info: repo.info, items: repo.items };
}

/** 프로젝트의 리뷰어 — 그 프로젝트의 칸이 있으면 그것이, 없으면 공통이다. */
function reviewersFor(project, common) {
  return Array.isArray(project.reviewers) && project.reviewers.length > 0 ? project.reviewers : common;
}

/**
 * 연결 코드와 프로젝트 전체를 점검한다 — 터미널 생성기와 시험이 쓴다(페이지는 같은 조각을
 * 캐시하며 따로 부른다). projects 는 [{ repoUrl, baseBranch?, reviewers? }], 공통 리뷰어는
 * reviewers 로 건넨다.
 */
export async function runInviteCheck({ request, projects, reviewers = [], now = Date.now() }) {
  // GitHub 레포가 하나도 없으면(개발 실행의 로컬 경로 · 다른 호스트) 물을 것이 없다 — 코드도 묻지 않는다.
  const anyGitHub = projects.some((project) => githubRepoOf(project.repoUrl) !== null);
  const token = anyGitHub
    ? await checkToken(request, { now })
    : { login: null, scopes: null, items: [] };
  const results = [];
  for (const project of projects) {
    const result = await checkProject(request, { token, ...project });
    results.push({
      ...result,
      items: [
        ...result.items,
        ...checkReviewers({ login: token.login, reviewers: reviewersFor(project, reviewers) }),
      ],
    });
  }
  const counts = tally([token.items, ...results.map((entry) => entry.items)]);
  return { token, projects: results, counts, blocking: counts.fail > 0 };
}

/** 터미널용 보고 — 한 줄씩. 기호 · 문장만 있고 코드 값은 어디에도 없다. */
export function formatReport(result) {
  const lines = ["초대장 사전 점검 — GitHub 에 읽기와 예행 요청만 보내요(풀 리퀘스트 · 브랜치 · 이슈 · 코멘트는 만들어지지 않아요)"];
  const section = (title, items) => {
    if (items.length === 0) return;
    lines.push(title);
    for (const entry of items) lines.push(`  ${MARK[entry.status]} ${entry.text}`);
  };
  section("연결 코드", result.token.items);
  for (const project of result.projects) section(project.slug ?? project.repoUrl, project.items);
  const { fail, warn, unknown } = result.counts;
  lines.push(`요약: 막히는 것 ${fail} · 경고 ${warn} · 확인하지 못한 것 ${unknown}`);
  return lines;
}
