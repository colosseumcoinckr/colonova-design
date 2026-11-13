import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  DraftBlock,
  DraftPublishPreview,
  DraftRevisionView,
  DraftView,
} from "@colonova-design/protocol";
import { L } from "../src/next/labels.ts";
// 순수 모듈 — src 에서 곧장 읽는다(next-drafts.test.ts 와 같은 모양).
import { loadPublishReview } from "../src/next/plans/draft/publish-review.ts";

/**
 * 발행 확인 창의 검토 읽기 시험(2026-11-11 초안 검토 개선) — `loadPublishReview` 는 미리보기 → 기준(판 0) →
 * 현재 초안을 순서대로 읽고, 읽는 동안 초안이 달라졌으면 발행 대상으로 내보내지 않는다. 이 과정에 원격 쓰기는
 * 없어야 한다 — 원격 재검사는 데몬의 발행 게이트 몫이다.
 */

const para = (id: string, text: string): DraftBlock => ({
  id,
  view: { kind: "paragraph", text },
  editable: true,
  tokens: {},
  status: "same",
});

const preview = (overrides: Partial<DraftPublishPreview> = {}): DraftPublishPreview => ({
  docKey: "p-2001",
  kind: "update",
  pageId: "2001",
  title: "[정책서] 주문 접수 v0.8",
  titleChanged: true,
  parent: null,
  baseVersion: 7,
  remoteVersion: 7,
  draftRevision: 3,
  changes: { changed: 1, inserted: 1, deleted: 1, protectedRemoved: [] },
  stage: { current: "0.8", closed: false, required: false },
  blockers: [],
  checkedAt: "2026-11-11T09:00:00.000Z",
  ...overrides,
});

const base = (overrides: Partial<DraftRevisionView> = {}): DraftRevisionView => ({
  docKey: "p-2001",
  revision: 0,
  at: "2026-10-01T09:00:00.000Z",
  origin: "system",
  label: null,
  title: "[정책서] 주문 접수",
  blocks: [para("b0", "발행본 본문")],
  ...overrides,
});

const draft = (overrides: Partial<DraftView> = {}): DraftView => ({
  docKey: "p-2001",
  kind: "existing",
  pageId: "2001",
  site: "colosseum.atlassian.net",
  title: "[정책서] 주문 접수 v0.8",
  baseTitle: "[정책서] 주문 접수",
  baseVersion: 7,
  revision: 3,
  state: "editing",
  blocks: [para("b0", "발행본 본문"), para("n1", "새 문단")],
  parent: null,
  stage: { notation: "0.8", closed: false },
  observedVersion: null,
  pendingCommandId: null,
  updatedAt: "2026-11-11T09:00:00.000Z",
  ...overrides,
});

/** 호출 순서를 기록하는 가짜 읽기 — 읽기 셋과 쓰기 스파이만 있다. */
function apiFor(input: {
  preview?: DraftPublishPreview;
  base?: DraftRevisionView;
  draft?: DraftView;
  failPreview?: boolean;
  failBase?: boolean;
  failDraft?: boolean;
}) {
  const calls: string[] = [];
  const writes: string[] = [];
  return {
    calls,
    writes,
    api: {
      draftPublishPreview: async (_docKey: string) => {
        calls.push("preview");
        if (input.failPreview) throw new Error("읽기 실패");
        return input.preview ?? preview();
      },
      draftRevision: async (_docKey: string, _revision: number) => {
        calls.push(`revision:${_revision}`);
        if (input.failBase) throw new Error("읽기 실패");
        return input.base ?? base();
      },
      draftGet: async (_docKey: string) => {
        calls.push("draft");
        if (input.failDraft) throw new Error("읽기 실패");
        return input.draft ?? draft();
      },
      // 검토 과정에 불리면 안 되는 쓰기 — 호출되면 writes 에 남고 시험이 잡는다.
      draftPublish: async () => {
        writes.push("publish");
        throw new Error("검토에서 쓰기를 불렀다");
      },
    },
  };
}

test("읽기 순서 — 미리보기 → 기준(판 0) → 현재 초안 순으로 읽고 쓰기는 부르지 않는다", async () => {
  const { calls, writes, api } = apiFor({});
  const review = await loadPublishReview(api, "p-2001");
  assert.deepEqual(calls, ["preview", "revision:0", "draft"]);
  assert.deepEqual(writes, [], "검토 과정에 원격 쓰기가 없어야 한다");
  assert.equal(review.preview.draftRevision, 3);
  assert.equal(review.base?.revision, 0);
  assert.equal(review.draft.revision, 3);
});

test("새 문서 — kind=create 면 기준을 읽지 않고 base = null 로 둔다", async () => {
  const { calls, api } = apiFor({
    preview: preview({ kind: "create", pageId: null, baseVersion: null, docKey: "n-abc" }),
    draft: draft({ docKey: "n-abc", kind: "new", pageId: null, baseVersion: null }),
  });
  const review = await loadPublishReview(api, "n-abc");
  assert.deepEqual(calls, ["preview", "draft"], "판 0 읽기를 건너뛴다");
  assert.equal(review.base, null);
});

test("확인 중 개정이 달라짐 — 초안 개정이 미리보기와 다르면 바뀐 초안을 내보내지 않는다", async () => {
  const { api } = apiFor({ draft: draft({ revision: 4 }) });
  await assert.rejects(
    () => loadPublishReview(api, "p-2001"),
    (err: Error) => {
      assert.equal(err.message, L.drafts.publishReviewChanged);
      return true;
    },
  );
});

test("기준 판이 달라짐 — baseVersion 이 미리보기와 다르면 거절한다", async () => {
  const { api } = apiFor({ draft: draft({ baseVersion: 8 }) });
  await assert.rejects(
    () => loadPublishReview(api, "p-2001"),
    (err: Error) => {
      assert.equal(err.message, L.drafts.publishReviewChanged);
      return true;
    },
  );
});

test("엇갈린 문서 — 미리보기 · 기준 · 초안의 docKey 가 하나라도 다르면 거절한다", async () => {
  for (const part of ["preview", "base", "draft"] as const) {
    const { api } = apiFor({
      preview: part === "preview" ? preview({ docKey: "p-9999" }) : preview(),
      base: part === "base" ? base({ docKey: "p-9999" }) : base(),
      draft: part === "draft" ? draft({ docKey: "p-9999" }) : draft(),
    });
    await assert.rejects(
      () => loadPublishReview(api, "p-2001"),
      (err: Error) => {
        assert.equal(err.message, L.drafts.publishReviewChanged);
        return true;
      },
    );
  }
});

test("읽기 실패 전달 — 미리보기가 실패하면 그대로 던져 확인 창의 다시 시도가 서게 한다", async () => {
  const { api } = apiFor({ failPreview: true });
  await assert.rejects(() => loadPublishReview(api, "p-2001"), /읽기 실패/);
});

test("읽기 실패 전달 — 기준 읽기가 실패하면 그대로 던진다", async () => {
  const { api } = apiFor({ failBase: true });
  await assert.rejects(() => loadPublishReview(api, "p-2001"), /읽기 실패/);
});

test("읽기 실패 전달 — 현재 초안 읽기가 실패하면 그대로 던진다", async () => {
  const { api } = apiFor({ failDraft: true });
  await assert.rejects(() => loadPublishReview(api, "p-2001"), /읽기 실패/);
});
