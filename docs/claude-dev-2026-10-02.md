# claude.dev 글 열 편 — ColoNova Design 에 비춰 본 것 (2026-10-02)

> [claude.dev](https://claude.dev/) 는 Anthropic 의 개발자 블로그다("technical writing for
> people building with Claude"). 이 도구는 Claude Code 를 Agent SDK 로 구동하므로 글의
> 절반이 우리 코드에 직접 닿는다. 글마다 무엇을 말하는지, 우리에겐 어떤지, 이번에 한
> 것과 남은 것을 적는다. 행동이 바뀐 자리는 [DEVELOPERS.md](DEVELOPERS.md) 가 진실이고,
> 이 문서는 그 결정의 출처다.

## 한눈에

| 글 | 판정 | 이번에 한 것 · 남은 것 |
| --- | --- | --- |
| [Context engineering for Claude 5](https://claude.dev/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models/) | **적용** | 공통 규칙 24 → 12 불릿(2,929 → 1,998자). 도구 사용법은 도구 설명으로. 이 레포의 `CLAUDE.md` 도 세 문서 통째 싣기(≈123KB)에서 안내와 함정 한 장(3.5KB)으로 |
| [What a task costs on Opus 5.5](https://claude.dev/blog/what-a-task-costs-on-opus-5-5/) | **적용** | 턴 통계에 `tokens` · `costUsd` · `cacheHitRate`, 벤치 표에 비용 · 캐시 |
| [Getting the most out of Opus 5.5](https://claude.dev/blog/getting-the-most-out-of-opus-5-5/) | **적용** | 기계 턴 넷(화면 확인 · 충돌 정리 · 코멘트 반영 · 제출 단계 · 준비 회복)에 끝의 기준 한 줄 |
| [Spending your effort](https://claude.dev/blog/spending-your-effort/) | 부분 | 5단계 노력 칩과 기본 medium 은 이미 같다. 열린 대화의 칩에 "중간에 바꾸면 다시 읽는다" 한 줄. 남은 것: 턴 종류별 권고를 벤치로 확인 |
| [Building with Claude Sonnet 5.5](https://claude.dev/blog/building-with-claude-sonnet-5-5/) | 부분 | 모델을 하드코딩하지 않는다. 초대장 기본값 권고(Sonnet · medium, 수치 확인 뒤)를 DEVELOPERS.md 에 적었다 |
| [Automating eval design and hillclimbing](https://claude.dev/blog/automating-eval-design-and-hillclimbing/) | 부분 | 벤치가 재생 평가다. 남은 것: 시나리오 수 · 노이즈 측정 · 답변 품질 채점 |
| [How we use skills](https://claude.dev/blog/lessons-from-building-claude-code-how-we-use-skills/) | 부분 | 연결 레포에 검증 스킬을 두라는 안내를 DEVELOPERS.md 에 적었다(레포의 `.claude/` 는 이미 실린다). 데몬이 싣는 스킬은 남음 |
| [How we made claude.ai 3x faster](https://claude.dev/blog/how-we-made-claude-ai-faster/) | 간접 | "측정이 먼저 · 래칫" — 릴리스 점검 11번(벤치 중앙값을 지난 릴리스와 비교)으로 |
| [Getting started with Claude Code mods](https://claude.dev/blog/getting-started-with-claude-code-mods/) | 해당 없음 | 터미널 UI 플러그인. 아이디어는 이미 다른 모양으로 있다 |
| [Dynamic workflows](https://claude.dev/blog/a-harness-for-every-task-dynamic-workflows-in-claude-code/) | 해당 없음 | 글 스스로 "일반 코딩에는 과하다" |

## 적용한 것

### 1. 컨텍스트 엔지니어링 — 공통 규칙을 갈랐다

글의 요지: Claude 5 세대에서는 Claude Code 시스템 프롬프트의 80% 를 걷어내도 평가 손실이
없었다. 규칙 대신 판단을 맡기고, 서로 부딪히는 제약을 없애고, **도구 사용법은 시스템
프롬프트가 아니라 도구 설명에** 두며, 같은 말을 두 층에 되풀이하지 않는다.

우리 공통 규칙(`packages/daemon/src/common-instructions.ts`)은 24 불릿 가운데 넷이 도구
사용법(`browser_find` · `browser_inspect` · `screen_files` · `repo_diagnostics` ·
`submit_for_review`)이었고, `screen_check` 의 인자 안내(`routes` · `viewport` · `a11y: true` ·
`colorScheme` · `capture`)가 도구 설명과 겹쳤으며, 답변의 틀 · 어휘 규칙 여섯 불릿이 서로
겹쳤다(파일 경로를 쓰지 말라는 말이 두 번). 그래서:

- 도구 사용법 불릿을 걷고, 그 뜻이 빠진 자리는 도구 설명이 채운다(`browser_snapshot` —
  "전체가 필요할 때만, 일부는 find · inspect"; `screen_files` — "핀 없이 화면을 말했을 때
  먼저"). 나머지 도구는 설명이 이미 말하고 있었다.
- 답변 규칙은 "틀"(무엇으로 열고 · 눌러 볼 것 · 링크로 닫기) 하나와 "어휘"(본문에 쓰지 않는
  것 · 기술 정보 절 · 보관 · 제출 · 반영됨) 하나로 합쳤다. 사용자 소유의 미커밋 변경(2026-10-02
  의 "기술 정보" 불릿)도 그 안에 들어 있다.
- 안전 규칙(명령 범위 · 미리보기 서버 · 락파일 · `curl | sh` · 첨부 · 비밀)은 글자 하나
  안 바꿨다 — 글도 "critical areas" 는 예외로 둔다.
- `common-instructions.test.ts` 가 분담을 지킨다: 지침은 `screen_check` 와 `notify_developer`
  만 이름으로 가리키고, 나머지 도구 이름과 `screen_check` 의 인자는 지침에 없어야 한다.

**재지 않았다.** 벤치는 데스크톱 개발 실행과 구독이 있어야 돈다. 글은 "your own numbers
are the ones to trust" 라 한다 — 아래 "다음에 할 것" 1번이 그것이다.

### 2. 비용 — 턴마다 토큰 · 비용 · 캐시 적중률

글의 요지: 한 작업의 비용은 네 변수(턴 수 · 캐시 읽기 · 출력 · 모델)로 정해지고, "다른
어떤 설정도 캐시 적중률만큼 입력 비용을 움직이지 않는다". 노력 · MCP 서버 · 빠르게는 세션
시작에 정하고 그대로 두라(바꾸면 캐시가 깨진다).

우리 턴 통계는 시간은 잘게 쟀지만 토큰 · 비용은 하나도 없었다. 그래서:

- 프로토콜 `turn.end` 에 `usage?: TurnUsage`(새 입력 · 출력 · 캐시 읽기 · 캐시 쓰기 · 비용).
  기존 `costUsd` 는 SDK 의 **누적치**였다는 사실을 주석으로 밝혔다(턴의 몫이 아니다).
- Claude 드라이버는 SDK result 의 `modelUsage`(누적 · 서브에이전트 포함)의 **차분**을
  낸다 — SDK 문서가 "토큰 · 비용 셈에는 이것을 쓰라" 고 한다. 재개 · `/clear` 로 누적이
  되돌아가 차분이 음수면 이번 값을 통째로 센다. 크래시 result 의 0 은 모름으로 둔다.
- Codex 드라이버는 `thread/tokenUsage/updated` 의 `last` 를 싣는다 — 새 입력은
  `inputTokens − cachedInputTokens`, 캐시 쓰기 · 비용은 null.
- 턴 통계 행에 `tokens` · `costUsd` · `cacheHitRate`. 벤치의 요약 · 비교 표에 비용(합)과
  캐시(가중 평균), 비용 변화율. 모르는 것은 0 이 아니라 `-` 다.

### 3. Opus 5.5 — 게이트 브리프에 끝의 기준

글의 요지: 일을 통째로 주고 **끝나는 선을 이름 붙이라**("Done means: …"), 멈출 조건을
정확히 말하라. 우리 기계 턴들은 "아래를 고친 뒤 답해 주세요" 로 끝났다 — 행동은 있고
끝의 기준이 없었다. 이제 다섯 브리프가 저마다의 마지막 줄을 갖는다: 화면 확인은 "다시
확인했을 때 같은 문제가 없을 것", 충돌 정리는 "표식이 하나도 남지 않고 두 뜻이 살아 있을
것", 코멘트 반영은 "코멘트마다 `개발자에게 (#id):` 답이 있을 것", 제출 단계는 "출력의 원인이
사라질 것 — 다시 도는 쪽은 도구", 준비 회복은 "멈춘 단계를 넘어갈 것 — 확인은 도구가".
모두 "그 밖의 화면과 파일은 손대지 말 것" 으로 범위를 묶는다. 글의 다른 권고는 이미
그렇다 — "think hard" 류 지시가 없고, 확인 없이 진행하며(bypass + 안전 규칙이 멈출 조건),
긴 작업용 `TASKS.md` · 서브에이전트 분산은 우리 턴(화면 하나)에 맞지 않는다.

## 부분 적용 — 남은 것

### 노력(effort)

글: low 는 반복 안의 빠른 답(스케치 · 쉬운 수정), medium 은 보통의 기능 구현, high 는
검증 · 엣지가 중요한 수정, max 는 완전 자율. Claude Code 의 기본은 medium.

우리: 5단계 칩(`low … max`), 고르지 않으면 CLI 기본(= medium, `thread.ts` 의 설명과
같다), 프로젝트 기본값(`defaults.effort`), 핀 턴 첫 턴의 실험줄(`COLONOVA_DESIGN_PIN_EFFORT`,
low 거절). 글의 휴리스틱은 우리 턴 종류와 맞는다 — 핀 턴은 좁은 수정이라 medium 이 적당하고,
게이트 고침 턴은 검증이라 high 가 맞다. 그러나 비용 글이 "턴 중간에 노력을 바꾸지 말라" 고
하므로 턴마다 바꾸는 길은 틀렸고, 세션 시작의 한 번이 맞다 — 지금 `pin-effort.ts` 가 그렇게
되어 있다. 남은 것: 벤치의 핀 시나리오를 `--effort low|medium|high` 로 돌려 통과 수 · 비용 ·
첫 편집을 비교하는 것(이제 비용 칸이 있다).

### Sonnet 5.5

글: 잘 정의된 반복 편집 · 조사 · 리뷰는 Sonnet, 긴 판단은 Opus. Claude Code 기본 노력은
medium. 빠르게(fast mode)는 Sonnet 에 없다. 캐시 최소 512 토큰.

우리: 모델을 하드코딩하지 않는다(기계 일회성 턴만 haiku). 우리 작업(화면 하나를 말로
고치기)은 글의 "well-scoped everyday coding" 그대로다. 빠르게 토글은 모델의
`supportsFastMode` 로 이미 가린다. 남은 것: 초대장의 프로젝트 기본값에 `model: sonnet ·
effort: medium` 을 권고로 적는 것 — 결정은 벤치 수치 뒤에.

### 평가 · 힐클라이밍

글: 좋은 평가의 네 조건(운영을 닮은 과제 · 모델이 좋아지면 점수도 오를 것 · 포화되지
않을 것 · 요동이 작을 것). 채점은 제약된 출력엔 프로그램식, 열린 출력엔 "검사 가능한
주장" 루브릭의 LLM 채점. train/test 를 가르고, 노이즈 바닥보다 큰 변화만 믿고, 비용도
목표가 된다.

우리 벤치(`scripts/bench/`): 재생 평가다 — 바뀐 파일의 부분 문자열 · 내용 · 턴 오류 ·
게이트 재개. 이번에 비용 칸이 붙어 "같은 통과에 더 싸게" 를 잴 수 있다. 남은 것:
(a) 시나리오가 fixture 7 · cds 5 로 적다 — 노이즈 바닥을 재려면 20~40 개와 `--repeat 3`;
(b) 답변 품질(화면이 무엇을 하는지로 시작 · 링크로 끝 · 파일 경로 없음 — 공통 규칙의
"틀" 그대로가 검사 가능한 주장이다)을 haiku 일회성 채점으로 더하기 — `repo-prompts.ts` 의
`memoPrompt` 와 같은 길; (c) 턴 통계는 설계상 사용자의 말을 남기지 않으므로 운영 로그 →
평가 케이스 변환은 못 한다 — 대신 베타 테스트 보고가 손으로 적는 5~10 케이스의 재료다.

### 스킬

글: 스킬은 폴더(지침 · 스크립트 · 자료)이고, "Product Verification" 류가 가장 측정 가능한
효과를 냈다. 가장 값진 내용은 **gotcha 절**이며, 처음은 몇 줄과 gotcha 하나로 시작하라.

우리: 데몬은 `plugins` · `skills` 를 싣지 않는다. 다만 `settingSources: ["user","project",
"local"]` 이라 연결 레포의 `.claude/skills` 는 이미 실린다. 두 길이 있다 — (a) 게이트
브리프에 매번 실리는 긴 설명(접근성 고치는 법 · 반응형 고치는 법)을 데몬이 싣는 스킬로
옮겨 실패했을 때만 읽히게 하는 것; (b) DEVELOPERS.md 의 `CLAUDE.md` 안내 옆에 "레포의
검증 스킬(검사 명령 · 화면이 깨지는 전형)" 을 두라고 적는 것. (b) 가 더 싸다.

## 해당 없음 — 왜

- **Mods** — Claude Code 터미널 UI 의 플러그인(`turn.complete` · `tool.call` · `ui.render`).
  우리는 SDK 로 돌리고 UI 가 따로 있어 mods 가 실릴 자리가 없다. 아이디어는 이미 다른
  모양으로 있다: Token Weather = 컨텍스트 링, Blast Radius = git 가드 PreToolUse, Replay
  Theater = 작업 기록 · 수정 전후 보기. 이 레포를 고치는 개발자 자신의 터미널에는 쓸 수
  있다(예: `labels.ts` 밖의 한글 리터럴을 Edit 에서 막는 mod) — 선택이다.
- **Dynamic workflows** — 글 스스로 "리뷰어 다섯 명이 필요하지 않은 일반 코딩에는 쓰지
  말라" 고 한다. 우리 턴은 화면 하나이고 사용자는 비개발자라 "use a workflow" 를 말하지
  않는다. 켜지 않는다.
- **3x faster** — 성능 캠페인의 교훈("측정이 먼저, 모든 승리를 래칫으로")만 가져온다. 우리
  잣대는 `turn-stats` 의 `firstEditMs` · `firstDeltaMs` · `browserMs`, 이제 `costUsd`. CI 는
  구독이 없어 벤치를 못 돌리므로 릴리스마다 사람이 한 번 돌려 중앙값을 적는 습관이 래칫이다.

## 이번에 바뀐 파일

- `packages/daemon/src/common-instructions.ts` · `test/common-instructions.test.ts` ·
  `test/screen-overflow.test.ts` · `test/screen-a11y.test.ts` — 공통 규칙과 분담 시험
- `packages/daemon/src/browser-tools.ts` — `browser_snapshot` · `screen_files` 설명
- `packages/protocol/src/session.ts` — `TurnUsage` · `turn.end.usage`
- `packages/daemon/src/agent/drivers/claude/event-mapper.ts` · `drivers/codex/session.ts` — 턴의 몫
- `packages/daemon/src/turn-stats.ts` · `test/turn-stats-measure.test.ts` — 세 칸
- `packages/daemon/src/screen-gate.ts` · `test/gate-type.test.ts` — `GATE_FINISH_LINE`
- `scripts/bench/lib.mjs` · `lib.test.mjs` · `README.md` — 비용 · 캐시 칸
- `docs/DEVELOPERS.md` — 턴 통계 행 · 벤치 · 분담 문단

## 2026-10-02 둘째 손질 — 판단해서 적용한 것과 남긴 것

남은 권고 14개를 셋으로 갈랐다. 측정 없이도 글의 근거만으로 옳고 되돌리기 쉬운 것은
적용했고, 수치가 있어야 정할 것과 데몬의 핵심 경로를 건드리는 것은 이유와 함께 남겼다.

**적용**

- 이 레포의 `CLAUDE.md`(= `AGENTS.md`, 심볼릭 링크) — 세 문서 통째 싣기에서 레포 안내 ·
  문서 지도(언제 무엇을 읽는가) · 함정 열 가지 · 검사 명령 한 장으로. 문서는 손대는 영역의
  절을 읽으라고 가리킨다.
- 끝의 기준 한 줄을 나머지 기계 턴에도 — 충돌 정리(`conflictBrief`) · 코멘트 반영
  (`REVIEW_FINISH_LINE`) · 제출 단계(`repo-publish`) · 준비 회복(`repo-guidance`).
- 열린 대화의 생각 시간 칩에 "중간에 바꾸면 앞의 대화를 처음부터 다시 읽어 다음 답이 더
  걸린다" 한 줄(`L.model.thinkHelpSession`) — 비용 글의 "세션 시작에 정하고 두라".
- DEVELOPERS.md 에 셋: 연결 레포의 검증 스킬 안내(`CLAUDE.md` 다섯 줄 옆), 초대장 처음
  값의 권고(Sonnet 5.5 · medium — 벤치로 확인한 뒤), 릴리스 점검 11번(벤치 중앙값 비교).
- 서브에이전트 도구 이름 `Agent` 를 `Task` 와 같이 읽는다(`tool-names.ts` · `progress.ts`) —
  SDK 0.3.x 타입의 이름. 누적 비용 주석(`daemon-client.ts`)과 pin-effort 의 옛 주석도 고쳤다.

**남긴 것과 이유**

1. **지침 슬림화의 앞뒤 측정** — 데스크톱 개발 실행과 구독이 있어야 돈다. 사람이 돌린다.
   ```bash
   COLONOVA_DESIGN_BENCH_ENDPOINT=/tmp/colonova-bench.json pnpm dev:desktop
   pnpm bench run --endpoint /tmp/colonova-bench.json --project colonova-beta-fixture \
     --scenarios scripts/bench/scenarios/fixture.json --provider claude --repeat 3 --label after
   pnpm bench compare bench-results/<before>.json bench-results/<after>.json
   ```
2. **턴 사이의 선제 compact** — 데몬의 보내기 경로(대기 방 · replay · compact 플래그)를 건드리는
   비동기 판정이라 이 세션에서 끝까지 검증할 수 없다. 먼저 턴 통계의 `contextTokens` 로 세션이
   실제로 80% 를 넘는 빈도를 보고, 넘는다면 `release()` 앞에 `contextUsage()` 를 묻는 설계로.
3. **초대장 기본값 확정 · 턴 종류별 노력** — 1번의 수치 뒤. 권고는 문서에 있다.
4. **벤치 확장(20~40 시나리오 · 노이즈 바닥) · 답변 품질 LLM 채점** — 시나리오는 fixture 앱을
   알아야 쓰고 채점기는 돌려 봐야 믿을 수 있다. 둘 다 벤치를 돌릴 수 있는 자리에서.
5. **데몬이 싣는 스킬 · 제출 전 자기 리뷰 · 개발자 터미널용 mod** — SDK `plugins` 옵션 검증,
   구독 비용, 제품 밖의 편의. 각각 필요가 생기면.
