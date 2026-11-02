# 홈 자리 걷기 — 계획

> 상태: 구현 완료(2026-10-31). 아래 「구현 기록」에 실제로 걷고 옮긴 것과 확인 결과를 둔다.

## 0. 결정 기록 (2026-10-31 사용자)

- 홈은 앱을 처음 열 때 말고는 거의 쓰지 않는다. 홈 자리를 걷는다.
- 셸은 **기획서 · 화면** 두 자리가 된다. 10-23 화면 전면 재설계의 「셸은 세 자리다」를 바꾼다.
- 홈에만 있던 일은 쓰는 곳으로 옮긴다. 옮길 곳이 이미 같은 말을 하고 있으면 옮기지 않고 걷는다.
- 10-31 같은 날 낸 홈 전면 개선안은 이 결정으로 접는다.

## 1. 홈이 하던 일과 갈 곳

| 홈의 일 | 갈 곳 | 할 일 |
| --- | --- | --- |
| 큰 입력창(새 대화 열기) | 화면 자리의 새 대화 | 없음. 이미 같다 |
| 시작점 칩(`문구 다듬기` …) | 새 대화의 빈 자리 | 옮긴다. 처음 여는 사람이 가장 많이 본 자리다(§5 판단 1) |
| 끌어다 놓기 첨부 | 대화 칸 전체 | 없음. 대화 칸이 이미 칸 전체를 놓는 자리로 쓴다 |
| `답을 기다려요` 카드(지금 프로젝트) | 그 대화 안의 같은 카드 · 사이드바 대화 줄의 호박색 점 | 없음 |
| `답을 기다려요` 줄(다른 프로젝트) | 사이드바 `다른 프로젝트 줄` · 전환기의 숫자 | 없음 |
| 사이드바 `홈` 줄의 기다림 배지 | 사이드바 `화면` 줄 | 옮긴다. 지금 프로젝트의 기다림만 센다 |
| `지금 진행 중`(도는 대화 · 준비 · 개발자 확인) | 대화 줄의 돌림 표시 · 화면 줄의 도는 표시 · 상태 줄의 여정 · 다른 프로젝트 줄 | 없음 |
| `이어서 하기` | 사이드바 대화 목록의 `오늘` 묶음 | 없음 |
| `방금 있던 일` | 대화 줄의 표시 · 개발자 소식은 상태 줄과 `이번 작업` | 없음. 도구 업데이트 한 줄은 설정 → 업데이트 쪽이 이미 말한다 |
| `반영된 일`(최근 여덟) | `이번 작업` 팝의 아래 묶음 | 옮긴다. 홈 말고는 이 기록을 보이는 곳이 없다 |
| `서비스가 떴어요` 줄 | 첫 준비 끝 알림(토스트) | 줄은 걷는다. 토스트와 `화면 보기` 단추는 남는다 |
| 세 걸음 안내 | 새 대화의 빈 자리 안내 | 걷는다. 빈 자리 안내가 같은 일을 한다(GUIDE §2) |
| 기획서 카드(작성 중인 초안 · `새 문서`) | 기획서 사이드바의 `작성 중인 초안` · 목록 머리의 `새 문서` | 없음 |
| 홈의 문제 문장 · 초대 파일 지우기 줄 | 작업 보기의 같은 줄(상태 줄 아래) | 없음. 가져온 직후 첫 자리가 작업 보기가 된다 |

## 2. 앱을 열면 가는 곳

- 프로젝트마다 마지막으로 있던 자리(기획서 · 화면)로 간다. 기억은 이 앱의 localStorage 에 둔다(`draft-pick` 과 같은 방식).
  기억이 없으면 화면 자리다.
- 처음 연 프로젝트는 화면 자리다. 준비 진행(내려받기 · 설치하기 · 미리보기 켜기)이 바로 보인다 — 홈에서 기다리던 때보다 낫다.
- 프로젝트를 옮기면(`project-changed`) 홈 대신 위의 규칙으로 간다.
- 개발자 쪽 사건 알림(`onOpenProject`)을 누르면 그 프로젝트의 화면 자리로 간다. 지금은 홈의 받은 편지함을 연다.
- ⌘K 의 `홈` 칩은 걷는다. `새 대화` · `기획서` · `설정` 칩은 남는다.

## 3. 걷을 것

### 웹 코드

- `src/next/home/` 전부 — `HomeView` · `HomeInbox` · `HomePlans` · `HomeComposer` · `HomeReady` · `HomeStarters` ·
  `use-first-look.ts` · `icons.tsx` · `home.css`(next.css 의 불러오기 줄 포함).
- 홈 전용 lib — `lib/home-feed.ts` · `lib/home-resume.ts`. `lib/home-starters.ts` 는 시작점 칩을 옮기면 남긴다(§5 판단 1).
- 줄이는 lib — `lib/waiting.ts` 의 `waitingRows`(남는 것: `daysSince` — Workspace 가 쓴다), `lib/landed.ts` 의 `landedLines` ·
  `activeNewsOf`(`landedLines` 는 `이번 작업` 팝으로 옮기면 남는다), `lib/update-row.ts` 의 `agentUpdateEvents`.
- `lib/nav.ts` — `view: "home"` 과 `{ type: "home" }` 을 걷는다. `initialNav` 와 `project-changed` 는 §2 의 자리로 간다.
  `view` 가 `"thread"` 하나만 남으면 필드째 걷는다.
- `lib/ready-watch.ts` · `use-shell-nav.ts` — `SeenView.view` 의 `"home"` 은 「작업 화면을 보지 않음」의 뜻으로만 남는다.
  기획서 자리가 그 뜻을 맡는다. `goHome` · `dismissReady` 를 걷는다. `ready` 목록은 알림이 화면으로 가는 판정에 남긴다.
- `slots.ts` — `ShellNav` 의 `goHome` · `dismissReady`.
- `Workspace.tsx` — 홈 분기 · `nx-homebar` · `nx-offstage` 전환 · `HomeView` 렌더.
- `sidebar/Sidebar.tsx` — `홈` 줄과 `HomeIcon`. 기다림 배지는 `화면` 줄로 간다.
- `components/shell/Palette.tsx` — `onOpenHome` · `홈` 칩.
- `chat/Composer.tsx` — `variant: "home"` 과 `.nx-composer--home`.
- `labels.ts` — `L.home` 을 걷는다. `home-drafts.ts` 가 쓰는 초안 상태 말(`draftConflict` · `draftNewDoc` · `draftChanged` …)은
  `L.drafts` 로 옮긴다. `L.sidebar.home` 도 걷는다. `L.inbox` 는 대화 카드가 쓰므로 남긴다. `L.landed` · `L.firstReady` 도 남는다.
- `plans/home-drafts.ts` — 기획서 사이드바가 쓰므로 남기고, 이름을 `drafts-in-progress.ts` 로 바꾼다.

### 견본 · 시험

- `dev/home-fixture.{html,tsx}` 를 걷는다. 시작점 칩 · `반영된 일` 의 새 자리는 `thread-fixture` · `status-fixture` 에 상태를 더한다.
- 걷는 시험 — `next-home-resume` · `next-first-look`(홈 연결 부분).
- 고칠 시험 — `next-home-starters`(칩을 옮기면 새 자리로) · `next-landed` · `next-ready-watch` · `next-waiting`(홈 소스를 읽는 단언) ·
  `palette-match`(`홈` 칩) · `next-composer-suggest` · `next-sent-draft` · `next-request-results` · `next-planner-ux` ·
  `next-diagnostics-text` · `next-roving` · `next-thread` · `next-plans` · `next-preview` · `next-project-note` ·
  `next-session-target`. 뒤의 것들은 `home` 낱말만 걸린 경우가 많다 — 하나씩 읽고 판단한다.

### 문서

- `docs/GUIDE.md` — §3 홈을 걷고 목차를 고친다. 「알아 둘 말」의 세 자리를 두 자리로. §2 틀의 사이드바 줄 차례
  (`홈 · 찾기 · 기획서 · 연결 · 화면` — 연결도 이미 걷혔다)와 `홈 · 화면 자리의 목록`, 사이드바 폭의 `홈 · 화면`. 처음 한 번 뒤
  첫 자리 · 알림을 누르면 가는 곳.
- `README.md` — 193 · 196 줄 근처의 홈 · 세 자리 설명.
- `docs/DEVELOPERS.md` — 셸의 자리(561–597), 반영된 일 · 소식(375–377), 첫 준비와 홈(495–529), 알림 구독(1178),
  견본(2352–2361), 기획서 카드(1907–1913 · 1942). `layout.sidebarWidth` 의 「홈 · 화면」.
- `packages/web/src/next/README.md` — 틀 · 칸의 계약 · lib 절의 홈.
- `AGENTS.md` — 「셸은 세 자리다 — 홈 · 기획서 · 화면」을 두 자리로, 이 결정의 날짜와 함께.
- 소개 페이지(`site/`)는 이번에 고치지 않는다 — 체험에 홈 장면이 있으면 따로 걷는다.

## 4. 순서

1. **옮기기 먼저** — `반영된 일` 을 `이번 작업` 팝으로, 기다림 배지를 `화면` 줄로, 시작점 칩을 새 대화의 빈 자리로 옮긴다.
   홈이 살아 있는 채로 새 자리를 견본으로 확인한다.
2. **들어가는 길 바꾸기** — `initialNav` · `project-changed` · 알림 구독을 §2 의 규칙으로 바꾼다. 마지막 자리 기억을 더한다.
3. **걷기** — 사이드바 줄 · ⌘K 칩 · Workspace 분기 · `next/home/` · 홈 전용 lib · 라벨 · 견본을 걷는다.
4. **시험 · 문서** — §3 의 시험과 문서를 같은 변경에서 고친다. `knip` 이 남은 고아 내보내기를 잡는다.

한 단계마다 `pnpm typecheck` · `pnpm test` 를 지난다. 프로토콜과 데몬은 바뀌지 않는다.

## 5. 남은 판단

1. 시작점 칩을 옮길지 걷을지 — 옮기기를 권한다. 처음 여는 사람에게 요청의 모양을 보여 주는 유일한 자리다.
2. 마지막 자리를 기억할지, 늘 화면으로 열지 — 기억을 권한다. 기획자는 기획서로, 화면을 고치는 사람은 화면으로 돌아온다.
3. 여러 프로젝트를 한 판에서 훑는 자리가 사라진다. 사이드바 `다른 프로젝트 줄` 은 급한 것부터 셋까지만 보인다. 프로젝트를 많이
   굴리는 사용자가 아쉬워하면 그때 전환기를 넓힌다.

## 6. 완료 기준

- 앱을 켜고, 프로젝트를 옮기고, 초대 파일을 가져오고, 알림을 누르는 네 길 모두 기획서나 화면 자리에 닿는다. 빈 판이 서지 않는다.
- 사이드바에 `홈` 줄이 없고, `화면` 줄이 지금 프로젝트의 기다림 수를 말한다.
- `반영된 일` 이 `이번 작업` 팝에서 보이고, 앱을 다시 켜도 남는다.
- 첫 준비 끝 토스트의 `화면 보기` 가 그 프로젝트의 화면으로 간다.
- `src/` 와 문서에 홈 자리를 말하는 문장이 남지 않는다(숨은 폴더를 뜻하는 「홈 폴더」는 그대로다).
- `pnpm typecheck` · `pnpm test` · `pnpm build` 를 지난다. `pnpm dev:desktop` 에서 위 네 길을 눈으로 본다.

## 7. 구현 기록 (2026-10-31)

§4 의 순서대로 옮기고 걷었다. 프로토콜과 데몬은 바뀌지 않았다.

**옮긴 것**

- `반영된 일` → `이번 작업` 팝의 아래 묶음(`status/WorkPopover.tsx` — 코멘트 칸 다음, `landedLines` 로 최근 여덟 ·
  0건이면 묶음이 없다 · 누르는 줄이 아니라 기록). 묶음이 서면 코멘트 칸의 `--last` 표식이 넘어간다.
- 기다림 배지 → 사이드바 `화면` 줄. 지금 프로젝트의 `pendingCount` 만 센다(옛 `홈` 줄의 모든 프로젝트 합은 걷었다) —
  도는 표시와 함께 설 때는 배지를 비켜 세운다. 다른 프로젝트의 기다림은 `다른 프로젝트` 줄의 노트가 그대로 말한다.
- 시작점 칩 → 새 대화의 빈 자리(`chat/Starters.tsx` — 옛 `home/HomeStarters.tsx`). `ChatColumn` 의 빈 대화에서만 서고,
  `Composer.onContentChange` 로 말이 생기면 · 잠겨 있으면 물러난다. 문장은 `L.composer.starters*` 로 옮기고 lib 은
  `lib/home-starters.ts` → `lib/starters.ts` 로 이름을 바꿨다(§5 판단 1 채택 — 옮긴다). 칩의 CSS 는 `home.css` 에서
  `chat.css` 로 옮겼다.
- 걷은 것 중 옮길 곳이 같은 말을 하던 것(§1 의 「없음」 줄)은 전부 새 자리가 이미 하고 있었다 — 데몬 · 프로토콜 손대지 않았다.

**들어가는 길**

- `lib/pane-memory.ts`(새 순수 모듈 + `next-pane-memory.test.ts`) — 프로젝트별 마지막 자리를 이 앱의
  localStorage(`colonova-design.pane.<slug>`)에 남긴다(`draft-pick` 방식). `initialNav` · `project-changed` ·
  알림을 누르는 네 길이 전부 기획서나 화면 자리에 닿는다. `project-changed` 는 이제 기억한 자리를 실어 받는다.
  슬러그가 바뀐 커밋에서는 기억을 쓰지 않게 가렸다 — 옮겨 앉기 전 자리가 새 프로젝트의 기억을 덮는 일이 없게.
- 개발자 소식 알림(`onOpenProject`)은 늘 `openProjectScreen` 한 길 — 옛 홈의 받은 편지함 자리가 없으니 소식 알림도
  그 프로젝트의 화면 자리로 간다. ⌘K 의 `홈` 칩은 걷었다(칩 줄은 새 대화 · 기획서 · 설정).
- `SeenView.view` 의 `"home"` 은 계획대로 「작업 화면을 보지 않음」의 뜻으로만 남고 기획서 자리가 그 뜻을 맡는다.

**걷은 것**

- `src/next/home/` 전부, `lib/home-feed.ts` · `home-resume.ts` · `first-look.ts`(사진 요청의 마지막 손님이 홈이었다),
  `dev/home-fixture.*`, `lib/nav.ts` 의 `view` 필드와 `home` 흐름, `goHome` · `dismissReady`, `Composer` 의
  `variant`( `nx-composer--home` ), `shell.css` 의 `nx-homebar`, `Sidebar` 의 `threadView` prop(늘 참이라 속째 걷음).
- lib 줄이기: `waiting.ts` 의 `waitingRows` · `waitingForDeveloper` · `waitingNote`(`daysSince` 만 남김),
  `update-row.ts` 의 `agentUpdateEvents`, `landed.ts` 의 `activeNewsOf` · `NewsKind`.
- knip 이 잡은 이번 변경의 고아: `lib/result-photos.ts`(+시험) — `photoUrl` 의 마지막 손님이 옛 홈 사진이었고,
  `sent-draft.ts` 의 `clearSentDraft` — 보내기 성공 뒤의 옛 홈 비움 길이었다(실패 복구 `restoreRejectedDraft` 늘 남는다).
  그림도 셋 — `ui/icons` 의 `CalmIcon` · `DropIcon` · `ChevronDownIcon` 의 손님은 모두 옛 홈 컴포넌트였다. 팝의
  `HISTORY_OPEN_EVENT` 내보내기는 `HistoryDrawer` 의 정본과 겹치므로 안쪽 상수로 격했다.
- `plans/home-drafts.ts` → `plans/drafts-in-progress.ts` 로 이름만 바꾸고, 홈 줄의 한 줄 상태(`draftRowStatus`)는
  마지막 손님인 홈 기획서 카드와 함께 걷렸다 — §3 의 초안 상태 말(`draftConflict` · `draftNewDoc` · `draftChanged`)은
  `L.drafts` 로 옮길 손님이 남지 않아 같이 걷었다(죽은 말을 남기지 않는다).
- 라벨: `L.home` 전부, `L.sidebar.home`, `L.palette.homeHint`, `L.firstReady.sub`, `L.inbox` 의 홈 편지함 말
  (`openConv` · `askMany` · `stepNames` …), `L.update.doneEvent`. `next-labels` 의 죽은 문장 검사가 비움을 지킨다.
- 콜드 시험(`test/cold/next-cold.cjs`)의 과제 6 을 홈 → 새 대화의 빈 자리(안내 · 칩 누르기 · 초안 담김 · 보내기)로
  다시 썼고, 첫 자리 판정도 빈 대화 안내로 바꿨다.

**견본 · 시험 · 문서**

- 새 자리의 상태: `dev/status-fixture.html?case=x`(반영된 일 묶음), `dev/thread-fixture.html?scene=empty`
  (빈 자리 — 진짜 `ChatColumn` + 가짜 데몬).
- 걷은 시험: `next-home-resume` · `next-first-look` · `next-result-photos`. 고친 시험: `next-starters`(새 자리) ·
  `next-landed` · `next-ready-watch` · `next-waiting` · `next-plans` · `next-project-note` · `next-planner-ux` ·
  `next-update-row` · `palette-match` · `next-sent-draft` · `next-session-target` · `next-preview-overlays` ·
  `next-live-follow` · `next-session-discard`. 더한 시험: `next-pane-memory`.
- 문서: GUIDE(홈 절 걷고 절 번호 당김 · 사이드바 줄 · 찾기 칩 · 시작점 칩을 빈 자리로 · `반영된 일` 은 9절 ·
  준비 끝 토스트 · 알림), README(두 자리 · 기다림 배지 · 반영된 일), DEVELOPERS(셸의 자리 · 시작점 칩 · 첫 준비 ·
  첫 화면 사진 · 알림 구독 · 기획서 카드 · 패키지 표 · 견본), `next/README.md`(틀 · 칸의 계약 · lib 절), AGENTS
  (셸은 두 자리). 소개 페이지(`site/`)는 이번에 고치지 않았다(§3 원칙).

**확인 결과**

- `pnpm typecheck` 통과(전 워크스페이스). `pnpm test` 통과 — 남는 실패는 데몬의 Windows 환경 탓 기록된 것들
  (symlink · 원장 0o600 · draft-ai · 묽기 · 클론 정리 — 2026-10-26 스태시 검증으로 회귀가 아님을 확인한 목록과 같다).
- 눈으로 보는 검증(`pnpm dev:desktop` 의 네 길 · 견본 주소)은 이 기록을 쓴 시점에 아직 돌리지 않았다 — §6 의
  완료 기준 중 남은 항목이다.
