# 기획서 문서와 화면을 잇는 연결 지도 · 구현 계획

작성 2026-10-24. 출처: 같은 날 사용자 요청과 결정 — 「기획서 목록과 프로젝트 화면 목록을 노드로 보여 주고 노드끼리
연결할 수 있게 만들고 관리하고 싶다. 연결 레포에서 관리하고 프로젝트를 쓰는 사람이 모두 공유해서 같이 본다.」
범위·순서·완료 기준의 정본은 [최종 구현 계획](confluence-sync-plan-2026-10-18.md)이고, 이 문서는 그 F6 의 세부다.
[기획서와 화면 잇기 후보](plans-screen-trace-plan-2026-10-23.md)의 그래프 보기·연결 레포 보관 두 항목을 이 결정이 대체한다.

## 0. 결정 기록 (2026-10-24 사용자)

- 지도 보기부터 만든다(읽기). 잇기·끊기는 그 다음 조각이다.
- 연결 데이터의 정본 저장소는 **연결 레포 파일**이다. 앱이 고치면 보관(사이클 브랜치 커밋) → 제출(PR)을 지나고, 머지되면
  팀 전원이 같은 지도를 본다. 프로젝트 데이터나 Confluence 에 두지 않는다.
- 연결을 만드는 주체는 사람이다. AI 가 만들거나 제안하지 않는다(정본 §5).
- 보기는 기획서 칸 안의 한 보기다. 별도 대시보드가 아니다(정본 §11, 같은 날 결정).

## 1. 이미 있는 재료 (2026-10-24 코드 실측)

| 재료 | 위치 | 내용 |
| --- | --- | --- |
| 문서 목록 | 데몬 `requests/confluence.ts` `docList`(144–175) → 원장 `confluence/confluence.json`(`confluence-ledger.ts:5-23`) | `docs: {pageId,title,version,path}[]` + `folders` + `unsupported`. 트리는 `path` 문자열 |
| 화면 주소 관찰 | 프로젝트 데이터 `screen-map.jsonl`(`screen-map.ts:33-97`, 커밋당 1행, 상한 500) | `routes: string[]`, 선택 `screens: {route,title}[]`(답변 링크의 제목) |
| 라우트↔파일 | `route-index.ts:22-26,239`(Next 고정 경로 page 파일 → 패턴), `edit-screens.ts:111-115`(`nextRoutePattern`), `screen-map.ts:136-160`(`observedFilesFor`) | 클론 파일 구조에서 라우트 패턴을 짓는 기존 판정 |
| 클론 읽기 선례 | `code-files.ts:41`(넓이 우선, 상한 4,000), `pin-files.ts:26-27`(파일당 바이트 상한) | 데몬이 클론 파일을 읽는 관례 |
| 경로 해결 | `registry.paths(slug)` — `root`=`~/.colonova-design/projects/<slug>`, `repoRoot`=`<root>/repo`(`projects.ts:543-549`) | 원장은 `root`, 클론은 `repoRoot` |
| 선로 선택 필드 선례 | `messages.ts:797-823`(`comments.record` `id?.intent?.element?`), 941–942, 968–971 | 버전을 올리지 않고 옵셔널로 더한 사례 |

응답 형은 프로토콜에 없고 데몬 반환형과 웹 `daemon-client.ts` 인라인 형이 같은 모양을 각자 적는 이중 정의다(예: `docList`
`daemon-client.ts:1006-1010`). 이 계획도 그 관례를 따른다.

## 2. 연결 파일 — 연결 레포 안의 정본

클론의 뿌리 `plans-map.json` 이다(연결 레포마다 하나 · 같은 날 사용자 결정으로 `docs/` 에서 뿌리로 옮겼다).

```json
{
  "format": 1,
  "links": [
    { "pageId": "1785626658", "route": "/setting/user-management", "section": "사용자 등록", "note": "권한 등급 표", "createdAt": "2026-10-24T01:02:03.000Z" }
  ]
}
```

- 열쇠는 `(pageId, route, section?)` 다. 같은 열쇠는 한 줄이다. `section` 은 문서의 절 머리말이고 없으면 문서 전체를 가리킨다.
- `route` 는 정규화된 미리보기 경로(`/setting/user-management` 모양)다. `screen-map.ts` `normalizeRoute`(101–131)의 결과와 같은 규격.
- `pageId` 는 Confluence 페이지 id 다. 제목·경로가 바뀌어도 id 로 버틴다.
- `note` · `createdAt` 는 사람이 채우는 자유 칸이다. 작성자 칸은 두지 않는다(git 기록이 이미 있다).
- 파일이 없으면 연결 0줄이다. 깨진 파일( JSON 아님 · `format` 1 아님 · 배열 아닌 `links`)은 연결 0줄로 읽고 로그 한 줄만 남긴다 —
  지도가 깨지는 일은 없다. 종류와 수만 로그에 남긴다(기존 규칙).
- 고아(원장에 없는 `pageId` · 인벤토리에 없는 `route`)도 그대로 보여 준다. 지운 노드의 연결이 사라지면 지도가 조용히 줄어든다.
  「연결이 있지만 노드를 못 찾음」 표시로 사람이 끊게 한다(2조각). 1조각은 표시만 한다.

왜 클론의 뿌리인가 — 레포 첫눈에 보이는 자리라 팀이 파일을 바로 찾는다(2026-10-24 사용자 결정). 보관의
거름(`saveable-paths.ts`)도 특례 없이 담는다 — 클론의 보통 파일이다.

## 3. 선로 — `map.read` 요청 하나

- 요청 이름 `map.read`. 몸은 없다(`doc.list` `messages.ts:753-755` 와 같은 모양). 프로토콜 버전은 올리지 않는다.
- 응답(데몬 반환형과 웹 인라인 형이 같이 적는 이중 정의 관례):

```ts
{
  docs: { pageId: string; title: string; version: number; path: string }[];      // 원장 그대로(docList 와 같은 모양)
  folders: { folderId: string; title: string; path: string }[];                  // docList 와 같은 모양
  screens: { route: string; title: string | null; observed: boolean }[];         // 화면 인벤토리
  links: { pageId: string; route: string; section: string | null; note: string | null; createdAt: string | null }[]; // 연결 파일 그대로
}
```

- `screens.title` 은 `screen-map.jsonl` 관찰 제목을 붙이고 없으면 `null`(웹은 경로를 보인다). `observed` 는 관찰 제목이
  있다는 뜻이다.
- 연결이 없어도 `docs` · `screens` 는 다 나간다. 지도는 노드가 먼저다.

## 4. 데몬 — `link-map.ts` 새 모듈
- `screenInventory(projectRoot, repoRoot)` — 1) `route-index` 의 패턴 계산으로 클론의 라우트 전체를 뽑고(고정 경로 page 파일),
  2) `screen-map.jsonl` 의 `screens[].route`·정규화된 `routes` 를 더해(관찰 제목 입히기), 3) 합친다. 정렬은 라우트 문자열.
  클론이 없으면 빈 배열. 파일 읽기는 `pin-files.ts` 의 바이트 상한 관례를 따른다.
- `readPlanMap(repoRoot)` — 클론 뿌리의 `plans-map.json` 읽기(§2 규칙). 순수 함수로 만들어 시험을 클론 없이 돌린다.
- `mapRead(deps, slug)` — `docList` 와 같은 관문(활성 슬러그·연결 확인, `requests/confluence.ts:144-152` 모양) 뒤
  원장 문서(`readConfluenceLedger`)와 화면 인벤토리·연결 파일을 합친다. 연결이 없으면 `docs: null`(docList 관례)이 아니라
  빈 배열 — 화면 인벤토리는 연결과 무관하니까. 단 연결 여부를 가리는 `linked: boolean`(연결 없으면 false)을 함께 돌려
  웹이 「Confluence 연결이 없다」 안내를 문서 트리와 같은 말로 쓰게 한다.
- 등록은 `doc.list` 등록 자리와 같은 곳에 한 줄(`requests/` 조립부).

## 5. 웹 — 기획서 칸 안의 지도 보기 (1조각, 읽기)

**2026-10-24 갱신** — 이 절의 「기획서 칸 머리에 보기 전환」 자리와 「손으로 쓰는 인라인 `<svg>`」
그림은 같은 날 결정으로 갈음했다. 지도는 사이드바의 별도 자리(연결)에 서고(§6 갱신) 그림은
reactflow 노드 그래프다(§6). 아래는 1조각 설계 당시의 기록이다.

- 상태: `use-plans.ts` 옆에 `use-link-map.ts` — `useState` 하나, 낡은 답 버리기용 seq ref(`use-plans.ts:67-75` 패턴).
  `daemon.api.mapRead()` 로 읽는다. 다시 읽기 손 하나.
- 자리: 기획서 칸 머리에 보기 전환(문서 트리 ↔ 연결 지도) 한 줄. 칸 마운트·오프스테이지 관례(`Workspace.tsx:594-604`)는 그대로.
- 모양: 두 층 지도. 왼쪽 문서 노드(원장 `path` 의 첫 마디로 묶음 — 예: `[TD] WMS`), 오른쪽 화면 노드(라우트 첫 마디로 묶음 —
  예: `/wms`). 연결은 노드 사이 선이다. 손으로 쓰는 인라인 `<svg>` 다(`onboarding/Hero.tsx:42-72` 선례, 새 그릇 없음).
  180문서 × 94화면 이므로 묶음 접기·필터(묶음 단위)가 첫 화면이고, 전체를 한 장에 펼치는 것은 범위 밖(정본 §5 경계).
- 문서 노드 누르면 문서 보기가 열린다(`openDoc`). 화면 노드는 이 조각에서 표시만 한다 — 눌러 미리보기로 옮기는 것과
  「화면을 만든 뒤 문서가 바뀌었을 수 있어요」 같은 판 안내는 잇기 조각과 [후보 계획](plans-screen-trace-plan-2026-10-23.md)
  1단계가 맡는다(판 안내는 근거 기록의 시각이 있어야 계산할 수 있다).
- 사용자 문장은 전부 `labels.ts` `L` 의 `plans` 그룹에 넣는다. 「연결 지도」 「연결 n개」 「관찰됨」 같은 말. 개발 어휘
  (라우트·파일·id)은 화면 문장에 못 들어간다(`next-labels` · `vocab-sweep`, `packages/web/test/` 두 시험).
- 연결 지도의 노드 이름: 문서는 제목, 화면은 관찰 제목이 없으면 라우드가 아니라 경로 표기(`route` 문자열 그대로 —
  이건 식별자이지 개발 용어 설명이 아니다. `vocab-sweep` 의 금지어가 아니므로 그대로 쓴다).

## 6. 2조각 — 잇기·끊기 (2026-10-24 구현)

- 웹의 지도는 reactflow(@xyflow/react, 같은 날 사용자 결정) 노드 그래프다 — 문서 노드에서 화면 노드로
  드래그해 잇고, 연결을 골라 끊는다. 그릇은 별도 청크(vite `flow`)로 나뉜다.
- 요청은 `map.write` 하나 — 변경 묶음(`add` · `remove`, 최대 100건)이 통째로 성공하거나 거절된다.
  답은 쓴 뒤의 연결 목록 전체다(선로 스키마 참조).
- 데몬 `writePlanMap` — 현재 파일에 변경을 얹어 임시 파일 → 바꿔치기로 다시 쓴다(원자 쓰기 관례). 같은
  열쇠의 재잇기는 메모만 갈아 얹고 만든 날은 첫 연결을 지킨다.
- 데몬 쓰기는 git 차선을 지나지 않는다 — 파일은 클론의 변경으로 남고 보관이 커밋한다. AI 의 쓰기 가드는
  그대로다(`write-guard.ts`). 연결을 만드는 주체는 사람뿐이다(정본 §5).

**2026-10-24 갱신(연결 자리)** — 같은 날 사용자 결정으로 지도는 기획서 칸 안의 보기가 아니라 사이드바의
별도 자리(홈 · 기획서 · **연결** · 화면)로 옮겼다. §5 의 「기획서 칸 머리에 보기 전환」 문장은 이 결정으로
대체된다. 정본 §11 도 같은 날 고쳤다.

## 7. 문서·시험

- AGENTS.md — 기획서 칸 단어에 「연결」 을 더한다(같은 변경). GUIDE.md — 지도 보기 사용 설명 한 절. DEVELOPERS.md —
  `link-map.ts` · `plans-map.json` 규격 한 절.
- 시험(순수, 클론 없이): ① `readPlanMap` — 정상·빈 파일·깨진 파일·고아·같은 열쇠 ② `screenInventory` — 라우트 패턴 계산 모의·
  screen-map 관찰 제목 입히기·클론 없음 ③ `mapRead` 조립 — 연결 없을 때 빈 배열과 `linked: false` ④ 웹 — 지도 보기가
  노드·연결 수를 맞게 그리는지(컴포넌트 시험 아님, 상태 계산 함수만).
- 눈으로 보는 검증: 격리 데몬 + 실제 `colonova-cdp` 프로젝트 데이터(원장 180문서)로 지도가 서는지.

## 8. 완료 기준

1조각(읽기):

- `pnpm typecheck` · `pnpm test`(빌드 포함) · biome 통과.
- 연결 자리에서 지도를 열면 문서 노드(원장 수)와 화면 노드(클론 라우트)가 뜨고, 클론 뿌리의 `plans-map.json` 을 손으로 넣으면
  연결 선이 그려진다. 문서 노드 클릭으로 문서가 열린다.
- 연결 파일이 없어도 지도는 서고, Confluence 미연결 프로젝트에서는 빈 지도와 안내만 보인다.

2조각(잇기·끊기 — 2026-10-24 구현):

- 문서 노드의 오른쪽 손잡이에서 화면 노드로 끌면 연결이 생기고 클론 뿌리의 `plans-map.json` 에 그대로 반영된다.
  고른 연결을 끊으면 파일에서 지워진다.
- 잘못된 묶음(빈 값 · 모르는 열쇠)은 통째로 거절되어 파일을 바꾸지 않고, 화면에는 고치지 못했다는 안내가 선다.
- 쓰기는 git 차선을 지나지 않는다 — 변경은 클론에 남고 보관이 커밋한다(§6).

## 9. 확인한 근거

- 2026-10-24 두 읽기 조사(DaemonPathScout · WebPlansScout) — 1절 표의 줄번호는 그 기록이다.
- 연결 레포 실측: `colonova-cdp` 클론 `src/screens/**` 에 `screen.tsx` 94개, `src/demo/shell/app-routes.ts` 에 라우트 표.
  프로젝트 원장 180문서. `plans/refs.jsonl` · `screen-map.jsonl` · `plans/links.json` 은 아직 없다.
- 정본 개정: §5 연결 지도 행 · §11 한 보기 문장 · §12 F6 행 · §14 A21 · §15 · 부록 2026-10-24 결정(같은 날).
