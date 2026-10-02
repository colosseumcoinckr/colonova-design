/**
 * 기능 제안 견본 — 데몬 · 자격 증명 · 실제 접수 없이 `FeedbackDialog` 와 사이드바
 * 바닥의 `기능 제안` 단추를 눈으로 보는 자리(chip-fixture 와 같은 모양). 가짜 API 는
 * `window.__feedbackFixture` 에 호출 기록(횟수 · 내용 · 명령 ID)을 남기므로, 독립된
 * 시험(QA)이 화면 밖에서 등록 여부를 잰다. 시나리오(접수 · 브라우저 · 거절 · 확인
 * 불가 · 연결 끊김)와 응답 지연을 위에서 고른다. 이 견본은 `feedbackDraft` 키 하나만
 * 만지고 사용자의 자격 증명 · 다른 저장 값을 읽지 않는다.
 */

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Daemon } from "../src/lib/daemon-client";
import { applyStoredTheme, applyStoredTypeScale } from "../src/lib/settings";
import { FeedbackDialog } from "../src/next/feedback/FeedbackDialog";
import { FEEDBACK_DRAFT_KEY, loadDraft } from "../src/next/feedback/lib";
import { L } from "../src/next/labels";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "../src/styles.css";
import "../src/next/next.css";

applyStoredTheme();
applyStoredTypeScale();

type Scenario = "sent" | "browser" | "failed" | "uncertain" | "disconnected" | "hold";

interface FixtureCall {
  input: unknown;
  commandId: string | null;
  at: string;
}

interface FixtureState {
  scenario: Scenario;
  delayMs: number;
  calls: FixtureCall[];
  /** hold 시나리오의 갇힌 약속 — `settle()` · `abort()` 로 화면 밖에서 푼다. */
  settle: () => void;
  abort: () => void;
}

/** 화면 밖의 시험이 읽는 기록 — 호출마다 한 줄씩 쌓인다. */
const fixture: FixtureState = {
  scenario: "sent",
  delayMs: 800,
  calls: [],
  settle: () => {},
  abort: () => {},
};
Object.assign(window, { __feedbackFixture: fixture });

const delay = () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  if (fixture.scenario === "hold") {
    // 갇힌 약속 — QA 가 settle/abort 를 부를 때까지 답하지 않는다.
    fixture.settle = () => {
      fixture.settle = () => {};
      fixture.abort = () => {};
      resolve();
    };
    fixture.abort = () => {
      fixture.settle = () => {};
      fixture.abort = () => {};
      reject(new Error("갇힌 약속을 톺았다"));
    };
    return promise;
  }
  window.setTimeout(
    () => (fixture.scenario === "disconnected" ? reject(new Error("끊김")) : resolve()),
    fixture.delayMs,
  );
  return promise;
};

/** 가짜 API — 접수는 일어나지 않고 시나리오의 답만 돌려준다. */
const daemon = {
  api: {
    feedbackSubmit: async (input: unknown, commandId?: string) => {
      fixture.calls.push({
        input,
        commandId: commandId ?? null,
        at: new Date().toISOString(),
      });
      await delay();
      // 갇힌 답을 푸는 동안 시나리오를 바꿀 수 있다 — 풀리는 순간의 고름을 본다.
      const outcome = fixture.scenario === "hold" ? "sent" : fixture.scenario;
      if (outcome === "sent")
        return { kind: "sent", number: 42, url: "https://example.com/issues/42" };
      if (outcome === "browser")
        return {
          kind: "browser",
          url: "https://example.com/issues/new?title=%EA%B8%B0%EB%8A%A5",
          title: "[기능 제안] 미리보기의 검색창",
          body: "### 요청\n검색창을 원해요\n\n### 환경\n- 앱 버전: 0.0.0-견본",
        };
      if (outcome === "failed") return { kind: "failed", reason: "rejected" };
      return { kind: "uncertain", url: "https://example.com/issues" };
    },
  },
} as unknown as Daemon;

/** 견본의 좁은 사이드바 — 실제 단추의 클래스와 문장을 그대로 입힌다. */
function FakeSidebar({ onOpen }: { onOpen: () => void }) {
  return (
    <aside className="nx-sidebar">
      <div className="nx-side-label">견본 사이드바</div>
      <div className="nx-side-bottom">
        <button type="button" className="nx-side-row nx-fb-row" onClick={onOpen}>
          {L.feedback.button}
        </button>
        <button type="button" className="nx-me">
          <b>{L.feedback.title} 없음</b>
        </button>
      </div>
    </aside>
  );
}

function Fixture() {
  const [open, setOpen] = useState(false);
  const [, reroll] = useState(0);
  return (
    <div
      className="nx"
      style={{ display: "grid", gridTemplateColumns: "264px 1fr", height: "100vh" }}
    >
      <FakeSidebar onOpen={() => setOpen(true)} />
      <main style={{ padding: 24, overflow: "auto" }}>
        <h1 style={{ fontSize: 18, marginTop: 0 }}>기능 제안 견본</h1>
        <p style={{ fontSize: 13 }}>
          시나리오와 지연을 고르고 왼쪽의 `기능 제안`을 누른다. 창을 닫았다 다시 열어도 도는 전송은
          끝나고, 새로 고침 뒤에는 전송 시작 표시의 초안이 확인 불가로 돌아온다.
        </p>
        <label style={{ display: "block", fontSize: 13, margin: "8px 0" }}>
          시나리오{" "}
          <select
            value={fixture.scenario}
            onChange={(event) => {
              fixture.scenario = event.target.value as Scenario;
              reroll((n) => n + 1);
            }}
          >
            <option value="sent">접수(sent)</option>
            <option value="browser">브라우저(browser)</option>
            <option value="failed">거절(failed)</option>
            <option value="uncertain">확인 불가(uncertain)</option>
            <option value="disconnected">연결 끊김(disconnected)</option>
            <option value="hold">답을 갇음(hold — settle/abort)</option>
          </select>
        </label>
        {fixture.scenario === "hold" && (
          <span style={{ marginLeft: 8 }}>
            <button type="button" className="nx-btn" onClick={() => fixture.settle()}>
              답 풀기
            </button>{" "}
            <button type="button" className="nx-btn" onClick={() => fixture.abort()}>
              답 끊기
            </button>
          </span>
        )}
        <label style={{ display: "block", fontSize: 13, margin: "8px 0" }}>
          응답 지연(ms){" "}
          <input
            type="number"
            min={0}
            step={100}
            value={fixture.delayMs}
            onChange={(event) => {
              fixture.delayMs = Number(event.target.value) || 0;
              reroll((n) => n + 1);
            }}
          />
        </label>
        <button
          type="button"
          className="nx-btn"
          style={{ margin: "8px 0" }}
          onClick={() => {
            // 초안 장부의 키 하나만 — 견본이 다른 저장 값을 만지지 않는다.
            window.localStorage.removeItem(FEEDBACK_DRAFT_KEY);
            reroll((n) => n + 1);
          }}
        >
          초안 지우고 처음부터
        </button>
        <p style={{ fontSize: 12, color: "var(--ink3)" }}>
          현재 초안: <code>{JSON.stringify(loadDraft())}</code>
        </p>
        <h2 style={{ fontSize: 14 }}>가짜 API 호출 기록({fixture.calls.length})</h2>
        <pre style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>
          {JSON.stringify(fixture.calls, null, 2)}
        </pre>
      </main>
      <FeedbackDialog daemon={daemon} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

const rootNode = document.getElementById("root");
if (rootNode) {
  createRoot(rootNode).render(
    <StrictMode>
      <Fixture />
    </StrictMode>,
  );
}
