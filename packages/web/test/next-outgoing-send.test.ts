import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionView } from "../src/lib/daemon-client.ts";
import {
  countSend,
  type OutgoingSend,
  outgoingArrived,
  outgoingBlock,
} from "../src/next/lib/outgoing-send.ts";

const text = "Make the search field wider";
const block = outgoingBlock("pending-1", text, []);
const pending: OutgoingSend = {
  block,
  sessionId: "session-1",
  slug: "project",
  seen: 0,
  bound: true,
};
const view = (blocks: SessionView["blocks"] = [], queue: SessionView["queue"] = []) =>
  ({ blocks, queue }) as SessionView;

test("전송이 느려도 실제 기록이 오기 전까지 보낸 말을 유지한다", () => {
  assert.equal(outgoingArrived(pending, null), false);
  assert.equal(outgoingArrived(pending, view()), false);
  assert.equal(
    outgoingArrived(
      pending,
      view([{ type: "text", id: "a", text: "reply", agentId: null, streaming: true }]),
    ),
    false,
  );
  assert.equal(outgoingArrived(pending, view([{ ...block, id: "echo" }])), true);
});

test("대기 줄의 수락도 임시 말풍선을 대체한다", () => {
  const queued = { id: "queued-1", text, images: 0, files: 0 };
  assert.equal(outgoingArrived(pending, view([], [queued])), true);
});

test("같은 말을 다시 보낼 때 옛 기록과 대기 줄을 새 수락으로 세지 않는다", () => {
  const old = { ...block, id: "old" };
  const queued = { id: "q", text, images: 0, files: 0 };
  const before = view([old], [queued]);
  const again = { ...pending, seen: countSend(before, text) };
  assert.equal(outgoingArrived(again, before), false);
  // 옛 대기 줄이 기록으로 옮겨져도 전체 수는 같다.
  assert.equal(outgoingArrived(again, view([old, { ...block, id: "delivered" }])), false);
  assert.equal(outgoingArrived(again, view([old, { ...block, id: "delivered" }, block])), true);
});

test("대화 준비 중 들어온 옛 기록은 보내기 수락이 아니다", () => {
  assert.equal(outgoingArrived({ ...pending, bound: false }, view([block])), false);
});

test("핀 본문이 보강돼도 같은 표식의 수락은 중복 표시하지 않는다", () => {
  const marked =
    '<!-- colonova-design:comments {"items":[{"label":"Search"}],"note":"Wider"} -->\nOriginal';
  const send = { ...pending, block: outgoingBlock("pin", marked, []) };
  const enriched = { ...send.block, id: "echo", text: `${marked}\nFile hint` };
  assert.equal(outgoingArrived(send, view([enriched])), true);
});

test("그림과 문서의 표시 정보가 보내는 즉시 준비된다", () => {
  const sent = outgoingBlock("with-files", "", [
    { name: "photo.jpg", mediaType: "image/jpeg", data: "jpg" },
    { name: "design.png", mediaType: "image/png", data: "png" },
    { name: "brief.pdf", mediaType: "application/pdf", data: "pdf" },
  ]);
  assert.equal(sent.images, 2);
  assert.deepEqual(sent.files, ["brief.pdf"]);
  assert.deepEqual(sent.thumbs, ["jpg"]);
});
