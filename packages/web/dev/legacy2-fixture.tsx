/** 2026-11-12 UI 조사 LEGACY2 — 실제 부품의 격리 견본. */
import "../src/next/plans/draft/draft.css";
import "../src/next/plans/view/doc-view.css";
import { useState } from "react";
import { Markdown } from "../src/components/Markdown";
import { Tip } from "../src/components/Tip";
import { ActivitySummary } from "../src/components/transcript/activity";

const samples = {
  first: "flowchart LR\n A[First] --> B[Done]",
  second: "flowchart LR\n C[Second] --> D[Ready]",
  invalid: "not a diagram at all",
};
export function Legacy2Fixture() {
  const [diagram, setDiagram] = useState<keyof typeof samples>("first");
  const [removed, setRemoved] = useState("");
  return (
    <div
      className="nx"
      style={{ display: "block", width: 640, padding: 24, overflow: "auto", maxHeight: "95vh" }}
    >
      <h2>옛 부품 확인</h2>
      <Tip label="설명 풍선의 글자를 읽어요">
        <button type="button">설명</button>
      </Tip>
      <label>
        절 선택{" "}
        <select className="nx-input" defaultValue="a">
          <option value="a">입고 정책</option>
          <option value="b">보관 정책</option>
        </select>
      </label>
      <ActivitySummary
        steps={[
          {
            type: "tool",
            id: "write",
            name: "Write",
            input: { file_path: "a.tsx" },
            agentId: null,
            done: true,
          },
          {
            type: "tool",
            id: "fail",
            name: "Bash",
            input: { command: "check" },
            agentId: null,
            done: true,
            isError: true,
            result: "A".repeat(4100) + "TAIL ERROR",
          },
        ]}
        controls={{}}
      />
      <Markdown
        text={
          "[절로 이동](#받는-곳)\n\n보존 ⟦t1⟧ ⟦t2⟧\n\n##### 작은 제목\n\n###### 가장 작은 제목\n\n- [x] 마친 일\n- [ ] 남은 일\n\n```text\n읽는 원문\n```\n\n## 받는 곳"
        }
        tokens={{ t1: "보존한 표", t2: "완료" }}
        machineTokens={{ t2: "macro:status:Green:완료" }}
      />
      <Markdown text="지울 조각 ⟦t1⟧" tokens={{ t1: "보존한 표" }} onTokenRemove={setRemoved} />
      <output>{removed}</output>
      {Object.keys(samples).map((key) => (
        <button type="button" key={key} onClick={() => setDiagram(key as keyof typeof samples)}>
          {key}
        </button>
      ))}
      <Markdown text={`\`\`\`mermaid\n${samples[diagram]}\n\`\`\``} />
      <div className="activity__body">
        <span className="subagent__peek">하위 작업의 첫 답 미리 읽기</span>
        <span className="tool__taskmeta">도구 3개</span>
      </div>
    </div>
  );
}
