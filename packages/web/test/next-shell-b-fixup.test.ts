import assert from "node:assert/strict";
import { test } from "node:test";
import { historyRequestTitle } from "../src/next/preview/history-request-title.ts";
import {
  emptyConfluenceForm,
  settleConnect,
  startChangeRoot,
  startPick,
} from "../src/next/settings/confluence-form.ts";
import { recoverPlanLoop } from "../src/next/settings/recover-plan-loop.ts";

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

test("방송이 없으면 저장 응답 뒤 다시 읽고 대기를 끝낸다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reads = 0;
  const settled: boolean[] = [];
  recoverPlanLoop(
    async () => {
      reads++;
    },
    (ok) => settled.push(ok),
  );
  t.mock.timers.tick(1499);
  await flush();
  assert.equal(reads, 0);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(reads, 1);
  assert.deepEqual(settled, [true]);
});

test("상태 재조회 실패와 무응답 모두 대기를 끝낸다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const settled: boolean[] = [];
  recoverPlanLoop(
    async () => {
      throw Error("offline");
    },
    (ok) => settled.push(ok),
  );
  t.mock.timers.tick(1500);
  await flush();
  assert.deepEqual(settled, [false]);
  recoverPlanLoop(
    () => new Promise(() => {}),
    (ok) => settled.push(ok),
  );
  t.mock.timers.tick(1500);
  await flush();
  t.mock.timers.tick(5000);
  assert.deepEqual(settled, [false, false]);
});

test("방송 도착이나 언마운트로 취소하면 조회와 늦은 완료가 반영되지 않는다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let reads = 0;
  const settled: boolean[] = [];
  const cancel = recoverPlanLoop(
    async () => {
      reads++;
    },
    (ok) => settled.push(ok),
  );
  cancel();
  t.mock.timers.tick(1500);
  await flush();
  assert.equal(reads, 0);
  let resolve!: () => void;
  const stop = recoverPlanLoop(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
    (ok) => settled.push(ok),
  );
  t.mock.timers.tick(1500);
  await flush();
  stop();
  resolve();
  await flush();
  assert.deepEqual(settled, []);
});

test("재검색 중 기존 결과를 골라도 다음 기준 페이지 검색은 잠기지 않는다", () => {
  const searching = { ...emptyConfluenceForm, finding: true, roots: [{ id: "old", title: "old" }] };
  const picked = startPick(searching, "old");
  assert.equal(picked.finding, false);
  const reopened = startChangeRoot(
    settleConnect(picked, { site: "example.test", rootTitle: "old" }),
  );
  assert.equal(reopened.finding, false);
  assert.equal(reopened.roots, null);
});

test("작업 기록의 상한에 닿은 제목만 말줄임표로 알리고 원래 제목은 보존한다", () => {
  for (const size of [0, 79, 80, 81]) {
    const title = "가".repeat(size);
    assert.equal(historyRequestTitle(title), size < 80 ? title : `${title}…`);
    assert.equal(title.length, size);
  }
  const marked = `${"가".repeat(80)}…`;
  assert.equal(historyRequestTitle(marked), marked);
});
