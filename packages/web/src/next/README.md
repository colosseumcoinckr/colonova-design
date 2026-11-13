# next/ — 셸

앱의 유일한 셸이 사는 자리다 — 옛 셸은 걷혔고 문장과 토큰은 이 폴더의
`labels.ts` · `ui/tokens.css` · `next.css` 가 정한 규칙(아래)을 따른다.

## 여는 법

`App.tsx` 가 연결이 서면 언제나 `NextShell` 을 그린다. 연결 전 · 연결 그릇 — url 을 이미 쥔
데스크톱은 `next/ConnectingScreen.tsx` 가(재시도), url 이 없거나 브라우저 개발 경로면
`ConnectScreen.tsx` 가(url 붙여넣기) 선다. 셸 밖에서 빌려 쓰는 것:
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
- **크기는 `ui/tokens.css`, 색 짝 이름은 `next.css`.** 글자 · 간격 · 높이 · 그림자 · 글 폭은 토큰을 쓴다.
  사람이 읽는 글은 12px 아래로 내리지 않는다(키캡 `kbd` · `.nx-pm` 이니셜만 예외). 반 픽셀 크기를 새로 쓰지 않고,
  손대는 규칙은 토큰으로 옮긴다. 읽는 글은 `--fs-read`(15px) · `--lh-read`(1.7)다.
- **단추 초기화는 둘로 나뉜다(2026-11-12 · `briefs/NOTE-1`).** 앱은 `styles.css` 를
  먼저 · `next.css` 를 나중에 싣는다(`main.tsx` → `NextShell.tsx` — 견본 페이지는
  보통 반대라 눈으로 확인한 결과가 앱에서 뒤집힐 수 있다). 상자(`background` ·
  `border` · `padding` · `cursor` · `text-align`)는 `:where(.nx) button`(특이도 0-0-1)이
  초기화해 부품의 단일 클래스가 이기고, 글자(`font` · `color`)는 `.nx button`(0-1-1)이
  초기화해 옛 전역 `button { font: 500 …; color: inherit }` 에 이긴다. 그러니 부품이
  단추의 글자 · 색을 정할 때는 **`.nx .클래스`(0-2-0)** 로 쓴다 — 단일 클래스(0-1-0)는
  견본에서는 먹어도 앱의 초기화에 진다. 상자 쪽은 단일 클래스로 충분하다.
  `test/next-css-variables.test.ts` 가 이 갈림을 시험한다. 같은 이유로 옛
  `styles.css` 의 요소 선택자(`button` · `input` · `textarea` · `select`)와 같은
  특이도로 겨루는 새 규칙을 쓰지 않는다.
- **대체값 없는 `var(--x)` 는 선언된 이름만 쓴다.** `next-css-variables.test.ts` 가
  `src/**` 의 모든 CSS 를 읽어 미선언 참조를 잡는다 — 대체값(`var(--x, fallback)`)은
  허용하되 대체값 안의 미선언 참조도 잡는다. 인라인 변수는 시험의 표에 받는 곳을 적는다.

## 0단계의 공통 조각 (2026-11-12 UI 조사)

부품마다 다시 만들지 않는다 — 아래 것이 그 몫이다.

- **한글 조합은 `lib/ime.ts` 의 `composing` 으로 판정한다.** `isComposing` /
  `keyCode === 229` 하나로 본다 — 조합 중의 Esc · Enter 가 찍기 닫기 · 전송 · 편집
  취소로 새지 않는다. 새 키 처리기는 같은 판정을 쓴다(Popover 의 Esc 도 같다).
- **늦은 답은 `lib/latest-request.ts` 의 `createLatestRequest<Scope>()` 가 버린다.**
  `begin(scope)` 의 표와 `isCurrent(ticket, scope)` 로 — 요청 순서와 대상이 모두
  맞는 답만 받는다. 대상 변경 · 닫힘 · 언마운트는 `invalidate()` 로 옛 답 전부를
  버린다(같은 대상으로 돌아와도).
- **읽는 중 · 없음 · 실패는 `ui/ReadState` 가 그린다** — `nx-empty` 위에 돌림 ·
  `role="status"`/`"alert"` · 실패의 `다시 읽기` 손까지 한 덩이다.
- **복사는 `ui/CopyButton`** — `useCopied`(1.5초 `복사했어요`)와 실패 안내 · 얻은
  글의 직접 선택 퇴로가 함께다. 텍스트를 취하는 일과 확인 꼬리를 따로 짜지 않는다.
- **굴리기는 `lib/scroll-to-target.ts`** — `scrollToTarget(target, opts)` 가
  `prefers-reduced-motion` 을 읽어 `auto`/`smooth` 를 정한다. `scrollIntoView` 를
  곧장 부르면 사용자의 동작 줄이기를 무시한다.
- **초점 걸음은 공통 필터를 쓴다** — `focusableElements` · `visibleFocusable`
  (`hooks/use-modal-focus.ts`)가 빈 판 판의 초점 고리 · Popover 닫힘의 초점 복귀 ·
  모달 가두기를 한 기준으로 걷는다. ModalFrame 은 `initialFocus` 를 먼저 보고,
  없으면 안의 `autoFocus`, 둘 다 없으면 판에 둔다.
- **공통 부품은 `ui/ui.css` 끝에 있다.** `nx-btn`(28 · 32 · 40px) · `nx-ibtn`(24 · 28 · 32px),
  `nx-input`(+`--area`) · `nx-field`, `nx-pill`, `nx-banner`(+`-body` · `-act`),
  `nx-empty`(+`-mark` · `-title` · `-desc` · `-act`), `nx-topbar`(52px),
  `nx-li`(+`-main` · `-title` · `-sub` · `-end`), 어긋남 카드 `nx-mismatch`(`ui/MismatchCard.tsx` —
  2026-11-02 · 같이 고치기 UX 계획 §2. 기획서 칸 읽는 문서 곁 · 화면 자리 기획서 탭 · 기획 대화 답 아래가 함께 쓴다.
  `화면을 기획서대로` 는 2026-11-03 A안 1A-1(b)부터 브리프를 화면 대화로 바로 보내는 으뜸 손이고,
  `고쳐서 보내기` 만 입력창에 미리 채운다)를
  쓴다. 같은 모양을 각 칸의 CSS에 다시 선언하지 않는다.
- **으뜸 단추는 한 화면에 하나다.** `nx-btn--pri`는 잉크 바탕이고, 포인트 색 바탕(`nx-btn--accent`)은 AI에게
  `보내기`와 켜짐 상태에만 쓴다. 상태는 색과 함께 글이나 아이콘으로 말한다.
  (2026-10-23 화면 전면 재설계)
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

겹판은 모두 같은 틀 위에 선다(2026-10-06 겹판 손질 — 계약은 `docs/DEVELOPERS.md` 의 「겹판」). 새 겹판을 만들 때 스크림 · 그림자 · 반경 · 들어옴/나감을
다시 선언하지 않는다.

- **모달**은 `ui/ModalFrame`(+`ModalHead` · `ModalBody` · `ModalFoot`)이다 — `role="dialog"` · 이름 ·
  초점 가두기/복귀 · Esc(맨 위 층만) · 스크림 누름 · 닫는 모션이 한 곳에 있다. 닫기의 길은 하나(`useModalClose`
  의 `request()`)이고 `locked` 면 Esc · 스크림 · ✕ 가 모두 잠긴다. 설정만 제 껍데기를 쓴다(`useClosing`).
  공통 모달은 반경 16px(`--r-xl`), 머리 제목 18px(`--fs-h3`), 설명 13px(`--fs-sm`)다.
- **팝**은 `ui/Popover` 다 — 줄을 고르는 팝은 `role="menu"`(↑ ↓ Home End · 글자 건너뛰기, 줄에 `menuitem`/
  `menuitemradio` 를 단다), 폼 · 카드가 든 팝은 `role="dialog"`. 닫히면 여는 요소로 초점이 돌아온다.
  팝 스택(`lib/popover-stack.ts`)은 가장 나중에 연 팝 하나만 Esc 를 받게 한다 — 팝 안에서 연
  팝(부모)은 남고, 그 밖의 팝은 갈아 끼워진다(2026-11-12 UI 조사 U-130). Esc 는 캡처 단계 — 한글
  조합 중에는 물러나고, 대상이 팝 안 `InlineConfirm`(`.nx-iconf`)이면 그 확인의 «Esc 는 확인만
  접는다» 계약에 양보한다.
- **되돌릴 수 없는 일**은 `ui/InlineConfirm` + `.nx-btn--dng` — 초점은 `그만두기` 에, Esc 는 확인만 접는다.
- **토스트**는 `nav.toast(text)` 한 길이다(`ui/Toast` — 같은 문장도 새 알림, 손 · 초점이 얹히면 멈춤).
  글자는 14px, 동작 단추는 28px다. 현재 크기는 `overlay.css`가 `ui.css`의 기본값 위에 덮는다.
  (2026-10-24 화면 전면 재설계 §4 H·I)
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
└ Workspace ─ useSessions · usePins · useShellNav · usePlansWorkspace를 한 번씩 부른다
  ├ sidebar/Sidebar     앱 머리 / 프로젝트 전환기 / 찾기 · 기획서 · 화면 / 자리별 목록 / 바닥
  │ ├ 화면              다른 프로젝트 줄 · 날짜별 대화 목록 + 새 대화 · 도구가 한 일
  │ └ plans/PlansSidebar 기획 대화 목록(+ 새 기획 대화 — 날짜 묶음 머리 · 줄 끝 ⋯ 이름 바꾸기 · 지우기, 2026-11-03;
  │                     낮은 창 780px 아래는 몫이 30% 로 줄고 날짜 머리 · 문서 이름이 숨는다, 2026-11-11 화면 평가) / 기준 페이지 + 새 문서 · ⋯ / 찾기 · 트리(PlansList — 줄 끝 상태 점) / 가져온 때
    ├ 자리별 머리        기획서: plans/PlansHeader / 화면: status/StatusLine
    ├ status/ProblemLine 문제 문장 · 초대 파일 안내(작업 자리에 유지)
    ├ 기획서 자리        plans/PlansColumn — 문서 판(PlanDocView · DraftEditor) | 기획 대화(draft/PlanChat) 두 칸
    │                   / 판 고르기 · Confluence 판과 견주기 · 코멘트 · 화면 서랍 · plans/PlansEmpty — 연결 없음 · 빈 목록 · 실패 · 만료 안내
    └ 화면 자리          (넓은 창) 미리보기 | 오른쪽 칸(대화 · 기획서 · 작업 기록 탭) — 2026-10-31 화면 자리 개선안 S15 · S10
                        (좁은 창) 화면 · <이름> | 대화 | 기획서 탭 — 화면이 첫 탭이다(S12)
      ├ preview/PreviewColumn 막대(주소 · 찍기 · ⋯) · PreviewHost · LiveLayer · 말풍선 · 준비 화면 · 좁은 창의 작업 기록 서랍 · 입력창 시트 자리
      └ chat/ChatColumn  탭 머리 · 빈 자리(안내 · 시작점 칩) · Thread(결과 띠 — S3) · PlanTab · HistoryPanel · 작업 독(S4) · Composer(모델 · `/` · `@`)
```

**두 자리** — `Workspace`는 `pane === "plans"`이면 기획서, 아니면 화면이다. 옛 세 자리의 연결 자리는 2026-10-30,
홈 자리는 2026-10-31 사용자 결정으로 걷었다 — 연결은 화면 대화의 곁줄과 읽는 문서 곁의 `이 문서의 화면` 에서 보고
끊는다. 앱을 열거나 프로젝트를 옮기면 그 프로젝트가 마지막으로 있던 자리로 들어선다(`lib/pane-memory.ts` — 이 앱의
localStorage, 없으면 화면 자리). 기획서 자리에는 화면 대화 · 미리보기 · 화면 상태 줄 · 좁은 창의 탭은 보이지 않는다.
화면 자리에는 **미리보기가 가운데서 가장 넓은 자리를 쓰고 대화가 오른쪽 칸(기본 420px, 320~640px)에 선다** —
오른쪽 칸의 위쪽은 `대화 · 기획서 N · 작업 기록` 탭이고 작업 독과 입력창은 어느 탭에서도 바닥에 남는다(2026-10-31
화면 자리 개선안 S15 · S10 — 옛 좌우 배치의 「대화와 화면이 나란히」는 그대로, 좌우만 바꿨다). 오른쪽 칸의 경계를
끌어 폭을 바꾸고 두 번 누르면(⌘\) 기본 → 화면 넓게(320) → 칸 넓게(640) 로 돈다(S11). 좁은 창은 `화면 · <이름> |
대화 | 기획서` 세 탭이고 화면 탭에도 접힌 입력창 한 줄이 바닥에 선다 — 펼치면 같은 `Composer` 를 화면 칸의 시트
자리로 옮겨 그린다. `lib/composer-sheet.ts`가 자리와 열림을 공유하고, 포털 대상 DOM 상자를 고정해 그 상자만 옮기므로 첨부와 입력 상태가 유지된다. `입력창 접기` · Esc는 같은 상태를 닫는다. 기획서의 트리는 좁은 창의 사이드바 서랍 안에 있다.
(2026-10-23 화면 전면 재설계 · 2026-10-31 화면 자리 개선안)

**화면 옆 기획서(2026-11-11 채택 계약)** — `PlanTab` 은 연결 · 이 대화의 근거 · 같이 고친 초안을 출처별로 묶는다. 목록이 있어도 `기획서 고르기`로 추가 연결한다. `docKey`가 있는 줄은 최신 초안을 읽어 최신임을 밝히며, 근거를 담은 당시의 판으로 오인하게 하지 않는다. 연결된 공식 본문은 가져온 본문을 읽는다. 읽기 실패 · 부분 실패 안내와 다시 읽기, 근거 담기 실패 안내와 입력창 수신 확인을 제공한다. 프로젝트 · 화면 · 대화가 바뀐 뒤 늦게 온 답은 현재 범위에 반영하지 않는다. 런타임 눈 검증 범위와 결과는 같은 검토 문서에 남겼다.

**결과의 화면 이름(2026-11-11 여정 검토)** — `requestResults`는 저장된 화면 이름이 비었을 때만
같은 대화의 미리보기 링크에서 같은 경로의 제목을 보완한다. 저장된 제목과 외부 링크 판정은 유지한다.
이 표시 보완은 데몬의 화면 지도나 제출 분류를 수정하지 않는다.

**숨는 칸은 마운트를 지킨다.** 미리보기의 입력 · 스크롤 · 핀, 화면 대화의 쓰던 글, 기획서의 열린 문서 · 초안을 유지한다.
기획서 본문과 트리는 처음 기획서 자리를 열 때 마운트하고 그 뒤에는 숨긴다. `PlansWorkspace.tsx`의 `usePlansWorkspace`와
`PlansContext`가 트리 · 본문 · 찾기의 목록과 선택 상태를 공유한다. 연결한 프로젝트에서 기획서나 팔레트를 처음 열 때 목록을 읽는다.
팔레트는 이미 읽은 목록을 재사용하고, 기획서 자리에 다시 들어오면 목록을 갱신한다. 프로젝트가 바뀌면 목록 · 방문 상태 ·
열린 문서 · 초안 선택 · 찾는 말 · 접힌 폴더를 초기화한다. 저장된 초안을 지우는 것은 아니다.

숨는 칸은 **제 뿌리에** `nx-offstage`를 단다. 격자 직계에는 `.nx-body > .nx-offstage`가 이겨 숨은 칸이 자리를 차지하지 않는다.
`PreviewColumn`의 뿌리 클래스 누락으로 기획서가 둘째 줄에 떨어졌던 결함은 2026-10-23 기획자 화면 손질에서 고쳤다.
화면 대화 감싸개와 기획서 본문은 `aria-hidden`과 `inert`도 받는다. 칸 안의 색은 `.nx`의 토큰만 읽는다.

**기획서 본문(2026-10-31 기획서 칸 개선)** — 두 칸이다 — 왼쪽 문서 판(PlanDocView · DraftEditor), 오른쪽 기획 대화
(`draft/PlanChat`) — 넓은 칸에서 대화 칸은 머리 줄 아래부터 바닥 · 오른쪽 끝까지 붙고, 판의 위 · 아래 여백은 문서 칸이 제 스크롤 안에
가져간다(2026-11-12 사용자 요청). 읽기 · 고치기의 두 모드는 없다 — 문서 판은 늘 같은 자리고, 초안이 없는 문서의 첫 말은 초안을 열어
건네진다(`pending-ask`). 두 칸 사이의 선(`nx-pl-split`)을 끌어 폭을 바꾼다 — 선에 초점을 두고 ←/→ 는 24px,
Home/End 는 양끝(300 · 560px), Enter · 두 번 누름은 기본(380px)으로 옮긴다(2026-11-11). 문서 판의 `⤢` 가 판을 넓혀 대화를 접는다 — 접힌 대화 칸은 마운트가 남아 입력창의
쓰던 글과 붙인 근거가 보존된다(2026-11-11). 칸 폭 1100px 아래(`@container nxpl`)에서는 `문서` · `대화` 두 탭이
칸 위쪽의 가로 띠로 서고 고른 쪽이 칸 폭 전체를 쓴다(2026-11-11 화면 평가 수리 — 옛 세로 기둥 탭은 대화를 창 밖으로
밀었다). 탭은 화살표 · Home/End 도 먹는다(`lib/tab-keys` 한 판 — 오른쪽 칸 탭 · 설정 목록과 같다) — 대화 탭에서는
대화 칸 머리의 안내문이 순다(2026-11-02 D6). `useDraftThread`의 판은 `PlansColumn`이
쥐므로 문서 판의 남은 걸음 고르기 · 바로 반영의 표시와 대화의 문서 카드가 같은 판을 본다. 직접 고치다 바깥 고침으로 잃을 뻔한 글(되살린 글)도
`PlansColumn` 이 프로젝트 · 문서별로 쥔다 — `DraftEditor` 는 `recovery`(목록 · 더하기 · 닫기)를 받아 그리기만 하고, 초안을 닫았다 열어도 남으며
저장하지 않는다(2026-11-12 UI 조사 U-098). 기획 대화의 견주기 표는
셀마다 제 폭을 지킨다(`draft.css` 의 min-width — 전역 `.md table` 의 width:100% 이 좁은 칸에서 CJK 셀을 한 글자씩
접는다). AI 의 고침은 채택 없이 초안에 바로 들어가고(`#applyProposalLocked` — 2026-10-31 사용자 결정), 대화의 문서
카드가 `문서에서 보기`(문서 판을 그 블록으로 옮겨 칠한다 — 좁은 칸은 `문서` 탭이 먼저 선다, 2026-11-11)와
`되돌리기`(되돌릴 재료는 변경안 기록에 남는다)를 세운다. `⤢` 는 `nx:plans-expand-chat`
방송으로, 고른 글은 `nx:plan-selection` 방송으로 대화 칸에 닿는다.
기획 대화 칸의 말씨는 화면 대화와 같은 닻이다(2026-11-02 D 개선) — 기록(`.nx-dr-thread-log`)의 첫 아이 `margin-top: auto`
로 짧은 대화가 입력창 위에 붙고, AI 말은 `chat.css` 의 `nx-av`(스파크) 얼굴과 `lib/answer-lead` 의 첫 문장 크게를 쓰며,
말마다 `lib/format` 의 `timeAgo` 시각이 붙는다. 시각과 말의 손은 끝줄 하나(`.nx-dr-msg-foot`)에 서고 — 숨은 손이 따로 한 줄을
차지해 말 사이가 들쭉날쭉했다 — AI 답의 문서 카드는 끝줄보다 앞에 선다. 판정 실패의 `다시 시도`(`.nx-dr-msg-retry`)는 숨지 않는다
(2026-11-12 기획 대화 칸 손질). 마지막 말의 손은 늘 보이고, 바닥에서 떠나면 `nx-jump`(`맨 아래로` ·
`새 내용`)가 `.nx-dr-formwrap` 위에 뜬다. 입력창은 글이 바뀔 때마다 높이를 다시 잡아(`chat/Composer` 와 같은 규칙)
두 줄부터 180px 까지 자라고, 모델 칩과 보내기는 한 묶음(`.nx-dr-send`)이라 좁은 칸에서 묶음째 다음 줄 오른쪽으로 내려가며
머리의 담당 한 줄은 말줄임하지 않고 줄을 바꾼다(2026-11-12), 근거 고르기(`RefPicker`)는 `+ 근거 더하기` 단추에 붙은 `ui/Popover` 팝으로 뜨며 후보 · 절
고르기는 실제 `docRead`의 절 목록으로 만들고 순수 모듈 `draft/thread-model.ts`가 중복과 개수 제한을 잰다. 목록/절 읽기는 따로 재시도하고 늦게 온 답은 버린다. 문서 카드의 남은 고침 알약은
단추여서 누르면 남은 걸음 블록으로 문서 판을 연다. 채택 걸음의 옛 규칙(`.nx-dr-prop*` · `.nx-dr-cmp*` · `adopt` 손 ·
`ReadAsk`)은 2026-11-02 D11 에서 걷혔다.
직접 고치기의 마크다운 길(2026-11-02 사용자 지시)은 순수 모듈 `draft/markdown-blocks.ts` 가 맡는다 — 치던 글의 표식 변환
(`typedShift`) · 막대 표 판정(`pipeTable`) · 붙여넣기의 HTML → 투영 방언 변환(`clipboardBlocks` · `blocksFromDom`).
이스케이프는 데몬 `storage-blocks.ts` 의 `projectText` 와 같은 눈금이다 — 여기서 어긋나면 발행 때 글이 물린다. 여러 블록의
붙여넣기는 `insertEdits` 가 같은 닻의 insert 를 역순으로 쌓아 한 요청에 싣는다(데몬 `#indexAfter` 가 닻 바로 다음에
끼우기 때문). 목록 칸의 `textToList` 는 줄머리 마크다운 표식을 걷는다.
기존 `planDraft` · `setPlanDraft` · `StatusLine.docFocus` 계약은 남지만 `Workspace`의 자리 배치 조건으로 쓰지 않는다.

**미리보기 막대** — `PreviewBar`는 이동(`nx-pvg`) · 화면 고르기(`nx-addrwrap`) · 보기 도구(`nx-pvg--tools`)
세 묶음이다. 조절 높이는 32px다(기기 마디는 2026-11-11 걷었다). `찍기`는 보통 단추이며 켜졌을 때만
`nx-btn--accent`를 쓰고 담긴 수를 배지로 표시한다. 좁은 칸에서는 기록 글자 · 배율 · 찍기 글자 · 앞으로 순으로 숨는다.

**문제 줄** — `ProblemLine`은 공통 `nx-banner`에 아이콘 · 글 · 단추를 놓는다. 고치는 중은 호박색, 알렸다는 소식은 파랑,
막힘 · 다시 연결은 빨강이다. 좁은 창은 제목 아래 본문만 두 줄 말줄임하고 단추를 아래로 내린다.
준비 실패도 `PrepareCard`의 빨간 `nx-banner`다.
(2026-10-24 화면 전면 재설계 §4 F·G)

첫 가져오기(프로젝트 0개)의 행이 모두 `새로` 면 확인판 없이 곧바로 적용하고, 첫
프로젝트의 문제 문장 자리에 `초대 파일을 가져왔어요 — 휴지통에 넣기 · 나중에` 가 선다.
다시 받기는 확인판을 거친다.

처음 한 번(`onboarding/`)의 판정 — 세 항목의 통과 · 지금 손이 갈 항목 · 링 조각과 기하 — 은
`motion.ts`(순수, `next-motion.test.ts`)가 하고, 그림은 `Hero`(링 · 제목) · `FirstRun` 안의
`Step`(카드) · `Fold`(상태별 몸통의 접힘) · `InviteDrop`(놓는 자리와 `파일이 아직 없나요?` 의
요청 문장 — `NoProjects` 와 함께 쓴다)이 맡는다. 눈으로 보는 견본은 `dev/onboarding-fixture.html`.

이동 상태(기획서 · 화면 · 화면 자리의 좁은 창 탭 · 서랍 · 접힘)는 `lib/nav.ts` 의 줄임 함수,
그 손은 `lib/use-shell-nav.ts` 가 만든다. 주소에 싣지 않는다. 열린 대화의 주인은
`sessions.activeId` 하나다. 같은 훅이 프로젝트의 마지막 자리 기억(`lib/pane-memory.ts`)을 읽고 쓰며, 첫 준비가
끝난 순간(`lib/ready-watch.ts` — 데몬의 `ProjectSummary.firstPrep` 표식과 보고 있는 화면으로 판정)을 알아
`화면 보기` 단추가 달린 토스트를 세운다(2026-10-07; 줄은 2026-10-31 홈 걷기로 걷혔다).

## 칸의 계약 (`slots.ts`)

**`ShellNav`** — 모든 칸이 같은 길로 움직인다.

| 손 | 하는 일 |
| --- | --- |
| `openThread(slug, threadId)` | 대화를 연다. 다른 프로젝트면 `project.activate` 뒤, 등록부가 옮겨 앉으면 연다 |
| `newThread(slug?)` | 새 대화의 빈 자리(`sessions.fresh()`) — 세션은 첫 말이 나갈 때 태어난다 |
| `showThread()` | 화면의 대화 보기(좁은 창은 대화 탭) |
| `openScreen?()` | 열린 대화가 있으면 화면 자리로 가며 좁은 창은 화면 탭을 연다. 열린 대화가 없으면 새 대화의 빈 자리로 간다 |
| `showScreen()` | 작업 화면의 미리보기 쪽(좁은 창은 화면 탭) — 첫 준비가 끝났다는 토스트가 부른다. `switchProject` 는 이미 활성인 프로젝트로는 아무 데도 가지 않는다(2026-10-07) |
| `openProjectScreen(slug)` | 서비스가 떴다는 소식(토스트 · OS 알림)의 단추 — 활성이 아니면 옮긴 뒤 그 작업 화면(2026-10-31 홈 걷기로 개발자 소식 알림도 이 길로 온다) |
| `switchProject(slug, { quiet? })` | 옮기기 + 토스트 — 옮겼는지(`Promise<boolean>`)를 돌려 줘 부르는 줄이 도는 표시를 세운다. 옮겨 앉으면 그 프로젝트의 마지막 자리가 선다 |
| `showTab("chat" \| "preview")` | 좁은 창의 탭 |
| `openPlans()` · `showPane("preview" \| "plans")` | 기획서 자리로 간다(다시 눌러도 머문다) · 기존 호출자가 화면/기획서 자리를 고르는 손 |
| `openSettings()` · `toast(text, action?)` | 설정 대화상자(서랍이 열려 있으면 먼저 닫는다) · 잠깐 뜨는 한 줄 — `action`(`{ label, run }`)이 있으면 단추가 달리고 8초 머문다 |
| `openPlansConnect()` | 기획서 연결 대화상자(`project/PlansConnectDialog` — 활성 프로젝트의 Confluence. 서랍이 열려 있으면 먼저 닫는다, 2026-11-13 사용자 결정 — 프로젝트 쪽) |

**`SlotProps`** — `ChatColumn`(단계 2)과 `PreviewColumn`(단계 3)이 함께 받는다:
`daemon` · `settings` · `sessions`(`useSessions` 결과) · `pins`(`usePins` 결과 —
두 칸이 같은 목록) · `project`(활성, 없으면 null) · `activeSessionId` · `nav` ·
`narrow` · `onChatChange` · `onRenameSession`. `PreviewColumnProps` 는 여기에
`onScreenName(name | null)` — 지금 화면의 제목을 셸에 알려 좁은 창의 `화면 · <이름>`
탭이 읽는다. 셸은 이 이름을 `ChatColumnProps.screenName` 으로도 전달한다. 빈 대화는 현재 프로젝트의 미리보기 이름만 쓰고 쓸 수 없으면 중립 문구로 선다. 찍은 핀 수(탭 배지)는 셸이 `pins.list` 에서 센다.

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
- `update-row.ts` — 설정의 업데이트 줄 한 줄(`updateRowCopy`).
- `landed.ts` — 반영된 일(2026-10-08): `landedLines(landed, limit = 8)` 가 `이번 작업` 팝의 아래 묶음 줄(최신순 · 같은 요청 번호는 한 번 · 0건이면 묶음이 없다),
  `landedFacts(days, screens, words)` 가 `3일 만에 · 화면 2곳`(아는 것만), `hasLandedFacts(event)` 가 사건이 카드로 설지(필드 없는 옛 사건은 얇은 한 줄),
  `landedIsFresh(at, now)` 가 체크를 그릴 만큼 막 도착했는지를 가른다. 카드 그림은 `chat/LandedCard.tsx`.
  (옛 홈의 `home-feed.ts` · `home-resume.ts` 와 소식 판정 `activeNewsOf` 는 2026-10-31 홈 걷기로 걷혔다.)
- `starters.ts` — `shownScreenName` · `startersOf(screen, L.composer.starters)` · `usableScreen`: 현재 미리보기 이름을 제목 첫 조각 · 따옴표 · 24자 · 개발 흔적 · 이름 없는 화면으로 거르고 빈 대화의 안내 · 칩 초안 · 선택 자리를 만든다. 최근 작업 화면과 `firstScreen` 폴백은 쓰지 않는다.
- `submit-view.ts` — 제출 확인의 상태(`submitView`): 목록 · 알림 줄 · 주 단추가 서로 어긋나지 않게 읽기
  실패와 보내기 실패를 가른다(보내기가 실패해도 목록은 남고 `다시 제출` 이 선다).
- `use-copied.ts` — 복사 뒤 1.5초만 `복사했어요` 로 바뀌는 단추의 손(`useCopied`). 낭독은 부르는 쪽이 실린다.
  그 손에 실패 안내와 직접 선택 퇴로까지 얹은 부품이 `ui/CopyButton` 이다(위 «0단계의 공통 조각»).
- `use-closing.ts` — 겹판이 닫히는 동안의 모션 타이머 한 곳(`useClosing`).
- `latest-request.ts` · `ime.ts` · `scroll-to-target.ts` · `popover-stack.ts` — 늦은 답 버리기 · 한글
  조합 판정 · 동작 줄이기를 읽는 굴리기 · 팝의 최상위 Esc. 쓰는 법은 위 «0단계의 공통 조각».
- `mismatch-model.ts` — 어긋남 카드의 순수 재료(2026-11-02 · 같이 고치기 UX 계획 C7 · C8): `mismatchRowKey`
  (절 · 화면 이름의 짝) · `offerMismatchToComposer`(문서를 근거로 붙이고 브리프를 입력창에 미리 채운다 — 보내기는 사람) ·
  `sendMismatchNow`(2026-11-03 A안 1A-1(b) — 같은 길에 `send: true` 를 실어 입력창이 곧바로 보낸다,
  도는 중이면 대기 줄) ·
  `applyMismatchToDraft`(초안이 없으면 먼저 열고 기획 대화로 브리프를 보낸다). 브리프 문장은 `L.compare.applyBrief` ·
  `sendBrief`. 이벤트 이름 `nx:composer:attach` 는 `composer-attach.ts`(순수 모듈 — .tsx 를 읽지 않는 시험도 쓴다).
- `plans/plans-list.ts` — 기획서 칸의 순수 조립(2026-10-18): `planRows`(경로의 **걸음** 순서 — 글자 통째로 견주면 `정책서 v2` 가
  폴더와 그 아래 문서 사이로 끼어든다 · 숫자는 숫자로 · `hasChildren` · `folder`) · `visiblePlanRows`(접은 폴더 아래 가리기) ·
  `filterPlanRows`(제목 + 바로 위 폴더, 조각이 모두 맞아야) · `splitFrontmatter`(파생 마크다운 맨 위의 `---` 머리말을 뗀다 — 그대로
  그리면 가로줄 + 큰 제목 하나로 깨진다) · `planBodyBlocks`(데몬의 자리 표시 `[Confluence 매크로: …]` · `[첨부: …]` 를 상자 · 알약으로 —
  마커는 `L.plans.macroMarker` · `attachMarker` 와 데몬 소스가 글자까지 같아야 하고 시험이 대조한다) · `syncLine` · `importLine` · `docUrl`.
  호출 손은 `plans/use-plans.ts`(`daemon` 은 렌더마다 새 겉모습이라 `daemon.api` 를 ref 로 쥔다 · 늦게 온 답은 번호로 버린다).
  견본은 `dev/plans-fixture.html?case=list|none|empty|list-loading|list-failed|doc-slow|doc-failed|import-slow|import-failed|expired`.
- `plans/view/doc-view-model.ts` — 기획서 보기의 순수 판정(2026-10-30 사용자 요청 — Confluence 기능 확장): 그리지 못한 매크로 이름
  (`unknownMacros`) · 목차 들여쓰기 · 그릴 그림 종류(svg 제외) · 첨부 기억 열쇠 · 라벨 이름 검사와 결과 한 줄 · 본문 찾기 결과 거르기와
  강조 조각 · 코드 울타리. 그림은 `DocView`(데몬의 보기 블록 나무를 `.md` 눈금으로 그린다 — 홀로 선 그림은 칸 폭에 맞게 본래 크기 한도,
  누르면 겹판 `크게 보기`)와 `DocPreview`(초안의 보존 블록),
  곁은 `DocLabels` · `DocAttachments` · `DocHistory`, 손은 `use-attachment`(Blob 주소 기억) · `use-body-search` · `use-block-previews`.
- `handoff-preview.ts` · `use-handoff-draft.ts` — 제출 확인의 `개발자에게는 이렇게 보여요`: `handoffPreviewOf(draft, firstSubject)` 가 데몬의 요청 초안
  (`repo.handoffDraft`)에서 사용자가 읽는 제목(종류 접두어 · 작성자 꼬리를 뗌) · 설명 첫 대목 · 사진 수 · 자동 확인 결과(`extras.checks`)를 뽑고, `useHandoffDraft` 가 제출을 붙잡지 않고 따로 읽는다.
  첫 제출에만 읽는다 — 더하는 제출은 개발자의 글이 그대로라 지금 제목만 보인다. 정규식 안의 한글 · 역따옴표는 `\u` 로 적는다(한글 리터럴 린트가 정규식을 읽지 못한다).
- `waiting.ts` — 기다림이 보이게: `daysSince(since, today)` 가 요청이 열린 지 달력으로 며칠인지(오늘 0 — 여정의 며칠째가 읽는다).
  옛 홈의 줄 묶음(`waitingRows` · `waitingForDeveloper`)은 2026-10-31 홈 걷기로 걷혔다 — 사이드바 `화면` 줄의 배지가
  데몬의 `pendingCount` 로 그 말을 맡는다. 오늘의 자정은 부르는 쪽(`useToday`)이 쥔다.
  활성 프로젝트의 같은 요청이면 `note` 가 부제가 된다(`waitingNote` — 개발자의 승인 · 통과하지 못한 자동 검사, 검사 문장은 `ci-line.ts` 와 같은 판정).
- `receipt.ts` — 제출 영수증이 말하는 것: `sentOf(screens)` 가 확인 창의 이번 제출 화면을 사건에 실을 모양(`SubmitSent`)으로,
  `receiptFacts(block, same, more)` 가 받을 개발자 · 보낸 화면 · `nobody`(링크를 직접 전해야 하는가)를 가린다. 모르는 것은 말하지 않는다.
- `making.ts` · `use-held-phase.ts` — 단계 말: `makingPhase(blocks)` 가 도는 도구의 묶음을 고르고 `makingWordOf(phase, words)` 가 말로 옮긴다.
  `useHeldPhase(phase, on)` 은 말을 1.5초 이상 머물게 한다(상태 줄의 알약과 대화 칸의 진행 줄이 함께 쓴다).
- `run-plan.ts` — 입력창 위 알약(`chat/RunPlan.tsx`)의 내용: `runPlan(blocks)` 가 이 턴의 할 일 목록(`lib/todo-plan.ts` 의
  `currentTodoItems`)과 본 대화가 띄운 보조 작업(`lib/progress.ts` 의 `agentBriefs`)을 고른다. 둘 다 없으면 null(2026-10-20 사용자 요청).
- `undo-last.ts` — `undoTargetFor(entries, screens, requestId)`: `방금 한 것 되돌리기` 가 돌아갈 곳(`{ sha, count }`) — 그 요청의 보관이
  기록의 맨 위부터 이어질 때만. `request-results.ts` 의 `latestResult` 가 「마지막 턴이 낸 결과」 를 고른다.
- `result-photos.ts` — `photoUrl`: 사진의 형식과 크기를 확인해 안전한 데이터 주소를 만든다. 첫 화면 사진 호환 경로가 사용한다.
- `retry-send.ts` — `planRetry(send, original, restoredShots)` · `SentOriginal`: `다시 시도` 의 길 셋 — 보낸
  원본을 그대로 다시 · 입력창에 말을 돌려주고 다시 붙이게 · 기록이 가진 몫으로 다시 짜기. 대화 기록에는 첨부의
  바이트가 없어(개수와 이름뿐) `useSessions.sentOriginal` 이 대화마다 마지막으로 보낸 원본을 쥔다(세 대화 ·
  `SENT_ORIGINAL_MAX_BYTES` 까지, 앱을 다시 켜면 없다).
- `agent-fix.ts` · `settings-shell.ts` · `reset-scope.ts` — 설정의 판정: AI 카드의 설치 · 로그인 진행과 실패 ·
  닫기 보호와 이름 칸의 Esc · 전체 초기화가 지우는 것의 크기.
- `follow-edit.ts` · `preview/use-live-follow.ts` — 라이브감(2026-10-08): AI 가 고치는 화면을 같이 따라간다. `shouldFollow` 가 첫 편집에서
  미리보기를 그 화면으로 옮겨도 되는지(설정 · 칸이 숨음 · 덮개 · 외부 페이지 · 찍기 · 겹판 · 얼린 화면 · 작업 기록 · 이번 턴에 사용자가
  만졌는지 · 이미 그 화면인지)를, `judgeSignal` 이 `session.editing` 신호 하나를 「턴의 첫 신호인가 · 막 도착했는가 · 이름을 말할 수
  있는가」 까지 가려 내고, `pickLiveLine` 이 한 줄의 차례(옮겼어요 → 눌러 보는 중 → 고치는 중)를 정한다. 훅은 사용자의 손(`touchedAt`)과
  `browser.driving` 의 붙들기를 맡고, 마크업은 `preview/LiveLayer.tsx`(견본이 같은 것을 그린다). 이름 앞 · 뒤의 말을 둘로 나눈 문장(`L.live`)
  은 줄임표가 이름만 자르게 한 것이다.
- `shortcut-sheet.ts` — 단축키 시트의 묶음 · 키캡 조각(`keyHint` 로 이 컴퓨터에 맞춘 표기를 받아 쪼갠다).
- `composer-suggest.ts` — 입력창의 `/` · `@` 목록(2026-10-14): `triggerAt(text, caret)` 이 커서 앞에서 고르는 중인 조각을
  찾고(`/` 는 말의 맨 앞, `@` 는 맨 앞이나 빈칸 뒤), `completeAt` 이 고른 것을 그 자리에 넣고(폴더는 빈칸 없이 이어 간다),
  `matchCommands` 가 명령어를 거른다. 훅과 판은 `chat/ComposerSuggest.tsx` — 초점은 입력칸에 남는 콤보박스라 `ui/Popover` 를 쓰지 않는다.
- `problem.ts` · `invite-rows.ts` · `revert-summary.ts` · `thread.ts` · `nav.ts` ·
  `preview-geometry.ts` — 문제 문장 · 초대 확인판의 행(`inviteRows` · `inviteTitle` · `inviteReadError`) ·
  되돌리기 문구(와 서랍의 날 묶음 · 반영 차례 접힘 `historyDays`) · 대화록 · 이동 · 말풍선 좌표의 판정.
- 문장을 인자(`L`)로 받는 이유 — 시험이 src 에서 곧장 읽는 순수 모듈은 형제를 부르지
  않는다(확장자 없는 import 를 node 가 풀지 못한다).

시험: `node --test packages/web/test/next-*.test.ts packages/web/test/vocab-sweep.test.ts`.
