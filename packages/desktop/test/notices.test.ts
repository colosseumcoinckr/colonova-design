// 데스크톱 문장의 시험(2026-10-06 겹판 조사 · N) — OS 알림 · 네이티브 대화상자 · 설정이 그대로 보여 주는
// 오류 문장이 알림센터에서 한 목소리(해요체)와 한 어휘(보관 · 제출 · 반영됨)로 말한다. 위험한 확인은
// 취소가 첫 단추이자 기본이고, 막다른 길(시작 실패)에는 출구(기록 폴더 열기)가 있다.
// `../dist` 임포트인 이유는 a11y-probe 시험과 같다(node --test 는 src 의 `.js` 지정자를 못 읽는다) —
// 시험 전에 `tsc -p packages/desktop/tsconfig.json` 이 dist 를 만든다(`pnpm test` 가 먼저 돈다).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { DaemonNotice } from "@colonova-design/daemon/server";
import {
  ANSWER,
  BRIDGE,
  crashLoopOptions,
  NOTICE,
  quitOptions,
  resetOptions,
  resetUnfinished,
  START_ANSWER,
  startFailedOptions,
  UPDATE,
  unresponsiveOptions,
} from "../dist/copy.js";
import { buildSwapScript as macSwapScript } from "../dist/mac-self-update.js";
import { noticeCopy } from "../dist/notices.js";
import { planSelfUpdate, requireDiskSpace, verifyDownload } from "../dist/self-update.js";
import { buildSwapScript as winSwapScript } from "../dist/win-self-update.js";

/**
 * 막는 말 — 개발 어휘 · 옛 말 · 합니다체. 웹의 vocab-sweep 과 같은 잣대에 데스크톱의 몫을 더했다.
 * 사용자가 읽는 말은 보관 · 제출 · 반영됨 뿐이다(docs/GUIDE.md).
 */
const FORBIDDEN: Array<{ word: string; pattern: RegExp }> = [
  // 개발 어휘 — `패턴` · `리턴` 의 턴은 개발자의 턴이 아니다.
  { word: "턴", pattern: /(?<![패리])턴/ },
  { word: "경로", pattern: /경로/ },
  { word: "git", pattern: /git(?!hub)/i },
  { word: "데몬", pattern: /데몬/ },
  { word: "커밋", pattern: /커밋/ },
  { word: "브랜치", pattern: /브랜치/ },
  { word: "PR", pattern: /(?<![A-Za-z])PR(?![A-Za-z])/ },
  { word: "레포", pattern: /레포/ },
  // 옛 말 — 보관 · 제출 · 반영됨으로 말한다.
  { word: "저장", pattern: /저장/ },
  { word: "넘기기", pattern: /넘기/ },
  { word: "합쳤", pattern: /합쳤|합쳐|합침/ },
  { word: "최신화", pattern: /최신화/ },
  { word: "반려", pattern: /반려/ },
  { word: "변경 요청", pattern: /변경 요청/ },
  // 앱에 그런 쪽 · 이름이 없다 — 설정은 AI · 테마 · 알림 · 연결 · 업데이트 · 개발자용이다.
  { word: "문제 해결", pattern: /문제 해결/ },
  { word: "상태 확인", pattern: /상태 확인/ },
  // 보내기는 AI 에게 말을 전하는 말이다 — 개발자에게 가는 일은 제출이다.
  { word: "보냄", pattern: /보냄|보냈/ },
  // 폴더 이름은 기록 폴더 하나다(도움말 메뉴 · 시작 실패 상자).
  { word: "로그 폴더", pattern: /로그 폴더/ },
  // 말투는 해요체 하나다.
  { word: "합니다체", pattern: /니다(?![가-힣])/ },
];

function problems(text: string): string[] {
  return FORBIDDEN.filter(({ pattern }) => pattern.test(text)).map(({ word }) => word);
}

function assertVoice(label: string, text: string): void {
  assert.deepEqual(problems(text), [], `${label}: ${text}`);
}

test("problems: 개발 어휘 · 옛 말 · 합니다체는 잡고, 해요체와 패턴은 지나간다", () => {
  assert.deepEqual(problems("저장이 끝나지 못했습니다"), ["저장", "합니다체"]);
  assert.deepEqual(problems("넘기기 실패 · 최신화 충돌 · 반려됨"), ["넘기기", "최신화", "반려"]);
  assert.deepEqual(problems("설정 → 문제 해결 · 로그 폴더"), ["문제 해결", "로그 폴더"]);
  assert.deepEqual(problems("개발자가 제품에 합쳤습니다"), ["합쳤", "합니다체"]);
  assert.deepEqual(problems("패턴을 리턴해요"), []);
  assert.deepEqual(problems("보관하지 못했어요 · 기록 폴더 열기"), []);
});

// ---------------------------------------------------------------------------
// OS 알림 — 모든 사건이 한 목소리로 말한다.
// ---------------------------------------------------------------------------

const NAME = "회원 목록";
const NOTICES: DaemonNotice[] = [
  { kind: "done", sessionId: "s1", title: NAME },
  { kind: "crashed", sessionId: "s1", title: NAME },
  { kind: "ask", sessionId: "s1", title: NAME, what: "question" },
  { kind: "ask", sessionId: "s1", title: NAME, what: "permission" },
  ...(["save", "handoff", "refresh", "screen"] as const).map(
    (stage): DaemonNotice => ({ kind: "gate", sessionId: "s1", title: NAME, stage }),
  ),
  ...(["merged", "closed", "changes_requested", "comments", "replied"] as const).map(
    (event): DaemonNotice => ({
      kind: "handoff",
      slug: "members",
      projectName: NAME,
      event,
      count: 3,
    }),
  ),
  { kind: "ready", slug: "members", title: NAME },
  { kind: "submit-blocked", slug: "members", title: NAME, reason: "auth" },
  { kind: "submit-blocked", slug: "members", title: NAME, reason: "developer-notified" },
  { kind: "update-done", agent: "claude", version: "2.2.0" },
  { kind: "update-done", agent: "codex", version: "0.9.1" },
];

test("noticeCopy: 모든 알림이 해요체 · 사용자의 어휘로 말하고 제목이 짧다", () => {
  assert.equal(new Set(NOTICES.map((notice) => notice.kind)).size, 8, "사건 종류 여덟 가지 전부");
  for (const notice of NOTICES) {
    const { title, body } = noticeCopy(notice);
    const label = JSON.stringify(notice);
    assert.ok(title.trim() !== "" && body.trim() !== "", label);
    assertVoice(`${label} 제목`, title);
    assertVoice(`${label} 몸글`, body);
    // 몸글은 해요체로 닫는다 — 합니다체뿐 아니라 명사로 끝나는 몸글도 막는다.
    assert.match(body, /요\.?$/, `${label} 몸글의 끝: ${body}`);
    assert.ok([...body].length <= 90, `${label} 몸글이 길어 배너에서 잘려요: ${body}`);
    if (notice.kind === "update-done") continue;
    assert.ok(title.startsWith(`${NAME} · `), `${label} 제목은 이름 · 꼬리: ${title}`);
    const tail = title.slice(`${NAME} · `.length);
    // 배너는 제목 한 줄이다 — 이름이 길어도 꼬리가 읽히도록 꼬리는 12 자까지.
    assert.ok([...tail].length <= 12, `${label} 제목의 꼬리가 길어 잘려요: ${tail}`);
  }
});

test("noticeCopy: 게이트는 보관 · 제출이라 말하고 옛 말(저장 · 넘기기 · 최신화)을 쓰지 않는다", () => {
  const gate = (stage: "save" | "handoff" | "refresh" | "screen") =>
    noticeCopy({ kind: "gate", sessionId: "s1", title: NAME, stage });
  assert.match(gate("save").title, /보관하지 못했어요$/);
  assert.match(gate("handoff").title, /제출하지 못했어요$/);
  assert.match(gate("refresh").body, /개발자가 반영한 최신 작업/);
  assert.match(gate("refresh").body, /아직 보관하지 않은 작업/);
  assert.match(gate("screen").title, /화면 확인$/);
});

test("noticeCopy: 개발자 쪽 사건 — 반영됨 · 요청 닫힘 · 코멘트 · 다시 제출됨", () => {
  const handoff = (event: "merged" | "closed" | "changes_requested" | "comments" | "replied") =>
    noticeCopy({ kind: "handoff", slug: "members", projectName: NAME, event, count: 3 });
  assert.equal(handoff("merged").title, `${NAME} · 반영됨`);
  assert.match(handoff("merged").body, /^개발자가 이번 작업을 반영했어요/);
  assert.match(handoff("closed").title, /요청 닫힘$/);
  assert.match(handoff("replied").title, /다시 제출됨$/);
  assert.match(handoff("replied").body, /다시 제출했어요/);
  assert.match(handoff("changes_requested").body, /코멘트를 남겼어요/);
  assert.match(handoff("comments").body, /3건/);
  const bare = noticeCopy({
    kind: "handoff",
    slug: "members",
    projectName: NAME,
    event: "comments",
  });
  assert.match(bare.body, /1건/, "개수를 모르면 한 건");
});

test("noticeCopy: 제출이 막힌 알림 — 제목은 짧고, 개발자에게 알린 것은 몸글이 말하며, 연결 코드 만료는 알렸다고 하지 않는다", () => {
  const blocked = (reason: "auth" | "developer-notified") =>
    noticeCopy({ kind: "submit-blocked", slug: "members", title: NAME, reason });
  for (const reason of ["auth", "developer-notified"] as const) {
    assert.equal(blocked(reason).title, `${NAME} · 제출하지 못했어요`);
  }
  assert.match(blocked("developer-notified").body, /^개발자에게 알렸어요/);
  assert.match(blocked("developer-notified").body, /풀리면 도구가 다시 제출해요/);
  // 연결 코드가 끝난 막힘은 사용자의 손이 필요한 일이다 — 개발자에게 알린 것이 아니다.
  assert.doesNotMatch(blocked("auth").body, /알렸어요/);
  assert.match(blocked("auth").body, /새 초대 파일을 열어 주세요/);
});

test("noticeCopy: AI 업데이트 알림은 에이전트 이름과 버전을 말한다", () => {
  assert.deepEqual(noticeCopy({ kind: "update-done", agent: "claude", version: "2.2.0" }), {
    title: "AI를 업데이트했어요",
    body: "Claude Code 2.2.0 — 다음 새 대화부터 써요.",
  });
  assert.match(
    noticeCopy({ kind: "update-done", agent: "codex", version: "0.9.1" }).body,
    /^Codex 0\.9\.1/,
  );
});

// ---------------------------------------------------------------------------
// 웹과 같은 말 — 같은 사건을 앱 안과 알림센터가 같은 말로 한다. 웹 문장을 고치면 이 시험이 알려 준다.
// ---------------------------------------------------------------------------

const WEB_LABELS = readFileSync(join(import.meta.dirname, "../../web/src/next/labels.ts"), "utf8");

/** 마침표와 끝 공백을 걷는다 — 알림은 마침표로 닫고, 웹의 어떤 줄은 닫지 않는다. */
function bare(sentence: string): string {
  return sentence.replace(/[.\s]+$/, "");
}

function assertMirrors(key: string, sentence: string): void {
  const values = [...WEB_LABELS.matchAll(new RegExp(`\\b${key}:\\s*"([^"]*)"`, "g"))].map((match) =>
    bare(match[1] ?? ""),
  );
  assert.ok(
    values.includes(bare(sentence)),
    `웹 labels.ts 의 ${key} 와 desktop copy.ts 의 문장이 달라졌어요 — 같은 말로 맞춰 주세요: ${sentence}`,
  );
}

test("웹과 같은 말: 반영됨 · 요청 닫힘 · 연결 코드 만료 · 시험 알림", () => {
  assertMirrors("changedEmptyMerged", NOTICE.handoff.merged.body);
  assertMirrors("closed", NOTICE.handoff.closed.body);
  assertMirrors("reconnectInvite", NOTICE.submitBlocked.auth.body);
  assertMirrors("testNotify", BRIDGE.testNotice.title);
  assertMirrors("testNotifyBody", BRIDGE.testNotice.body);
});

// ---------------------------------------------------------------------------
// 문장은 한 곳에 — copy.ts 의 한글 리터럴이 전부 검사받고, 다른 desktop 파일에는 한글 리터럴이 없다.
// ---------------------------------------------------------------------------

const SRC = join(import.meta.dirname, "../src");
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힯]/;

/** 이 자리의 `/` 가 나눗셈이 아니라 정규식의 시작인가 — 앞선 코드의 마지막 글자로 판단한다. */
function regexStarts(code: string): boolean {
  const before = code.trimEnd();
  return before === "" || /[(,=:[!&|?{};+\-*%~^]$/.test(before) || /\breturn$/.test(before);
}

/**
 * 주석을 걷고 문자열 리터럴과 나머지 코드를 나눈다(웹의 vocab-sweep 과 같은 훑개). 정규식 리터럴은
 * 통째로 건너뛴다 — 그 안의 따옴표가 문자열을 열지 않게. 템플릿의 `${}` 안에 따옴표 · 백틱이 있으면
 * 틀리게 읽는다 — 문장 파일은 그런 모양을 쓰지 않는다.
 */
function splitSource(source: string): { literals: string[]; code: string } {
  const literals: string[] = [];
  let code = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
    } else if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (ch === "/" && regexStarts(code)) {
      let j = i + 1;
      let inClass = false;
      while (j < source.length && source[j] !== "\n") {
        if (source[j] === "\\") j += 1;
        else if (source[j] === "[") inClass = true;
        else if (source[j] === "]") inClass = false;
        else if (source[j] === "/" && !inClass) break;
        j += 1;
      }
      code += " ";
      i = j + 1;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) {
        if (source[j] === "\\") j += 1;
        if (ch !== "`" && source[j] === "\n") break;
        j += 1;
      }
      literals.push(source.slice(i + 1, j));
      i = j + 1;
    } else {
      code += ch;
      i += 1;
    }
  }
  return { literals, code };
}

function hangulLiterals(file: string): string[] {
  const { literals } = splitSource(readFileSync(join(SRC, file), "utf8"));
  return literals.filter((text) => HANGUL.test(text));
}

test("splitSource: 주석 · 정규식은 걷고 문장은 잡는다", () => {
  const sample = [
    "// 저장했습니다 — 주석은 괜찮다",
    'const a = "보관했어요";',
    "const b = /['\"`]/g;",
    "const c = `제출했어요`;",
    "/* 반려 */",
  ].join("\n");
  assert.deepEqual(splitSource(sample).literals, ["보관했어요", "제출했어요"]);
});

test("copy.ts: 모든 한글 리터럴이 해요체 · 사용자의 어휘다", () => {
  const sentences = hangulLiterals("copy.ts");
  assert.ok(sentences.length > 60, `훑은 문장이 너무 적다: ${sentences.length}`);
  for (const text of sentences) assertVoice("copy.ts", text);
});

test("문장은 copy.ts 한 곳에 — 알림 · 대화상자 · 다리 파일에는 한글 리터럴이 없다", () => {
  for (const file of [
    "notices.ts",
    "app-updates.ts",
    "windows.ts",
    "main.ts",
    "bridge.ts",
    "app-notify.ts",
  ]) {
    assert.deepEqual(
      hangulLiterals(file),
      [],
      `${file} 에 한글 리터럴이 있어요 — 사용자에게 보이는 문장은 copy.ts 에 두세요`,
    );
  }
});

// ---------------------------------------------------------------------------
// 네이티브 대화상자 — 두 단추의 문법과 시작 실패의 출구.
// ---------------------------------------------------------------------------

test("두 단추 상자: 안전한 쪽이 첫 단추 · 기본 · Esc 의 답이고, 일을 벌이는 단추는 뒤다", () => {
  assert.equal(ANSWER.safe, 0, "첫 단추가 안전한 쪽");
  assert.equal(ANSWER.other, 1);
  const boxes = {
    종료: quitOptions(),
    초기화: resetOptions(false),
    "초기화(AI 작업 중)": resetOptions(true),
    "화면이 계속 꺼짐": crashLoopOptions(),
    "화면이 멈춤": unresponsiveOptions(),
  };
  for (const [name, box] of Object.entries(boxes)) {
    assert.equal(box.buttons?.length, 2, name);
    assert.equal(box.defaultId, ANSWER.safe, `${name}: 기본 단추`);
    assert.equal(box.cancelId, ANSWER.safe, `${name}: Esc · 닫기의 답`);
    assert.equal(box.noLink, true, `${name}: Windows 에서도 같은 모양`);
    for (const text of [box.title, box.message, box.detail, ...(box.buttons ?? [])]) {
      assertVoice(name, text ?? "");
    }
  }
  // 위험한 확인은 취소가 첫 단추이고, 일을 벌이는 단추는 일을 이름으로 부른다.
  assert.deepEqual(boxes.종료.buttons, ["취소", "그만두고 끝내기"]);
  assert.deepEqual(boxes.초기화.buttons, ["취소", "모두 지우고 다시 시작"]);
  // 복구 상자는 복구(기다리기 · 다시 열기)가 기본이다.
  assert.deepEqual(boxes["화면이 계속 꺼짐"].buttons, ["다시 열기", "끝내기"]);
  assert.deepEqual(boxes["화면이 멈춤"].buttons, ["기다리기", "다시 열기"]);
});

test("종료 확인: 무엇이 멈추고 무엇이 남는지 말한다", () => {
  const box = quitOptions();
  assert.equal(box.message, "AI가 작업 중이에요. 지금 끝내면 하던 작업이 멈춰요.");
  assert.equal(box.detail, "이미 끝난 답은 보관돼 있어요.");
});

test("초기화 확인: 지워지는 것 · 남는 것을 말하고, 도는 AI 일이 있을 때만 그 일도 멈춘다고 말한다", () => {
  const idle = resetOptions(false);
  const busy = resetOptions(true);
  for (const box of [idle, busy]) {
    assert.match(box.detail ?? "", /제출하지 않은 작업은 되돌릴 수 없어요/);
    assert.match(box.detail ?? "", /Claude·Codex 로그인은 유지돼요/);
    assert.match(box.detail ?? "", /새 초대 파일을 넣어 주세요/);
    assert.doesNotMatch(box.detail ?? "", /초대장/, "UI 의 말은 초대 파일이다");
  }
  assert.doesNotMatch(idle.detail ?? "", /AI가 일하는 중/);
  assert.match(busy.detail ?? "", /지금 AI가 일하는 중이에요\. 다시 시작하면 그 일도 멈춰요\./);
  assert.ok(
    (busy.detail ?? "").startsWith(idle.detail ?? ""),
    "경고는 덧붙을 뿐 앞의 말을 바꾸지 않는다",
  );
});

test("시작 실패 상자: 기록 폴더 열기가 기본 출구이고, 날 오류는 detail 로 내린다", () => {
  const reason = "listen EADDRINUSE: address already in use 127.0.0.1:4317";
  const logs = "/Users/me/.colonova-design/logs";
  const box = startFailedOptions(reason, logs);
  assert.equal(box.type, "error");
  assert.deepEqual(box.buttons, ["기록 폴더 열기", "끝내기"]);
  assert.equal(START_ANSWER.openLogs, 0);
  assert.equal(START_ANSWER.quit, 1);
  assert.equal(box.defaultId, START_ANSWER.openLogs, "막다른 길의 기본은 출구");
  assert.equal(box.cancelId, START_ANSWER.quit, "Esc 는 그냥 끝낸다");
  assert.equal(box.noLink, true);
  assert.equal(box.message, "ColoNova Design을 시작하지 못했어요");
  assert.ok(!(box.message ?? "").includes("EADDRINUSE"), "날 오류는 제목에 올리지 않는다");
  assert.match(
    box.detail ?? "",
    /앱을 다시 열어 주세요\. 계속 안 되면 기록 폴더의 내용을 담당자에게 전해 주세요\./,
  );
  assert.ok((box.detail ?? "").includes(`자세한 내용: ${reason}`));
  assert.ok((box.detail ?? "").includes(`기록 폴더: ${logs}`), "끝내기를 골라도 자리를 안다");
  // 문장 부분(날 오류는 개발자의 말이 섞일 수 있다)은 해요체 · 사용자의 어휘다.
  const fixed = startFailedOptions("", logs);
  assertVoice("시작 실패", `${fixed.message}\n${fixed.detail}\n${fixed.buttons?.join(" ")}`);
  assert.ok(!(fixed.detail ?? "").includes("자세한 내용"), "이유가 없으면 그 줄도 없다");
});

test("시작 실패 상자: 긴 날 오류는 잘려 상자가 화면을 넘지 않는다", () => {
  const box = startFailedOptions("x".repeat(5_000), "/logs");
  assert.ok((box.detail ?? "").length < 600, `${(box.detail ?? "").length}`);
  assert.ok((box.detail ?? "").includes("…"));
});

test("시작 실패는 막다른 길이 아니다 — main.ts 의 두 길이 같은 상자를 쓰고 showErrorBox 는 없다", () => {
  const { code } = splitSource(readFileSync(join(SRC, "main.ts"), "utf8"));
  assert.doesNotMatch(code, /showErrorBox/);
  assert.equal(code.match(/await showStartFailure\(/g)?.length, 2);
});

test("초기화를 마치지 못했어요: 해요체이고 날 오류를 뒤에 붙인다", () => {
  const text = resetUnfinished("EBUSY: resource busy");
  assertVoice("초기화 미완", text.split("\n")[0] ?? "");
  assert.ok(text.endsWith("\nEBUSY: resource busy"));
  assert.match(text, /^초기화를 마치지 못했어요\./);
});

// ---------------------------------------------------------------------------
// 업데이트 — 설정의 업데이트 줄과 알림이 읽는 문장.
// ---------------------------------------------------------------------------

test("업데이트 알림: 설정 → 업데이트로 데려가고 존재하지 않는 쪽을 가리키지 않는다", () => {
  const lines = [
    UPDATE.available("0.4.1"),
    UPDATE.prepared("0.4.1"),
    UPDATE.prepareFailed("디스크 공간이 모자라요"),
    UPDATE.swapDone("0.4.1"),
    UPDATE.swapFailed("기존 앱을 치우지 못했어요"),
    UPDATE.swapFailed(undefined),
  ];
  for (const { title, body } of lines) {
    assertVoice("업데이트 제목", title);
    assertVoice("업데이트 몸글", body);
  }
  assert.match(UPDATE.available("0.4.1").body, /설정 → 업데이트에서 설치할 수 있어요/);
  assert.match(UPDATE.prepareFailed("x").body, /설정 → 업데이트에서 다시 시도할 수 있어요/);
  assert.match(
    UPDATE.prepared("0.4.1").body,
    /다시 시작하면 새 버전이 돼요\. 누르면 다시 시작해요\./,
  );
  assert.match(UPDATE.swapFailed("x").body, /누르면 기록을 열어요\.$/);
  assert.doesNotMatch(UPDATE.swapFailed(undefined).body, /undefined/);
});

test("업데이트 오류: 설정의 업데이트 줄에 그대로 서는 문장이 해요체이고 눌러야 할 단추의 이름이 맞다", () => {
  const errors = [
    UPDATE.checkTimeout,
    UPDATE.downloadFailed(404),
    UPDATE.nothingToInstall,
    UPDATE.nothingPrepared,
    UPDATE.devGuarded,
    UPDATE.fromDiskImage,
    UPDATE.verifyFailed("a.zip"),
    UPDATE.diskLow(1, "/tmp"),
    UPDATE.unsupportedPlatform("linux"),
    UPDATE.noTarget,
  ];
  for (const text of errors) assertVoice("업데이트 오류", text);
  // 설정의 업데이트 쪽에 있는 단추는 `지금 확인` 이다.
  assert.match(UPDATE.nothingToInstall, /지금 확인/);
  assert.match(UPDATE.nothingPrepared, /지금 확인/);
});

test("교체 스크립트가 알림에 싣는 실패 이유는 모두 해요체다(mac · Windows)", () => {
  const plan = {
    assetUrl: "https://example.test/colonova-design.zip",
    expectedSha256: "0".repeat(64),
    downloadPath: "/tmp/colonova-design.zip",
    target: "/Applications/ColoNova Design.app",
    steps: [],
  };
  const input = {
    plan,
    pid: 1234,
    logPath: "/tmp/update.log",
    resultPath: "/tmp/result.json",
    version: "9.9.9",
  };
  const reasonsIn = (script: string): string[] =>
    [...script.matchAll(/"reason":"((?:[^"\\]|\\.)*)"/g)].map((match) =>
      JSON.parse(`"${match[1]}"`),
    );
  const mac = reasonsIn(macSwapScript(input));
  const win = reasonsIn(winSwapScript(input));
  assert.ok(mac.length >= 5, `mac 이유 ${mac.length}개`);
  assert.ok(win.length >= 3, `Windows 이유 ${win.length}개`);
  for (const reason of [...mac, ...win]) assertVoice("교체 실패 이유", reason);
  assert.ok(
    win.some((reason) => reason.includes("__EXIT__")),
    "종료 코드 자리는 스크립트가 채운다",
  );
});

test("업데이트 검증 오류: 파일 · 디스크 · 계획의 오류가 해요체다", async () => {
  const dir = mkdtempSync(join(tmpdir(), "colonova-notices-"));
  try {
    const file = join(dir, "colonova-design-9.9.9.zip");
    writeFileSync(file, "not the release");
    await assert.rejects(verifyDownload(file, "0".repeat(64)), (error: Error) => {
      assertVoice("무결성", error.message);
      assert.ok(
        error.message.includes("colonova-design-9.9.9.zip"),
        "무엇이 틀렸는지 이름을 말한다",
      );
      return true;
    });
    await assert.rejects(
      requireDiskSpace({
        path: dir,
        minBytes: 1024 ** 3,
        statfs: async () => ({ bsize: 1, bavail: 1 }),
      }),
      (error: Error) => {
        assertVoice("디스크", error.message);
        assert.match(error.message, /1GB 이상의 여유가 필요해요/);
        return true;
      },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const base = { url: "https://example.test/a", sha256: "0", downloadsDir: "/tmp", version: "1" };
  assert.throws(
    () => planSelfUpdate({ ...base, platform: "linux" }),
    (error: Error) => {
      assertVoice("지원하지 않는 운영체제", error.message);
      return true;
    },
  );
  assert.throws(
    () => planSelfUpdate({ ...base, platform: "win32" }),
    (error: Error) => {
      assertVoice("교체 대상 없음", error.message);
      return true;
    },
  );
});

test("렌더러 다리: 시험 알림 · 알림 설정 · 초대 파일 문장이 해요체다", () => {
  assertVoice("시험 알림 제목", BRIDGE.testNotice.title);
  assertVoice("시험 알림 몸글", BRIDGE.testNotice.body);
  assertVoice("알림 설정 없음", BRIDGE.noNotifySettings);
  assertVoice("초대 파일 없음", BRIDGE.inviteMissing);
});
