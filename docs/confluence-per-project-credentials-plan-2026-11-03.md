# 프로젝트별 Confluence 자격 — 2026-11-03 결정과 구현

프로젝트(레포)마다 서로 다른 Confluence 계정을 한 머신에서 함께 쓴다(2026-11-03 사용자 결정).
같은 날 대화에서 확인한 걸림돌에서 출발한다 — 사이트 · 뿌리는 이미 프로젝트별(machine.json 의
`confluenceSite:<slug>` 등)이었지만 자격(이메일+토큰)은 머신 전역 한 항목(`confluence-pat`)이라,
둘째 프로젝트를 다른 계정으로 연결하면 첫 연결의 자격을 덮어써 첫 프로젝트가 401 만료로
내려앉았다. 설정 화면도 활성 프로젝트의 연결을 다루면서 누구의 연결인지는 말하지 않았다.

같은 날 사용자가 범위를 정했다 — 설정은 **활성 프로젝트 중심**(전체 프로젝트 연결 판 아님),
계정 표시는 **가려진 이메일 보여주기**(「자격은 요약에 절대 실리지 않는다」 원칙의 유일한 예외).

## 구조

- **자격 아이템** — OS 저장소에서 프로젝트 아이템 `confluence-pat:<slug>` 가 머신 기본
  `confluence-pat` 보다 앞선다(`loadConfluenceCredentials(store, env, slug?)` · 순서는 env 오버라이드 >
  슬러그 > 기본). GitHub PAT 가 `pat:<slug>` 에서 `pat` 로 통합된 것의 반대 방향 규약이다.
- **저장과 승격** — connect 가 이메일·토큰을 받으면 그 프로젝트 아이템에 쓴다(`saveConfluenceCredential`).
  머신 기본이 비어 있으면 첫 자격을 기본에도 올린다 — 같은 계정을 쓰는 둘째 프로젝트는 이메일·토큰
  없이 연결해 기본을 물려받는다. 기본이 찬 뒤의 프로젝트별 자격은 기본을 건드리지 않는다.
- **계정 표시** — connect 가 가려진 이메일(`i***@company.com` · `maskEmail`)을 machine.json 의
  `confluenceAccount:<slug>` 키에 쓰고, 요약(ProjectSummary.confluence 의 선택 필드 `account`)이 그대로
  싣는다. 동기로 도는 요약이 비동기 자격 저장소를 건너게 하려는 자리다. 원문 이메일 · 토큰은 여전히
  자격 저장소 밖으로 나가지 않는다. 프로토콜 판은 그대로(선택 필드).
- **시작 백필** — `backfillConfluenceAccounts`(server start)가 사이트 키는 있는데 계정 키가 없는
  프로젝트에 저장된 자격의 가려진 이메일을 채운다. 이 결정 전에 연결한 기계도 재연결 없이 계정 줄을 본다.
- **설정 화면** — 기획서 칸(설정 → 연결)은 계속 활성 프로젝트의 것이다. 알약 곁에 프로젝트 이름 칩,
  연결이 서면 `계정` 줄(가려진 이메일), 자격 문구는 「이 프로젝트의 자격으로 저장해요」로 바꿨다.
  `<ConfluenceConnect key={activeSlug}>` 로 프로젝트를 바꾸면 판이 새로 선다 — 설정이 열린 채
  프로젝트를 바꿀 때 옛 프로젝트의 사이트 · 연결 상태가 남던 잠복 결함도 같이 걷혔다.
- **읽는 곳** — 자격을 읽는 호출처(confluence-sync · doc-meta · doc-ops · doc-comments ·
  draft-service · requests/confluence)는 전부 slug 를 알고 있었으므로 시그니처만 넓혔다.

## 완료 기준과 남은 것

- 시험(순수) — `confluence-connect.test.ts`(프로젝트별 자격 분리 · 첫 자격 승격 · 읽기 순서 ·
  maskEmail · 백필) · `project-fleet-confluence.test.ts`(account 배선) ·
  `next-confluence-connect.test.ts`(계정 줄 · 칩 · 리마운트 소스 계약). 2026-11-03 통과.
- 눈 검증 — `pnpm dev:desktop` 으로 계정 줄 · 프로젝트 칩 · 프로젝트 전환의 판 리셋 · 같은 계정
  재연결을 본다. **서로 다른 두 계정 시나리오(프로젝트1 → CONFLUENCE1 · 프로젝트2 → CONFLUENCE2)는
  실제 두 사이트가 있는 환경에서 아직 보지 않았다** — 사용자의 몫으로 남아 있다.
