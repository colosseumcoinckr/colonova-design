import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import type { Options, Query, query as sdkQuery } from "@anthropic-ai/claude-agent-sdk";
import type { DraftMessage, DraftView } from "@colonova-design/protocol";
import {
  buildDraftPrompt,
  createDraftAiRunner,
  DRAFT_AI_OUTPUT_SCHEMA,
  type DraftAiRequest,
  draftAiEnv,
} from "../dist/draft-ai.js";

/**
 * 기획 AI 실행기(2026-10-23 · 작업 B1) — 진짜 Claude 를 부르지 않는다. 가짜 queryFn 이 받은
 * options 를 기록하고 정해 둔 메시지(시스템 init · 스트림 델타 · Read 도구 · 결과의
 * structured_output)를 내놓는다. 권한의 좁힘 · confine 훅의 가둠 · 누적 설명 · 실패와 중단 ·
 * 묻는 글의 재료와 한도 · 답 모양의 보존 없음을 본다.
 */

type QueryFn = typeof sdkQuery;

const ROOT = mkdtempSync(join(tmpdir(), "draft-ai-"));
const OUTSIDE = mkdtempSync(join(tmpdir(), "draft-ai-out-"));
mkdirSync(join(ROOT, "안"));
symlinkSync(OUTSIDE, join(ROOT, "밖링크"), "dir");
symlinkSync(join(ROOT, "안"), join(ROOT, "안링크"), "dir");

test.after(() => {
  rmSync(ROOT, { recursive: true, force: true });
  rmSync(OUTSIDE, { recursive: true, force: true });
});

const INIT = { type: "system", subtype: "init", session_id: "sdk-init" };

const ANSWER = { reply: "이렇게 다듬는다", summary: "문단을 다듬는다", ops: [] };

const delta = (text: string) => ({
  type: "stream_event",
  event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
});

const readUse = (filePath: string) => ({
  type: "assistant",
  message: {
    content: [{ type: "tool_use", id: "tu1", name: "Read", input: { file_path: filePath } }],
  },
});

const success = (output: unknown, sessionId = "sdk-result") => ({
  type: "result",
  subtype: "success",
  is_error: false,
  session_id: sessionId,
  structured_output: output,
});

/** 가짜 queryFn — 받은 prompt · options 를 기록하고 정해 둔 메시지를 async iterable 로 내놓는다. */
function fakeQuery(messages: unknown[]) {
  const calls: Array<{ prompt: string; options: Options }> = [];
  const fn = ((input: { prompt: string; options?: Options }) => {
    calls.push({ prompt: input.prompt, options: input.options ?? {} });
    return (async function* () {
      for (const message of messages) yield message;
    })() as unknown as Query;
  }) as unknown as QueryFn;
  return { fn, calls };
}

function collector() {
  return {
    texts: [] as string[],
    reads: [] as string[],
    onText(text: string) {
      this.texts.push(text);
    },
    onRead(absPath: string) {
      this.reads.push(absPath);
    },
  };
}

function makeRequest(overrides: Partial<DraftAiRequest> = {}): {
  request: DraftAiRequest;
  controller: AbortController;
} {
  const controller = new AbortController();
  return {
    controller,
    request: {
      executable: "/도구/claude",
      readRoot: ROOT,
      resume: null,
      prompt: "이 문단을 다듬어 준다",
      signal: controller.signal,
      ...overrides,
    },
  };
}

type PreToolUseHook = (input: unknown) => Promise<unknown>;

function confineOf(call: { options: Options } | undefined): PreToolUseHook {
  const hook: PreToolUseHook | undefined = call?.options.hooks?.PreToolUse?.[0]?.hooks[0];
  assert.ok(hook, "PreToolUse 훅이 options 에 없다");
  return hook;
}

/** 거절 판의 사유를 읽는다 — 허용(빈 객체)이면 null. */
function denyReason(result: unknown): string | null {
  if (typeof result !== "object" || result === null || !("hookSpecificOutput" in result)) {
    return null;
  }
  const output = result.hookSpecificOutput;
  if (typeof output !== "object" || output === null || !("permissionDecision" in output)) {
    return null;
  }
  if (output.permissionDecision !== "deny" || typeof output.permissionDecisionReason !== "string") {
    return null;
  }
  return output.permissionDecisionReason;
}

test("묻는 요청은 읽기 3 도구와 닫힌 설정 · 출력 모양 · 이어질 세션으로 간다", async () => {
  const { fn, calls } = fakeQuery([INIT, success(ANSWER)]);
  const cb = collector();
  const { request } = makeRequest({ resume: "이어지는-세션" });
  const answer = await createDraftAiRunner(fn)(request, cb);
  const options = calls[0].options;
  assert.equal(calls[0].prompt, request.prompt);
  assert.equal(options.pathToClaudeCodeExecutable, request.executable);
  assert.equal(options.cwd, request.readRoot);
  assert.deepEqual(options.tools, ["Read", "Grep", "Glob"]);
  assert.deepEqual(options.allowedTools, ["Read", "Grep", "Glob"]);
  assert.deepEqual(options.settingSources, []);
  assert.equal(options.strictMcpConfig, true);
  assert.deepEqual(options.mcpServers, {});
  assert.deepEqual(options.managedSettings, { allowedMcpServers: [] });
  assert.equal(options.maxTurns, 12);
  assert.equal(options.includePartialMessages, true);
  assert.equal(options.persistSession, true);
  assert.equal(options.resume, "이어지는-세션");
  assert.equal(options.outputFormat?.type, "json_schema");
  assert.equal(options.outputFormat?.schema, DRAFT_AI_OUTPUT_SCHEMA);
  assert.ok(options.abortController, "SDK 중단이 request 신호와 이어지지 않았다");
  assert.ok(options.hooks?.PreToolUse?.[0]?.matcher === "Read|Grep|Glob");
  assert.equal(answer.reply, ANSWER.reply);
  assert.equal(answer.summary, ANSWER.summary);
  assert.deepEqual(answer.ops, []);
  assert.equal(answer.sdkSessionId, "sdk-result");
});

test("요청 환경은 허용 목록만 남는다 — 비밀과 앱 키는 거르고 자기 업데이트는 끊는다", async () => {
  process.env.ANTHROPIC_API_KEY = "api-키";
  process.env.COLONOVA_DESIGN_CONFLUENCE_TOKEN = "앱-토큰";
  process.env.CLAUDE_CODE_EXTRA = "남는다";
  try {
    const { fn, calls } = fakeQuery([success(ANSWER)]);
    await createDraftAiRunner(fn)(makeRequest().request, collector());
    const env = calls[0].options.env ?? {};
    assert.equal(env.DISABLE_AUTOUPDATER, "1");
    assert.equal("ANTHROPIC_API_KEY" in env, false);
    assert.equal("COLONOVA_DESIGN_CONFLUENCE_TOKEN" in env, false);
    assert.equal(env.CLAUDE_CODE_EXTRA, "남는다");
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.COLONOVA_DESIGN_CONFLUENCE_TOKEN;
    delete process.env.CLAUDE_CODE_EXTRA;
  }
});

test("draftAiEnv 는 허용 목록의 키만 남기고 받은 객체를 건드리지 않는다", () => {
  const input: NodeJS.ProcessEnv = {
    PATH: "/usr/bin",
    LC_ALL: "ko_KR.UTF-8",
    XDG_CACHE_HOME: "/캐시",
    https_proxy: "http://proxy:8080",
    HTTPS_PROXY: "http://proxy:8080",
    CLAUDE_CONFIG_DIR: "/설정",
    ANTHROPIC_BASE_URL: "https://api.example.com",
    SystemRoot: "C:\\Windows",
    ComSpec: "cmd.exe",
    ANTHROPIC_API_KEY: "api-키",
    COLONOVA_DESIGN_CONFLUENCE_TOKEN: "앱-토큰",
    DISABLE_AUTOUPDATER: "0",
  };
  const env = draftAiEnv(input);
  assert.equal(env.DISABLE_AUTOUPDATER, "1");
  for (const key of ["PATH", "LC_ALL", "XDG_CACHE_HOME", "https_proxy", "HTTPS_PROXY"]) {
    assert.equal(env[key], input[key], `${key} 가 남아야 한다`);
  }
  for (const key of ["CLAUDE_CONFIG_DIR", "ANTHROPIC_BASE_URL", "SystemRoot", "ComSpec"]) {
    assert.equal(env[key], input[key], `${key} 가 남아야 한다`);
  }
  for (const key of ["ANTHROPIC_API_KEY", "COLONOVA_DESIGN_CONFLUENCE_TOKEN"]) {
    assert.equal(key in env, false, `${key} 가 남았다`);
  }
  assert.equal(input.ANTHROPIC_API_KEY, "api-키");
  assert.equal(input.DISABLE_AUTOUPDATER, "0");
});

test("confine 훅은 readRoot 안의 경로만 두고 밖 · `..` · 심볼릭 링크 밖은 막는다", async () => {
  const { fn, calls } = fakeQuery([success(ANSWER)]);
  await createDraftAiRunner(fn)(makeRequest().request, collector());
  const hook = confineOf(calls[0]);
  const inside = await hook({
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_input: { file_path: join(ROOT, "기획서/a.md") },
  });
  assert.deepEqual(inside, {});
  const none = await hook({
    hook_event_name: "PreToolUse",
    tool_name: "Grep",
    tool_input: { pattern: "찾는다" },
  });
  assert.deepEqual(none, {}, "경로가 없으면 cwd(readRoot) 자신을 본다");
  const missing = await hook({
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_input: { file_path: join(ROOT, "없는폴더/새문서.md") },
  });
  assert.deepEqual(missing, {}, "없는 경로는 있는 상위로 확인한다");
  const linkIn = await hook({
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_input: { file_path: "안링크/문서.md" },
  });
  assert.deepEqual(linkIn, {}, "안을 가리키는 심볼릭 링크는 둔다");
  for (const toolInput of [
    { file_path: join(ROOT, "..", "밖.md") },
    { file_path: "/etc/hosts" },
    { path: "/etc" },
    { file_path: "밖링크/문서.md" },
    // 물결표 경로 — CLI 가 홈으로 풀면 가둠이 무너진다. 실측 전까지는 닫는다(2026-10-23 · 검토 의심 1).
    { file_path: "~/x" },
    { file_path: "~/.ssh/config" },
    { path: "~" },
  ]) {
    const reason = denyReason(
      await hook({ hook_event_name: "PreToolUse", tool_name: "Read", tool_input: toolInput }),
    );
    assert.ok(reason !== null, `거절해야 한다: ${JSON.stringify(toolInput)}`);
    assert.equal(reason.includes(ROOT), false, "거절 사유에 경로를 싣지 않는다");
  }
  // Glob 의 pattern 이 폴더 밖을 가리키면 막는다. Grep 의 pattern 은 정규식이라 막지 않는다.
  for (const pattern of ["/etc/*", "../**/*.md", "~/**/*.md", "~"]) {
    const reason = denyReason(
      await hook({ hook_event_name: "PreToolUse", tool_name: "Glob", tool_input: { pattern } }),
    );
    assert.ok(reason !== null, `Glob 을 거절해야 한다: ${pattern}`);
  }
  assert.deepEqual(
    await hook({
      hook_event_name: "PreToolUse",
      tool_name: "Glob",
      tool_input: { pattern: "**/*.md" },
    }),
    {},
  );
  assert.deepEqual(
    await hook({
      hook_event_name: "PreToolUse",
      tool_name: "Grep",
      tool_input: { pattern: "/api/v2" },
    }),
    {},
  );
});

test("설명은 누적해 흐르고 읽은 파일은 절대 경로로 알린다", async () => {
  const { fn } = fakeQuery([
    INIT,
    delta("첫 "),
    delta("설명"),
    readUse("기획서/a.md"),
    success({ reply: "답", summary: "요약", ops: [{ type: "title", title: "새 제목" }] }, "sdk-2"),
  ]);
  const cb = collector();
  const answer = await createDraftAiRunner(fn)(makeRequest().request, cb);
  assert.ok(cb.texts.length > 0, "스트림 조각에서 설명이 흘러야 한다");
  assert.equal(cb.texts.at(-1), "첫 설명");
  assert.deepEqual(cb.reads, [resolve(ROOT, "기획서/a.md")]);
  assert.equal(answer.reply, "답");
  assert.equal(answer.summary, "요약");
  assert.deepEqual(answer.ops, [{ type: "title", title: "새 제목" }]);
  assert.equal(answer.sdkSessionId, "sdk-2");
});

test("세션 표식은 init 이 없으면 결과의 것을 쓴다", async () => {
  const { fn } = fakeQuery([success(ANSWER, "sdk-검증")]);
  const answer = await createDraftAiRunner(fn)(makeRequest().request, collector());
  assert.equal(answer.sdkSessionId, "sdk-검증");
});

test("실패한 결과와 답이 없는 끝은 오류를 던진다", async () => {
  const runner = createDraftAiRunner;
  const { request } = makeRequest();
  await assert.rejects(
    runner(fakeQuery([INIT, { type: "result", subtype: "error_max_turns", is_error: true }]).fn)(
      request,
      collector(),
    ),
    /끝내지 못했다/,
  );
  await assert.rejects(
    runner(fakeQuery([INIT]).fn)(request, collector()),
    /끝내지 못했다/,
    "결과 메시지가 없어도 던진다",
  );
  await assert.rejects(
    runner(fakeQuery([{ ...success(ANSWER), is_error: true }]).fn)(request, collector()),
    /끝내지 못했다/,
  );
});

test("structured_output 의 모양이 틀리면 오류를 던진다", async () => {
  const runner = createDraftAiRunner;
  const { request } = makeRequest();
  for (const output of [
    undefined,
    null,
    { summary: "요약", ops: [] },
    { reply: 1, summary: "요약", ops: [] },
    { reply: "답", summary: 2, ops: [] },
    { reply: "답", summary: "요약", ops: "배열이 아니다" },
  ]) {
    await assert.rejects(
      runner(fakeQuery([success(output)]).fn)(request, collector()),
      /모양이 맞지 않다/,
      `거절해야 한다: ${JSON.stringify(output)}`,
    );
  }
});

test("중단하면 오류로 끝나고 SDK 의 중단도 함께 걶는다", async () => {
  let captured: Options | undefined;
  // 기다림의 준비를 시험가에게 알린다 — 벽시계를 쓰지 않고 규칙적으로 중단시킨다.
  const ready = Promise.withResolvers<void>();
  const fn = ((input: { prompt: string; options?: Options }) => {
    captured = input.options;
    return (async function* () {
      yield INIT;
      const signal = input.options?.abortController?.signal;
      if (signal === undefined) throw new Error("묻는 요청에 SDK 중단 신호가 실리지 않았다");
      ready.resolve();
      const stop = Promise.withResolvers<never>();
      signal.addEventListener("abort", () => stop.reject(new Error("끊겼다")), { once: true });
      await stop.promise;
    })() as unknown as Query;
  }) as unknown as QueryFn;
  const { request, controller } = makeRequest();
  const pending = createDraftAiRunner(fn)(request, collector());
  await ready.promise;
  assert.equal(captured?.abortController?.signal.aborted, false);
  controller.abort();
  await assert.rejects(pending, /중단되었/);
  assert.equal(captured?.abortController?.signal.aborted, true);
});

function makeDraft(overrides: Partial<DraftView> = {}): DraftView {
  return {
    docKey: "p-123",
    kind: "existing",
    pageId: "123",
    site: "https://colosseum.atlassian.net",
    title: "로그인 화면 기획 v0.8",
    baseTitle: "로그인 화면",
    baseVersion: 4,
    revision: 3,
    state: "editing",
    parent: { id: "9", type: "page", title: "기획 루트" },
    stage: { notation: "0.8", closed: false },
    observedVersion: null,
    pendingCommandId: null,
    updatedAt: "2026-10-23T09:30:00.000Z",
    blocks: [
      {
        id: "b0",
        view: { kind: "heading", level: 2, text: "화면 흐름" },
        editable: true,
        tokens: {},
        status: "same",
      },
      {
        id: "b1",
        view: { kind: "paragraph", text: "첫 문단 **굵게** ⟦t1⟧" },
        editable: true,
        tokens: { t1: "macro:info" },
        status: "same",
      },
      {
        id: "b2",
        view: { kind: "list", ordered: false, items: ["항목 하나", "항목 둘"] },
        editable: true,
        tokens: {},
        status: "same",
      },
      {
        id: "b3",
        view: {
          kind: "table",
          rows: [
            {
              cells: [
                { header: true, text: "단계" },
                { header: true, text: "화면" },
              ],
            },
            {
              cells: [
                { header: false, text: "1" },
                { header: false, text: "로그인" },
              ],
            },
          ],
        },
        editable: true,
        tokens: {},
        status: "same",
      },
      {
        id: "b4",
        view: { kind: "preserved", label: "macro:quote" },
        editable: false,
        tokens: { t2: "image" },
        status: "same",
      },
    ],
    ...overrides,
  };
}

function message(role: "user" | "assistant", text: string): DraftMessage {
  return { messageId: `m-${text}`, role, text, at: "2026-10-23T09:00:00.000Z" };
}

test("묻는 글은 블록 · 토큰 이름표 · 근거 문서 · 요청을 실는다", () => {
  const prompt = buildDraftPrompt({
    draft: makeDraft(),
    text: "두 문단을 합쳐 준다",
    refs: [
      {
        title: "가져온 기획서",
        version: 7,
        markdown: "본문 전문",
        sections: ["화면 흐름"],
      },
    ],
    history: [message("user", "앞에서 물었다")],
  });
  assert.ok(prompt.includes("제목: 로그인 화면 기획 v0.8"));
  assert.ok(prompt.includes("업무 단계 표기: v0.8"));
  assert.ok(prompt.includes("[b0] 제목(2단계)"));
  assert.ok(prompt.includes("[b1] 문단"));
  assert.ok(prompt.includes("[b2] 목록"));
  assert.ok(prompt.includes("- 항목 하나"));
  assert.ok(prompt.includes("[b3] 표"));
  assert.ok(prompt.includes("| 단계 | 화면 |"));
  assert.ok(prompt.includes("| --- | --- |"));
  assert.ok(prompt.includes("[b4] 보존"));
  assert.ok(prompt.includes("보존: macro:quote"));
  assert.ok(prompt.includes("토큰: t1=macro:info"));
  assert.ok(prompt.includes("문서: 가져온 기획서 (판 7, 절: 화면 흐름)"));
  assert.ok(prompt.includes("본문 전문"));
  assert.ok(prompt.includes("사람: 앞에서 물었다"));
  assert.ok(prompt.includes("[이번 요청]"));
  assert.ok(prompt.includes("두 문단을 합쳐 준다"));
});

test("긴 근거 문서는 앞부분에서 자르고 잘랐다고 적는다", () => {
  const long = `${"가".repeat(40_000)}꼬리표시`;
  const clipped = buildDraftPrompt({
    draft: makeDraft(),
    text: "물어본다",
    refs: [{ title: "긴 문서", version: null, markdown: long }],
    history: [],
  });
  assert.ok(clipped.includes("잘렸다"));
  assert.equal(clipped.includes("꼬리표시"), false);
  const whole = buildDraftPrompt({
    draft: makeDraft(),
    text: "물어본다",
    refs: [{ title: "짧은 문서", version: null, markdown: "전문이 온다" }],
    history: [],
  });
  assert.ok(whole.includes("전문이 온다"));
  assert.ok(whole.includes("판 없음"));
});

test("앞선 대화는 마지막 여섯 개만 실린다", () => {
  const history = Array.from({ length: 8 }, (_, index) =>
    message(index % 2 === 0 ? "user" : "assistant", `말${index}`),
  );
  const prompt = buildDraftPrompt({
    draft: makeDraft(),
    text: "요청",
    refs: [],
    history,
  });
  assert.equal(prompt.includes("말0"), false);
  assert.equal(prompt.includes("말1"), false);
  const spoken = prompt
    .split("\n")
    .filter((line) => /^ (?:사람|AI): /.test(line) || /^(?:사람|AI): /.test(line));
  assert.equal(spoken.length, 6);
  for (let index = 2; index < 8; index += 1) {
    assert.ok(prompt.includes(`말${index}`), `말${index} 가 실려야 한다`);
  }
});

test("답 모양에는 보존 종류가 없다 — AI 가 만들 수 있는 종류만 둔다", () => {
  const text = JSON.stringify(DRAFT_AI_OUTPUT_SCHEMA);
  assert.equal(text.includes("preserved"), false);
  assert.ok(text.includes('"additionalProperties":false'));
  assert.deepEqual(DRAFT_AI_OUTPUT_SCHEMA.required, ["reply", "summary", "ops"]);
  const defs = DRAFT_AI_OUTPUT_SCHEMA.$defs as Record<
    string,
    { oneOf: Array<{ properties: { kind?: { const: string }; type?: { const: string } } }> }
  >;
  assert.deepEqual(
    defs.view.oneOf.map((variant) => variant.properties.kind?.const),
    ["heading", "paragraph", "list", "table"],
  );
  assert.deepEqual(
    defs.op.oneOf.map((variant) => variant.properties.type?.const),
    ["replace", "insert", "delete", "title"],
  );
});
