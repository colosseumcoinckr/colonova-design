// 다시 연 대화의 에코에서 첨부 섹션을 걷는다(2026-10-08 검토 · F10).
// 벤더 대화록은 AI 가 받은 글 그대로라 `<attachment …>` 섹션(경로 · 안내 문장)이 사용자의 말풍선과 내보낸 글에 보였다.
// 싣는 쪽(`prepareAttachments` · `composeTurnText` · `withViewingLine`)을 그대로 불러 만든 글로 되돌린다 — 순수 시험.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ChatEvent } from "@colonova-design/protocol";
import { transcriptToMarkdown } from "../../web/src/lib/transcript-export.ts";
// `../dist` 임포트인 이유: attachments 는 protocol 을 부르고 드라이버가 형제 `.js` 지정자로 읽는다 — 다른 데몬 시험과 같다.
import {
  composeTurnText,
  prepareAttachments,
  stripAttachmentSections,
  stripReplayedAttachments,
} from "../dist/agent/attachments.js";
import { DriverRegistry } from "../dist/agent/registry.js";
import { SessionManager } from "../dist/session-manager.js";
import { stripReplayedViewing, withViewingLine } from "../dist/viewing-line.js";

const WORDS = "이 화면에서 로고를 바꿔 줘";
const here = { path: "/members" };

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");
const PNG = (name = "logo.png") => ({ name, mediaType: "image/png", data: b64("PNG-BYTES") });
const TEXT = (name: string, body: string) => ({ name, mediaType: "text/plain", data: b64(body) });
const PDF = (name = "기획.pdf") => ({
  name,
  mediaType: "application/pdf",
  data: Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01, 0x02]).toString("base64"),
});

/** 클론 하나 — 첨부가 `.git` 안에 놓인다. */
function clone(): { dir: string; done: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "colonova-replay-attach-"));
  mkdirSync(join(dir, ".git"));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

/** AI 가 받는 글 — 세션이 말에 보던 화면 줄을 붙이고, 드라이버가 섹션을 잇는다(두 자리의 실제 함수 그대로). */
function sent(
  dir: string,
  words: string,
  attachments: Array<{ name: string; mediaType: string; data: string }>,
  viewing: { path: string } | undefined = here,
) {
  const prepared = prepareAttachments(dir, attachments);
  return composeTurnText(withViewingLine(words, viewing, false), prepared);
}

/** 재생이 에코에 하는 두 손질 — 호출 순서도 `SessionManager.history` 와 같다. */
function replay(events: ChatEvent[]): ChatEvent[] {
  return stripReplayedViewing(stripReplayedAttachments(events));
}

function echo(text: string, images = 0): Extract<ChatEvent, { kind: "user.echo" }> {
  return { kind: "user.echo", text, images };
}

test("섹션 하나 — 그림 한 장: 말만 남고 그림은 images 칸이 말한다", () => {
  const { dir, done } = clone();
  try {
    const text = sent(dir, WORDS, [PNG()]);
    assert.match(
      text,
      /<attachment name="logo\.png" type="image\/png" path="/,
      "AI 가 받는 글에는 있다",
    );
    const [out] = replay([echo(text, 1)]);
    assert.deepEqual(out, echo(WORDS, 1));
  } finally {
    done();
  }
});

test("섹션 여럿 — 그림 둘 · PDF · 텍스트: 그림은 수로, 그 밖은 이름으로(라이브 에코와 같은 칸)", () => {
  const { dir, done } = clone();
  try {
    const text = sent(dir, WORDS, [
      PNG("a.png"),
      PDF("기획.pdf"),
      PNG("b.png"),
      TEXT("메모.txt", "첫 줄\n둘째 줄"),
    ]);
    const [out] = replay([echo(text, 2)]);
    assert.deepEqual(out, {
      kind: "user.echo",
      text: WORDS,
      images: 2,
      files: ["기획.pdf", "메모.txt"],
    });
  } finally {
    done();
  }
});

test("그림만 보낸 말 — 글이 섹션뿐이면 말이 비고, 칸으로만 말한다", () => {
  const { dir, done } = clone();
  try {
    const text = sent(dir, "", [PNG("a.png"), PNG("b.png")]);
    assert.ok(text.startsWith("<attachment "), "말이 없으니 섹션이 글의 머리다");
    const [out] = replay([echo(text, 2)]);
    assert.deepEqual(out, echo("", 2));
  } finally {
    done();
  }
});

test("Codex 의 재생은 images 가 0 이다 — 그림 섹션의 수가 대신 센다, 벤더가 더 많이 세면 그 수가 이긴다", () => {
  const { dir, done } = clone();
  try {
    const text = sent(dir, WORDS, [PNG("a.png"), PNG("b.png")]);
    assert.deepEqual(replay([echo(text, 0)])[0], echo(WORDS, 2));
    // 핀의 크롭 같은 보기만 하는 그림은 섹션이 없다 — 비전 블록이 더 많다.
    assert.deepEqual(replay([echo(text, 3)])[0], echo(WORDS, 3));
  } finally {
    done();
  }
});

test("텍스트 첨부 — 본문은 AI 에게 필요한 글이지 사용자가 본 말이 아니다: 걷고 이름만 남는다", () => {
  const { dir, done } = clone();
  try {
    const text = sent(dir, WORDS, [
      TEXT("요구사항.md", "# 요구사항\n\n- 버튼은 파랗게\n- 간격 16px"),
    ]);
    assert.match(text, /type="text\/plain">\n# 요구사항/);
    const [out] = replay([echo(text)]);
    assert.deepEqual(out, { kind: "user.echo", text: WORDS, images: 0, files: ["요구사항.md"] });
  } finally {
    done();
  }
});

test("텍스트 첨부의 본문에 닫는 태그가 있어도 섹션을 일찍 닫지 않는다", () => {
  const { dir, done } = clone();
  try {
    // 본문이 `</attachment>` 뒤에 빈 줄과 `<attachment name=` 까지 잇는 병적인 경우는 섹션 둘로 읽힌다 —
    // 말은 그대로 걷히고 files 에 이름이 하나 더 설 뿐이다(첫 번째로 맞는 끝을 고르는 값).
    const body = [
      "앞 문단",
      "</attachment>",
      '<attachment name="가짜" type="text/plain">',
      "뒤 문단</attachment>",
      "끝",
    ].join("\n");
    const text = sent(dir, WORDS, [TEXT("html-조각.txt", body), PNG()]);
    const [out] = replay([echo(text, 1)]);
    assert.deepEqual(out, { kind: "user.echo", text: WORDS, images: 1, files: ["html-조각.txt"] });
  } finally {
    done();
  }
});

test("길어서 잘린 텍스트 첨부 — 닫는 태그 뒤의 안내 줄까지 한 덩이로 걷는다", () => {
  const { dir, done } = clone();
  try {
    const body = `${"긴 글 한 줄\n".repeat(30_000)}끝`;
    const text = sent(dir, WORDS, [TEXT("긴-문서.txt", body), PNG()]);
    assert.match(text, /\[첨부가 길어 앞부분만 실었다 — /, "잘림 안내가 실렸다");
    const [out] = replay([echo(text, 1)]);
    assert.deepEqual(out, { kind: "user.echo", text: WORDS, images: 1, files: ["긴-문서.txt"] });
  } finally {
    done();
  }
});

test("사용자 말 속의 태그처럼 보이는 글은 그대로다 — 섹션이 뒤따라도 앞의 글을 먹지 않는다", () => {
  const { dir, done } = clone();
  try {
    const words = [
      "이 </attachment> 는 뭐예요?",
      "",
      '<attachment name="x" type="y">라고 쓴 글도 있어요</attachment> 그 뒤에도 말이 이어져요',
      "",
      "마지막 문단 </attachment>",
    ].join("\n");
    const text = sent(dir, words, [PNG()]);
    const [out] = replay([echo(text, 1)]);
    assert.deepEqual(out, echo(words, 1), "사용자가 쓴 태그 글은 하나도 지워지지 않는다");

    // 섹션이 없는 말은 같은 객체로 돌아온다.
    const plain = echo(words);
    assert.equal(replay([plain])[0], plain);
  } finally {
    done();
  }
});

test("글 끝까지 섹션으로 이어지지 않으면 걷지 않는다 — 뒤에 다른 글이 붙은 글은 건드리지 않는다", () => {
  const section =
    '<attachment name="a.png" type="image/png" path="/x/a.png">저장됐어요</attachment>';
  const withTrailer = `${WORDS}\n\n${section}\n\n그 뒤에 이어 쓴 말`;
  assert.equal(stripAttachmentSections(withTrailer).text, withTrailer);
  assert.equal(stripAttachmentSections(`${WORDS}\n\n${section}`).text, WORDS);
  // 빈 줄 뒤가 아니면 섹션의 시작이 아니다.
  const inline = `${WORDS} ${section}`;
  assert.equal(stripAttachmentSections(inline).text, inline);
});

test("태그 모양 글이 아주 많아도 빠르고 말은 그대로다 — 끝이 섹션의 끝맺음이 아니면 훑지 않는다", () => {
  const words = `말${'\n\n<attachment name="a" type="t">\n본문'.repeat(5_000)}`;
  const startedAt = Date.now();
  assert.equal(stripAttachmentSections(words).text, words);
  assert.ok(Date.now() - startedAt < 3_000, "여는 태그가 5천 개여도 선형이다");
  // 한 줄이 아주 긴 여는 태그도 되돌아가며 느려지지 않는다.
  const long = `말\n\n<attachment name="${'" type="'.repeat(20_000)}</attachment>`;
  const longStartedAt = Date.now();
  assert.equal(stripAttachmentSections(long).text, long);
  assert.ok(Date.now() - longStartedAt < 3_000);
});

test("보던 화면 줄과 섹션이 함께 있어도 둘 다 걷힌다 — 말은 그대로", () => {
  const { dir, done } = clone();
  try {
    const text = sent(dir, WORDS, [PNG(), PDF()]);
    assert.match(text, /\[지금 사용자가 보는 화면: \/members\]/);
    assert.deepEqual(replay([echo(text, 1)])[0], {
      kind: "user.echo",
      text: WORDS,
      images: 1,
      files: ["기획.pdf"],
    });
  } finally {
    done();
  }
});

test("다른 사건은 건드리지 않는다 — AI 의 답에 섹션 모양이 있어도 그대로", () => {
  const section =
    '<attachment name="a.png" type="image/png" path="/x/a.png">저장됐어요</attachment>';
  const answer: ChatEvent = { kind: "text.done", blockId: "b", text: section, agentId: null };
  assert.equal(stripReplayedAttachments([answer])[0], answer);
});

test("내보내기 — 재생을 거친 대화에는 경로도 안내 문장도 없고, 첨부는 칸으로 적힌다", () => {
  const { dir, done } = clone();
  try {
    const text = sent(dir, WORDS, [PNG(), TEXT("메모.txt", "내용")]);
    const markdown = transcriptToMarkdown(
      replay([echo(text, 1)]),
      "회원 목록",
      new Date(2026, 9, 8),
    );
    assert.ok(!markdown.includes("<attachment"), "섹션 태그가 없다");
    assert.ok(!markdown.includes(dir), "저장 경로가 없다");
    assert.ok(!markdown.includes("이 경로에 저장됐"), "안내 문장이 없다");
    assert.ok(!markdown.includes("보는 화면"), "보던 화면 줄도 없다");
    assert.match(markdown, /\*\*나\*\* \(이미지 1장, 메모\.txt\)\n\n이 화면에서 로고를 바꿔 줘$/);

    // 걷기 전의 글은 그대로 내보내면 섹션이 실린다 — 이 시험이 지키는 회귀다.
    const raw = transcriptToMarkdown([echo(text, 1)], "회원 목록", new Date(2026, 9, 8));
    assert.ok(raw.includes("<attachment"));
  } finally {
    done();
  }
});

test("SessionManager.history 가 재생의 에코를 이 손질로 흘린다 — 벤더 저장소에서 읽은 글이 말풍선에 닿기 전", async () => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "colonova-replay-wire-")));
  mkdirSync(join(cwd, ".git"));
  try {
    const text = sent(cwd, WORDS, [PNG(), PDF()]);
    const registry = new DriverRegistry();
    registry.register({
      id: "claude",
      describe: () => ({ id: "claude", label: "Claude", capabilities: {} }),
      createSession: () => {
        throw new Error("이 시험은 세션을 열지 않는다");
      },
      store: {
        list: async () => [],
        has: async (id: string) => id === "stored",
        import: async () => [
          echo(text, 1),
          { kind: "text.done", blockId: "b", text: "네, 바꿨어요", agentId: null },
        ],
      },
    } as never);
    const manager = new SessionManager({ onEvent: () => {}, onState: () => {} }, registry);
    const events = await manager.history("stored", cwd);
    const first = events.find((event) => event.kind === "user.echo");
    assert.deepEqual(first, { kind: "user.echo", text: WORDS, images: 1, files: ["기획.pdf"] });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
