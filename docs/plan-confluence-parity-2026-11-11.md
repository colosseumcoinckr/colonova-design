# 기획서 Confluence 기능 대조와 검토·발행 개선 — 2026-11-11

공식 문서 조사(§2) · 기능 대조(§3) · 이번 구현 범위(§7) · 검증 상태(§9)를 한 데 둔다. 검증 결과는
최종 결과가 오면 「검증 상태」에 갱신한다.

## 1. 확정 요구(2026-11-11 사용자 확정)

- 기획서 탭은 Confluence 가 원본 저장소다.
- Confluence 의 모든 기능을 제공하되 앱 쪽이 더 편해야 한다.
- 직접 고침 · AI 고침 · 화면에서 돌아온 고침 — 문서 수정은 모두 초안에 보관하고, 사람이 발행해야
  원본에 반영된다.
- 「단순히 Confluence 에서 열기」는 동등 지원으로 세지 않는다.
- 이 문서는 기능 전체 parity 완료를 주장하지 않는다. 대표 영역과 추가 조사 범위를 구분한다.

## 2. 조사 방법과 범위

- 공식 문서 6쪽을 2026-11-11 실제 조회했다:
  1. [만들기 · 초안 · 발행 · 판 기록 · 미발행 변경](https://support.atlassian.com/confluence-cloud/docs/create-edit-and-publish-a-page/)
  2. [콘텐츠 종류 · 서식 · 표 · 매크로 · 템플릿 · Rovo · 승인 · 가져오기](https://support.atlassian.com/confluence-cloud/docs/create-and-edit-content/)
  3. [미디어 형식 · 삽입 · 크기 · 캡션 · 파일 보기](https://support.atlassian.com/confluence-cloud/docs/work-with-images-videos-and-files/)
  4. [단축키 · 슬래시 명령 · 자동완성 · 마크다운](https://support.atlassian.com/confluence-cloud/docs/keyboard-shortcuts-markdown-and-autocomplete/)
  5. [권한 세 층 · 콘텐츠 제한](https://support.atlassian.com/confluence-cloud/docs/what-are-confluence-cloud-permissions-and-restrictions/)
  6. [live docs · 공동 편집 · 공유 · 판](https://support.atlassian.com/confluence-cloud/docs/create-and-collaborate-in-real-time-with-live-docs/)
- **대표 영역**은 위 여섯 쪽이 다루는 범위다. **추가 조사 범위**(공식 문서의 다른 쪽 — 아직 읽지
  않음): 승인(approvals) 상세 · 분류·민감정보 가리기(redaction) · 오프라인 편집 · 차트 · 슬라이드 · Rovo · 전역 권한과
  관리자 · 알림(watch) 상세 · Marketplace 앱 · 내보내기/가져오기 상세.
- 실사이트 검증은 이번 조사에서 하지 않는다. 앱 동작의 근거는 코드 경로이고, 실사이트 재현은
  미검증으로 적는다.

## 3. 기능 대조표

판정: **지원**(앱이 같은 목적을 한다) / **부분**(일부만) / **미지원**(없다) / **미검증**(실사이트
동작 확인 전). 경로는 근거 위치다.

| 영역 | Confluence(공식 문서) | 앱 현황 — 코드 경로 | 판정 |
| --- | --- | --- | --- |
| 문서 · 폴더 트리 | 콘텐츠 트리(모든 종류) · 드래그 이동 · 곳곳의 만들기 단추 | 폴더 계층 읽기 · 접기 · 빈 폴더 · Confluence 전용 흐린 줄 — whiteboard/database/embed 는 아래를 읽고 파일은 안 만든다(`confluence-sync.ts` walkChildren · ledger `unsupported`) · 이동은 창(`doc-ops.ts` doc.move) | 부분 — Smart Link · slide · live doc 이 트리에 어떤 type 으로 오는지 미검증 |
| 검색 | 사이트 전체 검색 · CQL | 로컬 사본 제목 · 폴더 · 초성 · 본문(두 글자 이상)(`requests/confluence.ts` doc.search) · 원격 CQL 은 기준 페이지 찾기와 URL pageId 뽑기만(`confluenceSuggestRoots` · `pageIdFromQuery`) | 부분 — 범위는 마지막 가져오기 시점 사본 |
| 기본 편집 | 편집기(도구 모음 · 슬래시 · 마크다운 · 붙여넣기) | 블록 투영 편집 — 좁은 마크다운(굵게 · 기울임 · 코드 · 링크 · 줄바꿈)(`storage-blocks.ts` projectBlock · `DraftEditor.tsx`) | 부분 |
| 서식 | 색 · 정렬 · 하이라이트 · 위첨자 · 기준선 등 전체 | 위의 좁은 표현만 새로 쓰고 나머지는 원문 바이트 보존 | 부분 |
| 표 | 표 편집 전체(병합 포함) | 셀 편집 · 행·열 더하기/빼기 — 병합 셀 표는 읽기만(보존 경계) | 부분 |
| 매크로 · 요소 삽입 | 슬래시 명령 · 매크로 · 멘션 · 이모지 · 상태 · 날짜 · 할 일 · 목차 삽입 | 새 삽입 없음 — 읽기 렌더는 info/note/warning/tip/panel/expand/code/toc/status 등(`confluence-view.ts`) · 나머지는 `Confluence 전용` 자리표시 · 보존 토큰 `⟦…⟧`로 원문 유지 | 미지원(삽입) · 읽기 부분 |
| 첨부 | 업로드(도구 모음 · /image · 드래그) · 관리 | 목록 · 내려받기만(`confluence-client.ts` listAttachments · downloadAttachment — 10MB · 60초 캐시) | 부분(읽기만) — 업로드는 후속이고 확정 원칙(초안 → 사람 발행)에 맞춘다(§8) |
| 그림 | 삽입 · 크기 · 캡션 · 정렬 · 대체 텍스트 | 읽기만 — 계정으로 받아 그림 · 크게 보기 · svg 칩 | 부분(읽기만) |
| 템플릿 | 템플릿 패널 · 가져오기 · 변환 | 없음 — 새 문서 밑그림은 기존 문서 하나 | 미지원 |
| 초안 | 편집기 자동저장 초안 · 공유 가능 · Close draft · 삭제 | 로컬 초안(`plans/drafts` — 개정 스냅숏 · 버리기 · 잠금) — 공유 · 실시간 없음 | 다른 방식(§4 정책 기록) |
| 발행 | Publish 모달(위치 · 접근 · 판 메모) · 예약 발행 · 블로그로 발행 | 확인 창(대상 · 점검 · 전후 보기 · 단계 표기) · 쓰기 게이트 · 의도 기록 + 조건부 갱신(`draft-publish.ts`) — 예약 · 블로그 전환 없음 | 부분 |
| 미발행 변경 | 배지 · View changes · 되돌림으로 버리기 | `아직 발행 전` 알약 · 전후 보기 · 초안 버리기 | 지원(이름만 다르다) |
| 판 기록 · 비교 · 복원 | 전체 판 기록 · 판 비교 · 복원 · 판 삭제(영구) | 최근 50 읽기 · 옛 판 읽기 · 초안↔발행본 견주기 · 초안 개정 복원 — Confluence 판 복원 · 판 삭제 · 판 간 비교 없음 | 부분 |
| 복제 · 이동 | 트리 드래그 · 공간 간 이동 | 창에서 복제 · 이동(`doc-ops.ts` — 들어갈 자리는 원장 범위 안) | 부분 — 공간 간 이동은 `out-of-scope` |
| 휴지통 · 보관 | 휴지통 · 복구 · 보관(archive) | 휴지통(v2 DELETE) · 복구(이 앱이 옮긴 것만 · `status: current`) — 영구 삭제는 만들지 않는다(의도) · archive 없음 | 부분 |
| 댓글 | 바닥글/인라인 · 답글 · 해결 · 서식/멘션 코멘트 | 읽기(안 풀린 것 · 닻 · 답글 들여쓰기) + 쓰기(만들기 · 답글 · 맨 글 고치기 · 해결)(`doc-comments.ts`) — 서식 · 멘션 코멘트는 Confluence 에서 | 부분 — 직접 원격 쓰기(§4) |
| 라벨 | Details 패널 · 검색 | 더하기/빼기(`doc-meta.ts` — v1 label 길 · 금칙 문자 · 255자 · 소문자화) — 라벨 검색 없음 | 부분 — 직접 원격 쓰기(§4) |
| 공유 · 권한 | Share 대화상자 · 콘텐츠 제한(보기/편집) · 공간 권한 | 권한 판정만 — pageOperations 로 update/create 을 보고 `no-permission` 으로 막는다(`draft-publish.ts` · `doc-ops.ts`) · 제한 읽기/설정 · 공유 없음 | 미지원(판정만) |
| 공동 편집 | 29명(페이지) · 40명(live doc) 실시간 | 없음 — 다른 창 · 대화의 동시 수정은 개정 대조로 보호(`draft.stale` · `withLock`) | 미지원(§4 정책) |
| 알림 · 즐겨찾기 | watch 설정 · star · 알림 | 없음 | 미지원 |
| live doc · whiteboard · database · blog · Smart Link · slide | 콘텐츠 종류 전체 | whiteboard · database · embed 는 흐린 줄 표시 — 코드 확인(`confluence-sync.ts` walkChildren · ledger `unsupported` — 아래를 읽고 파일은 없음) · live doc · blog · Smart Link · slide 의 표시 방식은 미검증 | 미지원 — live doc 생성 · 전환 · 공동 편집 구현 없음(코드 확인) |
| 내보내기 · 가져오기 | PDF/Word 내보내기 · 외부 문서 가져오기 | 없음(파생 마크다운은 로컬 참고 사본) | 미지원 |
| 단축키 · 자동완성 | 편집기 단축키 체계 · 슬래시 · `@` `:` `{` | 앱 자체 손맛(제자리 편집 ⌘/Ctrl+Enter · 마크다운 길) — Confluence 단축키 호환이 아니다 | 유사(별개) |
| 승인 · 상태 · 분류 · 소유권 · 오프라인 | 공식 기능(추가 조사 범위) | 없음 — 오프라인 편집은 로컬 초안이 부분 대신한다 | 미지원/유사 — 공식 문서 별쪽 미조회 |

## 4. 정책 기록 — 같은 이름, 다른 구조

- **로컬 초안 ≠ Confluence 공동 초안.** Confluence 초안은 편집기의 자동저장이며 공유 조건을 만족하면
  다른 사람이 본다. 앱 초안은 이 컴퓨터 `plans/` 에만 살고 공유 길이 없다 — 2026-11-11 확정 원칙
  (모든 수정은 초안 보관 → 사람 발행)과 일치하는 설계다. 팀원이 Confluence 에서 고치는 중이면
  `remote-draft` 막는 이유가 발행을 늦춘다(`confluence-client.ts` readDraft → `draft-publish.ts`).
- **Live docs.** 발행 없이 즉시 모두에게 보인다 — 사용자의 초안→발행 정책과 방향이 반대다. 앱에는
  live doc 전용 생성 · 전환 · 공동 편집이 없다(코드 확인). 기존 페이지 읽기 경로에서 어떻게
  표시되는지 — 실제 API type 명과 트리 · 본문 표시 여부 — 는 실측 전이라 미검증이다. 지원을 논할
  때는 「즉시 반영 구간을 초안 정책의 어디에 둘지」를 먼저 정해야 한다 — 별도 설계 사안이다.
- **댓글 · 라벨 · 이동 · 삭제는 지금 직접 원격 쓰기다.** 각자 commandId 기록 · 쓰기 게이트 · 막는
  이유를 갖추고 있지만(`doc-comments.ts` · `doc-meta.ts` · `doc-ops.ts`) 본문 발행(`draft-publish.ts`
  의 의도 기록 + 조건부 갱신)과 같은 트랜잭션이 아니다 — 같은 트랜잭션으로 오해하면 안 된다. 확정
  원칙과의 일치는 다음 결정 사안이며 이번 변경에서 동작을 바꾸지 않는다.

## 5. 실앱 관찰(루트 · 2026-11-11 · 읽기 한정)

루트가 실행 중인 Electron 앱의 기획서 탭을 실제로 열어 읽었다: 문서 226개 트리가 표시되고, 본문 ·
첨부 · 코멘트 영역이 표시된다. pagetreesearch · children · jira 는 `Confluence 전용` 자리표시다 —
`confluence-view.ts` 의 모르는 매크로 → `macro` 블록 경로와 일치한다. 본문 수정 · 발행은 하지
않았다. **이것은 읽기 관찰이며 UI 개선 뒤의 검증과 별개다.**

## 6. 우선 개선 이유

1. **발행 전 실내용 검토(이번 구현)** — 비개발자가 원본 훼손 불안 없이 발행하려면 무엇이 바뀌는지
   실제 전후로 봐야 한다. 수(고침 N · 새로 N · 지움 N)만으로는 부족했다.
2. **편집 커버리지** — 보존 경계(매크로 블록 · 병합 표 · 중첩 목록 · 정보 상자 내부)에 걸리면
   문서마다 Confluence 왕복이 생긴다.
3. **첨부 · 그림 업로드** — 기획 문서에 증거를 넣는 기본 동작이다. 현재 읽기만이다.
4. **템플릿** — 새 문서 품질의 출발점이다.
5. **원격 검색** — 사본 시점 한계(마지막 가져오기 뒤 변경은 다음 가져오기 뒤)를 해소한다.
6. **정책 일치** — 코멘트 · 라벨 · 문서 관리의 직접 원격 쓰기를 확정 원칙과 맞춘다(결정 대기).

## 7. 이번 구현 범위 — 초안 → 검토 → 사람 발행

코드는 2026-11-11 시점 기준으로 읽었다. 최종 검증 결과가 오면 이 절과 관련 문서의 상태를 맞춘다.

- **수정 전후 보기(공유)** — 편집기 견주기와 발행 확인 창이 `draftChangeRows` 하나를 쓴다
  (`packages/web/src/next/plans/draft/DraftChanges.tsx` · `change-review-model.ts`). 제목 전후 ·
  블록 전후(고침/새로/지움 · 순서 변경 줄)를 위아래로 견주어 보이고, 기본은 바뀐 곳만,
  `그대로인 내용 N곳도 보기`로 전체 문맥을 펼친다. 삽입·삭제로 밀린 자리는 이동으로 세지 않는다.
  지워지는 보존 조각은 자리표시가 아니라 그 판의 실제 내용으로 보인다 — `DraftBlock` 의 선택
  `preview` 필드(스토리지 보기)와 `DocPreview` 재사용; 모르는 매크로는 기존 `Confluence 전용 · 종류`
  표시 한계를 유지한다.
- **발행 창의 실내용 확인** — `PublishDialog.tsx` 가 검토 자료를 읽어 확인 창에 DraftChanges 를
  띄운다.
- **읽기 실패 재시도** — 검토 자료(preview · 기준 판 · 초안) 읽기 실패 시 창에서 다시 시도한다.
- **개정 · 기준 불일치 감지** — `loadPublishReview`(`publish-review.ts`)가 docKey · 개정 · 기준 판
  일치를 검사하고 어긋나면 `drafts.publishReviewChanged` 로 발행 대상에서 내보낸다. 발행 명령은
  `expectedRevision` 대조로 다시 검사한다(`draft-publish.ts` publish).
- **초안으로 돌아가기** — 확인 창의 닫기 단추(`drafts.backToDraft`). 초안 보관은 그대로다.
- **초안 보관과 발행 안내** — `drafts.draftOnlyNote` · `drafts.publishSub` 문장이 보관과 반영의
  경계를 말한다.
- 사용자 문장은 `labels.ts` 의 `L.drafts` 에 있다(publishReviewChanged · backToDraft · reviewAgain ·
  previewVersions 등).

## 8. 후속 구현 순서(파일 단위)

순서는 §6 의 이유를 따른다. 정책이 필요한 항목은 이미 확정된 원칙(§1 · §4)에 맞춘다.

1. **검토·발행 흐름 마무리(이번)** — 위 7의 파일들. 시험은 tests/fixture 담당의 몫이다.
2. **첨부 · 그림 업로드** — 확정 원칙을 따른다: 업로드도 초안에 남기고 발행 때 원본에 반영한다.
   `confluence-client.ts`(첨부 POST 길) · 초안에 첨부를 두는 저장 설계(`draft-store.ts`) ·
   `DraftEditor.tsx`.
3. **템플릿** — 템플릿 목록 읽기(동기화 쪽) · 새 문서 창에 밑그림 선택 확장. 설계: 템플릿 출처
   (공간 템플릿 API 후보).
4. **원격 검색** — `requests/confluence.ts` doc.search 에 CQL 본문 검색(`confluence-client.ts`
   searchPages 확장) — 검색 범위는 연결 범위(기준 페이지 하부)를 따른다.
5. **코멘트 · 라벨 · 문서 관리의 정책 일치** — 지금의 직접 원격 쓰기 차이는 §4 대로 명시를 유지하고,
   일치시키는 설계는 후속이다(동작 임의 변경 금지).
6. **편집 커버리지 확대** — `storage-blocks.ts` 보존 경계(병합 표 셀 · 중첩 목록 · 매크로 블록의
   투영) — G2 실측 뒤.
7. **live doc · whiteboard · database 읽기** — §4 live docs 정책 설계가 먼저다.

## 9. 검증 상태(2026-11-11 — 루트 보고)

- **전체 검사 통과(최종 · 루트 보고 2026-11-11)** — `pnpm typecheck` 전체 pass · `pnpm test`(전체
  빌드 포함, `/tmp/colonova-logs/test2.log`) 2982 total · 2977 pass · 0 fail · 5 skip(기존 환경
  의존) · `pnpm build`.
- **루트 fixture 브라우저(눈 검증) 통과** — 발행 검토 읽기 실패 → `다시 시도`로 ready · 검토 도중
  초안이 바뀐 경우(stale)는 발행 잠김 · `초안으로 돌아가기`/Esc 종료 뒤 초안 유지 · `not-applied` →
  `최신 내용 다시 확인` → 재발행 뒤 창 닫힘 · 320px/1280px 에서 전후 내용과 단추 유지. Sol 의 보존
  블록 수정 뒤 재확인 — 발행 검토의 삭제된 정보 상자가 실제 발행본 문장으로 표시 · `그대로인 내용`
  토글 표시 · 320px 모달 폭 280(스크롤 넘침 없음 · 단추 화면 안) · 비교 읽기 실패 → 재시도 성공 ·
  발행 실패 → `최신 내용 다시 확인` → ready · 새 문서 초안은 전체 추가로 표시하고 돌아가기 확인.
- **실제 Confluence 원격 발행은 하지 않았다 — 실사이트 실측은 전부 미검증.** 기존 G0–G5(앱 자격 ·
  폴더 아래 CQL 증분 · 원격 미발행 초안 판정 · 휴지통 복구 갱신 · 인라인 닻 · 답글 목록)에 더해 이번
  흐름의 실사이트 확인이 남는다.
- **보존 블록 삭제 렌더의 수정(Sol) — 완료 · 검증 통과.** `DraftBlock` 의 선택 `preview` 필드(스토리지
  보기)와 `DocPreview` 재사용으로 각 판의 보존 블록 실제 내용을 표시한다 — 별도 잠금 · 새 원격 쓰기는
  없다. 회귀 2건 통과(정보 상자 · 병합 표 · 중첩 목록의 삭제와 내용 변경 · 데이터 불변 · 원격 호출 0),
  protocol/daemon 빌드 · web 타입 검사 · 소유 biome 통과. 루트 fixture 추가 — Tab 16회가 모두
  확인 창 안에서 순환하고 Escape 뒤에도 초안이 유지된다. SWE-2 독립 검토 — 각 판의 XML→preview
  혼동 없음 · 새 원격 쓰기 없음 확인.
- **실앱 관찰**(§5)은 읽기 한정 증거다 — 동작 재현이 아니므로 지원 판정의 근거로 쓰지 않는다.

## 10. 발견한 모순과 이번 갱신

- `docs/FEATURES.md` 한눈에 — 「화면에서 바뀐 결정은 이어진 기획서의 초안까지 자동으로 되돌아간다
  (2026-10-30)」는 2026-11-03 A안(판정 → 카드 → 사람이 누름 · AGENTS.md)과 모순이었다. 같은 변경에서
  한 줄 고쳤다.
- `AGENTS.md` 목표 절의 같은 문구(「초안까지 자동」) — 같은 변경에서 고쳤다.
- `docs/GUIDE.md` 발행 절에 이번 검토 흐름(전후 보기 · 재시도 · 개정 금지 · 돌아가기)이 없었다 —
  같은 변경에서 더했다.
- `docs/DEVELOPERS.md` 발행 절에 개정·기준 불일치 감지(`loadPublishReview`)와 공유 전후 보기가 없었다 —
  같은 변경에서 더했다.
- GUIDE 의 「화면을 작업 기록에서 되돌리면 같이 고친 초안도 함께 되돌아간다」는 모순이 **아니다** —
  되돌리기 연동(FEATURES 14.2 🧪)이고 직접 고친 곳은 유지한다. 구분해 둔다.
- 그 밖의 옛 문구(다른 절의 자동 되돌림 표현)는 이번 범위 밖이다 — 광범위 정리는 하지 않았다.
