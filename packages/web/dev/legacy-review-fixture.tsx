/** 2026-11-12 LEGACY-R — 검토 재현용 실제 부품 조합. */
import { useRef, useState } from "react";
import { Markdown } from "../src/components/Markdown";
import { Tip } from "../src/components/Tip";
import { ActivitySummary } from "../src/components/transcript/activity";
import { ToolBlock } from "../src/components/transcript/blocks";
import type { Block } from "../src/lib/daemon-client";
import { Popover } from "../src/next/ui/Popover";

export const fullInput = `INPUT ${"long ".repeat(1000)} END INPUT`;
export const fullResult = `RESULT ${"long ".repeat(1000)} END RESULT`;
export const fullSummary = `근황 전체 ${"내용 ".repeat(100)} 마지막 근황`;
const tool = (id: string, isError = false): Extract<Block, { type: "tool" }> => ({
  type: "tool",
  id,
  name: "Write",
  input: {},
  result: "ok",
  done: true,
  agentId: null,
  isError,
});

export function LegacyReviewFixture() {
  const anchor = useRef<HTMLButtonElement>(null);
  const [pop, setPop] = useState(false);
  const [calls, setCalls] = useState(0);
  const attempt = useRef(0);
  const [mode, setMode] = useState("throw");
  const task = {
    id: "task",
    description: "작업 설명",
    summary: fullSummary,
    lastTool: null,
    subagentType: null,
    tokens: 0,
    toolUses: 1,
    backgrounded: false,
    status: "running" as const,
  };
  return (
    <div
      className="nx"
      style={{ display: "block", width: 620, padding: 24, overflow: "auto", maxHeight: "95vh" }}
    >
      <button type="button" ref={anchor} onClick={() => setPop(true)}>
        팝 열기
      </button>
      {pop && (
        <Popover anchor={anchor} label="검토 팝" onClose={() => setPop(false)}>
          <Tip
            label="빠르게 실행하면 비용이 더 들 수 있어요. 긴 안내의 폭과 닫힘을 확인해요."
            bubbleClass="nx-fast-tip"
          >
            <button type="button">팝 안 단추</button>
          </Tip>
        </Popover>
      )}
      {[
        ["mixed", [tool("fail", true), tool("ok")]],
        ["failed", [tool("fail", true)]],
        ["retry", [tool("attempt", true), tool("retry")]],
      ].map(([name, steps]) => (
        <section key={name as string} data-case={name as string}>
          <ActivitySummary steps={steps as Extract<Block, { type: "tool" }>[]} controls={{}} />
        </section>
      ))}
      <section data-case="raw">
        <ToolBlock
          block={{
            ...tool("raw", true),
            input: fullInput,
            result: fullResult,
            progress: { task: { ...task, status: "failed" } },
          }}
        />
      </section>
      <label>
        실패 방식{" "}
        <select
          aria-label="실패 방식"
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            attempt.current = 0;
          }}
        >
          <option value="throw">동기 예외</option>
          <option value="reject">비동기 거절</option>
          <option value="moved">옮기기 거절</option>
        </select>
      </label>
      <output data-testid="calls">{calls}</output>
      <section data-case="actions">
        <ToolBlock
          block={{ ...tool("action"), done: false, progress: { task } }}
          onBackgroundTask={() => {
            setCalls((v) => v + 1);
            const fail = attempt.current++ === 0;
            if (mode === "throw" && fail) throw new Error("sync failure");
            return new Promise((resolve, reject) =>
              window.setTimeout(() => {
                if (fail && mode === "reject") reject(new Error("async failure"));
                else resolve({ moved: !(fail && mode === "moved") });
              }, 500),
            );
          }}
        />
      </section>
      <Markdown text={"- [x] **첫째** 항목\n- [ ] 둘째 항목\n  - [ ] 안쪽 항목"} />
    </div>
  );
}
