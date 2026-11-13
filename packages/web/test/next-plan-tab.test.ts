import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  DocBlock,
  DraftCompareResult,
  DraftSnapshot,
  DraftView,
} from "@colonova-design/protocol";
import type { Daemon, MapReadResult } from "../src/lib/daemon-client.ts";
import {
  comparePlanTarget,
  createPlanComparison,
  createPlanFocusConsumer,
  createPlanRequest,
  readPlanBody,
  readPlanSources,
  sendPlanReference,
} from "../src/next/chat/plan-tab-model.ts";
import { offerMismatchToComposer, sendMismatchNow } from "../src/next/lib/mismatch-model.ts";

const draft: DraftView = {
  docKey: "draft-1",
  pageId: null,
  title: "최신 초안 제목",
  blocks: [
    {
      id: "b1",
      view: { kind: "paragraph", text: "최신 초안 본문" },
      editable: true,
      tokens: {},
      status: "new",
    },
  ],
  kind: "new",
  site: "example.test",
  baseTitle: null,
  baseVersion: null,
  revision: 3,
  state: "editing",
  parent: null,
  stage: { notation: null, closed: false },
  observedVersion: null,
  pendingCommandId: null,
  updatedAt: "2026-11-11T00:00:00Z",
};
const map: MapReadResult = {
  linked: true,
  docs: [{ pageId: "page-1", title: "원본 제목", version: 1, path: "one.md" }],
  folders: [],
  screens: [],
  links: [
    { pageId: "page-1", route: "/here/", section: "첫 절", note: null, createdAt: null },
    { pageId: "page-2", route: "/elsewhere", section: null, note: null, createdAt: null },
  ],
};
const snapshot: DraftSnapshot = {
  attachment: { name: "latest.md", mediaType: "text/markdown", data: "latest" },
  ref: {
    title: "최신 제목",
    pageId: "page-1",
    docKey: "draft-1",
    url: null,
    version: 1,
    revision: 3,
    published: false,
    sections: ["근거 절"],
  },
};

function sources(): Pick<Daemon["api"], "mapRead" | "draftRefs" | "draftSyncDocs"> {
  return {
    mapRead: async () => map,
    draftRefs: async () => ({ refs: [{ at: "2026-11-11T00:00:00Z", ref: snapshot.ref }] }),
    draftSyncDocs: async () => ({
      docs: [
        {
          pageId: "page-1",
          docKey: "draft-1",
          title: "고친 문서",
          changes: 2,
          sections: ["바뀐 절"],
          at: "2026-11-11T00:00:00Z",
        },
      ],
    }),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("새 초안은 pageId가 없어도 최신 초안 본문과 제목을 읽는다", async () => {
  const read = await readPlanBody(
    {
      draftGet: async (key) => {
        assert.equal(key, "draft-1");
        return draft;
      },
      docRead: async () => {
        assert.fail("초안에서 원문 읽기를 부르면 안 된다");
      },
    },
    { docKey: "draft-1", pageId: null },
  );
  assert.deepEqual(read, { kind: "draft", pageId: null, title: draft.title, blocks: draft.blocks });
});

test("원본 id가 함께 있는 근거·변경 기록도 docKey를 우선한다", async () => {
  const read = await readPlanBody(
    {
      draftGet: async () => ({ ...draft, pageId: "page-1" }),
      docRead: async () => {
        assert.fail("과거 근거 대신 원문으로 바꾸면 안 된다");
      },
    },
    { docKey: "draft-1", pageId: "page-1" },
  );
  assert.equal(read.kind, "draft");
  assert.equal(read.pageId, "page-1");
});

test("초안 읽기 실패는 원문으로 대체하지 않고 거절한다", async () => {
  await assert.rejects(
    readPlanBody(
      {
        draftGet: async () => {
          throw new Error("draft unavailable");
        },
        docRead: async () => {
          assert.fail("실패를 원문으로 감추면 안 된다");
        },
      },
      { docKey: "draft-1", pageId: "page-1" },
    ),
    /draft unavailable/,
  );
});

test("docKey 없는 문서는 가져온 보기 블록 또는 마크다운을 그대로 읽는다", async () => {
  const views: Array<DocBlock[] | undefined> = [
    undefined,
    [{ t: "p", children: [{ t: "text", text: "가져온 본문" }] }],
  ];
  for (const view of views) {
    // 이 시험의 블록은 렌더러 입력을 바꾸지 않는지만 확인한다.
    const api = {
      draftGet: async () => {
        assert.fail("가져온 본문에서 초안을 열면 안 된다");
      },
      docRead: async (id: string) => {
        assert.equal(id, "page-1");
        return { markdown: "가져온 본문", sections: [], comments: null, view };
      },
    } satisfies Pick<Daemon["api"], "draftGet" | "docRead">;
    const read = await readPlanBody(api, { docKey: null, pageId: "page-1" });
    assert.deepEqual(read, {
      kind: "imported",
      pageId: "page-1",
      blocks: view ?? null,
      markdown: "가져온 본문",
    });
  }
});

test("원문 읽기 실패와 잘못된 대상은 정상 본문으로 처리하지 않는다", async () => {
  const api = {
    draftGet: async () => draft,
    docRead: async () => {
      throw new Error("import unavailable");
    },
  };
  await assert.rejects(readPlanBody(api, { docKey: null, pageId: "page-1" }), /import unavailable/);
  await assert.rejects(readPlanBody(api, { docKey: null, pageId: null }), /Missing document/);
});

test("세 출처는 같은 문서라도 역할을 보존하고 현재 화면의 연결만 고른다", async () => {
  const result = await readPlanSources(sources(), "/here?filter=one#top", "session-1");
  assert.deepEqual(result.failed, []);
  assert.equal(result.rows.length, 3);
  assert.deepEqual(
    new Set(result.rows.map((row) => row.source)),
    new Set(["linked", "refs", "changed"]),
  );
  assert.equal(result.rows.find((row) => row.source === "linked")?.section, "첫 절");
  assert.equal(result.rows.find((row) => row.source === "refs")?.section, "근거 절");
  assert.equal(result.rows.find((row) => row.source === "changed")?.synced?.changes, 2);
  assert.equal(new Set(result.rows.map((row) => row.key)).size, 3);
});

test("화면 주소가 없으면 모든 연결을 보여주지 않고 대화 자료만 남긴다", async () => {
  const api = sources();
  api.mapRead = async () => {
    assert.fail("화면을 모를 때 연결을 읽을 필요가 없다");
  };
  const result = await readPlanSources(api, null, "session-1");
  assert.deepEqual(new Set(result.rows.map((row) => row.source)), new Set(["refs", "changed"]));
  assert.deepEqual(result.failed, []);
});

test("대화가 없으면 근거·변경 기록 요청 없이 화면 연결만 읽는다", async () => {
  const api = sources();
  api.draftRefs = async () => {
    assert.fail("선택한 대화가 없다");
  };
  api.draftSyncDocs = async () => {
    assert.fail("선택한 대화가 없다");
  };
  const result = await readPlanSources(api, "/here", null);
  assert.deepEqual(
    result.rows.map((row) => row.source),
    ["linked"],
  );
});

test("출처마다 실패를 알리고 다른 출처의 성공은 남긴다 — 다시 읽으면 회복한다", async () => {
  for (const [method, source] of [
    ["mapRead", "linked"],
    ["draftRefs", "refs"],
    ["draftSyncDocs", "changed"],
  ] as const) {
    const api = sources();
    const healthy = api[method];
    Object.assign(api, {
      [method]: async () => {
        throw new Error("offline");
      },
    });
    const result = await readPlanSources(api, "/here", "session-1");
    assert.deepEqual(result.failed, [source]);
    assert.equal(result.rows.length, 2);
    assert.equal(
      result.rows.some((row) => row.source === source),
      false,
    );
    Object.assign(api, { [method]: healthy });
    const retried = await readPlanSources(api, "/here", "session-1");
    assert.deepEqual(retried.failed, []);
    assert.equal(retried.rows.length, 3);
  }
});

test("모든 출처 실패는 성공한 빈 목록과 구분한다", async () => {
  const fail = async () => {
    throw new Error("offline");
  };
  const result = await readPlanSources(
    { mapRead: fail, draftRefs: fail, draftSyncDocs: fail },
    "/here",
    "session-1",
  );
  assert.deepEqual(result.rows, []);
  assert.deepEqual(new Set(result.failed), new Set(["linked", "refs", "changed"]));
});

test("늦게 끝난 이전 본문 읽기는 새 요청 뒤에도 유효해지지 않는다", async () => {
  const gate = createPlanRequest();
  const slow = deferred<DraftView>();
  const oldCurrent = gate.begin();
  const oldRead = readPlanBody(
    {
      draftGet: () => slow.promise,
      docRead: async () => {
        assert.fail();
      },
    },
    { docKey: "old", pageId: null },
  );
  const newCurrent = gate.begin();
  const latest = await readPlanBody(
    {
      draftGet: async () => draft,
      docRead: async () => {
        assert.fail();
      },
    },
    { docKey: "draft-1", pageId: null },
  );
  assert.equal(latest.kind, "draft");
  slow.resolve({ ...draft, title: "늦은 이전 본문" });
  await oldRead;
  assert.equal(oldCurrent(), false);
  assert.equal(newCurrent(), true);
  gate.cancel();
  assert.equal(newCurrent(), false, "문서·scope 교체와 닫기도 현재 읽기를 무효화한다");
});

test("근거 첨부는 스냅샷 거절과 수신 불가를 구분하고 수신 확인 뒤 성공한다", async () => {
  const row = { docKey: "draft-1", pageId: "page-1" };
  const fail = await sendPlanReference({
    api: {
      draftSnapshot: async () => {
        throw new Error("offline");
      },
    },
    row,
    isCurrent: () => true,
    offer: () => {
      assert.fail();
    },
  });
  assert.equal(fail, "failed");
  for (const accepts of [false, true]) {
    const target = new EventTarget();
    target.addEventListener("attach", (event) => {
      if (accepts) event.preventDefault();
    });
    const result = await sendPlanReference({
      api: {
        draftSnapshot: async (asked) => {
          assert.deepEqual(asked, { docKey: "draft-1" });
          return snapshot;
        },
      },
      row,
      isCurrent: () => true,
      offer: (received) => {
        assert.equal(received, snapshot);
        const event = new Event("attach", { cancelable: true });
        target.dispatchEvent(event);
        return event.defaultPrevented;
      },
    });
    assert.equal(result, accepts ? "attached" : "unavailable");
  }
});

test("스냅샷을 기다리는 중 scope를 떠나면 성공·실패 어느 쪽도 새 입력창으로 보내지 않는다", async () => {
  for (const rejects of [false, true]) {
    const gate = createPlanRequest();
    const pending = deferred<DraftSnapshot>();
    const sent = sendPlanReference({
      api: { draftSnapshot: () => pending.promise },
      row: { docKey: "draft-1", pageId: null },
      isCurrent: gate.begin(),
      offer: () => {
        assert.fail("새 대화로 이전 근거를 보내면 안 된다");
      },
    });
    gate.cancel();
    if (rejects) pending.reject(new Error("old failure"));
    else pending.resolve(snapshot);
    assert.equal(await sent, "stale");
  }
});

test("비교 카드의 근거는 비교 초안 → 선택 초안 → 가져온 원문 순서다", () => {
  assert.deepEqual(comparePlanTarget({ docKey: "picked", pageId: "page-1" }, "compared"), {
    docKey: "compared",
  });
  assert.deepEqual(
    comparePlanTarget({ docKey: null, pageId: "page-1" }, "compared"),
    { docKey: "compared" },
    "연결 문서에서 비교해도 비교에 쓴 초안을 보낸다",
  );
  assert.deepEqual(comparePlanTarget({ docKey: "picked", pageId: "page-1" }, null), {
    docKey: "picked",
  });
  assert.deepEqual(comparePlanTarget({ docKey: null, pageId: "page-1" }, null), {
    pageId: "page-1",
  });
});

test("비교 카드 두 보내기도 스냅샷 대기 중 자리를 바꾸면 전달 전에 멈춘다", async () => {
  const before: unknown = Reflect.get(globalThis, "window");
  const receiver = new EventTarget();
  let delivered = 0;
  receiver.addEventListener("nx:composer:attach", (event) => {
    delivered++;
    event.preventDefault();
  });
  Reflect.set(globalThis, "window", receiver);
  try {
    for (const send of [sendMismatchNow, offerMismatchToComposer]) {
      const gate = createPlanRequest();
      const pending = deferred<DraftSnapshot>();
      const result = send({
        api: { draftSnapshot: () => pending.promise },
        target: { docKey: "compared" },
        brief: "브리프",
        isCurrent: gate.begin(),
      });
      gate.cancel();
      pending.resolve(snapshot);
      assert.equal(await result, false);
      assert.equal(delivered, 0, "새 입력창이 있어도 이전 요청의 이벤트를 전달하지 않는다");
    }
    const current = await sendMismatchNow({
      api: { draftSnapshot: async () => snapshot },
      target: { docKey: "compared" },
      brief: "현재 요청",
      isCurrent: () => true,
    });
    assert.equal(current, "prefilled", "현재 요청은 실제 수신자가 받는다");
    assert.equal(delivered, 1);
  } finally {
    if (before === undefined) Reflect.deleteProperty(globalThis, "window");
    else Reflect.set(globalThis, "window", before);
  }
});

test("결과 띠 보기는 문서를 찾을 때 한 번만 소비하고 목록 갱신으로 다시 열지 않는다", () => {
  const focus = createPlanFocusConsumer();
  assert.equal(focus.consume(1, false), false, "목록을 기다리는 동안 소비하지 않는다");
  assert.equal(focus.consume(1, true), true);
  assert.equal(
    focus.consume(1, true),
    false,
    "닫거나 다른 문서를 고른 뒤 목록이 갱신돼도 다시 열지 않는다",
  );
  assert.equal(focus.consume(2, true), true, "사람이 보기를 다시 누른 새 요청은 연다");
  assert.equal(focus.consume(1, true), false, "늦게 돌아온 이전 보기 요청도 다시 소비하지 않는다");
});

const compareResult: DraftCompareResult = {
  docKey: "p-42",
  pageId: "42",
  title: "비교한 초안",
  source: "초안 개정 3",
  rows: [],
  note: null,
};

test("연결 문서에서 비교 대기 중 초안이 바뀌면 늦게 온 이전 비교 결과를 버린다", async () => {
  const comparison = createPlanComparison();
  const pending = deferred<DraftCompareResult>();
  const reading = comparison.begin({ pageId: "42", docKey: null });
  const result = reading.read(() => pending.promise);
  assert.equal(comparison.onDraftChanged("p-43"), false, "다른 문서 변경은 비교를 취소하지 않는다");
  assert.equal(reading.isCurrent(), true);
  assert.equal(
    comparison.onDraftChanged("p-42"),
    true,
    "응답의 docKey를 알기 전에도 대상 초안을 식별한다",
  );
  pending.resolve(compareResult);
  assert.equal(await result, null, "변경 전 본문으로 진행한 결과가 화면에 돌아오면 안 된다");
  assert.equal(reading.isCurrent(), false);
  const retry = comparison.begin({ pageId: "42", docKey: null });
  assert.deepEqual(await retry.read(async () => compareResult), compareResult);
  assert.equal(retry.isCurrent(), true, "변경 후 다시 비교할 수 있다");
});

test("비교 완료 후에는 결과 초안의 변경도 비교를 무효화하고 이전 판의 첨부를 막는다", async () => {
  const comparison = createPlanComparison();
  const reading = comparison.begin({ pageId: "42", docKey: null });
  const compared = { ...compareResult, docKey: "compared-draft" };
  assert.deepEqual(await reading.read(async () => compared), compared);
  const pending = deferred<DraftSnapshot>();
  const sending = sendPlanReference({
    api: { draftSnapshot: () => pending.promise },
    row: { docKey: compared.docKey, pageId: "42" },
    isCurrent: reading.isCurrent,
    offer: () => {
      assert.fail("변경 전 비교와 변경 후 근거를 함께 보내면 안 된다");
    },
  });
  assert.equal(comparison.onDraftChanged(compared.docKey), true);
  pending.resolve(snapshot);
  assert.equal(await sending, "stale");
  assert.equal(reading.isCurrent(), false);
});

test("공식본 비교 뒤 같은 문서의 초안이 생겨도 기존 비교는 무효가 된다", async () => {
  const comparison = createPlanComparison();
  const reading = comparison.begin({ pageId: "42", docKey: null });
  await reading.read(async () => ({ ...compareResult, docKey: null, source: "Confluence 판 1" }));
  assert.equal(comparison.onDraftChanged("p-42"), true);
  assert.equal(reading.isCurrent(), false);
});
