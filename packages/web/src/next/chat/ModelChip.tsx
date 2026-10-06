import {
  type ComponentProps,
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ChipTarget, Sessions } from "../../hooks/useSessions";
import { modelName, modelOptions, modelRowOf } from "../../lib/chat-options";
import type { Daemon } from "../../lib/daemon-client";
import { L } from "../labels";
import { chipLabel, EFFORT_OF, type EffortWord, effortWord } from "../lib/thread";
import {
  refillWhen,
  USAGE_HOT_MIN,
  USAGE_WORD_MIN,
  usageHeat,
  usageReading,
  usageRowName,
  usageRows,
} from "../lib/usage";
import { useRoving } from "../lib/use-roving";
import { Popover } from "../ui/Popover";
import { CheckIcon, ChevIcon, LockIcon, ProviderMark } from "./icons";

/** 이 개수부터는 모델 줄을 눈으로 걷지 않고 거르는 편이 빠르다. */
const MODEL_FILTER_MIN = 8;

/** CLI descriptions currently shown by the installed providers, in plain Korean. */
const MODEL_HINTS: Record<string, string> = L.model.hints;

function modelHint(label: string, hint?: string): string | null {
  if (/^default\b/i.test(label)) return L.model.defaultHint;
  return hint ? (MODEL_HINTS[hint] ?? null) : null;
}

/**
 * 라디오 군의 칸 하나 — 칸 전체가 누르는 과녁이다. AI · 모델 · 생각 시간 세 군이 같은 부품을
 * 쓴다(2026-10-06 겹판 조사): 로빙 탭 순서와 화살표 걸음은 `useRoving().item(i)` 가 펼친 props 가
 * 맡고, 이 부품은 역할과 고른 표시만 정한다.
 */
function Radio({
  checked,
  children,
  ...rest
}: { checked: boolean } & Omit<ComponentProps<"button">, "role" | "type" | "aria-checked">) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: 칸 전체가 누르는 과녁이다 — 동그라미 입력칸 없이 radio 로 읽힌다(radiogroup 안).
    <button type="button" role="radio" aria-checked={checked} {...rest}>
      {children}
    </button>
  );
}

/**
 * 입력창의 설정 칩 `Opus 5.5 · 보통 ▾` 과 그 팝오버(목업 `modelPop`) —
 * 칩은 모델과 생각 시간을 말한다(모델 목록이 오지 않았을 때만 프로바이더가 앞말).
 * 팝오버는 AI · 모델 · 생각 시간 · 사용량. 읽고 쓰는 주인은 `target` 이
 * 정한다(PLAN-MODEL-CHIP D1·D2): `next` 는 AI 고르는 줄이 서고(팝은 닫지 않고
 * 모델 목록이 바뀌는 것을 보여 준다), `session` 은 누르지 않는 AI 한 줄만 선다.
 * 부르는 길은 `target.pickProvider` · `setModel` · `setEffort`.
 * 한도가 가까우면(P6, 70% 넘음) 칩 옆에 사용량 한 단어가 선다 — 가장 찬 창의
 * 것. 팝의 사용량 칸은 창을 모두 한 줄씩 세운다(5시간 · 이번 주 · 모델별 창).
 */
export function ModelChip({
  daemon,
  sessions,
  target,
  disabledProviders = [],
  up = true,
}: {
  daemon: Daemon;
  /** 사용량 다시 읽기(`refreshUsage`)만 쓴다 — 칩의 값은 target 이 쥔다. */
  sessions: Pick<Sessions, "refreshUsage">;
  target: ChipTarget;
  disabledProviders?: string[];
  /**
   * 여는 방향 — 입력창이 화면 바닥에 붙는 대화 칸은 위로, 홈처럼 화면 가운데
   * 있는 입력창은 아래로. 위로만 열면 홈에서 팝의 머리가 창 밖으로 나간다.
   */
  up?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [modelQuery, setModelQuery] = useState("");
  const [showAllModels, setShowAllModels] = useState(false);
  // AI 를 바꿀 때마다 오르는 셈 — 모델 목록의 열쇠라, 목록이 새로 서며 내려앉는다.
  // 팝을 열 때는 0 이라 처음 여는 목록은 움직이지 않는다.
  const [aiSwap, setAiSwap] = useState(0);
  const anchor = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    setModelQuery("");
    setShowAllModels(false);
    setAiSwap(0);
  };
  const providers = (daemon.status?.providers ?? []).filter(
    (p) => !disabledProviders.includes(p.id),
  );
  const usable = providers.filter((p) => p.available && p.loggedIn !== false);
  const provider = target.provider;
  const providerLabel = providers.find((p) => p.id === provider)?.label ?? L.model.ai;
  // 고르는 AI 줄에서 알약이 앉을 칸 — 고른 AI 가 목록에 없으면 -1(알약이 없다).
  const pickedAt = usable.findIndex((p) => p.id === provider);
  const chooseProvider = (id: string) => {
    // 팝은 닫지 않는다 — 거르는 칸만 비우고 바로 아래 모델 칸이
    // 새 AI 의 목록으로 바뀌는 것을 보인 채 이어서 고르게 한다.
    // 「AI 를 바꿨는데 모델이 안 바뀐다」가 이 결함의 증상이었다.
    if (id !== provider) setAiSwap((n) => n + 1);
    target.pickProvider?.(id);
    setModelQuery("");
    setShowAllModels(false);
  };
  // 세 줄(AI · 모델 · 생각 시간)은 같은 라디오 군이다 — 군마다 Tab 정지 하나, 안에서는
  // ← ↑ → ↓ Home End(`useRoving`). AI 는 고른 자리가 곧 초점이라 화살표가 곧 고름이다.
  const aiRoving = useRoving<HTMLButtonElement>({
    count: usable.length,
    selected: pickedAt,
    onStep: (to) => {
      const next = usable[to];
      if (next) chooseProvider(next.id);
    },
  });
  const modelRow =
    modelRowOf(target.models, target.model) ??
    (target.model === null
      ? (target.models.find((row) => row.value === "default") ?? target.models[0])
      : undefined);
  const models = modelOptions(target.models, modelRow);
  const recommendedModel = models.find((row) => row.value === "default") ?? models[0];
  const primaryModels = recommendedModel ? [recommendedModel] : [];
  const selectedOutsidePrimary = models.find((row) => row.picked && !primaryModels.includes(row));
  const compactModels = selectedOutsidePrimary
    ? [...primaryModels, selectedOutsidePrimary]
    : primaryModels;
  const shownModels = showAllModels ? models : compactModels;
  const hiddenModelCount = Math.max(0, models.length - compactModels.length);
  const needle = modelQuery.trim().toLowerCase();
  const visibleModels =
    needle === ""
      ? models
      : models.filter((row) => `${row.label} ${row.hint ?? ""}`.toLowerCase().includes(needle));
  // 다섯 칸을 모두 내놓는다. CLI 가 알려 준 지원 목록(supportedEffortLevels)으로
  // 거르면 낡거나 좁은 목록이 실제 단계(xhigh · max)를 가려 두세 개만 남는 수가
  // 있다 — 생각 시간 자체가 없는 모델(supportsEffort === false)만 칸을 통째로 숨긴다.
  const efforts = Object.keys(EFFORT_OF) as EffortWord[];
  const showEffort = modelRow?.supportsEffort !== false;
  const think = effortWord(target.effort);
  // 모델은 줄을 눌러야 고른다(고르면 팝이 닫힌다) — 훑는 것만으로 바뀌면 안 되니 화살표는 초점만
  // 옮긴다. 생각 시간은 팝이 닫히지 않는 가벼운 선택이라 AI 처럼 화살표가 곧 고름이다.
  const listed = visibleModels.filter((row) => shownModels.includes(row));
  const modelRoving = useRoving<HTMLButtonElement>({
    count: listed.length,
    selected: listed.findIndex((row) => row.picked),
  });
  const effortRoving = useRoving<HTMLButtonElement>({
    count: efforts.length,
    selected: efforts.indexOf(think),
    onStep: (to) => {
      const word = efforts[to];
      if (word) void target.setEffort(EFFORT_OF[word]);
    },
  });
  const label = target.loading
    ? L.model.loading
    : target.unknown
      ? L.model.unknown
      : chipLabel(
          modelName(target.models, target.model) ?? providerLabel,
          showEffort ? L.model.efforts[think] : null,
        );
  const plan = daemon.status?.planUsageByProvider?.[provider];
  const reading = usageReading(plan);
  const usage = usageRows(plan);
  const { api } = daemon;
  // 2026-10-04 ux-review(2차): 사용량 칸은 팝에서 상시 선다 — 다시 읽기가
  // 실패하면 조용히 끝내지 않고 그 줄에서 말하고 곁의 다시 시도로 되묻는다.
  const [planRead, setPlanRead] = useState<"loading" | "ok" | "failed">("loading");
  // 가장 나중에 시작한 읽기의 끝만 칸에 닿는다 — AI 를 빠르게 바꾸면 앞 읽기가 늦게 끝나도
  // 읽는 중 표시가 먼저 꺼지지 않는다.
  const readSeq = useRef(0);
  const readPlan = useCallback(() => {
    readSeq.current += 1;
    const mine = readSeq.current;
    setPlanRead("loading");
    api.planRefresh(provider).then(
      () => mine === readSeq.current && setPlanRead("ok"),
      () => mine === readSeq.current && setPlanRead("failed"),
    );
  }, [api, provider]);
  // 팝이 열려 있는 동안 그 AI 계정의 한도를 한 번 다시 읽는다 — 팝 안에서 AI 를
  // 바꾸면 바뀐 계정을. 한도는 대화가 아니라 계정의 것이라, 다른 곳(터미널 ·
  // 웹)에서 쓴 만큼도 여기서 따라온다. 답은 status 방송으로 돌아온다.
  useEffect(() => {
    if (open) readPlan();
  }, [open, readPlan]);
  // 키보드로 연 팝은 첫 줄이 아니라 고른 칸(각 군에서 Tab 이 닿는 칸)에 초점을 얹는다 —
  // `Popover` 는 이미 안에 있는 초점은 그대로 둔다. 마우스로 연 팝은 초점을 가져가지 않는다.
  useLayoutEffect(() => {
    if (!open) return;
    const opener = anchor.current;
    if (!opener?.matches(":focus-visible")) return;
    opener.parentElement
      ?.querySelector<HTMLElement>('.nx-model-pop [role="radio"][tabindex="0"]')
      ?.focus();
  }, [open]);
  const now = new Date();

  return (
    <div className="nx-anchor nx-model">
      {reading && reading.pct >= USAGE_WORD_MIN && (
        <span
          className={`nx-usage-word${reading.pct >= USAGE_HOT_MIN ? " nx-usage-word--hot" : ""}`}
        >
          {L.chat.usageWord(reading.pct)}
        </span>
      )}
      <button
        ref={anchor}
        type="button"
        className="nx-tbtn nx-tbtn--model"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) close();
          else setOpen(true);
          if (!open) sessions.refreshUsage();
        }}
      >
        <ProviderMark provider={provider} />
        <span className="nx-model-label">{label}</span>
        <ChevIcon />
      </button>
      {open && (
        <Popover
          anchor={anchor}
          onClose={close}
          align="end"
          up={up}
          label={L.model.popLabel}
          className="nx-model-pop"
        >
          {usable.length >= 2 &&
            (target.pickProvider ? (
              <>
                <div className="nx-mh">{L.model.ai}</div>
                {/* 생각 시간 칸과 같은 말(틀 위에 올라앉은 알약) — 고른 AI 로 알약이
                    옮겨 앉고 그 AI 의 표식만 제 색을 입는다. 화살표 키는 고른 자리가
                    곧 초점이라 라디오 묶음의 로빙 탭 순서를 따른다. */}
                <div
                  className="nx-aipick"
                  role="radiogroup"
                  aria-label={L.model.ai}
                  data-none={pickedAt < 0 ? "" : undefined}
                  style={{ "--n": usable.length, "--i": Math.max(0, pickedAt) } as CSSProperties}
                  {...aiRoving.group}
                >
                  {usable.map((p, index) => {
                    const on = provider === p.id;
                    return (
                      <Radio
                        key={p.id}
                        checked={on}
                        className={`nx-aiopt${on ? " nx-aiopt--on" : ""}`}
                        {...aiRoving.item(index)}
                        onClick={() => chooseProvider(p.id)}
                      >
                        <ProviderMark provider={p.id} />
                        <span className="nx-ainame">{p.label}</span>
                      </Radio>
                    );
                  })}
                </div>
                <div className="nx-mnote">{L.model.aiNext}</div>
                <div className="nx-msep" />
              </>
            ) : (
              <>
                <div className="nx-mh">{L.model.ai}</div>
                {/* 열린 대화의 AI 는 태어날 때 정해진다 — 고르는 줄이 아니라 같은 틀에
                    이름 하나와 자물쇠만 서고, 안내가 그 밑에서 말한다(D1). */}
                <div className="nx-aipick nx-aipick--fixed">
                  <span className="nx-aiopt nx-aiopt--on">
                    <ProviderMark provider={provider} />
                    <span className="nx-ainame">{providerLabel}</span>
                    <LockIcon />
                  </span>
                </div>
                <div className="nx-mnote">{L.model.aiFixed}</div>
                <div className="nx-msep" />
              </>
            ))}
          {models.length > 0 && (
            <>
              <div className="nx-mh">{L.model.model}</div>
              {showAllModels && models.length > MODEL_FILTER_MIN && (
                <input
                  className="nx-mfilter"
                  type="text"
                  value={modelQuery}
                  // biome-ignore lint/a11y/noAutofocus: 팝이 열리면 거르는 칸부터 — 많은 모델을 걷지 않으려는 길이다.
                  autoFocus
                  placeholder={L.model.filterPlaceholder}
                  aria-label={L.model.filter}
                  onChange={(event) => setModelQuery(event.target.value)}
                  onKeyDown={(event) => {
                    // ↓ 는 거른 줄로 건너간다 — 입력칸에서 목록으로 Tab 만으로 닿던 길의 지름길.
                    if (event.key !== "ArrowDown" || listed.length === 0) return;
                    event.preventDefault();
                    modelRoving.focusAt(
                      Math.max(
                        0,
                        listed.findIndex((row) => row.picked),
                      ),
                    );
                  }}
                />
              )}
              {/* AI 를 바꾸면 목록이 새로 서며 내려앉는다 — 어디가 바뀌었는지 눈이 따라간다.
                  모델도 같은 라디오 군이다: Tab 정지는 고른 줄 하나, 줄 사이는 화살표(훑기만 하고
                  고르지는 않는다 — 줄을 눌러야 바뀌고 팝이 닫힌다). */}
              <div
                key={aiSwap}
                role="radiogroup"
                aria-label={L.model.model}
                className={aiSwap > 0 ? "nx-mlist nx-mlist--swap" : "nx-mlist"}
                {...modelRoving.group}
              >
                {listed.map((row, index) => {
                  const hint = modelHint(row.label, row.hint);
                  return (
                    <Radio
                      key={row.value ?? row.label}
                      checked={row.picked}
                      className="nx-mi"
                      {...modelRoving.item(index)}
                      onClick={() => {
                        void target.setModel(row.value);
                        close();
                      }}
                    >
                      <span className="nx-mt">
                        <b>{/^default\b/i.test(row.label) ? L.model.auto : row.label}</b>
                        {hint && <small>{hint}</small>}
                      </span>
                      {row.picked && (
                        <span className="nx-ck nx-r">
                          <CheckIcon />
                        </span>
                      )}
                    </Radio>
                  );
                })}
                {visibleModels.length === 0 && (
                  <div className="nx-mempty" role="status">
                    {L.model.noMatch}
                  </div>
                )}
              </div>
              {(hiddenModelCount > 0 || showAllModels) && !needle && (
                <button
                  type="button"
                  className="nx-model-more"
                  onClick={() => {
                    setShowAllModels((shown) => !shown);
                    setModelQuery("");
                  }}
                >
                  {showAllModels ? L.model.fewerModels : L.model.otherModels(hiddenModelCount)}
                </button>
              )}
              {modelRow?.supportsFastMode === false && (
                // 번개 칩이 없는 이유를 팝이 대신 대답한다 — 모델이 조용히
                // 가려진 것을 빠르게의 부재로 오해하는 일이 없게.
                <div className="nx-mnote">{L.model.fastMissing}</div>
              )}
            </>
          )}
          {showEffort && (
            <>
              {models.length > 0 && <div className="nx-msep" />}
              <div className="nx-mh">{L.model.think}</div>
              {/* 다섯 칸의 한 줄(세그먼트)도 AI 와 같은 라디오 군이다 — 고른 자리가 곧 초점. */}
              <div
                className="nx-mseg"
                role="radiogroup"
                aria-label={L.model.think}
                style={{ "--n": efforts.length, "--i": efforts.indexOf(think) } as CSSProperties}
                {...effortRoving.group}
              >
                {efforts.map((word, index) => (
                  <Radio
                    key={word}
                    checked={think === word}
                    className={think === word ? "nx-on" : ""}
                    {...effortRoving.item(index)}
                    onClick={() => void target.setEffort(EFFORT_OF[word])}
                  >
                    {L.model.efforts[word]}
                  </Radio>
                ))}
              </div>
              <div className="nx-mnote">{L.model.thinkHelp}</div>
              {target.subject === "session" && (
                // 열린 대화의 칩에만 — 다음 새 대화(next)는 아직 다시 읽을 대화가 없다.
                <div className="nx-mnote">{L.model.thinkHelpSession}</div>
              )}
            </>
          )}
          {/* 2026-10-04 ux-review(2차): 칸을 상시 열어 둔다 — 「왜 없지」를 칸이
              대신 대답한다. 창이 읽혔으면 줄들을 세우고, 실패 · 빈 요금제는 한 줄이 선다.
              실패한 줄 곁에서 다시 시도로 되묻는다.
              2026-10-06 겹판 조사: 읽는 중에는 바닥에 한 줄을 띄우지 않는다 — 위로 여는 팝은 바닥이
              고정이라 그 줄이 사라질 때 위의 줄들이 30px 내려앉았다. 머리 오른쪽의 작은 도는
              표시만 서고(`aria-busy`) 이전에 읽은 줄은 그대로 있다. */}
          <div className="nx-msep" />
          {/* biome-ignore lint/a11y/useSemanticElements: 머리 · 줄 · 덧말의 묶음 — fieldset 의 테두리 · legend 틀이 필요 없는 자리라 group 으로 읽힌다. */}
          <div role="group" aria-label={L.model.usage} aria-busy={planRead === "loading"}>
            <div className="nx-mh nx-mh--row">
              {L.model.usage}
              {planRead === "loading" && (
                <>
                  <i className="nx-spin nx-mh-spin" aria-hidden="true" />
                  <span className="nx-sr">{L.model.usageReading}</span>
                </>
              )}
              {planRead === "failed" && (
                // 실패도 머리 줄 오른쪽에서 말한다 — 바닥에 줄이 새로 서면 위로 여는 팝의 줄들이 올라갔다.
                <span className="nx-mh-state" role="status">
                  {L.model.usageFailed}
                  <button type="button" className="nx-mh-retry" onClick={readPlan}>
                    {L.vocab.retry}
                  </button>
                </span>
              )}
            </div>
            {usage.length > 0 && (
              <div className="nx-usage">
                {usage.map((row) => {
                  const name = usageRowName(row, L);
                  const heat = usageHeat(row.pct);
                  const when = row.resetsAt ? refillWhen(row.resetsAt, now, L) : null;
                  return (
                    <div key={name} className={`nx-usage-row nx-usage-row--${heat}`}>
                      <div className="nx-usage-row-head">
                        <span className="nx-usage-row-name">{name}</span>
                        <span className="nx-usage-row-pct">{L.chat.usageUsed(row.pct)}</span>
                      </div>
                      {/* 쓴 비율은 위의 글이 말한다 — 막대는 눈으로 가늠하는 자리다. */}
                      <div className="nx-meter" aria-hidden="true">
                        <i style={{ width: `${row.pct}%` }} />
                      </div>
                      {when && <div className="nx-usage-row-when">{L.chat.usageRefill(when)}</div>}
                    </div>
                  );
                })}
              </div>
            )}
            {planRead === "ok" && usage.length === 0 && (
              <div className="nx-mnote" role="status">
                {L.model.usageEmpty}
              </div>
            )}
          </div>
        </Popover>
      )}
    </div>
  );
}
