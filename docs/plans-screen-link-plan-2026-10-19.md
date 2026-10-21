# 기획서와 화면 잇기 설계 계획

2026-10-19. 「ColoNova Design 의 다음」(같은 날의 그림 문서) 권고를 짓는 순서로 옮긴 계획이다. 바뀌는 것은 둘이다.
화면 작업이 기획서를 읽고 따르게 되고, 기획서의 고침 · 발행 · 코멘트 · 미결이 앱 안에서 돈다. 읽는 사람은
기획자(앱을 쓰는 사람)와 이 레포를 고칠 다음 사람이다. 프로그램이 지키는 규칙은 하나다. AI 는 기획서 폴더를
고치지 않고, 고친 글은 제안으로 와서 사람이 받고 데몬이 적고 발행한다. 단위는 열둘이고 순서는 U0-1 · U0-2 ·
U0-3 · U1-1 · U1-2 · U1-3 · U1-4 · U1-5 · U2-1 · U2-2 · U2-3 · U2-4 다.

배경 · 판단 근거 · Confluence 실측은 [2026-10-18 계획 문서](confluence-sync-plan-2026-10-18.md)와
[설계 문서](confluence-sync-design-2026-10-18.md)에 있고 여기서 되풀이하지 않는다. 이 문서는 그 두 문서의
2단계 · 3단계 항목을 단위로 쪼개고, 0단계(화면 작업이 기획서를 쓰게 하는 배선)를 앞에 더한다.

## 읽는 법

상자 하나가 일의 단위 하나다. 상자마다 그것을 확인할 증거를 이름한다(파일 · 시험 실행 · 화면 사진 · 측정값).
증거가 있을 때만 상자를 채운다. 들여쓴 상자는 위 상자의 부분이다. 본문은 할 일의 순서이고, 부록이 설명과
기록이다.

단위 하나가 이 레포의 제출(풀 리퀘스트) 하나다. 사용자가 단위마다 화면 사진을 보고 합친다. 실행 모형은 pstack
의 autopilot-stack 플레이북과 같은 꼴(짓고 검증하고, 합치는 것은 사용자)이되, 그 플레이북의 클라우드 레인 ·
봇 검토 · 한 시간 감사 틱은 이 레포에 없으므로 쓰지 않는다. 검증은 이 레포에 있는 도구로만 한다(「운영」 절).

시험만으로는 검증이 아니다. 단위는 단위 시험 · 실제 확인 · 성능 상자가 모두 채워져야 끝난다.

## 전제와 규칙

- 프로토콜 버전은 올리지 않는다. 새 명령 종류와 선택 필드로만 더한다(AGENTS.md).
- 사용자 문장은 `packages/web/src/next/labels.ts` 의 `L` 에만 둔다. 금칙어(턴 · 경로 · git · 데몬 · 커밋 ·
  브랜치 · PR)는 `next-labels` · `vocab-sweep` 시험이 지킨다. 이 계획의 새 말은 발행 · 제안 · 받기 · 버리기 ·
  미결 · 정하기 · 넘기기 · 새 기획서 · 휴지통이다. 모두 금칙어가 아니다(2026-10-19 두 시험의 목록으로 확인).
- AI 는 기획서 폴더(`docs/plans/`)를 고치지 않는다. 공통 규칙의 한 구절(2026-10-18)과 쓰기 가드
  (`write-guard.ts`, 2026-10-19)가 막는다. 이 계획은 그 울타리를 지킨 채 데몬이 쓰는 길만 더한다.
- Confluence 토큰은 데몬만 안다. 화면 코드와 AI 세션 환경에 싣지 않는다. 발행은 데몬의 일이다.
- 기획서 폴더는 보관 · 제출에서 빠진다(D1). 폴더는 클론의 `.git/info/exclude` 에 있고 `saveable-paths` 가
  거른다.
- 1.0 CLOSED 문서는 앱이 제자리에서 고치지 않는다. 발행은 같은 단계의 개정이 기본이고 승급은 사람이 확인
  창에서 고른다(2026-10-18 미정 3 권고).
- 사본은 두 벌뿐이다. Confluence 가 공식본, 클론 안 폴더가 작업본이다. 원장에 더하는 표는 파생 색인이지
  세 번째 사본이 아니다(「데이터 모양」 절).
- 날짜가 있는 결정 중 이 계획이 건드리는 것은 하나다. 2026-10-18 의 「분석은 전부 나중」 가운데 미결 큐만
  2단계로 앞당긴다(U2-2). 다른 분석은 3단계에 그대로 둔다.
- 쓰기 명령의 멱등 키는 모두 클라이언트 명령의 `id` 다(`command-dedupe.ts`). 새 명령도 같은 규칙이고
  따로 키를 만들지 않는다.

## 데이터 모양 먼저

원장 `docs/plans/confluence.json` 에 네 가지를 더한다. 모두 선택 필드다. 옛 원장은 그대로 읽히고 모르는
필드는 버린다(`parse*` 는 절대 던지지 않는다). 2단계 기능은 전부 이 표를 읽으므로 기능보다 표를 먼저
정의한다.

```
docs/plans/
  confluence.json                             원장 (pages · proposals · links · pending)
  COLO/8.8-ColoNova/…/<제목>.storage.xml      정본 원문. 가져오기가 쓴다
  COLO/8.8-ColoNova/…/<제목>.md               파생 마크다운. 가져오기와 「받기」 · 「저장」 이 쓴다
```

```json
{
  "site": "https://colosseum.atlassian.net",
  "roots": ["933068815"],
  "lastSyncAt": "2026-10-19T03:00:00Z",
  "pages": {
    "1818591273": {
      "path": "COLO/8.8-ColoNova/01-시스템분석/데이터-모델",
      "title": "회원 목록 기능설계서 v0.8",
      "version": 7,
      "sections": [{ "heading": "화면과 입력 항목", "macro": false }],
      "comments": { "unresolved": 2 },
      "dirty": { "sections": ["화면과 입력 항목"], "baseVersion": 7, "since": "2026-10-19T04:10:00Z" }
    }
  },
  "proposals": [
    {
      "id": "p-20261019T0410-k3f9",
      "pageId": "1818591273",
      "heading": "화면과 입력 항목",
      "markdown": "…",
      "reason": "회원 목록에 검색창을 더했다",
      "baseVersion": 7,
      "sessionId": "…",
      "at": "2026-10-19T04:10:00Z",
      "state": "open"
    }
  ],
  "links": [
    {
      "pageId": "1818591273",
      "heading": "화면과 입력 항목",
      "route": "/member/list",
      "files": ["src/pages/member/List.tsx"],
      "source": "ai",
      "confirmedAt": null
    }
  ],
  "pending": [
    {
      "id": "t-1818591273-3",
      "kind": "tbd",
      "pageId": "1818591273",
      "heading": "미결",
      "text": "대행 승인의 주체",
      "owner": null,
      "since": "2026-09-30",
      "state": "open",
      "snoozedUntil": null
    },
    {
      "id": "c-1970733557",
      "kind": "comment",
      "pageId": "1818591273",
      "commentId": "1970733557",
      "anchor": "검색 조건은 최대 5개",
      "author": "정인권",
      "createdAt": "2026-10-02T01:49:00Z",
      "excerpt": "5개 제한의 근거가 정책서에 없어요",
      "state": "open",
      "snoozedUntil": null
    }
  ]
}
```

규칙.

- `pages[id].dirty` 는 받기나 저장이 고친 절 목록이다. `baseVersion` 은 고치기 시작한 판이다. 발행이 끝나면
  지운다. 가져오기는 dirty 가 있는 문서의 `.md` 와 `.storage.xml` 을 건드리지 않고 원장의 `version` 만 새로
  적는다. 사람의 고침과 비교의 기준이 되는 원문을 함께 지키기 위해서다. 발행의 충돌 길은 지금의 저장 포맷을
  그 자리에서 읽어 보관한 기준과 비교한다.
- `proposals[]` 는 AI 가 `plan_propose` 로 낸 제안이다. `baseVersion` 은 제안 때의 판이다. 받기 때 지금
  판과 다르면 받기를 막고 「그 사이 문서가 바뀌었어요 · 판 7 → 8」 과 `다시 제안` 을 세운다. 발행의 판 검사와
  같은 규칙을 한 걸음 앞에 둔다. `state` 는 `open` · `accepted` · `rejected` · `stale` 이다.
- `links[]` 는 문서의 절과 화면을 잇는다. `source` 가 `ai` 면 후보이고 `user` 면 사람이 확인한 것이다. 2단계
  기능은 확인한 것만 믿고, 후보는 제안의 재료로만 쓴다. 같은 (pageId · heading · route) 는 한 줄이다.
- `pending[]` 은 가져올 때마다 다시 계산하는 파생 색인이다. `tbd` 는 제목에 「미결」 이 든 절의 불릿과 `TBD`
  가 든 줄이고, `comment` 는 안 풀린 코멘트이며, `mismatch` 는 U2-4 의 대조가 보낸 어긋남이다. 코멘트 항목은
  id · 닻 · 글쓴이 · 때 · 첫 줄(140자)만 둔다. 본문은 열 때 Confluence 에서 읽는다(`doc.read` 가 이미 그렇게
  한다). 이 색인은 발행되지 않는다. 그래서 「사본은 두 벌뿐」 을 어기지 않는다. 다시 계산은 `tbd` 와 `comment`
  만 건드린다. `mismatch` 는 사람이 만든 것이라 사람이 닫을 때까지 남는다.
- id 규칙. 제안은 `p-` 와 시각과 난수, tbd 는 `t-<pageId>-<절 안 순번>`, 코멘트는 `c-<commentId>`, 어긋남은
  `m-` 와 시각과 난수다. 같은 항목이 가져오기마다 같은 id 를 가져야 `snoozedUntil` 과 `state` 가 살아남는다.
  tbd 의 순번은 절 안 불릿 순서다. 불릿이 끼어들면 뒤의 항목이 새 id 를 얻는 것을 받아들인다(3단계에서
  글자 해시로 바꿀 수 있다).

## 단위와 순서

| 단위 | 이름 | 의존 | 검토 문 | 단계 |
| --- | --- | --- | --- | --- |
| U0-1 | 기획서 찾기 도구와 답 끝의 한 줄 | 없음 | 있음 (답의 말) | 0 |
| U0-2 | 입력창의 @기획서 | 없음 | 있음 | 0 |
| U0-3 | 문서 한 장의 「이 기획서로 화면 만들기」 | U0-1 | 있음 | 0 |
| U1-1 | 쓰기 클라이언트와 사전 검증 1 | 없음 | 없음 | 1 |
| U1-2 | 저장 포맷 절 스플라이스 | 없음 | 없음 | 1 |
| U1-3 | 제안과 받기, 절 저장 | U0-1 | 있음 | 1 |
| U1-4 | 발행과 판 충돌 | U1-1 · U1-2 · U1-3 | 있음 | 1 |
| U1-5 | 새 기획서 · 코멘트 달기 · 휴지통 | U1-1 | 있음 | 1 |
| U2-1 | 원장의 두 표 (links · pending) | U0-1 | 없음 | 2 |
| U2-2 | 미결 큐를 받은 편지함에 | U2-1 · U1-3 | 있음 | 2 |
| U2-3 | 화면에서 문서로 제안 | U2-1 · U1-3 · U0-3 | 있음 | 2 |
| U2-4 | 문서와 화면 대조 | U2-1 · U0-3 | 있음 | 2 |

```
U0-1 ─┬─ U0-3 ─┬─ U2-3
      │        └─ U2-4
      ├─ U1-3 ─┬─ U1-4 ◀── U1-1 · U1-2
      │        └─ U2-2 ◀── U2-1
      └─ U2-1
U0-2 (독립)      U1-5 ◀── U1-1
```

U0-1 · U0-2 · U1-1 · U1-2 · U2-1 은 서로 독립이라 함께 열 수 있다. 나머지는 의존이 합쳐진 뒤 연다.

## 0단계. 화면 작업이 기획서를 쓴다

### U0-1. 기획서 찾기 도구와 답 끝의 한 줄

**의존.** 없음.

**파일.**

- [ ] 고침 `packages/daemon/src/browser-tools.ts`. `plan_find` 도구 정의(op `planFind`).
- [ ] 생성 `packages/daemon/src/plan-find.ts`. 원장에서 후보를 고르는 순수 함수.
- [ ] 고침 `packages/daemon/src/server.ts`. op 처리기. `screenFiles` 처리기 바로 아래, 같은 꼴.
- [ ] 고침 `packages/daemon/src/common-instructions.ts`. 답변 틀 불릿의 끝에 한 구절.
- [ ] 고침 `packages/protocol/src/tool-names.ts`. 도구 이름 목록에 `plan_find`.
- [ ] 시험 `packages/daemon/test/plan-find.test.ts`(새) · `browser-tools` 스키마 시험 · 공통 규칙 불릿 수 시험.
- [ ] 문서 `docs/DEVELOPERS.md` 「기획서 동기화」 절에 도구 한 줄. `AGENTS.md` 의 「기획서 폴더는 읽기 전용
      자료다」 줄에 "AI 는 `plan_find` 로 찾아 읽는다" 한 구절.

**짓는 것.**

- [ ] `plan_find { query?, route?, title? }` 는 원장만 읽는다. 제목 · 폴더 경로의 글자 일치, `links[]` 의
      route 일치(U2-1 전에는 비어 있다), 화면 제목의 글자 일치 순으로 후보를 모아 `{ pageId, title, path,
      stage, sections[] }` 를 최대 8개 돌려준다. `path` 는 `docs/plans/<path>.md` 다. AI 는 그 파일을 자기 읽기
      도구로 연다. 새 읽기 도구를 만들지 않는다.
- [ ] 도구 설명이 사용법을 말한다. "화면을 만들거나 고치기 전에 그 화면의 정책서 · 기능설계서를 이 도구로
      찾아 읽는다. 없으면 없다고 답한다. 기획서 파일은 읽기만 한다." 사용법은 공통 규칙이 아니라 도구 설명에만
      둔다(AGENTS.md 「공통 규칙은 제품의 자리만」).
- [ ] 공통 규칙의 답변 틀 불릿 끝에 한 구절. "기획서를 따랐으면 답 맨 끝에 어느 문서의 어느 절을 따랐는지 한
      줄을 남긴다." 불릿 수는 13 그대로다. 시험의 글자 수 상한을 함께 고친다.
- [ ] 연결이 없거나 가져온 문서가 없으면 도구는 `{ ok: false, error: "기획서가 아직 없어요" }` 를 돌려준다.

**보이는 것.**

- [ ] 기획자가 "회원 목록에 검색창 넣어 줘" 라고 하면 AI 가 먼저 회원 목록 기능설계서를 찾아 읽고, 답 끝에
      "따른 기획서 · 회원 목록 기능설계서 › 화면과 입력 항목" 한 줄이 선다.
- [ ] 기획서가 없는 프로젝트에서는 아무 줄도 서지 않고 지금과 같은 답이 온다.

**검증.**

- [ ] 단위. `plan-find.test.ts` 가 제목 일치 · 경로 일치 · route 일치 · 빈 원장 · 상한 8 · 연결 없음을 본다.
      `browser-tools` 시험이 새 정의의 `properties` · `required` 를 본다. `pnpm test`.
- [ ] 실제. 격리 데몬(`packages/web/test/cold/smoke-daemon.sh`)에 실제 가져온 원장을 두고 Claude 세션에
      한 문장을 보내, 대화록의 도구 호출과 답 끝 한 줄을 본다. 사진 `u0-1-answer.png`.
- [ ] 성능. 원장 500 문서에서 `plan_find` 한 번이 20ms 안이다. 시험이 `performance.now` 로 잰다. 기준값은
      없다(새 함수). 상한은 절대값이다.

**검토 문.** 사용자가 대화록 사진을 본다. 답 끝 한 줄이 사용자 문장 규칙(파일 경로 · 컴포넌트 이름 없음)에
맞는가.

**합치기.** 세 검증 상자가 찼다. `pnpm typecheck` · biome · 순수 시험이 초록이다. DEVELOPERS 한 줄이 같은
변경에 있다.

### U0-2. 입력창의 @기획서

**의존.** 없음.

**파일.**

- [ ] 고침 `packages/web/src/next/lib/composer-suggest.ts`. `@기획서/` 로 시작하는 조각은 `kind: "plan"` 이다.
- [ ] 고침 `packages/web/src/next/chat/ComposerSuggest.tsx`. plan 조각이면 `doc.list` 를 한 번 읽어(프로젝트마다
      캐시) 제목 · 폴더로 거르고, 고르면 `@docs/plans/<path>.md` 글자를 넣는다. 파일 조각과 같은 방식이다.
- [ ] 고침 `packages/web/src/next/labels.ts`. `composer.suggest.plans` 머리말 "기획서", 연결 없음 한 줄
      "기획서를 연결하면 여기에 보여요", 빈 목록 한 줄.
- [ ] 시험 `packages/web/test/next-composer-suggest.test.ts` 에 plan 조각 · 완성 글자 · 폴더 거르기.
- [ ] 문서 `docs/GUIDE.md` 입력창 절에 `@기획서/` 한 줄. `packages/web/src/next/README.md` 의 `ComposerSuggest`
      줄.

**짓는 것.**

- [ ] `triggerAt` 가 `@기획서/` 뒤의 글자를 `query` 로 돌려준다. `@` 만 치면 파일 목록 맨 위에 `기획서/` 폴더
      행이 선다(연결된 프로젝트만).
- [ ] 파일 목록(`repo.files`)은 손대지 않는다. 그 목록은 `git ls-files --exclude-standard` 라 제외 폴더를
      보이지 않는다(2026-10-19 임시 저장소에서 측정, 부록 A). 기획서 행은 원장(`doc.list`)에서 온다.
- [ ] 넣는 글자는 파일 경로다. 지금의 `@src/…` 와 같은 모양이라 AI 가 그 이름으로 파일을 연다.

**보이는 것.**

- [ ] `@기획` 까지 치면 목록 머리가 "기획서" 로 바뀌고 문서 제목이 폴더 이름과 함께 선다. 고르면 입력창에
      `@docs/plans/…/회원-목록-기능설계서.md ` 가 들어가고 커서가 그 뒤에 선다.
- [ ] 연결하지 않은 프로젝트에서는 `기획서/` 행이 서지 않는다.

**검증.**

- [ ] 단위. `next-composer-suggest.test.ts` 가 조각 판정 · 완성 · 거르기를 본다. `vocab-sweep` 가 새 문장을
      본다. `pnpm test`.
- [ ] 실제. `packages/web/dev/` 에 입력창 견본이 없으면 `composer-fixture.html?case=plans` 를 새로 둔다. 전역
      Playwright 로 열어 `@기획` 을 치고 목록 사진 `u0-2-suggest.png` 를 찍는다(Paseo 탭은 127.0.0.1 에 못
      닿는다. 전역 Playwright 를 쓴다).
- [ ] 성능. 500 문서 목록을 거르는 한 번이 10ms 안이다. 견본에서 `performance.now` 로 잰다.

**검토 문.** 목록 사진. 머리말과 행의 모양이 파일 목록과 같은 결인가.

**합치기.** 세 상자가 찼고 GUIDE 한 줄이 같은 변경에 있다.

### U0-3. 문서 한 장의 「이 기획서로 화면 만들기」

**의존.** U0-1 (브리프가 `plan_find` 를 부르라고 말한다).

**파일.**

- [ ] 고침 `packages/protocol/src/turn-marker.ts`. `BriefMarker.purpose` 에 `"plan"` 을 더하고 선택 필드
      `doc?: { pageId: string; title: string }` 을 더한다. `readTurn` 의 허용 목록에도 같이 더한다.
- [ ] 고침 `packages/protocol/src/messages.ts`. 명령 `doc.startThread { pageId }`.
- [ ] 고침 `packages/daemon/src/dispatch.ts`. 처리기. 새 대화를 열고 purpose 가 `plan` 인 브리프 마커 턴을
      첫 턴으로 보낸다(`markTurn` 으로 만든다). 연결 준비 브리프(`dispatch.ts` 의 bootstrap 길)와 같은 길이다.
      `sessionId` 를 돌려준다.
- [ ] 생성 `packages/daemon/src/plan-brief.ts`. 브리프 본문을 짓는 순수 함수.
- [ ] 고침 `packages/web/src/next/plans/PlanDocView.tsx`. 머리의 단추. 누르면 명령을 보내고 답의
      `sessionId` 로 `nav.openThread` 한다.
- [ ] 고침 `packages/web/src/next/chat/cards.tsx`. purpose `plan` 의 브리프 카드 말 "기획서로 화면 만들기 ·
      <문서 제목>".
- [ ] 고침 `packages/web/src/next/labels.ts`. 단추 말 · 카드 말.
- [ ] 시험 `packages/protocol/test` 의 turn-marker 시험(purpose plan · doc 필드 · 옛 모양 호환),
      `packages/daemon/test/plan-brief.test.ts`(새), `packages/web/test/next-plans.test.ts` 와 카드 시험.
- [ ] 문서 GUIDE 「기획서」 절 · DEVELOPERS 「기획서 동기화」 절 · `next/README.md` 의 `PlanDocView` 줄 ·
      README 의 기능 소개 한 덩어리.

**짓는 것.**

- [ ] 브리프 본문(AI 가 읽는 글)은 문서 파일 경로와 절 목록을 주고, "먼저 이 문서를 읽고 화면과 입력 항목 ·
      기능 동작 절대로 화면을 만든다. 끝에 따른 절 한 줄을 남긴다" 고 말한다. 본문에 토큰 · 사이트 주소는
      없다.
- [ ] 마커는 카드가 보일 것만 싣는다(제목 · 문서 제목). 옛 웹은 모르는 purpose 를 `readTurn` 에서 버리므로
      일반 브리프 카드로 그린다. 깨지지 않는다(2026-10-19 `turn-marker.ts` 의 허용 목록으로 확인).
- [ ] 대화 제목은 문서 제목이다. 같은 문서로 두 번 누르면 두 대화가 생긴다. 멱등은 명령 `id` 가 맡는다.

**보이는 것.**

- [ ] 기획서 한 장 위에 `이 기획서로 화면 만들기` 단추가 선다. 누르면 왼쪽에 새 대화가 열리고 첫 카드가
      "기획서로 화면 만들기 · 회원 목록 기능설계서" 라고 말한다. AI 가 문서를 읽고 화면을 만들기 시작한다.
- [ ] 연결이 끊겼거나(만료) 문서를 못 읽으면 단추가 잠기고 그 이유가 한 줄로 선다.

**검증.**

- [ ] 단위. turn-marker 시험 · plan-brief 시험 · dispatch 시험(명령이 세션을 열고 첫 턴을 보냈는가) ·
      `next-plans` 시험. `pnpm test`.
- [ ] 실제. `dev/plans-fixture.html?case=doc` 에 단추가 선 사진 `u0-3-button.png`. 격리 데몬에서 단추를 눌러
      새 대화와 카드가 선 사진 `u0-3-thread.png`.
- [ ] 성능. 해당 없음. 명령 한 번이 대화 하나를 연다. 기존 새 대화와 같은 비용이다.

**검토 문.** 두 사진. 카드의 말과 단추 자리.

**합치기.** 세 상자가 찼다. 옛 웹 빌드로 새 브리프를 열어도 카드가 깨지지 않는 시험이 있다.

## 1단계. 쓰기

### U1-1. 쓰기 클라이언트와 사전 검증 1

**의존.** 없음.

**파일.**

- [ ] 고침 `packages/daemon/src/confluence-client.ts`. `updatePage` · `copyPage` · `trashPage` ·
      `createFooterComment` · `createInlineComment` · `readPageVersion`.
- [ ] 시험 `packages/daemon/test/confluence-client.test.ts` 에 가짜 전송으로 여섯 방법 · 409 · 429 사다리.
- [ ] 문서 DEVELOPERS 「기획서 동기화」 절의 「눈으로 보는 확인」 에 사전 검증 1 의 결과.

**짓는 것.**

- [ ] `updatePage(pageId, { title, storage, version, message })` 는 v2 PUT 이고 판은 `version + 1` 로 보낸다.
      409 는 `{ readable: false, kind: "conflict", current }` 로 돌려준다. 실패 분류는 지금의 401 · 403 · 429
      사다리와 한 곳이다.
- [ ] `readPageVersion(pageId)` 는 판만 읽는다. 발행 직전의 이중 검사가 쓴다.
- [ ] 판 차이는 Confluence 에 묻지 않는다. 데몬이 작업본의 `.storage.xml`(baseVersion)과 지금 읽은 저장
      포맷을 파생 마크다운으로 바꿔 줄 단위로 비교한다. 실측되지 않은 API 에 기대지 않기 위해서다.
- [ ] 쓰기 방법은 `git-lane` 의 `"confluence"` 차선에서만 불린다.

**보이는 것.**

- [ ] 사용자에게 보이는 것은 없다. 다음 단위가 쓴다.

**검증.**

- [ ] 단위. 가짜 전송 시험. 성공 · 409 · 401 · 429 재시도 · 본문에 토큰이 안 실리는 것. `pnpm test`.
- [ ] 실제. 사전 검증 1. `COLONOVA_DESIGN_CONFLUENCE_EMAIL/TOKEN` 을 env 로 두고 개인 스페이스의 스크래치
      페이지에서 기본 인증으로 PUT 이 되는지, 낡은 판으로 PUT 하면 409 가 오는지, 복제 · 휴지통 · 코멘트 둘이
      되는지 본다. 결과를 DEVELOPERS 에 날짜와 함께 적고 페이지를 지운다. 2026-10-18 실측은 MCP 자격 경로라
      앱 자체 인증의 증거가 아니다.
- [ ] 성능. 해당 없음. 요청 한 번이 방법 하나다. 시간당 예산(Global Pool 65,000 points)은 부록 C 의 위험이다.

**검토 문.** 없음. U1-1 은 상호작용을 바꾸지 않는다.

**합치기.** 사전 검증 1 이 지났고 DEVELOPERS 에 적혔다. 409 가 안 오면 U1-4 는 열지 않는다(부록 A).

### U1-2. 저장 포맷 절 스플라이스

**의존.** 없음.

**파일.**

- [ ] 생성 `packages/daemon/src/confluence-storage.ts`. `splitSections` · `markdownToStorage` ·
      `spliceSection`.
- [ ] 시험 `packages/daemon/test/confluence-storage.test.ts`(새). 견본은 조직 문서의 글자가 아니라 같은 모양으로
      새로 지은 것이다.
- [ ] 문서 DEVELOPERS 「기획서 동기화」 절에 변환의 범위와 거절 규칙.

**짓는 것.**

- [ ] `splitSections(storage)` 는 h1 부터 h6 까지의 제목으로 절을 나눠 `{ heading, xml, hasAnchor, hasMacro }`
      를 돌려준다. `confluence-markdown.ts` 의 절 판정과 같은 제목을 써야 한다. 두 모듈이 한 판정 함수를
      나눠 쓴다.
- [ ] `markdownToStorage(md)` 는 문단 · 제목 · 목록 · 표 · 굵게 · 기울임 · 코드 · 링크만 안다. 모르는 것은
      거절(`{ ok: false, reason }`)이고 조용히 떨어뜨리지 않는다.
- [ ] `spliceSection(storage, heading, newXml, original)` 은 그 절만 갈아 끼운다. 인라인 코멘트 닻
      (`ac:inline-comment-marker`)이 든 문단은 원문에서 글자 일치로 찾아 그대로 이식한다. 닻 문단의 글자가
      바뀌었으면 거절하고 어느 문단인지 돌려준다. 매크로가 든 절은 거절한다.

**보이는 것.**

- [ ] 사용자에게 보이는 것은 없다. U1-4 가 쓴다.

**검증.**

- [ ] 단위. 왕복(저장 포맷 → 마크다운 → 저장 포맷)이 표 · 목록 · 링크를 지키는 것, 닻 이식, 닻 문단 변경
      거절, 매크로 절 거절, 모르는 마크다운 거절. `pnpm test`.
- [ ] 실제. 사전 검증 2. 스플라이스 결과를 앱 클라이언트(U1-1)로 스크래치 페이지에 올려 Confluence 화면에서
      닻과 매크로가 산 것을 본다. 사진 `u1-2-anchor.png`. 2026-10-18 의 같은 실측은 MCP 경로였다.
- [ ] 성능. 160 문서의 절 하나씩을 변환하는 시험이 2초 안이다(순수, `pnpm test` 가 잰다). 기준값은 없다.

**검토 문.** 없음.

**합치기.** 세 상자가 찼다.

### U1-3. 제안과 받기, 절 저장

**의존.** U0-1 (제안은 찾기 뒤에 온다).

**파일.**

- [ ] 고침 `packages/daemon/src/browser-tools.ts`. `plan_propose { pageId, heading, markdown, reason }`
      (op `planPropose`).
- [ ] 고침 `packages/daemon/src/confluence-ledger.ts`. `proposals[]` · `pages[].dirty` 의 모양과 파싱.
- [ ] 생성 `packages/daemon/src/plan-proposals.ts`. 제안 쌓기 · 받기 · 버리기 · 절 바꿔 쓰기의 순수 부분.
- [ ] 고침 `packages/daemon/src/server.ts`. op 처리기.
- [ ] 고침 `packages/protocol/src/messages.ts`. 명령 `doc.proposal.accept { proposalId }` ·
      `doc.proposal.reject { proposalId }` · `doc.save { pageId, heading, markdown }`. `doc.read` 의 답에
      선택 필드 `proposals[]` · `dirty`.
- [ ] 고침 `packages/protocol/src/project.ts`. `confluence.proposals` · `confluence.dirty` 수(선택).
- [ ] 고침 `packages/web/src/next/plans/PlanDocView.tsx`. 제안 띠(전과 후 · 받기 · 버리기 · 다시 제안), 절의
      `고치기` 와 마크다운 칸 · `저장`.
- [ ] 고침 `packages/web/src/next/sidebar/Sidebar.tsx`. 기획서 항목의 숫자 배지(제안 수).
- [ ] 고침 `packages/web/src/next/labels.ts`. 제안 · 받기 · 버리기 · 다시 제안 · 고치기 · 저장 · 「그 사이 문서가
      바뀌었어요」.
- [ ] 고침 `AGENTS.md` 와 `CLAUDE.md` 의 「기획서 폴더는 읽기 전용 자료다」 줄. "AI 는 고치지 않는다. 고친 글은
      제안으로 오고 받기 · 저장은 데몬이 적는다" 로.
- [ ] 시험 `plan-proposals.test.ts`(새) · ledger 시험 · `next-plans.test.ts` · 라벨 시험.
- [ ] 문서 GUIDE 「기획서」 절(고치기 · 제안) · DEVELOPERS · `next/README.md`.

**짓는 것.**

- [ ] `plan_propose` 는 pageId 와 heading 이 원장에 있고 매크로 절이 아닐 때만 받는다. `baseVersion` 은
      지금 판이다. 답은 "제안을 기획서 칸에 두었어요" 한 줄이고 AI 는 그 말을 옮긴다. 도구 설명은 "사용자가
      고쳐 달라고 한 절만 제안한다. 파일을 직접 고치지 않는다" 고 말한다.
- [ ] 받기는 `baseVersion` 과 지금 판이 같을 때만 `.md` 의 그 절을 제안 글로 바꿔 쓰고 `dirty` 에 절을 더한다.
      다르면 `stale` 로 바꾸고 거절 답을 준다. 거절 답에 두 판 번호가 있다.
- [ ] `doc.save` 는 사람이 직접 고친 마크다운을 같은 길로 적는다. 매크로 절은 거절한다.
- [ ] 쓰기는 `"confluence"` 차선을 지난다. 가져오기와 겹치지 않는다.
- [ ] 제안은 여러 대화에서 같은 문서로 쌓일 수 있다. 띠는 절마다 가장 최근 것을 앞에 세운다.

**보이는 것.**

- [ ] 기획자가 "이 절을 이렇게 바꿔 줘" 라고 하면 AI 가 답하고, 기획서 칸의 그 문서 위에 "제안 1건" 띠가 선다.
      펼치면 전과 후가 나란히 서고 `받기` · `버리기` 가 있다. 받으면 본문이 바뀌고 문서 머리에 "고친 절 1 ·
      발행 전" 알약이 선다.
- [ ] 그 사이 가져오기가 문서를 새 판으로 바꿨으면 `받기` 대신 "그 사이 문서가 바뀌었어요 · 판 7 → 8" 과
      `다시 제안` 이 선다. 다시 제안은 U0-3 과 같은 길로 새 대화를 연다.
- [ ] 사이드바의 `기획서` 옆에 제안 수가 선다.

**검증.**

- [ ] 단위. 제안 쌓기 · 받기 · 낡은 판 거절 · 절 바꿔 쓰기(제목이 둘 이상 같을 때 첫째만) · 매크로 거절 ·
      원장 파싱(깨진 제안 버리기) · 띠의 순수 상태. `pnpm test`.
- [ ] 실제. 격리 데몬에서 한 문장으로 제안을 만들고 받는다. 사진 `u1-3-band.png` · `u1-3-accepted.png`.
      가져오기를 먼저 돌려 낡은 판 거절 사진 `u1-3-stale.png`.
- [ ] 성능. 받기 한 번이 50ms 안이다(파일 하나 다시 쓰기). 시험이 잰다.

**검토 문.** 세 사진. 전과 후 보기의 읽힘, 알약의 말.

**합치기.** 세 상자가 찼다. `AGENTS.md` · `CLAUDE.md` 줄이 같은 변경에 있다.

### U1-4. 발행과 판 충돌

**의존.** U1-1 · U1-2 · U1-3.

**파일.**

- [ ] 생성 `packages/daemon/src/plans-publish.ts`. 2026-10-18 설계가 이름한 그 파일. 발행의 상태 기계.
- [ ] 고침 `packages/protocol/src/messages.ts`. 명령 `confluence.publish { pageId, stage? }`. 2026-10-18 은
      `{ path, expectedVersion }` 이었다. 원장이 id 로 문서를 추적하므로 `path` 는 `pageId` 가 되고,
      `expectedVersion` 은 클라이언트가 보내지 않고 원장의 `dirty.baseVersion` 에서 읽는다. 낡은 번호를
      화면이 보낼 길을 없앤다.
- [ ] 고침 `packages/daemon/src/dispatch.ts`. 처리기.
- [ ] 고침 `packages/web/src/next/status/StatusLine.tsx` 와 새 `status/PublishPopover.tsx`. 기획서 칸이 서
      있을 때만 `발행` 단추(2026-10-18 설계 그대로).
- [ ] 고침 `packages/web/src/next/plans/PlanDocView.tsx`. 충돌 보기(차이 · 합치기 · 다시 발행).
- [ ] 고침 `packages/web/src/next/lib/journey.ts` 또는 새 `lib/publish-view.ts`. 발행 단추의 켜짐 · 잠긴 이유 ·
      확인 창의 목록(순수).
- [ ] 고침 `packages/protocol/src/project.ts`. `confluence.dirty` 수는 U1-3 에서 왔다. 발행 답의 모양.
- [ ] 고침 `packages/web/src/next/labels.ts`. 발행 · 발행 확인 · 같은 단계 개정 · 승급 · 그 사이 누가 고쳤어요 ·
      합치고 다시 발행 · 발행됨.
- [ ] 시험 `plans-publish.test.ts`(새) · `publish-view` 시험 · 라벨 시험.
- [ ] 문서 README 기능 소개 · GUIDE 「기획서」 절과 상태 줄 절 · DEVELOPERS 「기획서 동기화」 절(발행 · 충돌 ·
      멱등) · `next/README.md`.

**짓는 것.**

- [ ] 발행은 문서마다 돈다. 순서는 판 읽기(U1-1) → `baseVersion` 과 비교 → 다르면 충돌 답 → 같으면 dirty 절마다
      스플라이스(U1-2) → PUT → 409 면 충돌 답 → 성공이면 그 문서를 다시 가져오고 `dirty` 를 지우고 `published`
      를 적는다. 원장 표식이 먼저고 답이 나중이다(`repo-publish.ts` 의 규칙). 성공 뒤의 이 다시 가져오기가 비로소
      `.storage.xml` 과 `.md` 를 새로 쓴다. dirty 인 동안의 가져오기는 둘을 건드리지 않는다(「데이터 모양」).
- [ ] 충돌 답은 두 판 번호와 줄 단위 차이(데몬이 낸 것)를 싣는다. 합치기는 절 편집 칸(U1-3)에 두 판을 나란히
      보이고 사람이 고친 뒤 `다시 발행` 을 누른다.
- [ ] 판 단계는 확인 창의 선택이다. 기본은 같은 단계의 개정이고 승급은 제목의 `v0.8` 을 `v0.9` 로 바꾸는
      것이다. 1.0 CLOSED 문서(제목 `v1.0`)는 `발행` 이 잠기고 이유가 선다. 1.01+ 개정은 3단계다.
- [ ] 발행 중에는 그 문서의 받기 · 저장이 잠긴다. 발행과 가져오기는 같은 차선이라 겹치지 않는다.
- [ ] 명령 `id` 가 멱등 키다. 같은 id 의 재전송은 같은 답을 받는다(`command-dedupe.ts`).

**보이는 것.**

- [ ] 고친 절이 있고 기획서 칸이 서 있으면 상태 줄에 `발행` 이 선다. 누르면 확인 창에 바뀐 절 목록 · 판 단계
      선택 · 문서 수가 선다. 발행이 끝나면 문서 머리의 알약이 "발행됨 · 판 8" 로 바뀐다.
- [ ] 그 사이 Confluence 에서 누가 고쳤으면 "그 사이 누가 고쳤어요 · 판 7 → 8" 창이 서고 차이가 보인다.
      합치고 다시 발행하면 판 9 가 된다.

**검증.**

- [ ] 단위. 상태 기계. 같은 판이면 PUT, 다르면 충돌, 409 면 충돌, 성공 뒤 원장 표식, 재전송 멱등, 매크로 절이
      dirty 에 들어올 수 없음. `pnpm test`.
- [ ] 실제. 사전 검증 1 이 지난 스크래치 페이지에서 앱으로 절을 고쳐 발행하고 사이트의 판이 오른 것을 본다.
      사이트에서 고친 뒤 다시 발행해 충돌 창 · 합치기 · 재발행을 본다. 사진 `u1-4-confirm.png` ·
      `u1-4-conflict.png` · 짧은 녹화 `u1-4-publish.mp4`.
- [ ] 성능. 발행 한 번(판 읽기 · PUT · 다시 가져오기)이 실제 사이트에서 3초 안이다. 기준값은 없다. 절대
      상한이다. `scripts/bench/` 의 시나리오로 재면 다음 사람이 다시 잴 수 있다.

**검토 문.** 사진 둘과 녹화.

**합치기.** 세 상자가 찼다. README · GUIDE · DEVELOPERS 가 같은 변경에 있다.

### U1-5. 새 기획서 · 코멘트 달기 · 휴지통

**의존.** U1-1.

**파일.**

- [ ] 고침 `packages/protocol/src/messages.ts`. 명령 `doc.create { parentId, title, template }` ·
      `doc.comment.add { pageId, body, anchorText?, parentId? }` · `doc.trash { pageId }`.
- [ ] 고침 `packages/daemon/src/dispatch.ts`. 처리기 셋.
- [ ] 생성 `packages/daemon/src/plan-stage.ts`. 제목의 판 단계(`v0.8`)를 읽는 순수 함수. U1-4 와 나눠 쓴다.
- [ ] 고침 `packages/web/src/next/plans/PlansColumn.tsx` · `PlanDocView.tsx`. `새 기획서` 단추와 작은 창(어느
      폴더 · 제목 · 정책서 또는 기능설계서), 글 선택 뒤 `코멘트`, 문서 메뉴의 `휴지통으로`.
- [ ] 고침 `packages/web/src/next/labels.ts`.
- [ ] 시험 `plan-stage.test.ts`(새) · 코멘트 닻 맞춤 시험(한글 본문) · dispatch 시험(1.0 거절).
- [ ] 문서 GUIDE 「기획서」 절 · DEVELOPERS.

**짓는 것.**

- [ ] 새 기획서는 밑그림 문서를 복제한다. 밑그림은 기준 페이지 아래의 `[밑그림] 정책서` · `[밑그림] 기능설계서`
      두 페이지다(조직 템플릿 10절 · 8절을 담는다). 복제는 새 id 와 판 1 로 시작한다(2026-10-18 실측). 조직의
      전역 템플릿 API 로 바꾸는 것은 사전 검증 5 가 지나면 한다.
- [ ] 코멘트 달기는 바닥글과 인라인 둘이다. 인라인의 닻은 본문 글자 선택이고 저장 포맷 문단과 맞아야 한다.
      매크로 절에는 새 코멘트를 달지 못한다(2026-10-18 설계).
- [ ] 휴지통은 제목의 판 단계가 1.0 미만일 때만 열린다. 1.0 이상은 단추가 잠기고 이유가 선다. 복구는 사전
      검증 3 이 지나야 단추가 켜진다. 그 전에는 "휴지통에서 꺼내는 것은 Confluence 에서 해요" 한 줄이 선다.
- [ ] 삭제한 문서는 원장에서 `trashed` 상태가 되고 목록에서 접힌다. 다음 가져오기가 Confluence 에서 사라진
      것을 확인하면 항목을 지운다.

**보이는 것.**

- [ ] 목록 위 `새 기획서`. 제목과 종류를 넣으면 Confluence 에 문서가 생기고 목록에 바로 선다.
- [ ] 본문에서 글을 끌어 고르면 `코멘트` 가 뜨고, 달면 Confluence 화면에서도 같은 자리에 붙는다.
- [ ] 문서 메뉴의 `휴지통으로`. 1.0 문서는 잠겨 있다.

**검증.**

- [ ] 단위. 판 단계 읽기 · 1.0 거절 · 닻 맞춤 · 원장의 `trashed`. `pnpm test`.
- [ ] 실제. 스크래치 스페이스에서 생성 · 코멘트 · 휴지통을 돌리고 Confluence 화면 사진 `u1-5-comment.png` 를
      찍는다. 사전 검증 3 · 4 · 5 의 결과를 DEVELOPERS 에 적는다.
- [ ] 성능. 해당 없음.

**검토 문.** 사진 셋(새 문서 · 코멘트 · 잠긴 휴지통).

**합치기.** 세 상자가 찼다. 복구 단추는 사전 검증 3 이 지나기 전에는 켜지지 않는다.

## 2단계. 잇는다

### U2-1. 원장의 두 표

**의존.** U0-1 (`plan_link` 는 `plan_find` 의 짝이다).

**파일.**

- [ ] 고침 `packages/daemon/src/confluence-ledger.ts`. `links[]` · `pending[]` 의 모양과 파싱.
- [ ] 생성 `packages/daemon/src/plan-pending.ts`. 파생 마크다운과 코멘트 목록에서 미결 항목을 계산하고 옛
      상태(`snoozedUntil` · `state`)를 id 로 이어받는 순수 함수.
- [ ] 생성 `packages/daemon/src/plan-links.ts`. 링크 쌓기 · 확인 · 같은 줄 합치기(순수).
- [ ] 고침 `packages/daemon/src/confluence-sync.ts`. 바뀐 문서마다 미결을 다시 계산한다. 코멘트 목록은
      바뀐 문서만 읽는다(문서당 요청 둘).
- [ ] 고침 `packages/daemon/src/browser-tools.ts`. `plan_link { pageId, heading, route }` (op `planLink`).
      AI 가 기획서를 따라 화면을 고쳤을 때 부른다. `source: "ai"`.
- [ ] 고침 `packages/protocol/src/messages.ts`. `doc.links.set { pageId, heading, route, files? }`
      (`source: "user"`) · `doc.pending.list` · `doc.pending.snooze { itemId, until }`.
- [ ] 고침 `packages/protocol/src/project.ts`. `confluence.pending` 수(선택).
- [ ] 고침 `packages/web/src/next/plans/PlanDocView.tsx`. 절 메뉴의 `이 절의 화면 고르기`(목록은
      `cycleScreens` · `firstScreen` · 주소 색인) 과 "화면 · /member/list" 알약.
- [ ] 시험 `plan-pending.test.ts` · `plan-links.test.ts`(새) · ledger 시험 · sync 시험(바뀐 문서만 계산).
- [ ] 문서 DEVELOPERS 「기획서 동기화」 절(두 표 · 계산 규칙 · 요청 수) · GUIDE 「기획서」 절(화면 고르기).

**짓는 것.**

- [ ] 미결 계산. 제목에 「미결」 이 든 절의 불릿 하나가 항목 하나다. 본문 어디든 `TBD` 가 든 줄도 항목이다.
      안 풀린 코멘트는 id · 닻 · 글쓴이 · 때 · 첫 줄만 둔다. 같은 id 의 옛 항목이 있으면 `state` 와
      `snoozedUntil` 을 이어받는다. 사라진 항목은 `closed` 로 바꾸고 30일 뒤에 지운다. `mismatch` 항목은 이
      계산 밖이다. 사람이 닫을 때까지 남는다.
- [ ] 링크. (pageId · heading · route) 가 같으면 한 줄이다. 사람이 확인하면 `source: "user"` 와 `confirmedAt`
      이 되고 다시 `ai` 로 내려가지 않는다.
- [ ] 2026-10-18 「분석은 전부 나중」 중 이 단위가 앞당기는 것은 미결 색인 하나다. 모순 · 용어 · 번짐 ·
      판 비교는 손대지 않는다.

**보이는 것.**

- [ ] 문서의 절 메뉴에 `이 절의 화면 고르기` 가 서고, 고르면 절 머리에 "화면 · 회원 목록" 알약이 붙는다.
- [ ] 사이드바 `기획서` 옆에 미결 수가 선다(U2-2 가 쓴다).

**검증.**

- [ ] 단위. 미결 계산(「## 10. 미결」 · 「## 미결 사항」 같은 제목 변형, TBD 줄, id 안정, 상태 이어받기, 사라짐),
      링크 합치기, 원장 파싱. `pnpm test`.
- [ ] 실제. 실제 기준 페이지를 가져와 원장의 `pending` 수가 2026-10-17 의 미러 측정(1,604 · 83)과 같은
      자릿수인지 본다. 다르면 계산 규칙을 적고 이유를 DEVELOPERS 에 남긴다.
- [ ] 성능. 첫 가져오기(160 문서)가 U2-1 전과 후에 각각 얼마인지 같은 기계에서 번갈아 세 번 잰다. 후가 전의
      2배를 넘지 않고 60초 안이다. 증분 가져오기(바뀐 문서 0개)는 전과 같다. 재는 법은 `scripts/bench/` 의
      시나리오로 둔다.

**검토 문.** 없음. 절 메뉴 하나는 U2-2 의 검토에 함께 본다.

**합치기.** 세 상자가 찼다. 성능 전후 값이 DEVELOPERS 에 날짜와 함께 있다.

### U2-2. 미결 큐를 받은 편지함에

**의존.** U2-1 · U1-3 (정하기가 제안으로 이어진다).

**파일.**

- [ ] 고침 `packages/web/src/next/lib/home-feed.ts`. 묶음 `pending` (`asking` 다음). 오래된 순 다섯 장과
      `더 보기`.
- [ ] 고침 `packages/web/src/next/home/HomeInbox.tsx`. 미결 카드. 문서 제목 › 절, 문장, 주체(없으면 "주체
      없음"), 묵은 날. 단추 `정하기` · `문서에서 보기` · `넘기기`.
- [ ] 고침 `packages/web/src/next/plans/PlansColumn.tsx`. 목록의 `미결만` 거름과 문서별 미결 수.
- [ ] 고침 `packages/protocol/src/messages.ts`. 명령 `doc.decide { itemId }`. 새 대화를 열고 purpose
      `"decide"` 브리프를 보낸다(U0-3 의 길). `BriefMarker.purpose` 에 `"decide"`.
- [ ] 고침 `packages/daemon/src/dispatch.ts` · `plan-brief.ts`.
- [ ] 고침 `packages/web/src/next/labels.ts`. 미결 · 정하기 · 넘기기 · 주체 없음 · N일 묵음.
- [ ] 시험 `home-feed` 시험(순서 · 넘김 · 다섯 장) · `next-plans` 시험 · 라벨 시험.
- [ ] 문서 GUIDE 홈 절과 「기획서」 절 · `next/README.md`.

**짓는 것.**

- [ ] 카드 한 장이 결정 하나다. `정하기` 는 그 항목을 담은 브리프로 새 대화를 연다. 브리프는 "이 미결을 사용자가
      정하면 그 결정으로 문서의 절을 `plan_propose` 로 제안하거나 화면을 고친다" 고 말한다. AI 가 먼저 묻고
      사용자가 답한다.
- [ ] `넘기기` 는 7일 뒤로 `snoozedUntil` 을 적는다. 받은 편지함은 넘긴 것을 숨기고 기획서 칸의 거름은 보인다.
- [ ] `문서에서 보기` 는 기획서 칸을 열고 그 절로 스크롤한다.
- [ ] 코멘트 항목은 첫 줄만 보이고 카드를 펼치면 `doc.read` 로 본문을 그 자리에서 읽는다.

**보이는 것.**

- [ ] 홈의 받은 편지함에 "미결 1,604개 · 오래된 것부터" 묶음이 서고 다섯 장이 보인다. 카드에 "주체 없음 ·
      51일 묵음" 같은 줄이 있다.
- [ ] `정하기` 를 누르면 대화가 열리고 AI 가 그 미결을 한 문장으로 묻는다.

**검증.**

- [ ] 단위. 순서(오래된 것 먼저) · 넘긴 것 숨김 · 다섯 장 상한 · 수 표시. `pnpm test`.
- [ ] 실제. `dev/home-fixture.html?case=pending`(없으면 새로) 사진 `u2-2-inbox.png`. 격리 데몬에서 `정하기`
      → 대화 사진 `u2-2-decide.png`.
- [ ] 성능. 1,600 항목으로 기획서 칸의 `미결만` 거름을 켜는 한 번이 100ms 안이다. 견본에서 `performance.now`
      로 잰다. 넘으면 목록을 가상화한다.

**검토 문.** 사진 둘과 짧은 녹화 `u2-2-inbox.mp4`.

**합치기.** 세 상자가 찼다. 2026-10-18 「분석은 전부 나중」 의 예외가 이 단위 하나뿐임을 DEVELOPERS 에
적는다.

### U2-3. 화면에서 문서로 제안

**의존.** U2-1 · U1-3 · U0-3.

**파일.**

- [ ] 고침 `packages/web/src/next/status/WorkPopover.tsx` 와 `SubmitPopover.tsx`. 단추 `기획서에 반영 제안`.
- [ ] 고침 `packages/protocol/src/messages.ts`. 명령 `doc.reflect { requestId? }`. `BriefMarker.purpose` 에
      `"reflect"`.
- [ ] 고침 `packages/daemon/src/dispatch.ts` · `plan-brief.ts`. 브리프에 이번 작업의 화면 목록(`cycleScreens`
      의 route · title · note)과 링크(확인한 것 먼저, 후보 다음)를 싣는다.
- [ ] 고침 `packages/web/src/next/labels.ts`.
- [ ] 시험 `plan-brief.test.ts` · dispatch 시험.
- [ ] 문서 GUIDE 상태 줄 절 · 「기획서」 절 · DEVELOPERS.

**짓는 것.**

- [ ] 브리프는 "각 화면에 이어진 기능설계서의 「화면과 입력 항목」 절을 지금 화면대로 고쳐 `plan_propose` 로
      제안한다. 화면은 브라우저 도구로 보고 적는다. 정책서는 제안하지 않는다" 고 말한다. 정책서는 사람이 쓰는
      반쪽이다(2026-10-17 조사).
- [ ] 링크가 없는 화면은 제안하지 않고 답에 "연결된 기획서가 없어요 · 문서 고르기" 한 줄을 남긴다. 고르기는
      U2-1 의 절 메뉴다.
- [ ] 결과는 U1-3 의 제안이다. 받기 · 발행은 그 길을 그대로 쓴다.

**보이는 것.**

- [ ] 이번 작업 팝에 `기획서에 반영 제안` 이 선다. 누르면 대화가 열리고 AI 가 화면을 보고 절 초안을 제안한다.
      기획서 칸의 그 문서에 띠가 선다.

**검증.**

- [ ] 단위. 브리프 본문(화면 목록 · 링크 순서 · 정책서 제외). `pnpm test`.
- [ ] 실제. 격리 데몬에서 화면 하나를 고친 뒤 단추를 눌러 제안 띠까지 본다. 사진 `u2-3-proposal.png`.
- [ ] 성능. 해당 없음. 대화 한 번이다.

**검토 문.** 사진. 제안된 절의 글이 기획서 템플릿의 「화면과 입력 항목」 꼴인가.

**합치기.** 세 상자가 찼다.

### U2-4. 문서와 화면 대조

**의존.** U2-1 · U0-3.

**파일.**

- [ ] 고침 `packages/web/src/next/plans/PlanDocView.tsx`. 문서 머리의 `이 문서와 화면 대조`. 링크가 없으면
      화면 고르기 창이 먼저 선다.
- [ ] 고침 `packages/protocol/src/messages.ts`. 명령 `doc.audit { pageId, heading?, route }` ·
      `doc.pending.add { pageId, heading, text, kind: "mismatch" }`. `BriefMarker.purpose` 에 `"audit"`.
- [ ] 고침 `packages/daemon/src/dispatch.ts` · `plan-brief.ts` · `plan-pending.ts`(mismatch 종류).
- [ ] 고침 `packages/web/src/next/chat/cards.tsx`. 대조 답의 각 어긋남 줄 옆 `미결로 보내기`.
- [ ] 고침 `packages/web/src/next/labels.ts`.
- [ ] 시험 `plan-pending` 시험(mismatch) · `plan-brief` 시험 · 카드 시험.
- [ ] 문서 GUIDE 「기획서」 절 · DEVELOPERS.

**짓는 것.**

- [ ] 브리프는 문서 경로 · 절 · 화면 주소를 주고 "정책서의 규칙과 기능설계서의 항목 하나하나를 화면에서 찾아
      맞음 · 어긋남 · 못 봄으로 적는다. 화면을 고치지 않는다" 고 말한다.
- [ ] 답은 어긋남마다 한 줄이고 줄마다 절 제목이 앞에 선다. 카드가 그 줄에 `미결로 보내기` 를 붙인다. 보내면
      `pending[]` 에 `mismatch` 항목이 생기고 받은 편지함(U2-2)에 선다.
- [ ] 처음은 사람이 누른다. 링크가 찬 뒤 보관 때마다 저절로 도는 것은 3단계다.

**보이는 것.**

- [ ] 문서 머리에 `이 문서와 화면 대조`. 누르면 대화가 열리고 AI 가 "맞음 12 · 어긋남 2 · 못 봄 1" 로 답한다.
      어긋남 줄의 `미결로 보내기` 를 누르면 홈의 미결에 선다.

**검증.**

- [ ] 단위. mismatch 항목의 모양과 id · 브리프 본문 · 카드의 줄 판정. `pnpm test`.
- [ ] 실제. 격리 데몬에서 견본 문서와 화면으로 대조를 돌려 답과 미결 카드까지 본다. 사진 `u2-4-audit.png`.
- [ ] 성능. 해당 없음. 대화 한 번이다.

**검토 문.** 사진. 답의 줄이 사용자 문장 규칙에 맞는가.

**합치기.** 세 상자가 찼다.

## 3단계. 범위만 적는다

짓지 않는다. 2단계가 끝난 뒤 다시 계획한다.

- 결정의 전파. 한 결정이 닿는 문서 N 곳을 `links[]` 와 문서 간 링크(2026-10-17 측정 1,122개)로 찾아 제안을
  묶음으로 낸다.
- 판 승급과 판 비교의 화면. 1.01+ 개정의 사유 입력.
- 나머지 분석 8종(모순 · 용어 · 커버리지 · 판 현황 · 결정 기록 등).
- 자동 대조. 링크가 찬 문서는 보관 때마다 대조를 돌리고 어긋남을 미결로 보낸다.
- Codex 의 파일 쓰기 울타리. 지금은 공통 규칙의 구절만 막는다(2026-10-07).
- 사이트가 다른 두 프로젝트의 자격 분리(`confluence-pat:<slug>`).

## 운영

- [ ] 단위마다 `main` 에서 새 작업 트리를 연다. weak-eagle 트리는 세션 여럿이 함께 쓰므로 검증은 `/tmp` 의
      격리 사본에서 한다(2026-10-19 공유 트리 메모).
- [ ] 같은 변경에서 코드 · 시험 · 문서(README · GUIDE · DEVELOPERS · `next/README.md` · AGENTS.md)를 고친다.
      단위의 「파일」 상자가 그 목록이다.
- [ ] 합치기 전에 `pnpm typecheck` · biome · `pnpm test`(빌드 포함)를 돈다. 시험은 `dist` 를 읽으므로 src 만
      고치고 `node --test` 를 바로 돌리지 않는다.
- [ ] 실제 확인의 도구는 셋이다. `packages/web/dev/*-fixture.html` 을 전역 Playwright 로 연다. 데몬이 필요한
      것은 `packages/web/test/cold/smoke-daemon.sh` 의 격리 데몬에서 본다. 실제 Confluence 는 env 자격과
      개인 스페이스의 스크래치 페이지로만 만지고 끝에 지운다.
- [ ] 사진과 녹화는 `/tmp/plans-link/<단위>/` 에 모으고 제출 글에 붙인다. 레포에 넣지 않는다.
- [ ] 검토 문이 있는 단위는 사진과 녹화를 대화에 올리고 사용자가 보기 전에는 합치지 않는다.
- [ ] 제출 글과 커밋은 조직 관례(2026-10-13 분석의 commitlint 종류 · 본문 50자 · PR 템플릿)를 따른다.
- [ ] 의존이 합쳐지기 전에는 그 단위를 열지 않는다. 독립인 다섯(U0-1 · U0-2 · U1-1 · U1-2 · U2-1)은 함께
      열 수 있다.
- [ ] 단위가 끝나면 이 문서의 상자를 채우고 날짜를 적는다. 끝난 단위의 상자는 지우지 않는다.

## 부록 A. 사전 검증

증명된 것 하나.

| 물음 | 결과 | 방법 | 날짜 |
| --- | --- | --- | --- |
| 입력창의 `@` 목록이 `.git/info/exclude` 의 폴더를 보이지 않는가 | 보이지 않는다. `--exclude-standard` 가 그 파일을 읽는다 | 임시 저장소에서 `git ls-files --cached --others --exclude-standard` 를 돌려 `docs/plans/b.md` 가 빠지는 것을 봤다 | 2026-10-19 |

증명되지 않은 것 다섯. 이 세션에는 앱 자체 자격이 없고 Atlassian MCP 는 판을 스스로 올려 409 를 낼 수 없다.

| 번호 | 물음 | 정확한 실험 | 막는 단위 |
| --- | --- | --- | --- |
| 1 | 기본 인증(이메일 · API 토큰)으로 v2 PUT 이 되고 낡은 판은 409 인가 | 스크래치 페이지에 판 N+1 로 PUT, 이어 판 N 으로 PUT. 둘째가 409 여야 한다 | U1-1. 안 되면 U1-4 를 열지 않는다 |
| 2 | 앱 클라이언트의 저장 포맷 절 스플라이스가 닻과 매크로를 지키는가 | 인라인 코멘트와 info 매크로가 든 페이지의 다른 절을 바꿔 PUT, Confluence 화면에서 둘이 산 것을 본다 | U1-2 |
| 3 | 휴지통의 문서를 REST 로 되살릴 수 있는가 | 스크래치 페이지를 휴지통으로 보내고 되살리는 요청을 보낸다 | U1-5 의 복구 단추 |
| 4 | 인라인 코멘트의 해결 상태를 REST 로 읽고 바꿀 수 있는가 | 스크래치 페이지의 인라인 코멘트를 해결로 바꾸고 목록에서 상태를 읽는다 | U1-5 · U2-1 의 코멘트 항목 닫힘 |
| 5 | 조직 전역 템플릿에서 페이지를 만드는 API 가 있는가 | 템플릿 목록을 읽고 그 템플릿으로 페이지를 만든다. 없으면 밑그림 페이지 복제로 간다 | U1-5 의 새 기획서 |

## 부록 B. 기각한 대안

- Confluence 를 앱 안에서 통째로 대체한다. 매크로 · 앵커 때문에 동등성이 비싸고 비개발자 UI 가 둘로 갈린다.
  2026-10-19 그림 문서의 A 안이다.
- AI 가 기획서 파일을 직접 고친다. D1 로 고친 글이 아무 데도 가지 않고, 2026-10-19 의 쓰기 가드가 막는다.
  제안 카드가 그 자리를 맡는다.
- `repo.files` 가 제외 폴더를 함께 걷는다. 그러면 `.storage.xml` 과 원장도 `@` 목록에 선다. 기획서 행은
  원장에서 오는 것이 맞다.
- 제안을 대화록의 새 카드 종류로 그린다. 제안은 대화가 닫힌 뒤에도 남아야 하고 여러 대화에서 같은 문서로
  쌓인다. 기획서 칸의 띠가 그 자리다. 카드 종류는 늘리지 않는다.
- 제안을 세션 메모리에 둔다. 재시작과 다른 대화에서 보여야 하므로 원장이 맞다.
- 판 차이를 Confluence API 로 받는다. REST 의 차이 API 는 실측되지 않았고 데몬이 두 판을 다 갖고 있다.
- `confluence.publish` 가 `expectedVersion` 을 클라이언트에서 받는다. 낡은 번호를 보낼 길이 생긴다. 원장의
  `dirty.baseVersion` 이 정본이다.
- 미결의 코멘트 본문을 원장에 저장한다. 세 번째 사본이 된다. 첫 줄 140자만 색인으로 두고 본문은 열 때 읽는다.

## 부록 C. 위험

| 위험 | 단위 | 지켜볼 것 |
| --- | --- | --- |
| 기본 인증으로 쓰기 권한이 안 나온다 | U1-1 | 사전 검증 1. 안 되면 1단계 쓰기는 OAuth 설계로 되돌아간다 |
| 마크다운 → 저장 포맷 변환이 조직 문서의 모양을 다 못 덮는다 | U1-2 | 거절 이유의 종류를 세어 DEVELOPERS 에 적는다. 거절은 조용히 떨어뜨리는 것보다 낫다 |
| 시간당 요청 예산(65,000 points) | U2-1 | 첫 가져오기가 문서당 요청 셋이다. 160 문서면 480. 예산의 1% 다. 500 문서 상한을 넘기지 않는다 |
| 미결 id 가 불릿 순서에 묶여 끼어드는 불릿에 흔들린다 | U2-1 | 넘긴 항목이 되살아나는 수를 세고, 많으면 글자 해시 id 로 바꾼다(3단계) |
| 제안이 쌓여 띠가 길어진다 | U1-3 | 절마다 최근 것만 펼치고 나머지는 접는다. 30일 지난 `open` 제안은 `stale` 로 바꾼다 |
| 발행 도중 데몬이 죽는다 | U1-4 | 원장 표식이 먼저고 다음 시작이 이어받는다. PUT 뒤 다시 가져오기 전에 죽으면 다음 가져오기가 판을 맞춘다 |
| Codex 세션은 파일 쓰기 울타리가 없다 | U1-3 | 공통 규칙의 구절이 유일한 막이다. Codex 가 기획서 파일을 고친 경우 가져오기가 덮어쓰지 않는 dirty 규칙 때문에 사람의 고침으로 보일 수 있다. dirty 는 데몬이 적은 절만 포함하므로 Codex 의 직접 고침은 다음 가져오기가 덮어쓴다 |
| 두 기획자가 같은 절을 고친다 | U1-4 | 판 충돌 창이 받는다. 문서 단위 잠금 표시는 3단계다 |

## 부록 D. 읽을거리

- `docs/DEVELOPERS.md` 의 「기획서 동기화」 「전체 구조」 「자동 보관 · 제출 · 반영됨」 「AI 의 울타리」 「사용자
  문장의 규칙」 「테스트」.
- `docs/GUIDE.md` 의 「기획서」 「설정 · 여섯 쪽」 「상태 줄」.
- `docs/confluence-sync-plan-2026-10-18.md` · `docs/confluence-sync-design-2026-10-18.md`.
- `packages/web/src/next/README.md` 의 「오른쪽 칸은 두 얼굴이다」 「칸의 계약」 「순수 판정」.
- `packages/daemon/src/{confluence-sync,confluence-ledger,confluence-markdown,confluence-client}.ts` 와
  `browser-tools.ts` 의 `screen_files` · `describe_changes`, `write-guard.ts` 의 `plansFolderTarget`,
  `command-dedupe.ts`, `repo-publish.ts` 의 표식 규칙.
- `packages/protocol/src/turn-marker.ts` 의 `BriefMarker` 와 `readTurn` 의 허용 목록.
- 메모리의 조직 관례(2026-10-13)와 공유 작업 트리 메모(2026-10-19).

## 출처

- 권고와 그림. 「ColoNova Design 의 다음 · 그림으로 보는 발전 방향」(Claude Docs, 2026-10-19).
- 사용자 결정. 양방향(2026-10-17) · 분석 보류(2026-10-18) · 기획서 폴더 읽기 전용과 쓰기 가드(2026-10-18 ·
  2026-10-19) · 삭제 요구(2026-10-19).
- 측정. `git ls-files --exclude-standard` 의 제외 폴더(2026-10-19 임시 저장소). `turn-marker.ts` 의 purpose
  허용 목록과 `markTurn` 의 호출 자리(2026-10-19 코드 읽기). `vocab-sweep` · `next-labels` 의 금칙어 목록
  (2026-10-19 코드 읽기). 조직 문서 수치(2026-10-17 미러 측정).
- 선례. `screen_files` 도구와 op 처리기, `describe_changes` 의 세션 메모, 연결 준비 브리프, `repo-publish.ts`
  의 표식 먼저 규칙, `cycle.json` 원장의 이어받기.
