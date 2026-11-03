# 재생 벤치

화면 작업의 효과를 숫자로 재는 스크립트다. 데몬에 WebSocket 으로 붙어 시나리오
(사람의 말 또는 핀 턴)를 실제 세션으로 돌리고, 턴 통계와 바뀐 파일에서 통과
여부를 판정해 결과 파일로 남긴다. 새 의존성은 없다 — Node 22 의 전역
`WebSocket` 과 `node:child_process`, `node:test` 만 쓴다.

## 전제

- 데스크톱 개발 실행이 접속 파일을 쓰게 한다 — 이 파일이 데몬의 ws 주소를
  적어 둔다(패키징된 앱은 절대 쓰지 않는다):

  ```bash
  COLONOVA_DESIGN_BENCH_ENDPOINT=/tmp/colonova-bench.json pnpm dev:desktop
  ```

  대신 독립 데몬(`pnpm dev:daemon`)을 쓸 때는 인쇄되는 `client url` 을
  `--url` 로 직접 건다.
- 대상 프로젝트가 이미 등록돼 있고(초대 파일), 클론이 준비돼 있어야 한다.
  벤치는 `project.activate` 를 부를 뿐 준비를 기다리지 않는다.

## 돌리기

```bash
# fixture 앱(한 파일 server.js) — 원격에 작업 가지가 올라가는 것을 확인했으면 --yes
node scripts/bench/bench.mjs run \
  --endpoint /tmp/colonova-bench.json \
  --project colonova-beta-fixture \
  --scenarios scripts/bench/scenarios/fixture.json \
  --provider claude --model opus --effort high \
  --label before

# CDS 레포 — fixture 가 아니면 --yes 가 필요하다(원격에 작업 가지가 올라간다)
node scripts/bench/bench.mjs run \
  --endpoint /tmp/colonova-bench.json \
  --project cds-design-second-repo \
  --scenarios scripts/bench/scenarios/cds.json \
  --label before --yes
```

| 인자 | 뜻 |
|---|---|
| `--endpoint <파일>` | dev:desktop 이 적어 둔 접속 파일(`--url` 과 둘 중 하나 필수) |
| `--url <ws 주소>` | `ws://127.0.0.1:<포트>/?token=<토큰>` 꼴을 직접 건다 |
| `--project <slug>` | 프로젝트 — 필수. `colonova-beta-fixture` 가 아니면 `--yes` 를 요한다 |
| `--scenarios <파일>` | 시나리오 JSON — 필수 |
| `--provider` · `--model` · `--effort` | `session.create` 에 그대로 실린다(없으면 데몬 기본값) |
| `--label <이름>` | 결과 파일 꼬리표(기본 `run`) |
| `--only <id,id>` | 이 id 의 시나리오만 |
| `--repeat <N>` | 시나리오마다 N번(비교는 중앙값으로 접는다) |
| `--yes` | 안전 확인 건너뛰기 |

시나리오 하나의 한 바퀴: `project.activate`(시작에 한 번) → `git rev-parse
HEAD` 로 시작점 → `session.create` → `session.send`(핀 시나리오는
`lib.mjs` 가 만든 표식 턴과 `pins` · `pinHints`) → 턴 통계 파일을 2초마다
읽어 끝을 판정(턴 행이 내려오면 끝 — 상한 15분. gateset 행은 옛 게이트 기록에만
있고 `reopened` 면 턴 하나를 더 기다린다) →
자동 보관 대기(HEAD 가 움직이거나 20초) → 바뀐 파일 판정 → `session.close`.

## 결과와 비교

결과는 `bench-results/<YYYYMMDD-HHmm>-<label>.json` 에 쌓인다(루트
`.gitignore` 에 들어 있다). `run` 이 끝나면 시나리오마다 통과 · 총 시간 · 첫
편집까지 · 컨텍스트 · exec · 비용 · 캐시 적중률의 표를 찍는다. browser ·
browserMs · 게이트 재개 칸은 옛 기록(2026-10-20 내장 게이트 · 브라우저 도구
제거 전)을 읽을 때만 값이 있다. 비용은 턴 행의 `costUsd`(정가 기준 추정, Claude 만 —
구독에서는 일의 양을 재는 눈금이지 청구서가 아니다)의 합이고, 캐시는 입력 전체
가운데 캐시에서 읽은 몫이다. 프로바이더가 알려 주지 않은 실행은 `-` 다.

```bash
node scripts/bench/bench.mjs compare bench-results/…-before.json bench-results/…-after.json
```

`compare` 는 같은 id 끼리 같은 칸의 중앙값(`--repeat` 이 쌓은 여러 행을
젶는다)과 총 시간 · 비용의 변화율, 통과 수를 나란히 찍는다. 한쪽에만 있는 id 도
행으로 남는다. 모델 · 노력 · 지침을 바꾼 앞뒤를 "같은 통과 수에 더 싸게"로 읽는
자리이기도 하다 — 한 번의 실행은 요동이 크니 `--repeat 3` 이상의 중앙값으로 본다.

## 1층 채점 — 닿을 문서 고르기(2026-11-03 · A안 0-2)

데몬 없이 도는 별도 명령이다. 정답표(`compare-sheet.json`)의 화면 요청마다 데몬의
`syncTargets` 를 1층 바닥 재료(근거 없음 · 요청의 화면 주소 · 연결 표)로 돌려, 기대 문서가
대상에 들었는지 센다 — 놓침 n/20 이 C1 개방의 재료다.

```bash
# 정답표의 견본 연결 표(links)로 잰다 — pageId 가 없어도 돈다
node scripts/bench/bench.mjs targets --sheet scripts/bench/compare-sheet.json

# 실측 — 견본 프로젝트 클론의 plans-map.json 으로 잰다(docs[].pageId 를 먼저 채운다)
node scripts/bench/bench.mjs targets --sheet scripts/bench/compare-sheet.json \
  --links ~/.colonova-design/projects/<slug>/repo/plans-map.json --out -
```

끝에 두 줄이 선다 — «놓침 n/20 · id 목록»은 기대 문서(doc)가 있는데 대상에 없는 요청,
«잘못 닿음 m/20 · id 목록»은 기대에 없는 문서가 대상에 든 요청(doc: null 요청에 문서가
골라진 것 포함)이다. 한 요청이 두 줄에 함께 설 수 있다. `--out` 은
`{ total, hit, missed, extra }` 를 JSON 으로 남긴다.

`run` 의 끝 줄 `흔들림 n` — `--repeat` 으로 같은 compare · suggest 시나리오를 여러 번
돈 결과에서, 짚은 절 묶음이 첫 회와 달라진 회 수다(판정의 재현성). 절을 읽지 못한
회는 세지 않는다.

## 시나리오 파일

배열 하나다. 네 종류가 있다 — user · pin 은 세션을 돌리고, compare · suggest 는
세션 없이 초안 작업만 부른다:

```json
[
  { "id": "search", "kind": "user",
    "text": "공지 화면에 제목으로 거르는 검색창을 넣어 줘.",
    "expect": { "files": ["server.js"], "contains": ["<input"] } },

  { "id": "pin-title", "kind": "pin",
    "note": "제목을 더 크게 해 줘",
    "pins": [{ "screen": "list", "text": "회원 목록" }],
    "expect": { "files": ["server.js"] } },

  { "id": "compare-signup", "kind": "compare", "pageId": "12345",
    "expect": { "sections": ["비밀번호 규칙", "휴면 전환"] } },

  { "id": "suggest-signup", "kind": "suggest", "pageId": "12345",
    "brief": "비밀번호 규칙을 8자 이상으로 낮춰 줘",
    "expect": { "sections": ["비밀번호 규칙"] } }
]
```

- `expect.files` 의 각 항목은 바뀐 파일 경로(레포 루트 상대)의 **부분
  문자열**이다 — `src/screens/member/` 처럼 폴더를 겨눠도 된다.
- `expect.contains` 는 바뀐 파일 어느 하나의 지금 내용에 있어야 할 문장이다
  (생략 가능).
- 판정에 턴 오류가 더해진다 — 마지막 턴 행의 `isError` 가 참이면 실패다.
- 핀의 `screen` 은 미리보기 주소창의 경로(앞 슬래시 없는 id, 루트는
  `index`)다. `pins` · `pinHints` 는 웹의 핀 턴(`pinsToTurn`)과 같은 모양의
  표식 턴으로 실린다 — 마커의 `items[].id` 와 `pinHints[].id` 가 같아서
  데몬의 파일 후보 강화가 붙는다.
- compare · suggest 의 `expect.sections` 는 답의 어긋남 줄이 짚어야 할 절이다 —
  정답표(compare-sheet.json)의 절 이름과 같아야 한다. compare 는 `draft.compare`
  의 답을, suggest 는 초안을 열고(`draft.open`) `draft.ask` 로 보낸 말의 답 어긋남
  줄을 견준다 — suggest 의 시간은 생성과 판정을 합친 총 시간이다. suggest 는
  끝나면 흔적을 걷는다 — 새로 연 초안은 버리고, 원래 있던 초안은 보내기 전 개정으로
  되돌리고, 벤치가 만든 기획 대화는 지운다.

저장소에 둘레가 마련돼 있다 — `scenarios/fixture.json`(colonova-beta-fixture 의
7개) · `scenarios/cds.json`(CDS 레포의 5개, 실제 화면 폴더에 맞춰 뒀다) ·
`scenarios/compare.json` · `scenarios/suggest.json`(견본 각 한 편 — 실측 전에
pageId 를 채운다).

## 시험

`pnpm test` 가 `scripts/bench/*.test.mjs` 를 함께 돌린다 — 순수 함수(시나리오
검증 · 핀 턴 · 행 모으기 · 끝 판정 · 판정 · 1층 채점 · 흔들림 · 요약 · 비교)의
시험이다. 데몬이나 미리보기를 부르지 않는다 — 다만 데몬의 `dist` 는 읽는다(1층
채점이 `syncTargets` 를 가져다 쓴다) 빌드 뒤에 돈다.

## 주의

- 벤치는 실제 세션을 돌린다 — 구독이 타고, 클론에 커밋이 쌓이고, `--yes` 로
  돌린 프로젝트의 원격에 작업 가지가 올라간다. 되돌리기는 결과 파일의
  `startSha` 가 기준이다(자동 되돌리기는 없다).
- 턴 통계 파일은 7일 보존이다 — 결과 파일에 턴 행이 통째로 들어가므로 비교는
  결과 파일끼리 하면 오래간다.
- 접속 파일(`COLONOVA_DESIGN_BENCH_ENDPOINT`)에는 그 실행의 토큰이 들어 있다.
  임시 폴더에 적게 하고 앱을 끄면 데몬이 지운다.
