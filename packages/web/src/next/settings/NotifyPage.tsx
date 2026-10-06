import { type UIEvent, useState } from "react";
import { LONG_TURN_MS, type NoticeTiming, type Settings } from "../../lib/settings";
import { L } from "../labels";
import { CheckIcon, Spin } from "../ui/icons";
import { radioArrowStep, rovingTab, SGroup, SPage, SRow, Switch, useAnnounce } from "./parts";

/** 알림 시점의 세 갈래 — 데스크톱 메인의 알림 정책과 같은 값(`NoticeTiming`)이다. */
const NOTICE_CHOICES: ReadonlyArray<{ value: NoticeTiming; label: string }> = [
  { value: "off", label: L.settings.notifyOff },
  { value: "long", label: L.settings.notifyLong },
  { value: "all", label: L.settings.notifyAll },
];

/** 고른 시점이 무엇을 뜻하는지 한 줄 — 「오래 걸린」의 기준(1분)이 어디에도 안 보이던 것을 말한다. */
function noteOf(value: NoticeTiming): string {
  if (value === "off") return L.settings.notifyOffNote;
  if (value === "long") return L.settings.notifyLongNote(Math.round(LONG_TURN_MS / 60_000));
  return L.settings.notifyAllNote;
}

/** 시험 알림의 걸음 — 보내는 중이 있어야 권한 창을 기다리는 동안 두 번 눌리지 않는다. */
type TestState =
  | { phase: "idle" }
  | { phase: "sending" }
  | { phase: "sent" }
  | { phase: "blocked"; reason?: string };

/** 알림 쪽 — 저장은 settings.notifications 한 곳(App 의 상태가 유일한 원천이다). */
export function NotifyPage({
  active,
  settings,
  onSettingsChange,
  onScroll,
}: {
  active: boolean;
  settings: Settings;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onScroll: (event: UIEvent<HTMLDivElement>) => void;
}) {
  const announce = useAnnounce();
  const [test, setTest] = useState<TestState>({ phase: "idle" });
  const bridge = window.colonovaDesignDesktop;
  const openNotificationSettings =
    bridge && "openNotificationSettings" in bridge ? bridge.openNotificationSettings : undefined;

  const finish = (next: TestState) => {
    setTest(next);
    announce(next.phase === "blocked" ? L.settings.testBlocked(next.reason) : L.settings.testSent);
  };
  const sendTest = async () => {
    if (test.phase === "sending") return;
    setTest({ phase: "sending" });
    if (bridge?.notifyTest) {
      try {
        const result = await bridge.notifyTest();
        finish(
          result?.shown === false
            ? { phase: "blocked", ...(result.error ? { reason: result.error } : {}) }
            : { phase: "sent" },
        );
      } catch {
        finish({ phase: "blocked" });
      }
      return;
    }
    // 브라우저에서 직접 도는 경로 — 조용히 끝내지 않고 같은 자리에 막힘을 말한다(2026-10-04 ux-review).
    if (typeof Notification === "undefined") {
      finish({ phase: "blocked" });
      return;
    }
    try {
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission !== "granted") {
        finish({ phase: "blocked" });
        return;
      }
      new Notification(L.settings.testNotify, {
        body: L.settings.testNotifyBody,
        silent: !settings.notifications.sound,
      });
      finish({ phase: "sent" });
    } catch {
      // 페이지에서 직접 띄우지 못하는 브라우저 — 막힌 이유를 같은 자리에 말한다.
      finish({ phase: "blocked" });
    }
  };

  // 시점이나 소리를 바꾸면 지난 시험의 답은 낡았다 — 비운다.
  const change = (patch: Partial<Settings["notifications"]>) => {
    if (test.phase !== "sending") setTest({ phase: "idle" });
    onSettingsChange({ notifications: { ...settings.notifications, ...patch } });
  };
  const noticeAt = NOTICE_CHOICES.findIndex(
    (choice) => choice.value === settings.notifications.done,
  );
  const pickNotice = (value: NoticeTiming | undefined) => {
    if (value) change({ done: value });
  };

  return (
    <SPage id="notify" active={active} onScroll={onScroll}>
      <SGroup>
        <SRow
          title={L.settings.notifyDone}
          id="nx-notify-done"
          sub={noteOf(settings.notifications.done)}
          subId="nx-notify-note"
        >
          <div
            className="nx-sseg"
            role="radiogroup"
            aria-labelledby="nx-notify-done"
            aria-describedby="nx-notify-note"
            onKeyDown={(event) =>
              radioArrowStep(event, noticeAt, NOTICE_CHOICES.length, (index) =>
                pickNotice(NOTICE_CHOICES[index]?.value),
              )
            }
          >
            {NOTICE_CHOICES.map((choice, index) => (
              // biome-ignore lint/a11y/useSemanticElements: 세 칸이 한 덩어리로 읽히는 분절 단추다 — 동그라미 입력칸 없이 radio 로 읽힌다(radiogroup 안).
              <button
                key={choice.value}
                type="button"
                role="radio"
                aria-checked={settings.notifications.done === choice.value}
                tabIndex={rovingTab(index, noticeAt)}
                className="nx-sseg-opt"
                onClick={() => pickNotice(choice.value)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </SRow>
        <SRow title={L.settings.sound} id="nx-notify-sound">
          <Switch
            on={settings.notifications.sound}
            labelledBy="nx-notify-sound"
            onChange={(sound) => change({ sound })}
          />
        </SRow>
        <SRow
          title={L.settings.testRow}
          sub={
            <>
              {L.settings.testNotifyNote}
              {openNotificationSettings && (
                <button
                  type="button"
                  className="nx-slink"
                  onClick={() => void openNotificationSettings()}
                >
                  {L.settings.openSystemNotify}
                </button>
              )}
            </>
          }
        >
          {test.phase === "sending" && (
            <span className="nx-snote nx-stest">
              <Spin />
              {L.settings.testSending}
            </span>
          )}
          {test.phase === "sent" && (
            <span className="nx-snote nx-stest nx-stest--ok">
              <CheckIcon />
              {L.settings.testSent}
            </span>
          )}
          {test.phase === "blocked" && (
            <span className="nx-snote nx-stest nx-snote--red" role="alert">
              {L.settings.testBlocked(test.reason)}
            </span>
          )}
          <button
            type="button"
            className="nx-btn nx-btn--sm"
            disabled={test.phase === "sending"}
            onClick={() => void sendTest()}
          >
            {L.settings.testNotify}
          </button>
        </SRow>
      </SGroup>
    </SPage>
  );
}
