# next/ — 셸

앱의 유일한 셸이 사는 자리다 — 옛 셸은 걷혔고 문장과 토큰은 이 폴더의
`labels.ts` · `next.css` 가 정한 규칙(아래)을 따른다.

## 여는 법

`App.tsx` 가 연결이 서면 언제나 `NextShell` 을 그린다. 연결 전(브라우저 개발
경로의 url 붙여넣기)만 `ConnectScreen.tsx` 가 선다. 셸 밖에서 빌려 쓰는 것:
훅(`useDaemon` · `useSessions` · `usePins` · `use-invite-import`), 대화록의 블록
(`components/transcript/{blocks,activity,todo,shared}`), 미리보기 무대의 선로
(`components/preview/PreviewFrame` — 데스크톱이 `[data-testid=preview-slot]` 을 찾는다 —
와 `types.ts`), `components/shell/{Palette,Splitter}`(팔레트의 옷은 `palette.css` — 스스로
`.nx` 뿌리라 셸의 토큰을 받고, 앱 뿌리의 격자 · 잘림에는 갇히지 않는다), `ShortcutsSheet`, `lib/`.

## 규칙

- **사용자 문자열은 `labels.ts` 에만.** 이 폴더의 다른 `.ts`/`.tsx` 에 한글
  리터럴(문자열 · JSX 텍스트)을 쓰지 않는다. 숫자가 붙는 문장은 `labels.ts` 의
  함수로 만든다(`L.journey.screensBefore(n)`). 금칙어(턴 · 경로 · git · 데몬 ·
  커밋 · 브랜치 · PR)도 `labels.ts` 에 들이지 않는다. 둘 다
  `packages/web/test/next-labels.test.ts` 가 지킨다(`pnpm test`).
- **죽은 문장을 두지 않는다.** `L` 의 칸은 모두 이 폴더 어딘가가 부른다 — 같은
  시험이 센다. 칸을 통째로 건네면(`L.update`) 시험의 `WHOLE_GROUP` 표에 받는 곳을 적는다.
- **폴더 밖의 사용자 문장도 금칙어가 없다** — `test/vocab-sweep.test.ts` 가 `src/**` 의
  한글 리터럴 · JSX 텍스트를 훑는다(면제는 이유와 함께 그 파일의 `EXEMPT` 에).
- **클래스는 `nx-` 로 시작한다.** 토큰은 `next.css` 의 `.nx` 뿌리에 걸려 있어
  `styles.css` 의 전역 변수와 섞이지 않는다. 창 전체를 쓰는 뿌리(처음 한 번의
  `.nx-ob`)는 `.nx` 의 작업 틀 격자를 `display: block` 으로 풀어야 한다.
- 주석은 한국어로 써도 된다 — 검사는 주석을 걷고 본다.

## 움직임

- **손끝에는 기본값이 있다.** 단추 · 접는 머리 · 링크 · 호버로 밝아지는 줄의 호버 · 선택 ·
  눌림은 `next.css` 의 `:where()` 규칙이 150ms(`--nx-t-touch`)에 옮긴다 — 새 단추에
  `transition` 을 따로 쓰지 않는다. 특이도가 0 이라 제 전환을 선언한 부품(`.nx-sw` …)이
  이긴다. 화살표 키로 훑는 목록(`role="option"`)은 뺐다 — 하이라이트가 꼬리를 끌면 굼뜨다.
- **자리를 옮기는 것은 `--nx-t-move`(220ms).** 가락은 `styles.css` 의 `--drift`(옮김) ·
  `--spring`(튐). 접는 머리(`<details>`)는 `ui/ui.css` 가 높이째 여닫는다 —
  `::details-content` 를 아는 엔진에서만이고, 모르면 예전처럼 곧바로 여닫힌다.
- **등장은 새 줄에만.** CSS 만으로 등장을 걸면 React 가 재정렬에서 옮긴 옆 줄이 다시
  등장한다. `lib/use-fresh-keys.ts` 의 `useFreshKeys(keys, scope)` 가 앞 렌더에 없던 열쇠만
  가려 `nx-item--new`(격자 감싸개 `nx-item` — 자리를 열며) · `nx-row--new`(단추 한 줄 —
  내려앉기만)를 붙인다. 처음 그릴 때와 `scope`(프로젝트)가 바뀔 때는 이미 있는 줄을 새
  것으로 치지 않는다. 판정은 `lib/fresh-keys.ts`(순수).
- **숫자 배지는 `ui/Count`.** 값이 바뀔 때만 한 번 튄다.
- **끝난 뒤에도 남는 `transform` 애니메이션(`forwards` · `both`)을 쓰지 않는다** — 쌓임
  맥락이 남아 입력창의 팝이 아래 형제에 깔린다. 채움은 `backwards` 만.
- **동작 줄이기.** `.nx *` 규칙은 시간을 0 으로 만들 뿐이라 ① 지연(`animation-delay` ·
  늦춘 전환)은 남고 ② `::details-content` 같은 가상 요소에는 닿지 않는다 — 그런 규칙은
  자기 `@media (prefers-reduced-motion)` 블록을 갖는다.
- **재는 법.** 움직임은 시험이 못 본다 — 견본 페이지(`dev/`)나 격리 데몬에서 rAF 로
  계산된 값을 프레임마다 읽거나 `document.getAnimations()` 로 도는 것을 센다.

## 겹판 — 팝업 · 모달

겹판은 모두 같은 틀 위에 선다(2026-10-06 겹판 손질 — 표면별 결과는 `docs/overlay-review-2026-10-06.md`,
계약은 `docs/DEVELOPERS.md` 의 「겹판」). 새 겹판을 만들 때 스크림 · 그림자 · 반경 · 들어옴/나감을
다시 선언하지 않는다.

- **모달**은 `ui/ModalFrame`(+`ModalHead` · `ModalBody` · `ModalFoot`)이다 — `role="dialog"` · 이름 ·
  초점 가두기/복귀 · Esc(맨 위 층만) · 스크림 누름 · 닫는 모션이 한 곳에 있다. 닫기의 길은 하나(`useModalClose`
  의 `request()`)이고 `locked` 면 Esc · 스크림 · ✕ 가 모두 잠긴다. 설정만 제 껍데기를 쓴다(`useClosing`).
- **팝**은 `ui/Popover` 다 — 줄을 고르는 팝은 `role="menu"`(↑ ↓ Home End · 글자 건너뛰기, 줄에 `menuitem`/
  `menuitemradio` 를 단다), 폼 · 카드가 든 팝은 `role="dialog"`. 닫히면 여는 요소로 초점이 돌아온다.
- **되돌릴 수 없는 일**은 `ui/InlineConfirm` + `.nx-btn--dng` — 초점은 `그만두기` 에, Esc 는 확인만 접는다.
- **토스트**는 `nav.toast(text)` 한 길이다(`ui/Toast` — 같은 문장도 새 알림, 손 · 초점이 얹히면 멈춤).
- **토큰**은 `ui/overlay.css` — 층(`--nx-z-pop` · `modal` · `palette` · `toast`), 시간(`--nx-t-in` ·
  `--nx-t-out` = `modalCloseMs`), 스크림 흐림 · 판 반경. 나가는 모션은 들어옴의 `reverse` 가 아니라
  제 키프레임이다(같은 이름은 다시 돌지 않아 판이 곧장 끝 상태로 건너뛴다).
- **뿌리 클래스**(`.modal` · `.nx-pal` · `.onboarding` · `.nx-set-back` · `.nx-modal-back`)는
  `hooks/use-modal-focus.ts` 의 `MODAL_ROOT_SELECTOR` 가 기댄다 — 이름을 바꾸거나 서랍 스크림에 쓰지 않는다.
  열린 겹판이 있나는 `overlayOpen()`(닫는 중 `--out` 은 닫힌 것으로 친다), 다른 `aria-modal` 안의
  초점 앞에서 가두기가 물러나는 것은 `trapYields`.
- **견본**은 `dev/overlay-fixture.html?case=` 한 장 — 표면은 case 가 고른 것만 `lazy` 로 불러온다.

## labels.ts 의 칸

`L` 하나에 칸이 차례로 선다 — 공통(U10 어휘 · 문제 문장 · 여정), `단계 1 뼈대`,
`단계 2 대화`, `단계 3 미리보기`, `단계 4 제출·이번 작업`,
`단계 5 처음 한 번·준비·초대`, `단계 6 설정·업데이트`. 각 단계는 **자기 칸의
끝에만** 더한다; 칸 사이의 빈 줄 셋은 병합의 완충이라 `biome-ignore format` 으로
포매터가 접지 않게 해 두었다(더한 줄의 모양은 손으로 맞춘다).

## 틀

```
NextShell ─ 첫 상태 전 · 프로젝트 0개 · 게이트가 막힘 → onboarding/FirstRun · NoProjects(창 전체)
│           초대 파일 가져오기의 컨트롤러 하나 + onboarding/InviteConfirm(확인판)
└ Workspace ─ useSessions · usePins · useShellNav 를 한 번만 부른다
  ├ sidebar/Sidebar     새 대화 · 홈 · 찾기 / 전환기 / 다른 프로젝트 줄 / 대화 목록 · 도구가 한 일 / 설정
  ├ home/HomeView       인사 · 큰 입력창(HomeComposer) + 시작점 칩(HomeStarters) · 받은 편지함(HomeInbox) — 파일은 홈 어디에 놓아도 첨부
  └ 작업 보기(홈에서도 마운트된 채 `nx-offstage` 로 숨는다 — 미리보기 게스트가 살게)
    ├ status/StatusLine  제목 · 만드는 중 · 여정 세 점 · 제출(SubmitPopover) · 이번 작업(WorkPopover)
    ├ status/ProblemLine 문제 문장 셋 · 초대 파일 휴지통에 넣기 줄 — 대화와 미리보기에 걸친 한 줄
    ├ (좁은 창) 대화 | 화면 · <이름> 탭
    ├ chat/ChatColumn     대화록(Thread) · 카드 · 입력창(Composer · ModelChip — 칩의 주인 subject: next · session)
    └ preview/PreviewColumn 막대 · 무대(PreviewHost) · 말풍선 · 준비 화면 · 작업 기록 서랍
```

첫 가져오기(프로젝트 0개)의 행이 모두 `새로` 면 확인판 없이 곧바로 적용하고, 첫
프로젝트의 문제 문장 자리에 `초대 파일을 가져왔어요 — 휴지통에 넣기 · 나중에` 가 선다.
다시 받기는 확인판을 거친다.

처음 한 번(`onboarding/`)의 판정 — 세 항목의 통과 · 지금 손이 갈 항목 · 링 조각과 기하 — 은
`motion.ts`(순수, `next-motion.test.ts`)가 하고, 그림은 `Hero`(링 · 제목) · `FirstRun` 안의
`Step`(카드) · `Fold`(상태별 몸통의 접힘) · `InviteDrop`(놓는 자리와 `파일이 아직 없나요?` 의
요청 문장 — `NoProjects` 와 함께 쓴다)이 맡는다. 눈으로 보는 견본은 `dev/onboarding-fixture.html`.

이동 상태(홈 ↔ 대화 · 좁은 창의 탭 · 서랍 · 접힘)는 `lib/nav.ts` 의 줄임 함수,
그 손은 `lib/use-shell-nav.ts` 가 만든다. 주소에 싣지 않는다. 열린 대화의 주인은
`sessions.activeId` 하나다.

## 칸의 계약 (`slots.ts`)

**`ShellNav`** — 모든 칸이 같은 길로 움직인다.

| 손 | 하는 일 |
| --- | --- |
| `openThread(slug, threadId)` | 대화를 연다. 다른 프로젝트면 `project.activate` 뒤, 등록부가 옮겨 앉으면 연다 |
| `newThread(slug?)` | 새 대화의 빈 자리(`sessions.fresh()`) — 세션은 첫 말이 나갈 때 태어난다 |
| `goHome()` · `showThread()` | 홈 · 대화 보기 |
| `switchProject(slug, { quiet? })` | 옮기기 + 토스트 — 옮겼는지(`Promise<boolean>`)를 돌려 줘 부르는 줄이 도는 표시를 세운다. 옮겨 앉으면 셸은 홈부터 |
| `showTab("chat" \| "preview")` | 좁은 창의 탭 |
| `openSettings()` · `toast(text)` | 설정 대화상자(서랍이 열려 있으면 먼저 닫는다) · 잠깐 뜨는 한 줄 |

**`SlotProps`** — `ChatColumn`(단계 2)과 `PreviewColumn`(단계 3)이 함께 받는다:
`daemon` · `settings` · `sessions`(`useSessions` 결과) · `pins`(`usePins` 결과 —
두 칸이 같은 목록) · `project`(활성, 없으면 null) · `activeSessionId` · `nav` ·
`narrow` · `onChatChange` · `onRenameSession`. `PreviewColumnProps` 는 여기에
`onScreenName(name | null)` — 지금 화면의 제목을 셸에 알려 좁은 창의 `화면 · <이름>`
탭이 읽는다. 찍은 핀 수(탭 배지)는 셸이 `pins.list` 에서 센다.

**`StatusLineProps`**(단계 4) — `title` · `journey`(셸이 `deriveJourney(…, L)` 로 한 번
판정) · `turnStartedAt`(데몬 시계, `만드는 중 · 12초`) · `narrow` · `nav` ·
`onSubmit`(열린 제출 버튼을 눌렀다 — 확인 팝오버는 StatusLine 이 연다).
잠긴 버튼은 누르면 `journey.submit.reason` 이 버튼 아래 한 줄로 선다.
`이번 작업` 의 몸통은 `status/WorkPopover.tsx` 를 바꿔 채운다.

## 순수 판정 (`lib/`)

- `journey.ts` — `deriveJourney({ repo, diffStatus, handoff?, running, reconnect?, comments?, submitCopy }, L)`:
  세 점의 글자 · 지금 점 · `blocked` · `making` · 제출의 `enabled` · `reason` · `busy` · `more`.
  `repo.cycleScreens` 를 읽고, 없으면 커밋 수 · 요청 상태만으로 판정한다.
- `submit-copy.ts` — `submitCopy(repo?.submit, L)`(U13): 버튼의 말 · 첫 점(막힘) · 잠긴 이유
  (auth 는 새 초대 파일, 그 밖은 개발자에게 알림) · 마지막 제출 시각. 셸이 지어 여정에 건넨다.
- `work-ledger.ts` — 제출 확인 · `이번 작업` 의 목록 판정: 제출할 화면(화면마다 한 줄) · 화면 밖
  변경 · 코멘트 장부(`코멘트 반영 — ` 기록이 뒤에 있으면 반영됨) · 시작일. 장부의 값은
  `status/use-work-ledger.ts` 가 읽는다(`repo.handoffStatus` 의 `reviews` · `repo.history`).
- `project-note.ts` — `projectNote(summary, L, { aiFailed?, comments? })`(다른 프로젝트 줄의
  가장 급한 것) · `projectStatus`(전환기의 둘째 줄) · `isPreparing` · `neverPrepared`.
- `update-row.ts` — 설정의 업데이트 줄 한 줄(`updateRowCopy`) · 홈의 `방금 있던 일` 에
  서는 AI 프로그램 업데이트 소식(`agentUpdateEvents` — `DaemonStatus.agentUpdates` 의 done).
- `home-feed.ts` — `buildHomeFeed(pending, sessions, projects, activeSlug, L, { hidden?, titleOf? })`:
  홈의 `asking` · `running` · `done` · `resume`. 지워 낸 대화는 거두고 제목은 사용자가 바꾼 이름을 따른다.
- `home-resume.ts` — `resumeItems(threads, taken, systemTitles, titleOf?, limit?)`: `이어서 하기` 의
  최근 대화 세 개(다른 묶음에 선 것 · 도는 중 · 기다리는 중 · 도구의 대화는 뺀다).
- `home-starters.ts` — `startersOf(screen, L.home.starters)` · `recentScreenName(cycleScreens)` ·
  `usableScreen`: 입력창 아래 시작점 칩의 이름 · 초안 · 선택해 둘 화면 이름 자리.
- `submit-view.ts` — 제출 확인의 상태(`submitView`): 목록 · 알림 줄 · 주 단추가 서로 어긋나지 않게 읽기
  실패와 보내기 실패를 가른다(보내기가 실패해도 목록은 남고 `다시 제출` 이 선다).
- `compare-zoom.ts` — 비교 대화상자의 기본 보기(`나란히` · `겹쳐서` · `번갈아` — 좁으면 번갈아) · 확대의
  한계 · 두 사진이 함께 움직이는 이동 · 와이프 선 · 키 한 번이 하는 일. 사진 둘은 `zoom`/`pan` 한 벌을 쓴다.
- `roving.ts` · `use-roving.ts` — 라디오 군의 화살표 걸음 · 로빙 탭 순서(모델 칩의 AI · 모델 · 생각 시간).
- `use-copied.ts` — 복사 뒤 1.5초만 `복사했어요` 로 바뀌는 단추의 손(`useCopied`). 낭독은 부르는 쪽이 실린다.
- `use-closing.ts` — 겹판이 닫히는 동안의 모션 타이머 한 곳(`useClosing`).
- `result-photos.ts` — `readPhotos(record, { requestId, route })` · `photoUrl`: `고친 화면` 카드가 읽는 수정 전 · 수정 후 사진.
  요청이나 화면이 다른 기록 · 그릴 수 없는 형식 · 한도(`MAX_PHOTO_CHARS`)를 넘는 사진은 없는 것으로 친다. 카드가 둘 다 쥐고
  수정 전이 있으면 사진 위 토글(`nx-result-ba`)로 넘겨 본다.
- `retry-send.ts` — `planRetry(send, original, restoredShots)` · `SentOriginal`: `다시 시도` 의 길 셋 — 보낸
  원본을 그대로 다시 · 입력창에 말을 돌려주고 다시 붙이게 · 기록이 가진 몫으로 다시 짜기. 대화 기록에는 첨부의
  바이트가 없어(개수와 이름뿐) `useSessions.sentOriginal` 이 대화마다 마지막으로 보낸 원본을 쥔다(세 대화 ·
  `SENT_ORIGINAL_MAX_BYTES` 까지, 앱을 다시 켜면 없다).
- `agent-fix.ts` · `settings-shell.ts` · `reset-scope.ts` — 설정의 판정: AI 카드의 설치 · 로그인 진행과 실패 ·
  닫기 보호와 이름 칸의 Esc · 전체 초기화가 지우는 것의 크기.
- `shortcut-sheet.ts` — 단축키 시트의 묶음 · 키캡 조각(`keyHint` 로 이 컴퓨터에 맞춘 표기를 받아 쪼갠다).
- `problem.ts` · `invite-rows.ts` · `revert-summary.ts` · `thread.ts` · `nav.ts` ·
  `preview-geometry.ts` — 문제 문장 · 초대 확인판의 행(`inviteRows` · `inviteTitle` · `inviteReadError`) ·
  되돌리기 문구(와 서랍의 날 묶음 · 반영 차례 접힘 `historyDays`) · 대화록 · 이동 · 말풍선 좌표의 판정.
- 문장을 인자(`L`)로 받는 이유 — 시험이 src 에서 곧장 읽는 순수 모듈은 형제를 부르지
  않는다(확장자 없는 import 를 node 가 풀지 못한다).

시험: `node --test packages/web/test/next-*.test.ts packages/web/test/vocab-sweep.test.ts`.
