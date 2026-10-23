import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ServerMessage } from "@colonova-design/protocol";
import { writeConfluenceLedger } from "../dist/confluence-ledger.js";
import { confluenceLedgerFile } from "../dist/confluence-sync.js";
import { MemoryCredentialStore } from "../dist/credentials.js";
import type { DraftAiAnswer, DraftAiRequest, DraftAiRunner } from "../dist/draft-ai.js";
import { DraftPublisher } from "../dist/draft-publish.js";
import { DraftService } from "../dist/draft-service.js";
import { DraftStore } from "../dist/draft-store.js";
import type { DaemonLogger } from "../dist/log.js";
import {
  appendPlanRefs,
  buildPlanRefsSection,
  PLAN_REF_MARKER,
  readPlanRef,
  readPlanRefs,
} from "../dist/plan-refs.js";
import { type FixturePair, FixtureTransport, type RestTransport } from "../dist/rest-transport.js";

/**
 * 초안 흐름 통합 시험(2026-10-23 · 작업 E1) — 진짜 서비스 · 발행기 · 저장소 · 블록 엔진을 잇고,
 * Confluence 는 기록된 fixture 전송으로, 기획 AI 는 정해 둔 답을 돌려주는 가짜 실행기로 둔다.
 * 합성 문서(제목 합성 정책서 v0.8 · 판 4 · 블록 넷)만 쓰고 실사이트 · 진짜 Claude 는 두지 않는다.
 * 발행 게이트는 이 시험이 켜고 끄고, 끝나면 되돌린다.
 */

const SITE = "colosseum.atlassian.net";
const ROOT_ID = "9";
const PAGE_ID = "123";
const KEY = `p-${PAGE_ID}`;
const TITLE = "합성 정책서 v0.8";
const NOW = new Date("2026-10-23T01:00:00Z");
const CMD1 = "1a2b3c4d-5e6f-4a1b-8c9d-000000000001";
const CMD2 = "1a2b3c4d-5e6f-4a1b-8c9d-000000000002";
const CMD3 = "1a2b3c4d-5e6f-4a1b-8c9d-000000000003";

const HEADING_XML = "<h2>합성 정책의 적용 범위</h2>";
const PARA_XML =
  '<p>이 정책은 합성 로그인 화면에 적용한다<ac:inline-comment-marker ac:ref="anchor-1">이 부분</ac:inline-comment-marker>.</p>';
const PARA_TEXT = "이 정책은 합성 로그인 화면에 적용한다⟦c1⟧이 부분⟦/c1⟧.";
const TABLE_XML =
  "<table><tbody><tr><td>항목</td><td>값</td></tr><tr><td>재시도</td><td>3회</td></tr></tbody></table>";
const MACRO_XML =
  '<ac:structured-macro ac:name="info"><ac:rich-text-body><p>안내 매크로 문단이다.</p></ac:rich-text-body></ac:structured-macro>';
const STORAGE_V4 = [HEADING_XML, PARA_XML, TABLE_XML, MACRO_XML].join("\n");

/** 합성 문서의 원격 쪽 판 — 발행 본문을 받아 문단 · 표만 바꿔 만든다(아래 전송 기록 참조). */
const REMOTE_PARA = "<p>원격 작성자가 다듬은 문장이다.</p>";
const REMOTE_TABLE =
  "<table><tbody><tr><td>항목</td><td>값</td></tr><tr><td>재시도</td><td>5회</td></tr></tbody></table>";

const AI_TABLE_VIEW = {
  kind: "table",
  rows: [
    {
      cells: [
        { header: false, text: "항목" },
        { header: false, text: "값" },
      ],
    },
    {
      cells: [
        { header: false, text: "재시도" },
        { header: false, text: "5회 (AI 안)" },
      ],
    },
  ],
} as const;

const MY_TABLE_VIEW = {
  kind: "table",
  rows: [
    {
      cells: [
        { header: false, text: "항목" },
        { header: false, text: "값" },
      ],
    },
    {
      cells: [
        { header: false, text: "재시도" },
        { header: false, text: "7회" },
      ],
    },
  ],
} as const;

const WHOAMI_URL = "/wiki/rest/api/user/current";
const DRAFT_URL = `/wiki/api/v2/pages/${PAGE_ID}?get-draft=true&body-format=storage`;
const ANCESTORS_URL = `/wiki/api/v2/pages/${PAGE_ID}/ancestors?limit=250`;
const OPERATIONS_URL = `/wiki/api/v2/pages/${PAGE_ID}/operations`;
const PUT_URL = `/wiki/api/v2/pages/${PAGE_ID}`;

const pageJson = (id: string, title: string, storage: string, version: number) => ({
  id,
  title,
  spaceId: "SP1",
  version: { number: version, createdAt: "2026-10-23T00:00:00Z" },
  parentId: null,
  body: { storage: { value: storage, representation: "storage" } },
});

const times = <T>(count: number, make: () => T): T[] => Array.from({ length: count }, make);

/** 발행 본문의 문단 · 표만 바꿔치기 한다 — 원격이 외부에서 고친 상황의 합성 판이다.
 * 문단 앞뒤의 공백은 이웃 블록의 원문이므로 그대로 남긴다 — 바이트가 달라지면 지문도 달라진다. */
const swapParagraph = (body: string, replacement: string): string => {
  const head = body.indexOf("</h2>") + "</h2>".length;
  const tail = body.indexOf("<table");
  assert.ok(head > 4 && tail > head, "발행 본문의 문단 자리를 찾지 못했다");
  const segment = body.slice(head, tail);
  const lead = segment.slice(0, segment.indexOf("<"));
  const trail = segment.slice(segment.lastIndexOf(">") + 1);
  return `${body.slice(0, head)}${lead}${replacement}${trail}${body.slice(tail)}`;
};
const swapTable = (body: string, replacement: string): string => {
  const head = body.indexOf("<table");
  const tail = body.indexOf("</table>") + "</table>".length;
  assert.ok(head !== -1 && tail > head, "발행 본문의 표 자리를 찾지 못했다");
  return `${body.slice(0, head)}${replacement}${body.slice(tail)}`;
};

function paragraphText(
  block: { view: { kind: string; text?: string } } | undefined,
): string | null {
  return block?.view.kind === "paragraph" ? (block.view.text ?? null) : null;
}

function tableView(block: { view: { kind: string } } | undefined): {
  rows: Array<{ cells: Array<{ header: boolean; text: string }> }>;
} {
  assert.equal(block?.view.kind, "table");
  return block?.view as { rows: Array<{ cells: Array<{ header: boolean; text: string }> }> };
}

const changedMessages = (
  messages: ServerMessage[],
): Array<Extract<ServerMessage, { type: "draft.changed" }>> =>
  messages.filter(
    (message): message is Extract<ServerMessage, { type: "draft.changed" }> =>
      message.type === "draft.changed",
  );

const aiMessages = (
  messages: ServerMessage[],
): Array<Extract<ServerMessage, { type: "draft.ai" }>> =>
  messages.filter(
    (message): message is Extract<ServerMessage, { type: "draft.ai" }> =>
      message.type === "draft.ai",
  );

/** 조건이 맞아떨어질 때까지 미세 쉼 — 도는 생성의 방송을 기다린다(자지 않는다). */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    if (condition()) return;
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    await promise;
  }
  assert.fail(`조건이 끝내 맞지 않았다: ${what}`);
}

interface Rig {
  service: DraftService;
  store: DraftStore;
  home: string;
  requests: string[];
  putBodies: string[];
  messages: ServerMessage[];
  /** 다음 두 번의 PUT 을 응답 유실로 만든다 — 전송은 나가되 답을 잃는다. */
  failNextPuts(count: number): void;
  cleanup(): void;
}

function rig(runner: DraftAiRunner): Rig {
  const home = mkdtempSync(join(tmpdir(), "draft-flow-"));
  const cloneRoot = join(home, "clone");
  const readRoot = join(cloneRoot, "docs", "plans");
  mkdirSync(readRoot, { recursive: true });
  writeFileSync(join(readRoot, "COLO-policy.md"), "");
  writeConfluenceLedger(confluenceLedgerFile(cloneRoot), {
    site: SITE,
    roots: [ROOT_ID],
    lastSyncAt: null,
    pages: {
      [PAGE_ID]: {
        path: "COLO-policy",
        title: TITLE,
        version: 4,
        sections: [],
        comments: null,
      },
    },
    folders: {},
    unsupported: {},
  });

  // 원격 판 6 · 7 의 본문은 발행된 본문이 기록될 때 만든다 — 쌍의 답을 그때 채워 넣는다.
  const makePagePair = (version: number, storage: string): FixturePair => ({
    name: `문서 읽기 판 ${version}`,
    cite: "GET /wiki/api/v2/pages/123?body-format=storage — 합성 문서(2026-10-23 작업 E1)",
    request: { method: "GET", url: `/wiki/api/v2/pages/${PAGE_ID}?body-format=storage` },
    response: { status: 200, json: pageJson(PAGE_ID, TITLE, storage, version) },
  });
  const remoteV5 = makePagePair(5, "");
  const remoteV6 = makePagePair(6, "");
  const remoteV7 = makePagePair(7, "");
  const pairs: FixturePair[] = [
    ...times(20, () => ({
      name: "연결 확인",
      cite: "GET /wiki/rest/api/user/current — 합성 계정(2026-10-23 작업 E1)",
      request: { method: "GET", url: WHOAMI_URL },
      response: { status: 200, json: { accountId: "acct-1", displayName: "합성 사람" } },
    })),
    ...times(5, () => makePagePair(4, STORAGE_V4)),
    // 적용된 판(5)의 문서 읽기 — 발행이 적용되면 원격 본문이 새 기준이 되는 길이다.
    remoteV5,
    remoteV6,
    remoteV6,
    ...times(5, () => remoteV7),
    ...times(8, () => ({
      name: "윗문서 줄",
      cite: "GET /wiki/api/v2/pages/123/ancestors — 뿌리 아래임의 확인(2026-10-23 작업 E1)",
      request: { method: "GET", url: ANCESTORS_URL },
      response: { status: 200, json: { results: [{ id: ROOT_ID }, { id: "50" }] } },
    })),
    ...times(8, () => ({
      name: "문서 동작",
      cite: "GET /wiki/api/v2/pages/123/operations — 고침 권한 확인(2026-10-23 작업 E1)",
      request: { method: "GET", url: OPERATIONS_URL },
      response: {
        status: 200,
        json: {
          operations: [
            { operation: "read", targetType: "page" },
            { operation: "update", targetType: "page" },
          ],
        },
      },
    })),
    ...times(8, () => ({
      name: "원격 초안 없음",
      cite: "GET /wiki/api/v2/pages/123?get-draft=true — 임시 저장 초안 확인(2026-10-23 작업 E1)",
      request: { method: "GET", url: DRAFT_URL },
      response: {
        status: 200,
        json: {
          id: PAGE_ID,
          status: "current",
          version: { number: 4 },
          body: { storage: { value: "", representation: "storage" } },
        },
      },
    })),
    {
      name: "문서 갱신",
      cite: "PUT /wiki/api/v2/pages/123 — 발행의 조건부 갱신(2026-10-23 작업 E1)",
      request: {
        method: "PUT",
        url: PUT_URL,
        bodyContains: [
          // 고치지 않은 블록은 원문 그대로 나간다 — 매크로 · 코멘트 닻의 원문 바이트(fixture 본문 검사).
          '<ac:structured-macro ac:name=\\"info\\">',
          '<ac:inline-comment-marker ac:ref=\\"anchor-1\\">',
        ],
      },
      response: { status: 200, json: { id: PAGE_ID, title: TITLE, version: { number: 5 } } },
    },
  ];

  const requests: string[] = [];
  const putBodies: string[] = [];
  let failedPutsLeft = 0;
  const fixture = new FixtureTransport(pairs);
  const transport: RestTransport = {
    async request(input) {
      requests.push(`${input.method} ${input.url}`);
      if (input.method === "PUT") {
        const raw = new TextDecoder().decode(input.body ?? new Uint8Array());
        if (failedPutsLeft > 0) {
          failedPutsLeft -= 1;
          throw new Error("합성 전송 실패 — 응답이 유실렸다");
        }
        putBodies.push(raw);
        const parsed = JSON.parse(raw) as { body?: { value?: string } };
        const published = parsed.body?.value ?? "";
        remoteV5.response.json = pageJson(PAGE_ID, TITLE, published, 5);
        remoteV6.response.json = pageJson(PAGE_ID, TITLE, swapParagraph(published, REMOTE_PARA), 6);
        remoteV7.response.json = pageJson(PAGE_ID, TITLE, swapTable(published, REMOTE_TABLE), 7);
      }
      return await fixture.request(input);
    },
  };

  const setting: Record<string, string> = {
    "confluenceSite:demo": SITE,
    "confluenceRootId:demo": ROOT_ID,
  };
  const credentials = new MemoryCredentialStore();
  void credentials.save("confluence-pat", "me@example.com\ntok");
  const messages: ServerMessage[] = [];
  const logger: DaemonLogger = { info() {}, warn() {}, error() {} };
  const service = new DraftService({
    registry: { activeSlug: () => "demo", paths: (slug) => ({ root: join(home, slug) }) },
    machineSetting: { get: (key) => setting[key] ?? null },
    credentials,
    workspaceRoot: () => cloneRoot,
    claudeExecutable: () => "/usr/local/bin/claude",
    broadcast: (message) => messages.push(message),
    logger,
    ai: runner,
    publisher: new DraftPublisher(),
    now: () => NOW,
    transport: () => transport,
  });
  return {
    service,
    store: new DraftStore(join(home, "demo", "plans"), () => NOW),
    home,
    requests,
    putBodies,
    messages,
    failNextPuts(count: number) {
      failedPutsLeft = count;
    },
    cleanup() {
      rmSync(home, { recursive: true, force: true });
    },
  };
}

test("초안 흐름 — 열고 고치고 묻고 채택해 발행하고, 원격 바뀜에 맞춘 뒤 유실된 결과를 확인한다", async () => {
  const aiCalls: DraftAiRequest[] = [];
  const rig1 = rig(async (request, callbacks) => {
    aiCalls.push(request);
    callbacks.onText("표의 값을 다듬는다");
    return {
      reply: "표의 재시도 값을 다듬고 앞에 문단을 붙였다.",
      summary: "표 값 다듬기와 앞 문단",
      ops: [
        { opId: "op-table", type: "replace", blockId: "b2", view: { ...AI_TABLE_VIEW } },
        {
          opId: "op-insert",
          type: "insert",
          afterBlockId: null,
          view: { kind: "paragraph", text: "AI 가 붙인 첫 문단이다." },
        },
      ],
      sdkSessionId: "sess-draft-flow",
    } satisfies DraftAiAnswer;
  });
  const previousGate = process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH;
  delete process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH;
  const putCount = () => rig1.requests.filter((row) => row.startsWith("PUT")).length;
  try {
    // ————— 1. 열기 — 서서 넷 블록, 모두 같음 —————
    const opened = await rig1.service.open(PAGE_ID);
    assert.equal(opened.docKey, KEY);
    assert.equal(opened.kind, "existing");
    assert.equal(opened.title, TITLE);
    assert.equal(opened.baseVersion, 4);
    assert.equal(opened.revision, 0);
    assert.equal(opened.state, "editing");
    assert.deepEqual(opened.stage, { notation: "0.8", closed: false });
    assert.deepEqual(
      opened.blocks.map((block) => [block.id, block.view.kind, block.status, block.editable]),
      [
        ["b0", "heading", "same", true],
        ["b1", "paragraph", "same", true],
        ["b2", "table", "same", true],
        ["b3", "preserved", "same", false],
      ],
    );
    // 코멘트 닻은 토큰으로 자리를 지키고, 매크로는 기계 이름으로만 보인다.
    assert.deepEqual(opened.blocks[1]?.tokens, { c1: "comment-anchor" });
    assert.equal(paragraphText(opened.blocks[1]), PARA_TEXT);
    assert.deepEqual(opened.blocks[3]?.view, { kind: "preserved", label: "macro:info" });
    assert.deepEqual(changedMessages(rig1.messages).at(-1), {
      type: "draft.changed",
      docKey: KEY,
      revision: 0,
      state: "editing",
    });

    // ————— 2. 고치기 — 문단 글(닻 토큰은 지킨다) → changed 하나, 개정 1 —————
    const edited = await rig1.service.edit(KEY, 0, [
      {
        type: "set",
        blockId: "b1",
        view: {
          kind: "paragraph",
          text: "이 정책은 합성 로그인 화면의 모든 문서에 적용한다⟦c1⟧이 부분⟦/c1⟧.",
        },
      },
    ]);
    assert.equal(edited.revision, 1);
    assert.deepEqual(
      edited.blocks.map((block) => block.status),
      ["same", "changed", "same", "same"],
    );

    // ————— 3. 묻기 — 가짜 AI 가 표 replace 와 맨 앞 insert 를 낸다 → 방송 순서 · 변경안 저장 —————
    const asked = rig1.service.ask(KEY, "표의 재시도 값을 다듬어 줘", []);
    assert.equal(typeof asked.threadId, "string");
    await until(
      () => aiMessages(rig1.messages).some((message) => message.phase === "done"),
      "done 방송",
    );
    assert.deepEqual(
      aiMessages(rig1.messages).map((message) => message.phase),
      ["started", "text", "done"],
    );
    const call = aiCalls[0];
    assert.equal(call?.resume, null);
    assert.match(call?.readRoot ?? "", /docs[/\\]plans$/);
    assert.ok(call?.prompt.includes(TITLE));
    assert.ok(call?.prompt.includes("표의 재시도 값을 다듬어 줘"));
    const threadAfterAsk = rig1.service.thread(KEY);
    assert.deepEqual(
      threadAfterAsk.messages.map((message) => message.role),
      ["user", "assistant"],
    );
    assert.equal(threadAfterAsk.proposals.length, 1);
    assert.equal(threadAfterAsk.proposals[0]?.summary, "표 값 다듬기와 앞 문단");
    assert.deepEqual(
      threadAfterAsk.proposals[0]?.ops.map((op) => [op.type, op.state]),
      [
        ["replace", "open"],
        ["insert", "open"],
      ],
    );
    const proposalId = threadAfterAsk.proposals[0]?.proposalId ?? "";

    // ————— 4. 흐름 보기와 채택 — 둘 다 채택 → 개정 2, 표 changed, 새 블록 new —————
    assert.equal(threadAfterAsk.running, false);
    const adopted = await rig1.service.adopt(KEY, proposalId, ["op-table", "op-insert"], 1);
    assert.equal(adopted.revision, 2);
    assert.match(adopted.blocks[0]?.id ?? "", /^n[0-9a-f]{12}$/);
    assert.equal(paragraphText(adopted.blocks[0]), "AI 가 붙인 첫 문단이다.");
    assert.deepEqual(
      adopted.blocks.map((block) => block.status),
      ["new", "same", "changed", "changed", "same"],
    );
    assert.equal(tableView(adopted.blocks[3]).rows[1]?.cells[1]?.text, "5회 (AI 안)");
    assert.deepEqual(
      rig1.service.thread(KEY).proposals[0]?.ops.map((op) => op.state),
      ["adopted", "adopted"],
    );
    assert.deepEqual(changedMessages(rig1.messages).at(-1), {
      type: "draft.changed",
      docKey: KEY,
      revision: 2,
      state: "editing",
    });

    // ————— 5. 게이트 꺼짐 — preview 는 publish-disabled, publish 는 실패하고 전송 없음 —————
    const blocked = await rig1.service.publishPreview(KEY);
    assert.deepEqual(blocked.blockers, ["publish-disabled"]);
    const requestsBeforeFailed = rig1.requests.length;
    const failed = await rig1.service.publish({
      docKey: KEY,
      commandId: CMD1,
      expectedRevision: 2,
    });
    assert.equal(failed.state, "failed");
    assert.equal(failed.detail, "publish-disabled");
    assert.equal(failed.version, null);
    assert.equal(rig1.store.intent(CMD1), null);
    assert.equal(
      rig1.requests.slice(requestsBeforeFailed).some((row) => row.startsWith("PUT")),
      false,
    );
    const stillEditing = await rig1.service.get(KEY);
    assert.equal(stillEditing.state, "editing");
    assert.equal(stillEditing.revision, 2);

    // ————— 6. 게이트 켬 — preview 의 원격 검사가 비고 blockers, 발행은 원문 그대로 나간다 —————
    process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH = "1";
    const ready = await rig1.service.publishPreview(KEY);
    assert.deepEqual(ready.blockers, []);
    assert.equal(ready.kind, "update");
    assert.equal(ready.baseVersion, 4);
    assert.equal(ready.remoteVersion, 4);
    assert.equal(ready.stage.required, false);
    assert.deepEqual(ready.changes, { changed: 2, inserted: 1, deleted: 0, protectedRemoved: [] });
    const applied = await rig1.service.publish({
      docKey: KEY,
      commandId: CMD1,
      expectedRevision: 2,
    });
    assert.equal(applied.state, "applied");
    assert.equal(applied.pageId, PAGE_ID);
    assert.equal(applied.version, 5);
    assert.equal(putCount(), 1);
    // PUT 본문은 고치지 않은 info 매크로와 코멘트 닻을 원문 그대로 품는다(fixture 의 bodyContains 도 같은 걸 본다).
    const sentBody = rig1.putBodies[0] ?? "";
    assert.ok(sentBody.includes('<ac:structured-macro ac:name=\\"info\\">'));
    assert.ok(sentBody.includes("안내 매크로 문단이다."));
    assert.ok(sentBody.includes('<ac:inline-comment-marker ac:ref=\\"anchor-1\\">'));
    assert.ok(sentBody.includes("5회 (AI 안)"));
    const published = await rig1.service.get(KEY);
    assert.equal(published.state, "published");
    assert.equal(published.baseVersion, 5);
    assert.equal(published.pendingCommandId, null);
    assert.ok(published.blocks.every((block) => block.status === "same"));
    assert.deepEqual(changedMessages(rig1.messages).at(-1), {
      type: "draft.changed",
      docKey: KEY,
      revision: published.revision,
      state: "published",
    });

    // ————— 7. 같은 명령의 다시 발행 — 전송 없이 저장된 결과 —————
    const requestsBeforeReplay = rig1.requests.length;
    const replayed = await rig1.service.publish({
      docKey: KEY,
      commandId: CMD1,
      expectedRevision: published.revision,
    });
    assert.equal(replayed.state, "applied");
    assert.equal(replayed.version, 5);
    assert.match(replayed.detail, /저장된 결과/);
    // 같은 명령은 다시 보내지 않는다 — 연결 확인(whoAmI) 빼고는 아무 요청도 없다.
    assert.deepEqual(
      rig1.requests.slice(requestsBeforeReplay).filter((row) => !row.includes(WHOAMI_URL)),
      [],
    );
    assert.equal((await rig1.service.get(KEY)).revision, published.revision);

    // ————— 8. 근거 스냅샷 — 첨부 첫 줄 표식 · 되읽기 · 기록 · 절 —————
    const snap = rig1.service.snapshot({ docKey: KEY });
    const snapText = Buffer.from(snap.attachment.data, "base64").toString("utf8");
    assert.ok(snapText.startsWith(`<!-- ${PLAN_REF_MARKER} `));
    const ref = readPlanRef(snapText);
    assert.deepEqual(ref, {
      title: TITLE,
      pageId: PAGE_ID,
      docKey: KEY,
      url: `https://${SITE}/wiki/pages/viewpage.action?pageId=${PAGE_ID}`,
      version: 5,
      revision: published.revision,
      published: false,
      sections: [],
    });
    const refsFile = join(rig1.home, "plan-refs.jsonl");
    appendPlanRefs(refsFile, [{ at: NOW.toISOString(), sessionId: "sess-planref", ref }]);
    const entries = readPlanRefs(refsFile, null);
    assert.equal(entries.length, 1);
    const section = buildPlanRefsSection(entries);
    assert.ok(section !== null);
    assert.ok(section.startsWith("### 기획 근거"));
    assert.match(
      section,
      new RegExp(`${TITLE} — 아직 발행하지 않은 초안\\(개정 ${published.revision}\\)`),
    );
    assert.ok(section.includes("판 5"));
    assert.ok(!section.includes("재시도"));

    // ————— 9. 외부 편집 — 원격이 판 6 으로 문단을 바꿈 → remote-newer, 다시 맞추면 문단은 원격 · 표는 내 것 —————
    const beforeTune = await rig1.service.get(KEY);
    const revBeforeTune = beforeTune.revision;
    // 발행 뒤 초안은 새 기준에서 다시 선다 — 블록 id 는 그 기준의 자리 번호라 표를 종류로 찾는다(앞에 새 제목이 들어왔다).
    const tableId = beforeTune.blocks.find((block) => block.view.kind === "table")?.id ?? "";
    assert.equal(tableId, "b3");
    const retuned = await rig1.service.edit(KEY, revBeforeTune, [
      { type: "set", blockId: tableId, view: { ...MY_TABLE_VIEW } },
    ]);
    assert.equal(retuned.revision, revBeforeTune + 1);
    const newer = await rig1.service.publishPreview(KEY);
    assert.deepEqual(newer.blockers, ["remote-newer"]);
    assert.equal(newer.remoteVersion, 6);
    assert.equal((await rig1.service.get(KEY)).observedVersion, 6);
    const rebased = await rig1.service.rebase(KEY);
    assert.equal(rebased.state, "editing");
    assert.equal(rebased.baseVersion, 6);
    assert.equal(rebased.observedVersion, null);
    assert.deepEqual(
      rebased.blocks.map((block) => block.status),
      ["same", "same", "same", "changed", "same"],
    );
    // 원격 문단이 반영되고 내 표는 지켜진다 — 충돌은 없다.
    assert.equal(paragraphText(rebased.blocks[2]), "원격 작성자가 다듬은 문장이다.");
    assert.equal(tableView(rebased.blocks[3]).rows[1]?.cells[1]?.text, "7회");
    assert.ok(rebased.blocks.every((block) => block.theirs === undefined));

    // ————— 10. 충돌 — 원격이 같은 표를 판 7 로 바꿈 → rebase 뒤 conflict, 고르면 editing —————
    const conflicted = await rig1.service.rebase(KEY);
    assert.equal(conflicted.state, "conflict");
    const conflictBlock = conflicted.blocks.find((block) => block.status === "conflict");
    assert.equal(conflictBlock?.theirs?.kind, "table");
    assert.equal(tableView(conflictBlock).rows[1]?.cells[1]?.text, "7회");
    assert.equal(tableView({ view: conflictBlock?.theirs }).rows[1]?.cells[1]?.text, "5회");
    const conflictPreview = await rig1.service.publishPreview(KEY);
    assert.ok(conflictPreview.blockers.includes("conflict-open"));
    const resolved = await rig1.service.resolve(KEY, conflictBlock?.id ?? "", "mine");
    assert.equal(resolved.state, "editing");
    assert.deepEqual(
      resolved.blocks.map((block) => block.status),
      ["same", "same", "same", "changed", "same"],
    );
    assert.equal(tableView(resolved.blocks[3]).rows[1]?.cells[1]?.text, "7회");
    assert.deepEqual(changedMessages(rig1.messages).at(-1), {
      type: "draft.changed",
      docKey: KEY,
      revision: resolved.revision,
      state: "editing",
    });

    // ————— 11. 응답 유실 — PUT 이 던지면 unknown · 편집 잠김, 재검사로 풀리고 종료로도 풀린다 —————
    rig1.failNextPuts(2);
    const revBeforeLost = (await rig1.service.get(KEY)).revision;
    const lost = await rig1.service.publish({
      docKey: KEY,
      commandId: CMD2,
      expectedRevision: revBeforeLost,
    });
    assert.equal(lost.state, "unknown");
    assert.equal(lost.version, null);
    const locked = await rig1.service.get(KEY);
    assert.equal(locked.state, "result-unknown");
    assert.equal(locked.pendingCommandId, CMD2);
    await assert.rejects(
      rig1.service.edit(KEY, locked.revision, [{ type: "title", title: "합성 정책서 v0.9" }]),
      /발행이 도는 동안에는/,
    );
    const putsAfterLost = putCount();
    assert.equal(putsAfterLost, 2);
    const rechecked = await rig1.service.publishRecheck(CMD2);
    assert.equal(rechecked.state, "not-applied");
    const unlocked = await rig1.service.get(KEY);
    assert.equal(unlocked.state, "editing");
    assert.equal(unlocked.pendingCommandId, null);
    assert.equal(putCount(), putsAfterLost); // 재검사는 다시 보내지 않는다
    const lostAgain = await rig1.service.publish({
      docKey: KEY,
      commandId: CMD3,
      expectedRevision: unlocked.revision,
    });
    assert.equal(lostAgain.state, "unknown");
    assert.equal((await rig1.service.get(KEY)).state, "result-unknown");
    const closed = await rig1.service.publishClose(CMD3);
    assert.equal(closed.state, "closed-unconfirmed");
    const freed = await rig1.service.get(KEY);
    assert.equal(freed.state, "editing");
    assert.equal(freed.pendingCommandId, null);
    assert.equal(putCount(), 3); // 성공 한 번 + 유실 둘 — 그 뒤의 확인 · 종료는 전송하지 않는다
    // 종료로 잠금이 풀렸으니 편집이 다시 된다.
    const retitled = await rig1.service.edit(KEY, freed.revision, [
      { type: "title", title: "합성 정책서 v0.9" },
    ]);
    assert.equal(retitled.state, "editing");
    assert.equal(retitled.revision, freed.revision + 1);
    assert.equal(rig1.service.snapshot({ docKey: KEY }).ref.title, "합성 정책서 v0.9");
  } finally {
    if (previousGate === undefined) delete process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH;
    else process.env.COLONOVA_DESIGN_CONFLUENCE_PUBLISH = previousGate;
    rig1.cleanup();
  }
});
