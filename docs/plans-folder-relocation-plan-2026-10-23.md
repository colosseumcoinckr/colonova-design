# 기획서 사본을 클론 밖으로 — 프로젝트 = 레포 폴더 + Confluence 폴더 · 구현 계획

작성 2026-10-23. 같은 날의 사용자 대화에서 정한 구조를 코드 · 문서 · 시험 단위로 쪼갠 계획이다. 범위 · 완료 기준의 정본은
[최종 구현 계획](confluence-sync-plan-2026-10-18.md)이고, 이 문서는 그 §7 의 사본 자리 한 칸을 고치는 변경의 세부다.
줄 번호는 2026-10-23 작업 트리(`feat/confluence-sync` · dc72d76 + 미커밋 추적 계획 후보) 기준이다.

## 0. 구현 결과 (2026-10-23 · 커밋 전)

같은 날 작업 트리에 들어갔다. 커밋은 아직 없다. 아래 1–11절은 계획 당시의 글이고, 달라진 곳은 이 절이 이긴다.

- **검증** — 빌드 넷(protocol · daemon · desktop · web) 통과. 전체 시험 2,750 가운데 통과 2,744 · 건너뜀 5 · 실패 1. 실패 하나는
  데이터 폴더 이름 시험이다 — 격리 환경 변수에서 설계상 깨지고, 환경 변수 없이 다시 돌면 7/7 통과한다(바꾸기 전 기준선도 같다).
  biome 은 고친 · 새 파일 44개에서 새 진단 0(경고 · 안내 수는 바꾸기 전과 같다). 격리 데몬 + 합성 Confluence 스모크: 연결 · 가져오기로 문서 셋이 `projects/<slug>/confluence/` 에
  내려앉고, 클론에는 `docs/plans` 도 exclude 줄도 없이 `git status` 가 깨끗했다. 옛 사본(원장 · 문서 짝 · exclude 줄)과 레포가 추적하는
  `docs/plans/keep.md` 를 심고 다시 띄우자 준비가 옛 파일 셋 · 폴더 하나 · 줄을 거두고 추적 파일은 남겼다(로그는 수만).
- **계획과 달라진 것**
  - 변경 1 · 2 를 한 작업 트리에 함께 넣었다. 두 커밋으로 나누려면 두 변경이 함께 든 `session.ts` · `write-guard.ts` ·
    `common-instructions.ts` · `draft-service.ts` 는 조각 단위(`git add -p`)로 갈라야 한다.
  - 연결은 사본 폴더를 만들지 않고 신뢰 기록도 부르지 않는다(§5 의 그 줄을 바로잡았다).
  - 거절 상수는 이름 `PLANS_WRITE_REFUSAL` 그대로 새 문장이고, 필드는 `WriteScope.mirrorRoots`(복수)다. 셸 판정은 이유를 바꾸지 않는다.
  - 옛 사본 정리는 흔적(exclude 줄 · 옛 원장)이 있을 때만 돌고, 원장 밖의 `.storage.xml` 짝도 지우고, `docs/plans` 가 링크면 줄만 뺀다.
  - 이름은 점이나 `~` 로 시작하면 앞머리를 `-` 로 바꾸고(공간 키 포함), `CLAUDE` · `CLAUDE.local` · `AGENTS` 는 뒤에 페이지 id 를 붙인다.
- **검토에서 더한 것** — 기획 AI 울타리(Glob · Grep 거름의 중괄호 · 쉼표 마디, 경로 칸 모두, 절대 Glob 의 실제 경로 비교), 분기 · 자동 대화의
  사본 폴더, 읽은 근거의 실제 경로 비교, 가져오기의 자가 복구 · 문서 파일 원자 쓰기 · 뿌리가 바뀐 원장 다시 걷기 · 원장 path 거름,
  깨진 활성 슬러그의 연결 거절.
- **새 시험 파일** — `session-dirs.test.ts` · `confluence-legacy.test.ts`(CI 순수 목록에 넣음) · `confluence-legacy-bringup.test.ts`(진짜 git — 로컬 `pnpm test` 만).
- **보지 않은 것** — 실제 Claude 세션에서 `additionalDirectories` 로 사본이 읽히는지(SDK 의 실제 동작), Windows, 실사이트 Confluence.

## 1. 제안과 목표

프로젝트 하나는 연결 레포 폴더 하나와 Confluence 사본 폴더 하나를 형제로 가진다. 사본은 더는 클론 안 `docs/plans/` 에
살지 않는다. 앱의 두 AI 는 서로의 폴더를 읽는다. 화면 AI 는 사본을 참고로 보고, 기획 AI 는 클론을 참고로 본다. 쓰기는
지금처럼 각자의 자리에서만 한다. 공유 기획 항목(여러 레포가 한 사본을 나눠 쓰는 모양)은 만들지 않는다.

## 2. 결정 기록 (2026-10-23 사용자)

- 프로젝트마다 사본 한 벌. 공유 항목은 두지 않는다. 같은 기준 페이지를 두 프로젝트가 연결하면 사본과 초안이 두 벌이다
  (정본 157줄이 이미 그 경합을 다룬다).
- 탐색의 주체는 앱의 채팅 세션이다. 손으로 띄운 Claude Code 는 범위 밖이라 디스크의 두 폴더가 서로를 가리킬 필요가 없다.
  경로는 레지스트리가 알고 데몬이 세션을 띄울 때 넘긴다.
- 기획 AI 가 클론을 읽는다 — 허용(2026-10-23 사용자). 정본 340줄의 같은 날 결정(기획 AI 는 범위 안 캐시만 읽기)을 넓힌다.
- 기획 AI 의 비밀 파일 읽기는 훅으로 막지 않는다 — 일단은(2026-10-23 사용자). 화면 AI 와 같이 공통 규칙의 비밀 문장으로만 말한다.
  나중에 막기로 하면 읽기 울타리 훅에 이름 목록 한 줄이다.
- 기획서↔화면 연결은 [추적 계획 후보](plans-screen-trace-plan-2026-10-23.md)가 맡는다. 이 계획에 섞지 않는다.

## 3. 현재 상태 (실측)

- 경로가 상수 하나와 흩어진 리터럴로 적혀 있다. `confluence-sync.ts:51` 의 `PLANS_DIR`, 같은 파일 `removeDoc`(753, 상수를
  안 쓴다), `write-guard.ts:129`, `saveable-paths.ts:35`, `draft-service.ts` 491 · 595 · 1227 · 1271, `common-instructions.ts:20`.
- 가져오기와 걷기는 클론이 없으면 거절한다(`confluence-sync.ts` 257–270 · 295–305). 타이머도 클론 전 프로젝트를 건너뛴다(324–330).
  연결은 클론을 요구하지 않지만(`requests/confluence.ts` 101–110) 원장 초기화와 exclude 줄은 워크스페이스가 있을 때만 돈다.
- 원장 읽기가 여섯 곳에서 레포 경로를 넘긴다 — `project-fleet.ts:501`, `requests/confluence.ts` 103 · 109 · 155,
  `draft-service.ts:1107`, `doc-ops.ts:480`, `doc-comments.ts:370`.
- 가드가 세 겹이다 — 훅의 파일 쓰기 판정(`write-guard.ts:275`), 코어의 편집 판정(`session.ts:1188`), 보관 거름(`saveable-paths.ts:35`).
- 연결 레포 colonova-cdp 는 자기 `docs/plans/` 에 문서 넷을 추적한다. 이 컴퓨터의 클론은 아직 Confluence 미연결(원장 · exclude 줄 없음).
- 세션은 둘 다 작업 폴더 하나만 준다 — 화면 세션 `agent/drivers/claude/session.ts:187`, 기획 AI `draft-ai.ts:502`. 설치된
  Agent SDK 0.3.299 의 `Options.additionalDirectories` 가 add-dir 과 같다(`sdk.d.ts:1537`, 절대 경로).

## 4. 폴더 모양

```
~/.colonova-design/projects/<slug>/
├─ repo/            연결 레포 클론. 기획서 파일이 더는 들어가지 않는다
├─ confluence/      Confluence 사본 — 원장 confluence.json · <공간키>/<문서>.storage.xml · .md
└─ plans/           기획 작업 데이터 — drafts · proposals · threads · intents · ops · comment-ops · refs.jsonl (지금 그대로)
```

`confluence/` 를 `plans/` 안이 아니라 형제로 두는 이유는 세션에 붙이는 범위다. 화면 세션에는 `confluence/` 만 선언한다.
`plans/` 의 기획 대화 · 초안 · 발행 의도는 화면 AI 에게 보이면 안 된다(정본 269줄 — 기획 대화와 화면 대화를 섞지 않는다).
연결 레포의 자기 `docs/plans/` 는 보통 레포 파일로 돌아간다.

## 5. 변경 1 — 사본 이동 (커밋 하나)

순수한 단순화다. 정본 결정은 §7 사본 자리 한 칸뿐이다. 혼자 검증할 수 있다.

### 지우는 것

- `ensurePlansExclude` 와 두 호출(`confluence-sync.ts` 59–71 · 360, `requests/confluence.ts:109`). exclude 줄과 F7 의 stash 순서 위험이 함께 사라진다.
- `saveable-paths.ts:35` 의 기획서 특례.
- `write-guard.ts` 의 `PLANS_FOLDER` · `Ctx.plans` · `insidePlans` · `plansFolderTarget` · `PLANS_WRITE_REFUSAL` · 275줄 판정, 그리고
  `session.ts` 35–38 · 1187–1190 의 코어 편집 판정. 클론 밖 쓰기는 이미 `OUTSIDE_WRITE_REFUSAL` 로 거절된다.
- "기획서를 가져올 클론이 아직 없어요" 거절 둘(`importNow` · `walkNow`)과 `cloned()` 관문(`tickAll` · `importOnce`).
- `ConfluenceWorkspaceView` 와 `laneRun("confluence")`. 클론에 쓰지 않으니 보관 · 제출과 줄을 설 이유가 없다. `git-lane.ts:26` 의
  `"confluence"` 종류도 같이 지운다(다른 호출자가 없으면).

### 바꾸는 것

- 경로 도우미를 새 이름으로 만든다. `confluenceMirrorRoot(projectRoot)` · `confluenceMirrorLedger(projectRoot)`(`confluence-mirror.ts`)이되 **옛 이름을
  그대로 두고 뜻만 바꾸지 않는다.** 여섯 호출자가 레포 경로를 넘기므로, 이름이 같으면 타입 검사가 아무것도 못 잡고 빠뜨린 호출자가
  조용히 빈 원장을 읽는다. 새 이름 + 새 인자(`ProjectPaths.root`)로 모든 옛 호출을 컴파일 오류로 만든다. `writeDoc` · `removeDoc`
  (741 · 752)도 같은 도우미를 쓴다.
- `ConfluenceSyncDeps.workspaceOf` → `projectRoot(slug): string | null`. `server.ts` 776–783 은 `registry.paths(slug).root` 를 넘긴다.
  `tickAll` 은 연결된 프로젝트 전부를 돈다. `importOnce` 는 폴더를 `mkdirSync` 로 만들고 쓴다.
- 바퀴의 직렬화는 차선 대신 슬러그별 `inFlight` 약속 하나로 한다(이미 있다 — 257–259). `walkNow` 의 "차선 밖에서 기다린다" 설명(287–295)은
  단순해진다. 서로 다른 프로젝트의 바퀴는 병렬이어도 된다.
- `server.ts` 794 · 807 · 818 의 `workspaceRoot` 의존 셋 → `projectRoot` 로 이름을 바꾸고 `registry.paths(slug).root` 를 넘긴다.
  `draft-service.ts` 의 리터럴 넷과 임시 폴더 폴백(590–596)은 사본 뿌리 하나로 모인다. `doc-ops.ts:478–480` · `doc-comments.ts:370` 같다.
- `project-fleet.ts:501` 은 `.root` 를 넘긴다. "재시작 뒤 손대지 않은 클론" 설명(497–498)은 지운다 — 프로젝트 폴더는 늘 있다.
- `requests/confluence.ts` — `resetLedgerOnRootChange` 는 워크스페이스와 상관없이 돈다(원장이 아직 없으면 할 일이 없다).
  연결은 사본 폴더를 만들지 않는다 — 첫 가져오기가 만들고, 그 전의 기획 AI 는 비어 있는 임시 폴더를 쓴다. 신뢰 기록
  (`trustWorkspace` · `claude-trust.ts:266`)은 부르지 않는다 — 그 기록은 폴더의 `.claude/settings.json` 허용 규칙에만 쓰이고
  사본에는 그런 파일이 없다(예약 이름 규칙이 `.claude` 를 비킨다 · 2026-10-23 확인). `docList`(149–153)는 워크스페이스가 없어도
  원장을 읽는다. `doc.read`(201–220)는 Confluence 를 실시간으로 읽어 사본을 안 보므로 무관하다.
- `common-instructions.ts:20` — `docs/plans/` 경로를 뺀다. 변경 1 뒤에는 그 경로에 아무것도 없어 문장이 허공을 가리키기 때문이다.
  이 커밋에서는 "Confluence 에서 가져온 기획서 사본도 읽기만 한다" 꼴로 경로만 빼고, 세 역할 문장은 변경 2 에서 넣는다.
- 사용자 문장: 거절 문장 둘이 사라지고 새 문장은 없다. 웹은 그 문장을 매칭하지 않는다(실측).

### 옛 사본 정리 (이주가 아니다)

폴더를 옮기지 않는다. 연결 레포가 자기 `docs/plans/` 에 추적 파일을 둘 수 있어서(colonova-cdp 의 넷) `rename` 은 그 파일을 클론 밖으로
끌어내고 보관이 삭제를 커밋한다. 대신 데몬 시작 때, 보관보다 먼저, 프로젝트마다 한 번:

0. 흔적(exclude 의 `docs/plans/` 줄이나 옛 원장 `docs/plans/confluence.json`)이 없으면 아무것도 하지 않는다 — 사본을 둔 적 없는
   레포의 미추적 파일은 사람이나 AI 의 것일 수 있다(구현 검토에서 더함). `docs/plans` 가 심볼릭 링크면 파일은 건드리지 않고 2 만 한다.
1. `repo/docs/plans/confluence.json` 이 있으면 읽는다. `pages[id].path` 마다 `.storage.xml` 과 `.md` 를 지운다. 원장 밖에 남은
   `*.storage.xml` 과 그 옆의 같은 이름 `.md` 도 걸어서 찾아 지운다(첫 가져오기가 끊긴 클론). 원장을 지운다. 빈 폴더는 `docs/plans/` 까지
   거슬러 거둔다. `git ls-files` 의 추적 파일과 모르는 파일은 건드리지 않는다.
2. `.git/info/exclude` 에서 정확히 `docs/plans/` 인 줄만 지운다.
3. 사본은 다음 바퀴가 새 자리에 다시 받는다. 미출시 기능이라 사본 보존은 목표가 아니다.

불변식은 순서다. 원장의 파일을 먼저 지우고 exclude 줄을 나중에 뺀다. 거꾸로 하면 exclude 가 빠진 순간 옛 사본이 미추적 파일로
`git status` 에 보이고 보관이 담는다. 도는 자리는 워크스페이스를 세우기 전이다 — 준비의 최신화(`repo-bringup.ts` 122–126)와
그 안의 `stash push --include-untracked` 보다 앞. 거름 제거와 같은 커밋에 둔다.

### 스크립트

`scripts/plans-g0-check.mjs` 152–165 는 `docs/plans` 를 basename 으로 알아본다. `scripts/plans-g2-check.mjs` 9–11 · 33 · 105 는
"<클론 또는 docs/plans>" 를 받는다. 둘 다 "<프로젝트 폴더 또는 confluence 폴더>" 를 받게 고친다. DEVELOPERS 1770 의 사용법 줄도 같이.

## 6. 변경 2 — 상호 탐색 (커밋 하나)

AI 의 읽기 범위를 넓히는 조각이라 변경 1 과 분리한다.

### 화면 세션

- `session.ts` 의 launch 형(`appendSystemPrompt?` 가 있는 자리 · 265줄 근처)에 `additionalDirectories?: string[]` 를 더한다.
- `dispatch.ts` 의 세션 생성 두 곳(228–240 · 562–574)이 슬러그에서 사본 뿌리를 구해 넣는다. **폴더가 있을 때만** 넣는다 —
  `Options.additionalDirectories` 는 절대 경로를 요구하고 없는 경로를 어떻게 다루는지 적혀 있지 않다(`sdk.d.ts:1535–1537`).
  "없는 항목은 건너뛴다" 는 다른 구조체(333줄)의 말이다.
- `agent/drivers/claude/session.ts:187` 의 `query` 옵션에 그대로 넘긴다. 재개(resume)도 같은 옵션을 다시 넘긴다.
- 쓰기: 사본은 `write-guard` 의 뿌리(cwd · 임시 폴더 · 자동 메모) 밖이라 Write · Edit 와 셸 리다이렉션이 지금 규칙으로 거절된다.
  기획서 거절 문장을 다른 모양으로 살린다 — `WriteScope` 에 선택 필드 `mirrorRoots`(복수 · 절대 경로)를 더하고, 대상이 그 안이면
  클론 밖 거절 대신 기획서 말의 이유를 돌려준다. 상수는 이름 `PLANS_WRITE_REFUSAL` 그대로 문장만 바꿨다(구현). 판정은 바뀌지 않고
  이유만 바뀐다. AI 가 이제 그 파일을 보고 고치려 들기 때문이다. 셸 판정은 이유를 바꾸지 않는다(일반 문장 · 거절은 같다).
  어휘 시험은 이 상수에 그대로 건다.

### 기획 AI

- `draft-ai.ts` — `cwd` 는 사본 뿌리 그대로. 클론이 서 있으면 `additionalDirectories: [cloneRoot]`. `makeConfine`(362) 은 뿌리 둘을 받고,
  절대 경로 Glob 금지(367–370)는 "두 뿌리 중 하나 안이면 지난다" 로 완화한다. `..` · `~` · 링크 탈출 규칙은 그대로.
- 쓰기 도구는 없다(`tools: ["Read","Grep","Glob"]`). 환경 허용 목록 · `settingSources: []` 도 그대로.
- 비밀: 화면 AI 가 보는 레포 파일을 기획 AI 도 본다. 공통 규칙의 비밀 불릿을 기획 AI 의 묻는 글에도 한 줄로 싣는다.
- `.env` 같은 파일을 Read 로 여는 것은 훅으로 막지 않는다(2026-10-23 사용자 — 일단은). 위 비밀 문장이 그 몫이다.

### 공통 규칙 문장

변경 1 이 경로만 뺀 `common-instructions.ts:20` 의 문서 파일 불릿 끝 구절이 여기서 역할을 말한다. 세 가지다. 보낸 근거가 기준이다, 기획서 사본 폴더는
참고다(10분마다 덮어쓰이고 미발행 초안은 없다), 고치는 곳은 기획서 칸의 초안이나 Confluence 다. 불릿은 `- ` 한 줄을 지킨다.

### 함정 넷

1. **사본이 Claude Code 의 작업 폴더가 된다.** 그 안 파일 이름은 Confluence 의 제목에서 나온다(`confluence-path.ts:42` `planName`).
   제목 `CLAUDE` 는 `CLAUDE.md` 가 되고, 제목 `.claude` 는 폴더가 된다. 점이나 `~` 로 시작하는 이름(공간 키 포함)은 앞머리를 `-`
   하나로 바꾸고(`.claude` → `-claude`), `CLAUDE` · `CLAUDE.local` · `AGENTS` 는 뒤에 페이지 id 를 붙여 비킨다(구현). 시험 하나.
2. **폴더가 없을 때 넣지 않는다.** 위 화면 세션 항목.
3. **기획 AI 의 `cwd` 는 첫 가져오기 전에도 있어야 한다.** 사본 폴더가 아직 없으면 초안 서비스가 비어 있는 임시 폴더를 준다(변경 1 의 `draft-service.ts`).
4. **옛 세션 재개.** 변경 전에 시작한 대화를 재개할 때도 옵션이 붙는다. 대화록에는 경로가 남지 않는다.

## 7. 문서

- 정본 `confluence-sync-plan-2026-10-18.md` — 152줄 표(사본 자리 → 프로젝트 데이터 `confluence/`), 234줄(사본은 참고 · 스냅샷이 기준),
  236줄(공통 규칙 구절의 새 말), 340줄(기획 AI 의 클론 읽기 — 2026-10-23 결정으로 한 줄).
- `DEVELOPERS.md` — 1533–1536(내려놓는 자리 · exclude · 거름), 부품 목록의 F7 언급, 1658–1659(기획 AI 의 뿌리 둘), 1770(스크립트 사용법),
  1866–1871(가드 예외 불릿 삭제 → 사본 폴더는 클론 밖이라 일반 규칙으로 거절된다는 한 줄).
- `GUIDE.md` — 727–730("제출에는 안 탄다" 는 "앱의 기억 안에만 산다" 로, 화면 AI 는 사본을 참고하고 보낸 근거가 기준).
- `AGENTS.md` — 49–52 의 기획서 폴더 규칙(경로 · 가드 · 보관 제외 문장).
- 추적 계획 후보 — 6절 트리와 7절 6번(충돌 해소).
- 설계 이력 `confluence-sync-design-2026-10-18.md` 77–90 — 다시 쓰지 않고 이 문서로 가는 한 줄.

## 8. 시험

- `write-guard.test.ts` 128–164 · 652–654 · 723 — 변경 1 에서 기획서 폴더 케이스와 어휘 시험을 지운다. 사본 뿌리로의 Write 가 클론 밖
  거절인지 한 케이스. 변경 2 가 `mirrorRoots` 이유와 어휘 시험을 `PLANS_WRITE_REFUSAL` 의 새 문장에 건다.
- `saveable-paths.test.ts` 67–72 — 삭제. 연결 레포의 자기 `docs/plans/*.md` 변경이 담기는 케이스 하나 추가.
- `confluence-connect.test.ts` 227–237 — exclude 시험을 정리 시험으로 바꾼다. 옛 사본과 추적 파일이 섞인 클론에서 원장의 파일만
  지워지고 exclude 줄이 빠지는지. 243 의 뿌리 교체는 워크스페이스 없이도 원장이 비워지는지.
- `confluence-sync.test.ts` 413 · 768 · 810 · 822–836 — "클론 없이 거절" 을 "클론 없이 가져온다" 로 뒤집는다. 리그의 진짜 `GitLane`(158–165)은
  슬러그별 직렬화 시험(importNow 합류 · walkNow 가 도는 바퀴를 기다림)으로 바뀐다.
- `project-fleet-confluence.test.ts` 36–37 · 69 — 원장을 `root` 아래에, `paths()` 모의에 `root` 를 더한다(지금은 `repoRoot` · `work` 뿐).
- `draft-ai.test.ts` 204 — 뿌리 둘 케이스. 클론 안 경로는 지나고 두 뿌리 밖 · `..` 는 막힌다.
- `draft-service.test.ts` · `doc-ops.test.ts` · `doc-comments.test.ts` — 사본 경로 픽스처를 새 자리로.
- 새 순수 시험 — 슬러그로 세션 launch 옵션을 만드는 함수. 폴더가 있으면 `additionalDirectories` 가 서고 없으면 없다. Claude 를 띄우지 않는다.
- 새 순수 시험 — `planName` 예약 이름.
- 공통 규칙 불릿 모양 시험이 있으면 그대로 지난다(`- ` 한 줄).

## 9. 완료 기준

- `pnpm typecheck` · `pnpm test`(빌드 포함) · biome 통과.
- 눈으로(합성 Confluence 실셸 조리법 · planner-ux 기록): 사본이 `projects/<slug>/confluence/` 에 내려앉는다. 클론의 `git status` 가 깨끗하고
  exclude 줄이 없다. AI 턴 뒤 보관이 규칙으로 빼는 파일이 없다. 화면 세션의 Glob 이 사본을 찾는다. 기획 AI 의 Read 가 클론 파일을 읽는다.
  사본 안으로의 Write 가 거절된다. 연결 레포의 자기 `docs/plans/*.md` 를 AI 가 고치면 보관에 담긴다.
- 로그 · 턴 통계에 경로가 남지 않는다(기존 규칙).

## 10. 범위 밖

공유 기획 항목. 기획서↔화면 연결과 대조(추적 계획 후보). 손으로 띄운 Claude Code 의 탐색. 프로토콜 변경(없다 — 경로는 선로에 안 탄다).

## 11. 확인한 근거

- 경로 리터럴: `confluence-sync.ts` 51 · 102 · 479 · 742 · 753, `write-guard.ts` 129 · 181 · 239–249 · 275, `saveable-paths.ts` 35,
  `draft-service.ts` 491 · 595 · 1227 · 1271, `session.ts` 1188, `common-instructions.ts` 20.
- 클론 요구: `confluence-sync.ts` 136–141 · 257–270 · 287–305 · 324–330 · 349–357. 조립 `server.ts` 773–787 · 794 · 807 · 818.
- 연결 처리: `requests/confluence.ts` 60–112 · 149–157. 등록부 경로: `projects.ts` 86–91 · 542–550.
- 세션 옵션: `agent/drivers/claude/session.ts` 170–240, `session-manager.ts` 206–214, `dispatch.ts` 228–240 · 562–574, `session.ts` 253–266.
  기획 AI: `draft-ai.ts` 362–400 · 489–516. SDK: `sdk.d.ts` 333 · 1535–1537.
- 잔해 정리: `repo-bringup.ts` 210–213(클론 폴더만 지운다 — 사본 폴더는 밖이라 무관).
- 신뢰 기록: `claude-trust.ts` 266–280(`~/.claude.json` 의 projects 에 폴더를 적는다), 호출 `repo-bringup.ts:118` · `server.ts:900`.
- `doc.read`: `requests/confluence.ts` 201–220 — Confluence 실시간 읽기라 사본 경로를 쓰지 않는다.
- 연결 레포 실측: colonova-cdp 클론의 `docs/plans/` 추적 파일 넷, 원장 · exclude 줄 없음(2026-10-23).
