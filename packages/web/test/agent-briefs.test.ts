import assert from "node:assert/strict";
import { test } from "node:test";
import { toolLabel } from "@colonova-design/protocol";
// 순수 모듈 — src 에서 곧장 읽는다(next-making.test.ts 와 같은 모양).
import type { Block } from "../src/lib/daemon-client.ts";
import { agentBriefs } from "../src/lib/progress.ts";

/** 서브에이전트 도구 행 — 이름만 다르고 입력은 같다(description · subagent_type). */
const spawn = (name: string, id: string): Block => ({
  type: "tool",
  id,
  name,
  input: { description: "회원 목록 파일 찾기", subagent_type: "Explore", prompt: "…" },
  agentId: null,
  done: true,
});

test("서브에이전트 도구는 두 이름으로 온다 — 옛 CLI 의 Task 와 SDK 0.3.x 의 Agent (2026-10-02)", () => {
  const briefs = agentBriefs([spawn("Task", "t1"), spawn("Agent", "t2"), spawn("Read", "t3")]);
  assert.deepEqual(
    briefs.map((brief) => [brief.id, brief.type, brief.label, brief.status]),
    [
      ["t1", "Explore", "회원 목록 파일 찾기", "completed"],
      ["t2", "Explore", "회원 목록 파일 찾기", "completed"],
    ],
    "Task 와 Agent 는 같은 보조 작업이고, 다른 도구는 끼지 않는다",
  );
  assert.equal(toolLabel("Agent"), toolLabel("Task"), "한국어 이름도 같다");
  assert.equal(toolLabel("Agent"), "보조 작업");
});
