/**
 * 새 셸(PLAN-UI)의 사용자 문자열 — 전부 여기 한 곳에 산다(U10). `next/` 안의
 * 다른 파일은 한글 리터럴을 쓰지 않고 이 객체를 읽는다; 시험
 * (`test/next-labels.test.ts`)이 그 규칙과 금칙어를 함께 지킨다.
 *
 * 기준은 목업 `mockups/redesign.html` 의 문장이다 — 여기서 다듬지 말고 목업을
 * 먼저 고친다. 숫자가 붙는 문장은 부르는 자리에서 잇지 않고 여기의 함수로 만든다.
 *
 * 단계마다 자기 칸이 있다. 각 단계는 자기 칸의 끝에만 더해 병합이 겹치지 않게
 * 한다 — 칸 사이의 빈 줄 셋은 그 완충이다.
 */
import type { DocOpKind } from "@colonova-design/protocol";

// biome-ignore format: 단계 칸 사이의 빈 줄 셋이 병합의 완충이다 — 포매터가 한 줄로 접지 않게 둔다.
export const L = {
  // ── 공통 — U10 어휘 · 문제 문장 · 여정(U2)
  vocab: {
    openSubmitted: "제출한 내용 열기",
    aiFailed: "AI가 답을 못 했어요",
    retry: "다시 시도",
    retriedFive: "조금씩 기다리며 다섯 번 다시 물었어요",
    toolsReady: "필요한 도구 확인됨",
    connectionOk: "연결 정상",
    projectCount: (n: number) => `프로젝트 ${n}개`,
  },
  /** 화면의 문제 문장은 셋이다 — 셋째만 사람의 손이 필요하다. */
  problem: {
    fixing: "AI가 고치는 중이에요",
    notified: "개발자에게 알렸어요",
    blocked: "제출이 멈췄어요",
    blockedBody: "개발자에게 전달됐는지 아직 확인하지 못했어요. 작업은 보관돼 있어요. 아래 내용을 담당자에게 전달해 주세요.",
    /** 인터넷 문제로 막혔을 때 — 담당자 · 개발자를 기다릴 일이 아니다. 데스크톱 알림(copy.ts)과 같은 말. */
    blockedNetwork: "인터넷 연결이 끊겨 멈췄어요. 작업은 보관돼 있고, 연결되면 도구가 다시 제출해요.",
    /** 연결 코드의 권한이 모자라 막혔을 때 — 개발자가 코드의 권한을 고쳐야 한다(새 초대 파일이 풀지 않으므로 그 말은 하지 않는다). 데스크톱 알림(copy.ts)과 같은 말. */
    blockedPermission: "연결 코드의 권한이 모자라요. 작업은 보관돼 있고, 개발자가 코드의 권한을 고치면 도구가 다시 제출해요.",
    copyHelp: "담당자에게 보낼 내용 복사",
    copiedHelp: "복사했어요",
    helpText: (name: string, body: string) => `${name}에서 작업 제출이 멈췄어요. ${body}` ,
    reconnect: "다시 연결이 필요해요",
    fixingPreview: "미리보기가 뜨지 않아 AI가 막힌 곳을 고치고 있어요. 하실 일은 없어요.",
    notifiedSubmit:
      "제출이 막혀 개발자에게 알렸어요. 풀리면 도구가 다시 제출해요 — 지금은 계속 만들어도 돼요.",
    notifiedOther: "AI도 고칠 수 없는 문제라 개발자에게 알렸어요. 풀리면 저절로 이어져요.",
    reconnectInvite:
      "연결 코드가 만료됐어요. 개발자에게 받은 새 초대 파일을 열어 주세요. 대화와 작업은 그대로예요.",
    /** 준비가 연결 코드에서 멈췄을 때(2026-10-20) — AI 에게 넘기지 않고 사람이 초대 파일을 연다. */
    reconnectPackages:
      "서비스를 준비하려면 연결 코드가 필요해요. 개발자에게 받은 초대 파일을 다시 열어 주세요.",
    reconnectLogin: "AI 로그인이 끝났어요. 브라우저에서 한 번만 다시 로그인해 주세요.",
    /** 로그인 단추를 누른 뒤 — 브라우저가 열렸고, 다 마치면 `다시 확인` 을 누르라는 말(단추만 바뀌던 것). */
    loginWaiting: "브라우저에서 로그인을 마치면 다시 확인해요",
    openInvite: "초대 파일 열기",
    loginInBrowser: "브라우저에서 로그인",
    /** `개발자에게 알렸어요` 줄의 ✕ — 같은 문제를 이 탭이 사는 동안 숨긴다. */
    dismiss: "이 문제 알림 닫기",
    /** `AI가 고치는 중` 이 저절로 풀릴 때 — 접히기 전 초록 체크와 함께 선다. */
    fixed: "다 고쳤어요",
    /** 줄에 선 문제 외에 열린 문제가 더 있을 때 줄 끝의 `+N`. */
    more: (n: number) => `+${n}`,
    moreCount: (n: number) => `이 외에 열린 문제가 ${n}개 있어요`,
  },
  /** 여정 세 점(U2) — `제출 전 ─ 개발자 확인 ─ 반영됨`. */
  journey: {
    making: "만드는 중",
    before: "제출 전",
    screensBefore: (n: number) => `제출 전 · 화면 ${n}개`,
    beforeBlocked: "제출 전 · 제출하지 못했어요",
    submittedDone: "제출됨",
    review: "개발자 확인",
    // 열린 요청이 있다는 것만 안다 — 개발자가 실제로 열어 봤는지는 모른다. 아는 만큼만 말한다.
    reviewing: "개발자 확인을 기다려요",
    reviewingComments: (n: number) => `개발자 확인을 기다려요 · 코멘트 ${n}`,
    /**
     * 코멘트가 아직 없는 기다림에 며칠째인지 붙는다(2026-10-07 UX 점검 3단계) — 제출한 날이 1일째, 자정이 지나면 하루씩 는다.
     * 코멘트 변형보다 짧아 상태 줄의 접힘 문턱을 건드리지 않는다.
     */
    reviewingDays: (n: number) => `개발자 확인을 기다려요 · ${n}일째`,
    reviewed: "확인됨",
    merged: "개발자 반영",
    mergedNow: "개발자 반영 완료",
    projectWork: (name: string) => `${name} · 프로젝트 전체 작업`,
    /** 상태 줄에서 프로젝트 이름 옆에 서는 범위의 말 — 폭이 모자라면 이름만 남고, 둘 다 `projectWork` 로 툴팁에 산다. */
    projectScope: "프로젝트 전체 작업",
    openWork: "이번 작업 보기",
    makingRead: "화면을 살펴보는 중",
    makingFile: "화면 파일을 고치는 중",
    makingCheck: "검사를 돌리는 중",
    firstTurnHint: "처음은 몇 분 걸려요",
    /** 여정 단추의 접근 이름 — 시계가 매초 이름을 갈아 놓지 않게 보이는 몸과
       갈라 쓴다. */
    openWorkNow: (point: string) => `이번 작업 보기 · ${point}`,
    /** 보이지 않는 낭독 칸 — 점이 앞으로 오를 때만 한 번 말한다(첫 마운트는 조용하다). */
    nowPoint: (point: string) => `지금은 ${point}`,
  },

  /**
   * 제출 뒤의 시야 — 자동 검사 · 개발자의 확인(2026-10-07 베타 준비 분석 · A2a). 말하는 만큼만 읽은 것이다: 검사를
   * 읽지 못하면(권한이 없는 연결) 이 문장들은 하나도 서지 않는다. 사용자는 `CI` · `체크` 를 읽지 않는다 — 자동 검사다.
   */
  afterSubmit: {
    /** 문제 문장 — AI 가 통과하지 못한 자동 검사를 고치는 중(고치는 동안 하실 일은 없다). */
    fixingChecks: "자동 검사 결과를 확인하고 대화에서 수정을 요청해 주세요.",
    /** 문제 문장 — AI 가 몇 번 고쳐도 통과하지 못해 개발자에게 알렸다. */
    notifiedChecks: "자동 검사 결과를 확인해 주세요. 해결이 어려우면 담당 개발자에게 알려 주세요.",
    /** 여정 — 개발자가 승인했다. 둘째 점은 지나온 점이 되고 셋째 점이 지금이 된다. */
    approved: "개발자가 확인했어요",
    approvedWaiting: "반영을 기다려요",
    /** 이번 작업 팝오버의 검사 줄 — 제출 칸 아래에 한 줄. */
    checkPassing: "자동 검사를 통과했어요",
    checkPending: "자동 검사가 돌고 있어요",
    checkFailing: "자동 검사가 통과하지 못했어요 — 내용을 확인하고 수정을 요청해 주세요",
    /** 대화 카드 — 자동 검사가 통과하지 못해 AI 에게 맡긴 차례. 받은 글(검사 이름 · 출력)은 접혀 있다. */
    cardTitle: "자동 검사",
    cardCount: (n: number) => `검사 ${n}개가 통과하지 못했어요`,
    cardText: "제출한 요청의 자동 검사가 통과하지 못했어요. 내용을 확인하고 대화에서 수정을 요청해 주세요.",
    cardDone: "검사 결과를 확인해 주세요",
  },

  /**
   * 반영된 일(2026-10-08 베타 준비 분석 · A2b) — 제출한 일이 개발자에게 병합된 순간의 보상. 대화 안의 카드 · 홈의 `반영된 일` 묶음 ·
   * 데스크톱 알림(`desktop/src/copy.ts` 의 `mergedTitled`)이 같은 말을 쓴다. 말하는 만큼만 말한다: 제목 · 며칠 · 화면 수를 모르면
   * 그 말이 서지 않는다. 이름 뒤의 조사를 가리지 않으려 `일` 을 붙인다(`firstReady.title` 의 `서비스` 와 같은 까닭).
   */
  landed: {
    head: (title: string) => `‘${title}’ 일이 반영됐어요`,
    headPlain: "제출한 일이 반영됐어요",
    /** 제출부터 며칠 만인가 — 달력으로 센 차이다. 읽는 날이 아니라 제출한 날이 기준이라 `오늘` 이라 하지 않는다. */
    took: (days: number) => (days >= 1 ? `${days}일 만에` : "제출한 날 안에"),
    screens: (n: number) => `화면 ${n}곳`,
    /** 카드의 끝줄 — 반영된 뒤에는 어디서부터 새 작업인지. */
    next: "다음에 만드는 것은 새 작업이에요",
    /** 홈의 묶음 이름 · 제목을 모르는 줄의 이름. */
    fold: "반영된 일",
    untitled: "제출한 일",
  },



  // ── 단계 1 뼈대
  sidebar: {
    brand: "ColoNova Design",
    newConv: "새 대화",
    home: "홈",
    find: "찾기",
    others: "다른 프로젝트",
    convs: "대화",
    toolWorkCount: (n: number) => `도구가 한 일 ${n}`,
    settings: "설정",
    /** 바퀴에 점이 켜져 있을 때의 이름 — 점의 뜻을 낭독과 툴팁이 말한다. */
    settingsUpdate: "설정 · AI 새 버전이 있어요",
    collapse: "사이드바 접기 · ⌘B",
    expand: "사이드바 열기 · ⌘B",
    switchTo: (name: string) => `옮기기 · ${name}`,
    projects: "프로젝트",
    prepareOnFirstOpen: "처음 열 때 준비해요",
    preparing: "준비 중",
    notOpened: "아직 열지 않음",
    waitingAnswer: "답을 기다려요",
    waitingAnswerCount: (n: number) => `답을 기다려요 ${n}`,
    comments: (n: number) => `코멘트 ${n}`,
    aiFailedRetry: "AI가 답을 못 했어요 — 다시 시도할 수 있어요",
    /** 대화 목록의 날짜 머리 — 이 컴퓨터의 달력으로 오늘 · 어제 · 지난 7일 · 그 이전(2026-10-06). */
    groups: { today: "오늘", yesterday: "어제", week: "지난 7일", older: "이전" },
    /** 프로젝트 목록 맨 아래의 두 줄 — 지금 프로젝트의 카드, 새 프로젝트 들이기(2026-10-06). */
    projectInfo: "프로젝트 정보",
    addProject: "초대 파일로 프로젝트 추가…",
    /** `다른 프로젝트` 는 가장 급한 셋만 세운다 — 나머지는 이 줄이 전환기 목록으로 연다(2026-10-06 겹판 조사). */
    moreProjects: (n: number) => `프로젝트 ${n}개 더 보기`,
    /** 맨 위 `새 대화 · 홈 · 찾기` 줄들의 이름 — 대화 목록(`convs`)과 갈리는 내비게이션이다. */
    nav: "바로 가기",
    /**
     * `기획서` 줄 끝의 흐린 글 — 작성 중인 초안 수(2026-10-23 기획자 화면 손질 D5). 답을 기다리는 수(배지)와 달리 급한 일이
     * 아니라 이어 쓸 일이라 배지로 세우지 않는다. 낭독은 `plansDraftsAria` 가 한다.
     */
    plansDrafts: (n: number) => `초안 ${n}`,
    plansDraftsAria: (n: number) => `기획서 · 작성 중인 초안 ${n}개`,
    screen: "화면",
    screenRunning: "화면 · 만드는 중",
  },
  /** 사이클 상태의 한 단어 — 사이드바 · 전환기 · 팔레트가 함께 쓴다. */
  cycle: {
    draft: "제출 전",
    review: "개발자 확인을 기다려요",
    merged: "개발자 반영 완료",
  },
  home: {
    openScreen: "화면 열기",
    guidePlan: "기획서 쓰기",
    guideBuild: "화면 만들기",
    guideShip: "발행 · 제출하기",
    guideLabel: "작업 순서",
    guideAsk: "원하는 변경 말하기",
    guideCheck: "화면 확인하기",
    guideSubmit: "개발자에게 제출하기",
    greet: (name: string) => `${name}님, 무엇을 만들까요?`,
    placeholder: "예: 회원 목록에 이름으로 찾는 검색창을 넣어 줘",
    hint: "그림·문서를 끌어다 놓을 수 있어요. 보내면 새 대화가 열려요.",
    /** 첫 준비가 도는 동안의 안내(2026-10-07 베타 준비 분석 · 첫 5분) — 기다리는 동안 무엇을 해도 되는지, 보낸 말은 어떻게 되는지. */
    hintPreparing: "서비스를 처음 켜는 중이에요 · 먼저 말해 두면 준비가 끝나는 대로 시작해요",
    whichService: "어느 프로젝트에서 만들까요?",
    waiting: "답을 기다려요",
    calm: "기다리는 일이 없어요",
    running: "지금 진행 중",
    /** 개발자 확인을 기다리는 요청의 며칠째 — 오늘 낸 것은 `오늘 제출`, 그 뒤로는 제출한 날이 1일째(2026-10-07). */
    waitingFor: (days: number) => (days >= 1 ? `${days + 1}일째` : "오늘 제출"),
    recent: "방금 있던 일",
    workingTool: (tool: string) => `${tool} 하는 중이에요`,
    working: "작업하는 중이에요",
    untitled: "대화",
    doneFailed: "AI가 답을 못 했어요 — 다시 시도할 수 있어요",
    // 2026-10-04 ux-review: doneArrived 는 inbox.answered 와 같은 문장 — 하나로 쓴다.
    /** 이 프로젝트에서 나눈 최근 대화 — 눌러 이어 한다(2026-10-06 홈 개선). */
    resume: "이어서 하기",
    /** 입력창 아래 시작점 칩 묶음의 이름 — 칩은 보내지 않고 고쳐 쓸 초안만 담는다. */
    startersLabel: "요청 예시 · 누르면 입력창에 담겨요",
    /** 칩마다의 이름과 초안 — `screen` 은 이번 작업이 만진 화면의 이름(모르면 null), `blank` 는 이름을 모를 때 그 자리에 서는 낱말. */
    starters: {
      words: {
        label: "문구 다듬기",
        blank: "화면",
        draft: (screen: string | null) =>
          `${screen ? `‘${screen}’ 화면의` : "화면의"} 문구를 더 쉽고 부드럽게 다듬어 줘`,
      },
      empty: {
        label: "빈 화면 안내",
        blank: "목록",
        draft: (screen: string | null) =>
          screen
            ? `‘${screen}’ 화면에 내용이 없을 때 보여 줄 안내 문구와 버튼을 넣어 줘`
            : "목록이 비어 있을 때 보여 줄 안내 문구와 버튼을 넣어 줘",
      },
      phone: {
        label: "휴대폰에서 확인",
        blank: "화면",
        draft: (screen: string | null) =>
          screen
            ? `‘${screen}’ 화면이 휴대폰 크기에서 깨지는 곳이 없는지 확인하고 고쳐 줘`
            : "휴대폰 크기에서 화면이 깨지는 곳이 없는지 확인하고 고쳐 줘",
      },
      tidy: {
        label: "간격 정리",
        blank: "화면",
        draft: (screen: string | null) =>
          `${screen ? `‘${screen}’ 화면의` : "화면의"} 간격과 정렬을 깔끔하게 정리해 줘`,
      },
    },
    /** 파일을 끌어 홈 위에 올렸을 때 입력창을 덮는 한 줄. */
    dropHere: "여기에 놓으면 첨부돼요",
    // ── 홈의 기획서 묶음(2026-10-23 기획자 화면 손질 D4) — 기획서를 연결한 프로젝트의 홈에만 선다. 작성 중인 초안으로
    // 곧장 돌아가고, 새 문서를 연다. 화면 제작만 쓰는 프로젝트의 홈은 예전과 같다.
    plansTitle: "기획서",
    /** 묶음 머리의 한 줄 — 기준 페이지와 가져온 문서 수(설정의 연결 상태와 같은 숫자). */
    plansScope: (root: string | null, pages: number) =>
      typeof root === "string" && root !== "" ? `${root} · 문서 ${pages}개` : `문서 ${pages}개`,
    plansInProgress: "작성 중인 초안",
    plansNone: "작성 중인 초안이 없어요 — ‘새 문서’ 로 AI 와 함께 기획서를 시작해 보세요",
    /** 셋보다 많을 때의 끝 줄 — 누르면 기획서 목록이 열린다. */
    plansMore: (count: number) => `초안 ${count}개 더 · 기획서에서 보기`,
    draftNewDoc: "새 문서 초안",
    draftChanged: (count: number) => `바뀐 곳 ${count}`,
    draftConflict: "충돌을 골라 주세요",
    // ── 홈 현관(2026-10-23 화면 전면 재설계 §3.6) — 두 시작 카드와 인사 아래 한 줄.
    screenTitle: "화면",
    /** 인사 아래 흐린 한 줄 — 프로젝트 이름(기획서를 연결했으면 기준 페이지 이름까지). */
    where: (project: string, root: string | null) =>
      root ? `${project} · 기획서 ${root}` : project,
    /** `화면` 시작 카드 머리의 한 줄 소개(2026-10-24 QA 13) — 두 카드의 머리를 같은 해부(아이콘 · 이름 · 한 줄 소개 · 오른쪽 단추)로 맞춘다. */
    screenIntro: "원하는 변경을 말하고, 실제 화면에서 확인하세요",
  },
  narrow: {
    chatTab: "대화",
    screenTab: (name: string) => `화면 · ${name}`,
    sendPins: "찍은 곳을 대화에서 보내기",
  },
  toast: {
    switched: (name: string) => `옮겼어요 · ${name} · 미리보기는 보던 자리 그대로예요`,
    switchedPreparing: (name: string) => `옮겼어요 · ${name} · 준비가 계속 돌고 있어요`,
    /** 프로젝트를 못 옮겼을 때 — 사이드바 · 찾기 · 홈이 한 문장을 쓴다(2026-10-06 겹판 조사). */
    switchFailed: "프로젝트로 옮기지 못했어요 — 잠시 뒤 다시 시도해 주세요",
    close: "알림 닫기",
  },
  /**
   * 첫 준비가 끝난 순간(2026-10-07 베타 준비 분석 · 첫 5분) — 서비스가 내 컴퓨터에서 떴다는 첫 `와`. 홈 줄과 토스트가
   * 같은 문장을 쓴다(사용자가 어디에 있든 같은 말). 이름 뒤의 조사를 가리지 않으려 `서비스` 를 붙인다.
   */
  firstReady: {
    title: (name: string) => `‘${name}’ 서비스가 내 컴퓨터에서 떴어요`,
    sub: "이제 말로 시키면 화면이 바뀌어요",
    see: "화면 보기",
  },
  /** 겹판(대화상자) 공용 — `ui/ModalFrame` 이 읽는다. */
  modal: {
    close: "닫기",
  },
  /** 셸의 틀 — 상태 줄 · 좁은 창 · 열 경계. */
  shell: {
    menu: "메뉴 열기",
    chatWidth: "대화 너비",
    sidebarWidth: "사이드바 너비",
    closeMenu: "메뉴 닫기",
    projectMenu: "프로젝트 고르기",
    /** 화면 수를 모를 때(데몬이 아직 화면 목록을 싣지 않음)의 제출 이유. */
    submitReadyAny: "만든 것을 개발자에게 제출해요",
    submitMoreAny: "제출한 뒤로 바뀐 것을 같은 요청에 더해 제출해요",
    commentsArrived: "코멘트가 왔어요",
    /** 열 경계(Splitter)의 접근 값 — 화면 낭독이 폭을 말로 읽는다. */
    pixels: (n: number) => `${n}픽셀`,
    // 2026-10-04 ux-review: 되돌림이 더블클릭 전용이라 접근 이름에 힌트를 붙인다.
    chatWidthReset: "Enter 누르면 원래 폭",
  },

  /** 홈의 받은 편지함(U6). */
  inbox: {
    send: "보내기",
    openConv: "대화에서 보기",
    allow: "허용",
    deny: "거절",
    askMany: "물어볼 것이 여러 개예요 — 대화에서 답해 주세요",
    askPermission: (what: string) => `AI가 이것을 하려고 해요 · ${what}`,
    reviewArrived: "개발자가 코멘트를 남겼어요 — 대화에서 볼 수 있어요",
    firstPrepare: "처음 켜는 준비",
    answered: "답이 왔어요 — 확인해 보세요",
    eventMerged: "개발자 반영 완료",
    eventComments: "코멘트가 왔어요",
    eventClosed: "개발자가 요청을 닫았어요",
    eventReplied: "개발자가 답을 달았어요",
    stepNames: ["내려받기", "설치하기", "미리보기 켜기"],
  },
  /** 뼈대의 자리 표시 — 단계 2·3 이 채우기 전의 대화 · 미리보기 칸. */
  slot: {
    previewWaiting: "미리보기가 여기에 떠요",
  },
  /** 전환기 머리의 이름을 누르면 뜨는 프로젝트 카드(U7) — 원본 · 미리보기 · 목록에서 빼기. */
  projInfo: {
    openRepo: "만든 화면의 원본 보기",
    openPreview: "미리보기 열기",
    openInvite: "초대 파일 열기…",
    /** 데몬의 `project.remove` 는 파일을 지우지 않는다 — 대화와 작업 파일은 이 컴퓨터에 남는다. 그래서 「삭제」가 아니라 「빼기」다(2026-10-06 겹판 조사). */
    remove: "목록에서 빼기",
    removeTitle: (name: string) => `‘${name}’ 프로젝트를 목록에서 뺄까요?`,
    removeBody: "대화와 작업 파일은 이 컴퓨터에 그대로 있어요. 다시 쓰려면 초대 파일로 추가하세요.",
    removeLast: "마지막 프로젝트예요 — 빼면 초대 파일을 여는 화면으로 돌아가요.",
    removeCancel: "그만두기",
    removeBusy: "AI 작업이나 제출이 끝난 뒤에 뺄 수 있어요.",
    removing: "빼는 중…",
    removeDone: (name: string) => `‘${name}’ 프로젝트를 목록에서 뺐어요`,
    removeFailed: "프로젝트를 빼지 못했어요 — 다시 시도해 주세요",
  },
  /** 대화 줄의 `···` 메뉴 — 이름 바꾸기 · 내보내기 · 지우기(확인은 메뉴 안의 한 줄). */
  convMenu: {
    label: "대화 메뉴",
    rename: "이름 바꾸기",
    renameLabel: "대화 이름",
    export: "내보내기",
    exportDone: (file: string) => `${file} 파일로 내보냈어요`,
    exportFailed: "내보내지 못했어요",
    remove: "지우기",
    /** `···` 단추에 손을 올리면 — 이름(대화 메뉴)이 이미 말하는 것 대신 안에 든 것을 말한다(2026-10-06 겹판 조사). */
    hint: "이름 바꾸기 · 내보내기 · 지우기",
    /** 지우기 확인 — 제목은 일을, 본문은 영향의 크기와 남는 것을 말한다(데몬의 `session.delete` 가 그대로다). */
    removeTitle: "이 대화를 지울까요?",
    removeBody: "말과 답이 이 컴퓨터에서 영구히 지워져요 — 되돌릴 수 없어요. 만든 화면 작업은 그대로 남아요.",
    removeRunning: "지금 답하는 중이에요 — 멈추고 지우고, 기다리던 말도 함께 사라져요.",
    removeCancel: "그만두기",
    removeDone: "대화를 지웠어요",
    removeFailed: "지우지 못했어요",
  },



  // ── 단계 2 대화
  composer: {
    placeholder: "만들거나 고치고 싶은 것을 말해 주세요",
    placeholderPins: "찍은 곳을 어떻게 고칠지 말해 주세요",
    placeholderMerged: "다음에 만들 것을 말해 주세요 — 새 작업으로 시작해요",
    placeholderPreparing: "준비되는 동안 먼저 말해 두셔도 돼요",
    attach: "그림 · 문서 첨부 (한 건 8MB까지)",
    pin: "수정할 곳 선택",
    pinTip: "화면에서 고칠 곳 찍기 · ⌘⇧P",
    send: "보내기 · ↵ (줄바꿈은 ⇧↵)",
    /** AI 가 일하는 동안 보내면 줄을 선다 — 답이 끝나면 나간다. */
    sendQueue: "답이 끝나면 보내요 · ↵",
    stop: "멈추기",
    pinNote: "어떻게 바꿀까요? (선택)",
    pinRemove: "빼기",
    tooBig: (name: string) => `${name} — 8MB 보다 큰 파일은 보낼 수 없어요`,
    /** 핀만 있고 말이 어디에도 없을 때 — 보내지 않고 묻는다(2026-10-06 UX 점검). */
    pinNeedsWords: "무엇을 바꿀지 한 줄 적어 주세요 — 찍은 곳만으로는 알 수 없어요",
    /** 핀이 여섯을 넘을 때 — 일곱째부터는 사진 없이 자리만 간다. */
    pinShotCap: (n: number) => `사진은 앞 여섯 곳만 함께 가요 · 나머지 ${n}곳은 자리만 가요`,
    /** 입력칸의 고정 접근 이름 — placeholder 는 상태마다 바뀌므로 이름에서 뺐다(2026-10-04 ux-review). */
    message: "AI에게 보내는 말",
    /** 답하기 · 한마디 더 입력칸의 고정 접근 이름 — 바뀌는 자리 표시는 힌트로 묶는다. */
    noteToDev: "개발자에게 남기는 말",
    /**
     * 입력창의 `/` · `@` 목록(2026-10-14 사용자 요청) — `/` 는 지금 AI 가 알아듣는 명령어,
     * `@` 는 연결한 서비스의 파일 · 폴더. 폴더를 고르면 그 안을 이어 보인다.
     */
    suggest: {
      commands: "명령어",
      files: "파일 · 폴더",
      commandsNone: "맞는 명령어가 없어요",
      filesNone: "맞는 파일이 없어요",
      filesLoading: "찾는 중…",
      keys: "↑↓ 고르기 · ↵ 넣기 · esc 닫기",
    },
    /**
     * 다음 말 제안(2026-10-14 사용자 요청) — AI 가 답을 마치면 이어 물어볼 만한 말이 빈 입력창에 옅게
     * 뜬다. `Tab`(또는 오른쪽 끝의 칩)이 입력창에 넣고 `esc` 가 접는다. 넣기만 하고 보내지는 않는다.
     */
    ghost: {
      key: "Tab",
      tip: "이 말을 입력창에 넣기 · esc 로 숨기기",
      hint: (text: string) => `이어서 이렇게 말해 볼까요? ${text} — Tab 을 누르면 입력창에 들어가요`,
    },
  },
  model: {
    loading: "AI 정보를 확인하는 중…",
    unknown: "저장된 AI 설정을 알 수 없어요",
    hints: {
  "Efficient for routine tasks": "일상적인 작업에 적합해요",
  "For complex work and everyday tasks": "복잡한 작업과 일상적인 작업에 적합해요",
  "For your toughest challenges": "가장 어려운 요청에 적합해요",
  "Most efficient for simpler tasks": "간단한 요청에 효율적이에요",
  "Fastest for quick answers": "빠른 답변이 필요할 때 적합해요",
  "Best for everyday, complex tasks": "일상적이거나 복잡한 작업에 적합해요",
  "Most capable for your hardest and longest-running tasks": "가장 어렵고 오래 걸리는 작업에 적합해요",
},
    ai: "AI",
    aiNext: "보내면 이 AI 로 대화가 열려요",
    aiFixed: "이 대화의 AI 예요 · 다른 AI 는 새 대화에서 골라요",
    fastMissing: "이 모델에서는 빠른 응답을 선택할 수 없어요.",
    model: "모델",
    filter: "모델 고르기",
    filterPlaceholder: "모델 이름으로 고르세요",
    noMatch: "맞는 모델이 없어요",
    think: "생각 시간",
    thinkHelp: "오른쪽으로 갈수록 더 깊게 생각해요. 답변에 시간이 더 걸릴 수 있어요.",
    /** 열린 대화에서만 — 중간에 바꾸면 앞의 대화를 처음부터 다시 읽어 다음 답이 더 걸린다(2026-10-02). */
    thinkHelpSession: "대화 중간에 바꾸면 다음 답이 조금 더 걸려요 — 앞의 대화를 처음부터 다시 읽어요.",
    efforts: {
      short: "간단히",
      normal: "보통",
      long: "깊게",
      longer: "더 깊게",
      max: "가장 깊게",
    },
    defaultHint: "대부분의 요청에 추천하는 모델이에요",
    otherModels: (count: number) => `다른 모델 ${count}개 더 보기`,
    fewerModels: "모델 목록 접기",
    usage: "사용량",
    // 2026-10-04 ux-review(2차): 사용량 칸은 팝에서 상시 선다 — 실패와 빈 요금제도 한 줄로 말한다.
    // 머리 줄(`사용량`) 오른쪽에서 말한다(2026-10-06) — 곁에 다시 시도 단추가 선다.
    usageFailed: "읽지 못했어요",
    usageEmpty: "읽은 사용량이 없어요 — 무료 요금제이거나 한도가 없는 계정이에요.",
    auto: "자동 선택 (추천)",
    // 2026-10-06 겹판 조사: 팝의 이름(낭독이 팝이 무엇인지 말한다) · 읽는 중 표시의 낭독 문장.
    popLabel: "모델과 생각 시간",
    usageReading: "사용량을 읽는 중이에요",
  },
  /**
   * 빠르게의 문장 묶음(§5.4) — 칩의 이름 · 툴팁 카드 · 토스트. `FastWords`
   * 모양은 thread.ts 가 정하고 이 묶음이 채운다(통째로 건네므로 불리지 않는
   * 칸 검사의 표가 `fast` 를 안다).
   */
  fast: {
    name: "빠르게",
    offTitle: "빠르게 — 같은 모델이 더 빨리 답해요",
    nextTitle: "다음 대화부터 빠르게 — 같은 모델이 더 빨리 답해요",
    onTitle: "빠르게 켜짐 · 누르면 꺼요",
    costClaude: "요금제 사용량과 별도로 빠르게에 쓰는 남은 양에서 빠져요 · 같은 답에 약 2배",
    costMidway: "대화 중간에 켜면 지금까지의 대화도 한 번 더 계산해요",
    costOther: "사용량이 더 빨리 닳아요",
    blocked: {
      creditsGone: "빠르게에 쓰는 남은 양이 다 떨어져 보통 속도로 답해요",
      credits: "빠르게에 쓰는 남은 양을 켜 두어야 빠르게를 쓸 수 있어요 — AI 계정 설정 → 사용량",
      org: "조직 설정이 빠르게를 막아 두었어요",
      orgModels: "조직이 허용한 모델에 빠르게 모델이 없어요",
      network: "연결 문제로 지금은 빠르게를 쓸 수 없어요",
      evaluation: "무료로 써 보는 요금제에서는 빠르게를 쓸 수 없어요",
      cooldown: "빠르게 한도에 닿아 잠시 보통 속도로 답해요 · 풀리면 저절로 다시 켜져요",
    },
    /** 켜는 순간 한 번은 비용을 말한다 — 토스트가 그 자리다. */
    toastOn: (cost: string) => `빠르게 켜졌어요 · ${cost}`,
    toastOff: "빠르게를 껐어요",
    toastFail: "빠르게를 바꾸지 못했어요 — 다시 눌러 주세요",
  },
  transcript: {
    emptyTitle: "무엇을 만들까요?",
    editScreenHint: "대화 내용을 고쳐 보내요. 화면은 현재 상태를 유지해요",
    emptyBody: (name: string) =>
      `오른쪽은 ${name}의 실제 화면이에요.\n원하는 변경을 입력하거나, 수정할 곳을 선택해 주세요.\n그림·기획 문서도 첨부할 수 있어요.`,
    /** 좁은 창(900px 미만)에서는 미리보기가 오른쪽이 아니라 탭이다. */
    emptyBodyNarrow: (name: string) =>
      `${name}의 실제 화면은 화면 탭에서 봐요.\n원하는 변경을 입력하거나, 수정할 곳을 선택해 주세요.\n그림·기획 문서도 첨부할 수 있어요.`,
    emptyPreparing: (name: string) =>
      `${name} · 처음 켜는 중이에요.\n먼저 말해 두면 준비가 끝나는 대로 시작해요.`,
    queued: "준비가 끝나면 바로 보낼게요",
    editResend: "고쳐서 다시 보내기",
    editResendTip: "이 말부터 새 대화로 갈라서 고쳐 보내요 · 화면은 그대로예요",
    editResendToast: "이 말 앞까지 이어받은 새 대화예요 · 고쳐서 보내면 돼요 · 화면은 지금 그대로",
    shotLabel: "고친 화면",
    shotGo: "미리보기에서 보기",
    took: (secs: string) => `${secs} 걸렸어요`,
    /** 걸린 시간을 모르는 답의 마감 한 줄 — 정산 줄의 초록 체크 곁에 선다(2026-10-06). */
    done: "끝났어요",
    copyAll: "전체 복사",
    settleMenuTip: "답변 더 보기",
    fork: "여기서 새 대화",
    forkSub: "대화만 이 답까지 이어받아요 · 화면은 그대로예요",
    forkRevertLink: "작업 기록에서 되돌리기",
    forkToast: "이 답까지 이어받은 새 대화를 열었어요 · 원래 대화도 그대로 있어요",
    copyOne: "이 답변만 복사",
    copied: "복사했어요",
    copyFailed: "복사하지 못했어요. 글을 선택해 직접 복사해 주세요.",
    stopped: "멈췄어요 · 하던 곳까지는 화면에 남아 있어요",
    revived: "AI 프로그램이 멈춰 다시 일으켰어요 · 하던 일을 그대로 이어서 해요",
    seconds: (s: number) => `${s}초`,
    minutesSeconds: (m: number, s: number) => `${m}분 ${s}초`,
    /** 접힌 진행 문장의 머리 — 답이 끝난 뒤 과정은 이 한 줄로 접힌다. */
    stepsFold: "작업 과정",
    /** 고친 화면 카드의 마지막 이름 — 제목을 모를 때 주소가 서지 않게. */
    unknownScreen: "이름 없는 화면",
    // 2026-10-06 겹판 조사: `···` 가 메뉴가 되었다 — 안내문의 링크였던 되돌리기가 줄로 오르고,
    // 갈래를 못 내는 AI 에서도 `여기서 새 대화` 가 이유와 함께 흐려져 남는다.
    forkRevertSub: "화면을 이전 모습으로 되돌려요",
    forkOff: "이 AI는 여기서 이어받을 수 없어요",
  },
  cards: {
    gateResult: { verified: "다시 확인했어요 · 문제 없음", remaining: "문제가 남아 있어요", unchanged: "확인했어요 · 변경 없음", unverified: "해결 여부를 확인하지 못했어요", failed: "AI가 답을 마치지 못했어요", interrupted: "확인을 멈췄어요" },
    gateResultDetail: { verified: "고친 뒤 화면 확인을 통과했어요.", remaining: "다시 확인했지만 문제가 남아 있어요.", unchanged: "이번 답에서는 화면을 바꾸지 않았어요.", unverified: "답이 끝났지만 해결 여부는 아직 확인되지 않았어요.", failed: "이번 확인을 마치지 못했어요.", interrupted: "해결 여부를 확인하기 전에 멈췄어요." },
    gateFixed: "AI가 고쳤어요",
    gateFixing: "AI가 고치는 중",
    nothingToDoYet: "하실 일은 없어요 — 끝나면 알려 드려요.",
    gateBody: "AI가 확인한 자세한 내용",
    screenCheck: "화면 확인",
    developer: "개발자",
    /** AI 리뷰어(Codex · Claude …)의 의견 카드 — 사람 대신 이 말이 이름 옆에 선다(2026-10-14). */
    aiReviewer: "AI 검토",
    reviewDone: "의견을 확인하고 대화에서 수정을 요청해 주세요",
    reply: "답하기",
    replyTo: (name: string) => `${name}님에게 답하기`,
    replySend: "보내기",
    replyMine: (text: string) => `내 답: ${text}`,
    replyToast: (name: string) => `${name}님에게 답을 달았어요`,
    receiptFirst: "개발자에게 제출했어요",
    receiptMore: "같은 요청에 더해 제출했어요",
    /** 보낸 화면 — 제목은 앞선 몇 개까지, 닿지 않은 화면은 `외 N곳`(`rest`). 확인 창이 보인 목록이다. */
    receiptSent: (n: number, names: string, rest: number) =>
      names ? `보낸 화면 ${n}개 · ${names}${rest > 0 ? ` 외 ${rest}곳` : ""}` : `보낸 화면 ${n}개`,
    receiptReviewers: (n: number) => `받을 개발자 ${n}명`,
    /**
     * 도구가 아는 것은 요청에 적힌 개발자(`requested_reviewers`)뿐이다 — 팀 단위 코드 소유자나 늦게 채워지는 지정은
     * 닿지 않을 수 있어 「없다」 가 아니라 「확인하지 못했다」 를 말한다.
     */
    receiptNobody: "받을 개발자를 확인하지 못했어요 — 알림이 가지 않았을 수 있으니 제출한 내용의 링크를 개발자에게 전해 주세요",
    receiptCopyLink: "링크 복사",
    receiptLinkCopied: "복사했어요",
    receiptNextHead: "이제부터",
    receiptNextComments: "개발자가 코멘트를 남기면 이 대화에 카드로 와요. 내용을 확인하고 수정을 요청한 뒤 다시 제출해 주세요",
    receiptNextOriginal: "서비스 원본은 개발자가 반영하기 전까지 그대로예요",
    receiptNote: (note: string) => `내 한마디 · “${note}”`,
    /** 첫 제출의 영수증에만 — 앱이 꺼져 있으면 소식이 알림으로 오지 않는다(2026-10-06 UX 점검: 데몬은 앱 안에서 돌아 앱과 함께 끝난다). 창을 닫아도 mac 은 Dock 에, Windows 는 트레이에 남은 앱이라 켜져 있는 앱이다(2026-10-20). */
    receiptAway: "개발자 소식은 앱이 켜져 있으면 알림으로 오고, 꺼 두면 다시 켤 때 홈에서 알려요",
    askTitle: "AI가 물어봐요",
    askFree: "직접 답하기",
    failTitle: "AI가 답을 못 했어요",
    failWhy:
      "다섯 번 다시 물었지만 답을 받지 못했어요. 말씀은 그대로 남아 있어요 — 다시 시도하면 같은 말로 다시 물어요.",
    milestoneMerged: "개발자 반영 완료 · 다음에 만드는 것은 새 작업이에요",
    /** 날 오류 원문의 접힌 자리(W3) — cards.tsx 의 접힌 글과 같은 모양으로 편다. */
    detailFold: "자세히",
    /** 한마디 더(U20 · PLAN-UI §10) — 영수증의 상자가 열린 요청에 남기는 말. */
    noteMore: "개발자에게 한마디 더",
    notePlaceholder: "잘못 보냈거나 덧붙일 말을 적어요",
    noteSent: (time: string) => `${time} 개발자에게 보냈어요`,
    // 2026-10-06 겹판 조사: 여럿 고르기 질문 — 고른 개수를 말하고, 잠긴 보내기의 이유를 눈에 보이게 한다.
    pickedCount: (n: number) => `${n}개 골랐어요`,
    needAll: "모든 질문에 답하면 보낼 수 있어요",
    needOne: "하나 이상 고르면 보낼 수 있어요",
  },
  /**
   * 질문 카드의 시안(2026-10-08 베타 준비 분석 C1) — AI 가 선택지마다 작은 그림을 달아 보낸 질문. 눈으로 비교하다
   * 잘못 눌러 보내지 않도록 그림 카드는 고르기만 하고, 보내기는 따로다.
   */
  askPreview: {
    pickThis: "이걸로 할게요",
    needPick: "하나를 고르면 보낼 수 있어요",
    zoom: "크게 보기",
    zoomOf: (name: string) => `${name} 크게 보기`,
    choose: "이걸로 고르기",
    chosen: "골랐어요",
  },
  inviteCleanup: {
    title: "초대 파일을 가져왔어요",
    body: "파일에 연결 코드가 들어 있어요. 이 앱이 휴지통에 넣어 드릴게요.",
    remove: "휴지통에 넣기",
    later: "나중에",
    removed: "초대 파일을 휴지통에 넣었어요",
    removeFailed: "휴지통에 넣지 못했어요 — 파일을 직접 지워 주세요",
  },
  /** 대화 칸의 나머지 문장 — 입력창 · 대화록 · 카드가 함께 쓴다. */
  chat: {
    images: (n: number) => `그림 ${n}장`,
    attachRemove: "첨부 빼기",
    sendFailed: "AI에게 말을 전하지 못했어요 — 잠시 뒤 다시 보내 주세요",
    sending: "보내는 중…",
    somethingWrong: "잠시 문제가 있었어요 — 다시 해 주세요",
    dismiss: "닫기",
    offline: "연결이 끊겼어요",
    connecting: "연결하는 중이에요",
    stopping: "멈추는 중…",
    working: "작업 중",
    /**
     * 입력창 위 알약(2026-10-20 사용자 요청) — 도는 동안 이번 요청의 할 일 진행과 보조 작업 수. 누르면 AI 가 쓴
     * 항목이 펼쳐진다(항목은 AI 의 글이라 공통 규칙이 쉬운 말로 쓰게 한다).
     */
    plan: {
      todo: (done: number, total: number) => `할 일 ${done}/${total}`,
      agents: (n: number) => `보조 작업 ${n}`,
      title: "이번 요청의 할 일",
      agentsTitle: "보조 작업",
      agentUnnamed: "이름 없는 보조 작업",
      // 표식은 눈으로 읽힌다 — 화면 낭독기에는 이 말이 대신 읽힌다.
      done: "끝남",
      doing: "하는 중",
      waiting: "남음",
      agentFailed: "못 끝냄",
      agentStopped: "멈춤",
    },
    queuedAfter: "지금 답이 끝나면 바로 보낼게요",
    queueEdit: "고쳐서 보내기",
    queueNow: "지금 보내기",
    retrying: (n: number, of: number) => `잠깐의 문제로 조금씩 기다리며 다시 묻는 중이에요 · ${n}/${of}`,
    waitingLimit: "사용량이 다시 채워지면 스스로 이어서 해요",
    failWhyShort: "답을 받지 못했어요. 말씀은 그대로 남아 있어요 — 다시 시도하면 같은 말로 다시 물어요.",
    failLimit: "사용량을 다 썼어요. 다시 채워지면 다시 시도로 같은 말을 이어서 물어요.",
    failNotified: "개발자에게도 알렸어요.",
    retryLive: "지금은 스스로 다시 묻는 중이에요",
    /** 첨부를 되살릴 수 없을 때 — 말만 다시 보내면 AI 가 없는 그림을 어림짐작한다(2026-10-06 UX 점검). */
    retryReattach: "첨부는 다시 붙여 주세요 · 말은 입력창에 담아 뒀어요",
    historyFailed: "대화 기록을 읽지 못했어요",
    reopen: "다시 열기",
    newContent: "새 내용",
    toBottom: "맨 아래로",
    contextFull: "대화가 길어졌어요 — 새 대화에서 이어가면 더 빨라요",
    fixingOther: "AI가 막힌 곳을 고치고 있어요. 하실 일은 없어요.",
    recheck: "다시 확인",
    checking: "확인하는 중…",
    technicalHeading: "기술 정보",
    technicalDetails: "자세한 내용",
    technicalReferences: "화면 확인에 쓰인 정보",
    screenCheckTool: "화면 확인 기능",
    browserFindTool: "화면에서 찾기 기능",
    browserInspectTool: "화면 요소 확인 기능",
    screenFilesTool: "화면 관련 자료 확인 기능",
    diagnosticsTool: "오류 확인 기능",
    elementReference: "화면 요소",
    fileReference: "작업 파일",
    closed:
      "개발자가 이번 요청을 닫았어요 — 작업은 새 요청으로 옮겨 두었어요. 다시 만든 뒤 제출을 누르면 새 요청으로 가요",
    /** 제출 취소(2026-10-14) — 같은 닫힘이지만 내가 한 일이라 빨간 줄이 아니다. */
    withdrawn: "제출을 취소했어요 — 만든 화면은 그대로 있어요. 다시 제출하면 새 요청으로 가요",
    gateSummary: (step: string) => `${step}에서 문제를 찾아 AI에게 맡겼어요.`,
    errorSummary: "화면에 오류가 나서 AI에게 맡겼어요.",
    lookSummary: "보여 준 화면을 AI가 살펴보고 있어요.",
    lookTitle: "AI에게 보여 준 화면",
    briefScreen: (title: string) => `「${title}」 만들기를 AI에게 맡겼어요`,
    briefBootstrap: "처음 켜는 준비를 AI에게 맡겼어요",
    briefRefresh: "개발자가 반영한 내용을 받아왔어요",
    briefConventions: "이 서비스의 규칙을 다시 읽었어요",
    reviewText: "코멘트를 남겼어요",
    aiReviewText: "코드를 살펴보고 의견을 남겼어요",
    reviewAuthor: "개발자",
    usageWord: (pct: number) => `사용량 ${pct}%`,
    /** 사용량 칸의 한 줄(창 하나) — 이름 · 쓴 비율 · 다시 차는 때. */
    usageUsed: (pct: number) => `${pct}% 썼어요`,
    usageRefill: (when: string) => `${when}에 다시 차요`,
    usageFiveHour: "지금 시간대",
    /** 5시간 창의 툴팁(F21) — 줄에 마우스를 올리면 창의 길이를 말한다. */
    usageFiveHourTip: "방금 지난 5시간 동안의 사용량이에요",
    usageWeek: "이번 주",
    usageMonth: "이번 달",
    /** 모델마다 따로 있는 창 — `Fable · 이번 주`. */
    usageScoped: (name: string, period: string) => `${name} · ${period}`,
    usageTomorrow: (time: string) => `내일 ${time}`,
    usageOnDate: (month: number, day: number, weekday: string, time: string) =>
      `${month}월 ${day}일(${weekday}) ${time}`,
    /** `Date.getDay()` 의 차례 — 일요일부터. */
    usageWeekdays: ["일", "월", "화", "수", "목", "금", "토"],
    pinFlash: "화면에서 이 자리 보기",
    files: (n: number) => `파일 ${n}개`,
    /** 잃은 말의 실패 카드 이유(W8) — 다시 시도는 같은 말을 다시 보낸다. */
    lostWhy: "말이 닿기 전에 AI가 멈췄어요. 다시 시도하면 같은 말을 다시 보내요.",
  },
  /**
   * 데몬이 대화에 내려놓는 알림 문장의 첫머리 — 대화록이 이 머리로 알아보고
   * 제 문장(`L.chat` · `L.transcript`)으로 바꿔 그린다. 사용자에게 그대로
   * 보이는 글이 아니라 알아보는 표식이다.
   */
  daemonNotice: {
    retry: "일시적인 문제입니다",
    wait: "사용량이 다시 채워지는대로",
    revive: "AI 프로그램을 다시 켰어요",
  },



  // ── 단계 3 미리보기
  preview: {
    back: "뒤로",
    forward: "앞으로",
    reload: "새로 고침 · 보던 자리 그대로",
    devicePc: "PC",
    deviceTablet: "태블릿",
    devicePhone: "휴대폰",
    pinTip: "수정할 곳 찍기 · ⌘⇧P · option(⌥)+클릭은 언제든",
    history: "작업 기록",
    more: "더 보기",
    zoom: "배율",
    showAi: "AI에게 이 화면 보여 주기",
    showAiSub: "짚을 곳이 없는데 이상할 때",
    showAiToast: "지금 화면을 입력창에 담았어요 — 이상한 점을 말해 주세요",
    frozenOpen: "제출한 때의 화면 보기",
    frozenOpenSub: "개발자가 받은 모습 그대로",
    frozenLocked: "제출한 뒤에 볼 수 있어요",
    frozenBar: "제출한 때의 화면이에요",
    frozenBarAt: (time: string) => `제출한 때의 화면이에요 · ${time}`,
    unfreeze: "지금 화면으로",
    shortcuts: "단축키",
    addrPlaceholder: "화면 이름이나 주소",
    addrMine: "이 대화에서 만든 화면",
    addrOthers: "다른 화면",
    restartingTitle: "화면을 다시 켜는 중이에요",
    restartingBody: "미리보기가 저절로 꺼져서 다시 켜고 있어요.\n잠시만 기다려 주세요.",
    restarted: "화면이 다시 켜졌어요",
    fixingTitle: "AI가 막힌 곳을 고치고 있어요",
    fixingBody: "미리보기를 다시 띄우는 중이에요. 끝나면 화면이 저절로 떠요.",
    /** 기동 실패는 고침이 아니다 — 진행 대신 다시 시도를 내준다(2026-10-04 ux-review). */
    failedTitle: "화면을 띄우지 못했어요",
    failedBody: "미리보기를 여는 데 실패했어요.\n잠시 뒤에 다시 시도해 주세요.",
    retry: "다시 시도",
    /** 고침이 2분을 넘기면 덮개에 더하는 안내 줄(2026-10-04 ux-review). */
    fixingOverdue: "2분이 넘었어요 — 화면이 계속 안 뜨면 창을 다시 열어도 돼요",
    addrLabel: "화면 고르기",
    homeScreen: "첫 화면",
    untitledScreen: "이름 없는 화면",
    addrOnly: "미리보기 안의 화면 주소만 열 수 있어요",
    addrEmpty: "찾는 화면이 없어요",
    /** 목록 위의 낭독 한 줄 — 친 글자에 맞는 화면 수. */
    addrCount: (n: number) => `화면 ${n}곳`,
    recent: "최근 수정",
    device: "화면 크기",
    pin: "수정할 곳 선택",
    pinOffTip: "찍기 끄기 · ⌘⇧P",
    /** 잠김 상태를 아는 손 — 잠긴 이유는 눌렀을 때의 토스트가 말한다(2026-10-04 ux-review). */
    pinLockedState: "수정할 곳 선택 · 잠김",
    /** 골라 둔 곳이 있는 동안의 이름 — 막대 단추의 숫자 알약을 소리로도 읽는다(2026-10-06 막대 개편). */
    pinCountState: (n: number) => `수정할 곳 선택 · ${n}곳`,
    zoomOut: "작게",
    zoomIn: "크게",
    zoomReset: "실제 크기로",
    lateLoad: "화면이 늦게 뜨고 있어요 — 잠시만 기다려 주세요",
    /** 30초의 멈춤 — 한 번 다시 불러오는 순간과, 그래도 안 뜰 때의 문장(2026-10-04 ux-review). */
    selfReloaded: "화면을 다시 불러오고 있어요",
    stuckAfterReload: "다시 불러 봤어요 · 그래도 안 뜨면 AI가 확인해요",
    frameTitle: "미리보기",
    frozenNoShot: "제출한 때의 화면 그림이 없어요",
    showAiBusy: "화면을 담는 중…",
    showAiSent: "지금 화면을 AI에게 보여 줬어요 — 답을 기다려 주세요",
    showAiAgain: "이미 보여 줬어요 — 답을 기다려 주세요",
    shotName: (name: string) => `${name} 화면.jpeg`,
    /** 데몬이 다시 켜는 동안의 상태 문장이 이 말로 시작한다(C5 의 계약). */
    restartPrefix: "화면을 다시 켜는 중",
    prepAgainTitle: "화면을 켜는 중이에요",
    prepAgainBody: "잠시만 기다려 주세요 · 대화는 먼저 해도 돼요.",
    elapsedSec: (s: number) => `${s}초`,
    elapsedMin: (m: number, s: number) => `${m}분 ${s}초`,
    stepEta: (eta: string, elapsed: string) => `${eta} · ${elapsed}`,
    addrNoScreens: "아직 화면이 없어요 · 말로 부탁하면 여기에 생겨요",
    /** 아래는 AI 가 읽는 기계의 말 — 화면에는 서지 않는다. */
    stalledReport: "미리보기 화면이 새로 고친 뒤에도 30초 넘게 뜨지 않았어요.",
    lookAsk: "이 화면이 이렇게 보여요. 무엇이 잘못됐는지 보고 고쳐 주세요.",
    lookConsole: (lines: string) => `콘솔 마지막 기록:\n${lines}`,
  },
  /**
   * 라이브감 — AI 가 고치는 화면을 같이 따라간다(2026-10-08 베타 준비 분석). 한 줄은 미리보기 가장자리에 서고, 이름은
   * 화면 지도의 제목이다. 긴 이름은 줄임표가 이름만 자르고 문장의 끝(`고치는 중`)은 남아야 하므로, 이름이 들어가는 문장은
   * 이름 앞 · 뒤의 말 둘로 나눠 준다(이름 + 앞 + 뒤 = 한 문장). 이름 뒤의 조사는 이름 끝소리에 따라 달라지므로 `화면` 을
   * 붙여 정하고, 이름이 이미 `화면` 으로 끝나면 그 말을 겹치지 않는다(`ㄴ` 받침이라 `을` · `으로` 가 늘 맞는다).
   */
  live: {
    /** AI 가 브라우저 도구로 미리보기를 직접 눌러 보는 동안. */
    driving: "AI가 화면을 직접 눌러 보는 중",
    /** AI 가 이 화면의 파일을 고치는 중 — [이름 앞, 이름 뒤]. 제목을 모르면 이 문장을 쓰지 않는다. */
    editing: (name: string): [string, string] =>
      String(name).endsWith("화면")
        ? ["AI가 지금 ‘", "’을 고치는 중"]
        : ["AI가 지금 ‘", "’ 화면을 고치는 중"],
    /** 첫 편집에서 그 화면으로 옮겼을 때 몇 초 서는 줄 — [이름 앞, 이름 뒤]. 되돌리는 길은 뒤로 가기와 주소 목록이다. */
    moved: (name: string): [string, string] =>
      String(name).endsWith("화면") ? ["‘", "’으로 옮겼어요"] : ["‘", "’ 화면으로 옮겼어요"],
    /** 설정(AI 쪽)의 한 줄 — 끄는 길이다. */
    followRow: "AI가 고치는 화면으로 따라가기",
    followRowSub: "미리보기가 그 화면으로 옮겨 가요 · 내가 미리보기를 만지는 중이면 그대로 둬요",
  },
  pin: {
    stripTitle: "수정할 곳 선택 중",
    stripBody: "화면을 누르면 그 자리가 입력창에 담겨요 · 끌면 영역을 짚어요",
    /** 찍기 알약이 담은 수를 말한다 — 문장은 `2개 담음`. */
    stripCount: (n: number) => `선택한 곳 ${n}개`,
    stripOff: "선택 끝내기",
    bubblePlaceholder: "어떻게 바꿀까요? (입력창에 적어도 돼요)",
    /** 메모 칸 아래의 한 줄 — 담기(↵) · 보내기(⌘↵)는 단추의 키캡이 말하고, 여기는 줄바꿈만(2026-10-06 겹판 손질). */
    bubbleNewline: "줄바꿈",
    keep: "담기",
    sendNow: "지금 보내기",
    removePin: "이 핀 빼기",
    removed: "핀을 뺐어요",
    /** 찍은 자리를 담지 못했을 때 — 같은 자리를 다시 누르거나 다른 곳을 누르면 된다(2026-10-06 핀 봉투 회귀). */
    dropped: "이 자리는 담지 못했어요 · 다시 눌러 주세요",
    keptN: (n: number) => `${n}번을 담았어요 — 더 찍거나 입력창에서 보내요`,
    keptNarrow: (n: number) => `${n}번을 담았어요 — 대화 탭에서 메모를 남기고 보내요`,
    lockedPreparing: "준비가 끝나면 화면을 찍을 수 있어요",
    area: "영역",
    /** 핀 이름표의 마지막 폴백 — 정체(글자 · 컴포넌트 · 화면)를 다 못 짚을 때. */
    point: "찍은 곳",
    bubble: "핀 메모",
    /** 아래는 게스트 안 오버레이가 입는 말 — 선로(colonova-overlay:mode)로 건너간다. */
    unnamed: "이름 없음",
    hint: "클릭은 요소, 끌면 영역을 가리켜요. 여러 개 찍고 한 번에 말해 주세요.",
    badgeWord: "핀",
    badgeSentMark: "(보냄)",
    badgeDoneMark: "(고침)",
    kindButton: "버튼",
    kindLink: "링크",
    kindImage: "그림",
    kindInput: "입력칸",
    kindOther: "화면 부분",
    details: "요소 정보",
    textColor: "글자색",
    backgroundColor: "배경색",
    font: "글꼴",
    textSize: "글자 크기",
    weight: "글자 굵기",
    lineHeight: "줄 간격",
    padding: "안쪽 여백",
    margin: "바깥 여백",
    rounding: "모서리 모양",
    layout: "배치 방식",
    width: "너비",
    height: "높이",
    gap: "요소 사이 간격",
  },
  requestResult: {
    request: "관련 요청",
    explanation: "답변에서 설명한 변경",
    latest: "현재 화면 열기",
    edit: "추가 수정",
    draft: (title: string) => `${title} 화면을 추가로 수정해 주세요.\n원하는 수정: `,
    draftReady: "수정할 내용을 입력창에서 다듬어 보내 주세요",
    /** 마지막 결과에만 서는 단추 — 작업 기록의 「이후 전부」 되돌리기가 아니라 이 요청 하나일 때만 이름이 맞다(2026-10-06 UX 점검). */
    /**
     * 턴 끝의 자동 확인이 문제 없이 지나갔을 때의 한 줄(2026-10-06 UX 점검) — 예전에는 문제를 찾았을 때만 사용자에게 닿아
     * 「끝났다」 가 확인된 말인지 알 수 없었다. 열어 본 화면의 수와, 실제로 본 것만 말한다: 휴대폰 폭은 그 점검이 돈 때만.
     */
    checked: (screens: number, phone: boolean) =>
      phone
        ? `화면 ${screens}곳을 다시 열어 확인했어요 · 비거나 오류가 나는 곳이 없고 휴대폰 크기에서도 옆으로 밀리지 않아요`
        : `화면 ${screens}곳을 다시 열어 확인했어요 · 비거나 오류가 나는 곳이 없어요`,
    undo: "방금 한 것 되돌리기",
    undoTip: "이 요청이 바꾼 것만 되돌려요 · 되돌린 것도 작업 기록에 남아요",
  },
  history: {
    title: "작업 기록",
    sub: "AI가 한 차례 답할 때마다 저절로 보관돼요.\n따로 누를 것은 없어요.",
    foot: "이번 작업이 반영될 때까지 남아요",
    emptyMerged:
      "반영된 작업의 기록은 여기서 사라져요.\n합쳐진 것은 거슬러 갈 수 없어서예요.\n다음에 만드는 것부터 다시 쌓여요.",
    empty: "아직 보관된 차례가 없어요.\nAI가 한 차례 답할 때마다 여기에 쌓여요.",
    submittedAt: (time: string) => `${time} 제출했어요`,
    eventMerge: "최신 내용을 가져왔어요",
    /** 연속된 반영 차례를 한 행으로 접은 표시(2026-10-04 ux-plan PR 3) — 최신 차례의 문장에 접은 차례까지 합친 총 횟수를 붙인다. */
    eventMergeFold: (n: number) => `최신 내용을 가져왔어요 · ${n}번`,
    eventRestore: "이전 모습으로 되돌렸어요",
    eventComment: "의견을 반영했어요",
    /** 줄 끝에 선 되돌리기 — 「여기로」 가 어느 줄의 시점인지 말한다. 길게 말하는 것은 확인 카드와 낭독 이름(`revertLabel`)이다. */
    toHere: "여기로 되돌리기",
    affected: (names: string) => `되돌리면 바뀌는 화면 · ${names}`,
    working: "AI 작업이 끝난 뒤 되돌릴 수 있어요.",
    affectedAll: "이 시점 이후의 모든 변경(다른 대화 포함)이 되돌아가요",
    cancel: "그만두기",
    revertedToast: (time: string) => `${time} 시점으로 되돌렸어요 — 되돌리기도 기록에 남아요`,
    /** 코멘트 반영 차례의 제목 머리(U9 · U14) — `revertSummary` 가 이것으로 센다. */
    commentPrefix: "코멘트 반영 — ",
    restorePrefix: "되돌리기:",
    close: "작업 기록 닫기",
    loading: "기록을 읽어 오는 중…",
    readFailed: "기록을 읽지 못했어요 — 잠시 후 다시 시도해 주세요.",
    restoreFailed: "되돌리지 못했어요 — 잠시 후 다시 시도해 주세요.",
    restoring: "되돌리는 중…",
    today: "오늘",
    yesterday: "어제",
    dayOf: (month: number, day: number) => `${month}월 ${day}일`,
    // ── 2026-10-06 겹판 손질 — 확인 카드 · 타임라인 · 낭독(P)
    /** 시각을 말로: 1분 안은 방금, 한 시간 안은 N분 전, 그 밖은 시계. */
    justNow: "방금",
    minutesAgo: (n: number) => `${n}분 전`,
    /** 맨 위 줄의 표식 — 지금 서 있는 곳. */
    now: "지금",
    /** 단추의 이름 — 같은 말의 단추가 줄마다 있으니 시각과 제목을 앞에 싣고, 눈에 보이는 둘째 줄(만진 화면 · 코멘트 요지)도 `extra` 로 읽힌다. */
    revertLabel: (time: string, title: string, extra?: string) =>
      `${[time, title, extra].filter(Boolean).join(" · ")} · 이때 화면으로 되돌리기`,
    /** 확인 카드 — 시각이 아니라 제목으로 묻고, 되돌리는 일의 크기를 칩으로 말한다. */
    confirmAsk: (title: string) => `「${title}」 직후의 화면으로 되돌릴까요?`,
    confirmAskEvent: "이 시점의 화면으로 되돌릴까요?",
    /** 결과 카드의 `방금 한 것 되돌리기` 가 연 확인 — 되돌아갈 곳의 제목이 아니라 되돌리는 일을 말한다. */
    confirmAskLast: "방금 한 것을 되돌릴까요?",
    chipScreens: (n: number) => `화면 ${n}곳`,
    chipChanges: (n: number) => `변경 ${n}가지`,
    chipComments: "코멘트 반영 포함",
    reassure: "기록은 남아요 — 되돌린 것도 다시 되돌릴 수 있어요. 개발자에게는 다음 제출 때 전해져요.",
    revertAt: (time: string) => `${time} 시점으로 되돌리기`,
  },



  // ── 단계 4 제출·이번 작업
  submit: {
    idle: "제출",
    running: "제출하는 중…",
    done: "제출됐어요",
    retrying: "다시 제출하는 중…",
    failed: "제출하지 못했어요",
    whyReconnect: "다시 연결이 필요해요 — 위의 안내를 먼저 따라 주세요",
    whyRunning: "AI가 고치는 중 — 끝나면 제출할 수 있어요",
    whyPreparing: "준비가 끝나면 제출할 수 있어요",
    whyMerged: "개발자가 반영했어요 — 다음 작업을 만들면 제출할 수 있어요",
    whyBlocked:
      "제출이 막혔어요 — 풀리면 다시 제출해요. 위의 안내를 확인해 주세요",
    whyMoreReady: (n: number) => `제출한 뒤로 바뀐 ${n}곳을 같은 요청에 더해 제출해요`,
    whyNoMore: "제출한 뒤로 바뀐 것이 없어요 — 더 고치면 같은 요청에 더해 제출할 수 있어요",
    whyNothing: "아직 바뀐 화면이 없어요",
    whyReady: (n: number) => `바뀐 화면 ${n}개를 개발자에게 제출해요`,
    /** 막힘 중 연결 코드 만료(U13 의 auth) — 사람의 손이 필요한 유일한 막힘. */
    whyAuth: "연결 코드가 만료돼 제출이 막혔어요 — 새 초대 파일이 필요해요",
    /** 막힘 중 인터넷 문제 — 사람이 할 일은 없고 연결되면 도구가 다시 제출한다(2026-10-06 UX 점검). */
    whyNetwork: "인터넷 연결이 끊겨 제출이 막혔어요 — 연결되면 다시 제출해요",
    /**
     * 막힘 중 연결 코드의 권한 부족 — 새 초대 파일은 해결이 아니다(같은 코드를 받으면 같은 문장이 난다).
     * 개발자가 코드의 권한을 고쳐야 풀리고, 풀리면 도구가 다시 제출한다(2026-10-07 베타 준비 분석).
     */
    whyPermission: "연결 코드의 권한이 모자라 제출이 막혔어요 — 개발자가 코드의 권한을 고치면 풀려요",
    /** 다시 제출하는 중 GitHub 의 한도에 걸린 것 — 막힘이 아니라 시간이 푼다(사다리가 알아서 기다린다). */
    whyLimit: "요청이 몰려 잠시 쉬는 중이에요 — 곧 도구가 다시 제출해요",
  },
  /** 제출 확인 팝오버(U3). */
  submitConfirm: {
    title: "개발자에게 제출할까요?",
    titleMore: "같은 요청에 더해 제출할까요?",
    sub: "이 프로젝트에서 작업한 내용을 함께 제출해요",
    project: (name: string) => `제출할 프로젝트 · ${name}`,
    shared: "다른 대화에서 만든 변경도 포함돼요. 서비스 원본은 개발자가 반영하기 전까지 그대로예요.",
    follows: "제출 후 수정은 다시 제출한 뒤 같은 개발자 확인 요청에 전해져요.",
    loading: "제출할 내용을 확인하는 중…",
    readFailed: "제출할 내용을 읽지 못했어요. 다시 확인해 주세요.",
    refresh: "다시 확인",
    changed: "확인하는 동안 내용이 바뀌었어요. 갱신된 목록을 확인한 뒤 제출해 주세요.",
    subMore: "이미 열린 요청에 이어서 쌓여요 · 원본은 건드리지 않아요",
    screens: (n: number) => `제출할 화면 ${n}개`,
    earlierScreens: (n: number) => `앞서 제출한 화면 ${n}곳`,
    outsideScreens: (n: number) => `화면에 드러나지 않은 변경 ${n}건`,
    outsideDetail: "최종 변경이 남은 파일과 관련 요청이에요. 기록 횟수를 세지 않아요.",
    relatedRequest: (note: string, n: number) => `관련 요청: ${note} · 파일 ${n}개`,
    unassociated: (n: number) => `화면과 관련 요청을 확인하지 못한 변경 · 파일 ${n}개`,
    empty: "제출할 변경이 없어요.",
    note: "개발자에게 한마디",
    optional: "선택",
    notePlaceholder: "예) 검색창 위치는 기획 의도예요",
    reviewers: (names: string) => `받을 개발자 · ${names}`,
    cancel: "그만두기",
    confirm: "제출",
    // 2026-10-06 겹판 손질 — 무엇이 누구에게 가는가를 목록 위의 한 줄로 먼저 말하고, 안내 셋은 접는다.
    /** 목록 위의 한 줄 — 받을 개발자를 모르면(`names` 가 비면) 그 말이 빠진다. */
    summary: (n: number, names: string) =>
      names ? `바뀐 화면 ${n}개를 ${names}에게 제출해요` : `바뀐 화면 ${n}개를 제출해요`,
    summaryMore: (n: number, names: string) =>
      names
        ? `제출한 뒤 바뀐 화면 ${n}개를 ${names}에게 더해 제출해요`
        : `제출한 뒤 바뀐 화면 ${n}개를 더해 제출해요`,
    summaryOutside: (n: number, names: string) =>
      names
        ? `화면에 드러나지 않은 변경 ${n}건을 ${names}에게 제출해요`
        : `화면에 드러나지 않은 변경 ${n}건을 제출해요`,
    scopeMore: "제출 범위 자세히",
    /** 보내는 길에서 막혔다 — 목록은 그대로 두고 다시 제출할 수 있다. */
    sendFailed: "제출하지 못했어요 · 아래 목록은 그대로예요. 연결을 확인하고 다시 제출해 주세요",
    retrySubmit: "다시 제출",
    // 2026-10-07 UX 점검 3단계 — 개발자가 처음 읽는 제목과 설명을 보내기 전에 먼저 보인다.
    previewHead: "개발자에게는 이렇게 보여요",
    previewLoading: "개발자에게 보이는 모습을 정리하는 중…",
    /** 개발자에게 함께 가는 것 — 화면 사진과 자동 확인 결과(작업 몇 건 중 몇 건이 문제 없이 지났는가). 둘 다 없으면 빈 글이다. */
    previewWith: (photos: number, checked: number, total: number) => {
      const parts = [
        photos > 0 ? `화면 사진 ${photos}장` : "",
        checked > 0 ? `자동 확인 결과(작업 ${total}건 중 ${checked}건)` : "",
      ].filter((part) => part !== "");
      return parts.length > 0 ? `${parts.join(" · ")}도 함께 가요` : "";
    },
    /** 개발자가 받는 본문의 범위가 의존성 · 락파일 · 설정 · CI 파일을 포함할 때만 — 사용자가 몰라도 되지만 숨기지는 않는다(2026-10-07 베타 준비 분석). */
    previewScope: "설정 파일도 함께 바뀌었어요",
    /** AI 가 쓴 글이라 고칠 길은 한마디다 — 상자의 마지막 줄이 그 길을 가리킨다. */
    previewHint: "AI 가 정리한 글이에요 · 틀린 곳이 있으면 아래 한마디에 적어 주세요",
    previewHintRequest: "AI 가 글을 쓰지 못해 처음 한 말이 제목이 돼요 · 더 알려 줄 것은 아래 한마디에 적어 주세요",
    previewMoreHead: "이미 열린 요청",
    previewMoreHint: "제목과 설명은 그대로예요 — 바뀐 내용과 한마디만 새로 고쳐져요",
  },
  /** `이번 작업` 팝오버(U2). */
  work: {
    title: "이번 작업",
    subDraft: "이 컴퓨터에 보관돼 있어요",
    subReview: "개발자에게 가 있어요",
    subMerged: "개발자 반영이 끝났어요 · 서비스 공개 여부는 담당자에게 확인해 주세요",
    changed: "바뀐 화면",
    changedCount: (n: number) => `바뀐 화면 ${n}개`,
    changedSince: (n: number) => `제출한 뒤 ${n}곳 더`,
    changedEmpty: "아직 바뀐 화면이 없어요.",
    changedEmptyMerged: "개발자가 이번 작업을 반영했어요. 다음에 고치는 것부터 새 작업이에요.",
    submitHeading: "제출",
    receivedBy: (names: string) => `받은 개발자 · ${names}`,
    notSubmitted: "아직 제출하지 않았어요. 다 만들었으면 위의 제출을 눌러요.",
    blocked: "제출이 멈췄어요. 작업은 보관돼 있고, 문제가 풀리면 다시 제출해요.",
    comments: "개발자 코멘트",
    commentsCount: (n: number) => `개발자 코멘트 ${n}`,
    commentsAuto: "확인하고 대화에서 수정을 요청해 주세요",
    commentsEmptyDraft: "제출하면 개발자의 코멘트가 여기에 모여요.",
    commentsEmpty: "아직 없어요.",
    commentDone: "반영됨",
    commentFixing: "고치는 중",
    openHistory: "작업 기록 열기",
    /** 머리의 둘째 줄 — `<프로젝트> · <시작일>부터 · <지금 자리>`. 시작일을 모르면 빠진다. */
    headerSub: (name: string, since: string | null, where: string) =>
      since ? `${name} · ${since}부터 · ${where}` : `${name} · ${where}`,
    day: (month: number, day: number) => `${month}월 ${day}일`,
    /** 시각 한 칸 — 오늘이면 시:분만, 아니면 날짜를 앞에. */
    time: (today: boolean, hhmm: string, month: number, day: number) =>
      today ? hhmm : `${month}월 ${day}일 ${hhmm}`,
    // 시각이나 이름을 모를 때 구분점만 덩그러니 서지 않게 — 아는 것만 잇는다. 둘 다 모르면 빈 글(부르는 쪽이 `제출됨` 으로 채운다).
    submittedBy: (time: string, author: string | null) =>
      time && author ? `${time} · ${author}` : time || author || "",
    commentAuthor: "개발자",
    /**
     * 코멘트 반영 차례의 기록 제목 머리 — 도구가 붙이는 이름(데몬의
     * COMMENT_REFLECTION_PREFIX 와 같은 글자). 이 머리의 기록이 코멘트 뒤에 있으면 `반영됨`.
     */
    reflectionPrefix: "코멘트 반영 — ",
    /** 한마디 더(U20 · PLAN-UI §10) — 제출 칸 바닥의 같은 단추와 상자. */
    noteMore: "개발자에게 한마디 더",
    notePlaceholder: "잘못 보냈거나 덧붙일 말을 적어요",
    noteSent: (time: string) => `${time} 개발자에게 보냈어요`,
    // 2026-10-06 겹판 손질 — 읽는 중 · 읽지 못함은 `아직 없어요` 와 다르다. 많은 화면은 넷만 먼저 보인다.
    loading: "기록을 읽는 중…",
    readFailed: "코멘트를 읽지 못했어요",
    moreScreens: (n: number) => `바뀐 화면 ${n}개 더 보기`,
    // 2026-10-14 사용자 요청 — 제출한 사람이 열린 요청을 앱에서 닫는다. 만든 화면은 남고 다음 제출은 새 요청이다.
    withdraw: "제출 취소",
    withdrawTitle: "제출을 취소할까요?",
    withdrawBody: "개발자에게 간 요청이 닫혀요. 만든 화면은 그대로 남고, 다시 제출하면 새 요청으로 가요.",
    withdrawCancel: "그만두기",
    withdrawing: "취소하는 중…",
    /** 확인이 잠긴 이유 — 데몬도 같은 때 거절한다(도는 제출 · 턴이 닫힌 요청을 다시 건드리지 않게). */
    withdrawWhyRunning: "AI가 고치는 중 — 끝나면 취소할 수 있어요",
    withdrawWhySubmitting: "제출하는 중 — 끝나면 취소할 수 있어요",
    withdrawDone: "제출을 취소했어요 · 만든 화면은 그대로예요",
    withdrawFailed: "제출을 취소하지 못했어요 · 잠시 뒤 다시 시도해 주세요",
    // 2026-10-20 사용자 요청 — 개발자가 반영한 내용은 누를 때만 받아온다. 겹치는 부분은 AI가 정리한다.
    baseHeading: "개발자 쪽 새 내용",
    baseBehind: (n: number) => `개발자가 반영한 내용 ${n}건이 아직 이 작업에 없어요.`,
    baseHint: "받아오면 지금 작업 위에 합쳐요. 겹치는 부분은 AI가 정리해요.",
    basePull: "받아오기",
    /** 상태 줄의 작은 단추 — 받아올 수를 붙인다. */
    basePullCount: (n: number) => `받아오기 ${n}`,
    baseChipTitle: (n: number) => `개발자가 반영한 내용 ${n}건 · 눌러서 지금 작업에 받아와요`,
    basePulling: "받아오는 중…",
    baseWaiting: "AI 작업이 끝나면 받아와요",
    baseOverlap: "겹치는 부분을 AI가 정리하고 있어요",
    baseDone: "개발자가 반영한 내용을 받아왔어요",
    baseNone: "새로 받아올 내용이 없어요",
    baseFailed: "받아오지 못했어요 · 잠시 뒤 다시 눌러 주세요",
  },



  // ── 단계 5 처음 한 번·준비·초대
  onboarding: {
    title: "ColoNova Design 을 시작해요",
    sub: "세 가지가 채워지면 저절로 넘어가요.\n터미널을 열 일은 없어요.",
    tools: "도구 준비",
    toolsChecking: "확인하는 중…",
    agent: "AI 연결",
    agentIdle: "기다리는 중",
    agentInstalling: "Claude Code 설치 중",
    agentLogin: "브라우저에서 로그인",
    agentOk: "Claude Code · 로그인됨",
    agentBlocked: "설치가 막혔어요",
    // 2026-10-20 온보딩 손질: 걸리는 시간과 관리자 암호를 먼저 말한다 — 설치 스크립트는 사용자 폴더 안에서 끝난다(agent-install).
    agentWhat:
      "Claude Code 는 이 앱이 AI 를 부르는 데 쓰는 프로그램이에요. 설치는 몇 분이면 끝나고 관리자 암호는 묻지 않아요. 끝나면 내 Claude 계정으로 로그인해요.",
    copyText: "문장 복사",
    copied: "IT 담당자에게 보낼 문장을 복사했어요",
    retry: "다시 시도",
    // 2026-10-20 온보딩 손질: 로그인 뒤 연결을 허용하는 한 걸음이 더 있다 — 브라우저 쪽 단추의 이름은 적지 않는다.
    loginBody: "브라우저가 열렸어요. Claude 계정으로 로그인하고 연결을 허용하면 이 화면이 저절로 넘어가요.",
    loginReopen: "브라우저 다시 열기",
    loginFallback: "브라우저가 열리지 않았나요?",
    loginFallbackBody: "아래 주소를 브라우저에 붙여넣고, 받은 코드를 여기에 넣어 주세요.",
    /** 로그인 실패의 날 원문(F4) — 붉은 머리 줄 아래 이 접힘으로 내려간다. */
    loginRawDetail: "자세히",
    loginCode: "받은 코드 붙여넣기",
    confirm: "확인",
    invite: "초대 파일",
    inviteFrom: "개발자에게 받은 파일",
    invitePick: "파일 고르기",
    inviteOpening: "초대 파일을 여는 중…",
    /**
     * AI 를 기다리는 동안 초대 파일 칸에 서는 한 줄(2026-10-07 베타 준비 분석 · 첫 5분) — 서비스 준비(내려받기 · 설치 ·
     * 미리보기 켜기, 3~5분)는 초대 파일을 가져오는 즉시 AI 와 무관하게 돌기 시작한다. 파일을 먼저 놓으면 그 시간이 AI 설치와 겹친다.
     */
    inviteEarly: "초대 파일을 먼저 놓아 두면 서비스 준비가 미리 시작돼요 · AI 설치와 나란히 진행돼요",
    inviteDone: (names: string) => `${names}를 가져왔어요.`,
    inviteFirst: (name: string) => `${name}를 먼저 열어요. 나머지는 처음 고를 때 준비해요.`,
    inviteWarn: "초대 파일에는 연결 코드가 들어 있어요. 가져왔으니 지워 주세요.",
    /** 초대 확인판을 닫는 길. */
    close: "닫기",
    /** policy 가 아닌 설치 실패의 오른쪽 문구 — 본문 문장은 데몬의 detail 이 말한다. */
    agentFailed: "설치가 안 됐어요",
    /** 확인이 실패로 끝난 항목 — 도는 표시 대신 손이 필요하다는 말. */
    toolsBlocked: "확인이 막힌 항목이 있어요",
    /** 설치 진행기의 날 줄을 가려낸 세 단계의 말 — lib/install-step.ts 의 판정과 짝이다. */
    installSteps: {
      download: "내려받는 중…",
      install: "설치하는 중…",
      verify: "확인하는 중…",
    },
    /** 초대 파일 놓는 칸의 문장 — 확장자 대신 쉬운 말로. */
    inviteDropName: "개발자에게 받은 초대 파일",
    inviteDropHow: "여기에 놓으면 가져와요",
    /** 첫 실행이 끝나는 순간의 얼굴 — 체크리스트가 흐려져 사라지기 전의 한 문장. */
    doneTitle: "준비됐어요",
    doneSub: "이제 만들고 싶은 화면을 말씀해 주세요",
    emptyProjectsTitle: "프로젝트가 없어요",
    emptyProjectsSub: "초대 파일을 열어 프로젝트를 다시 추가해 주세요.\nAI 연결과 도구 준비는 그대로예요.",
    // 2026-10-04 ux-review: 로그인 시작 직전의 예고 — 브라우저가 예고 없이 뜨지 않게.
    loginStarting: "곧 브라우저가 열려요",
    // 2026-10-06 온보딩 손질: 링의 낭독 문장 · 파일이 아직 없을 때의 길
    // (README ③ 의 `개발자에게 보낼 메시지` 와 같은 문장 — 앱 안에서도 복사해 보낸다).
    progress: (done: number, total: number) => `${total}개 중 ${done}개 준비됐어요`,
    // 시작 전의 AI 칸 알약 — `기다리는 중` 대신 무엇이 필요한지 말한다(버튼이 곁에 있다).
    agentNeedInstall: "설치가 필요해요",
    agentNeedLogin: "로그인이 필요해요",
    inviteHelp: "초대 파일이 아직 없나요?",
    inviteHelpBody: "개발자에게 아래 문장을 그대로 보내 주세요.",
    inviteHelpMessage: (url: string) =>
      `ColoNova Design 초대 파일(.colonova-invite) 하나 만들어 주세요!\n여기서 바로 만들 수 있어요 → ${url}`,
    askCopied: "개발자에게 보낼 문장을 복사했어요",
    // ── 2026-10-20 온보딩 손질(비개발자 Windows · mac 설치 검토) — 준비물을 먼저 말하고, 막힌 칸마다 빠져나갈 길을 둔다.
    /** 머리 아래의 준비물 — 시작 전에 손에 쥘 두 가지(유료 계정 · 초대 파일). */
    needTitle: "준비할 것",
    needs: ["유료 Claude 계정", "개발자에게 받은 초대 파일"],
    /** 앱 밖에서 고친 것(설치 창 · IT 허용)을 앱을 다시 켜지 않고 읽는 단추. */
    recheck: "다시 확인",
    /** 첫 검사의 답이 오래 오지 않을 때 — 도는 표시만 두지 않는다. */
    checkSlow: "확인이 평소보다 오래 걸려요. 다시 확인을 눌러 보세요.",
    /** 고칠 단추가 없는 AI 칸의 알약 — 본문은 도구가 알려 준 이유 문장이 말한다. */
    agentStuck: "확인이 필요해요",
    /** 체크리스트 아래의 낮은 줄 — 도움말 메뉴(Windows 는 Alt 뒤에 숨는다)를 찾지 않아도 진단을 보낸다. */
    stuckAsk: "막혔나요?",
    stuckCopy: "담당자에게 보낼 내용 복사",
  },
  // ── 계정 · 요금제 (2026-10-07 베타 준비 분석) — 로그인 뒤의 한 줄 · 요금제가 필요하다는 말 · 쓸 수 없는 계정
  account: {
    /** 로그인 뒤의 한 줄 — `kim@회사.kr · Max 로 연결됨`. 이메일 · 요금제는 아는 것만 앞에 붙는다. */
    connectedAs: (who: string) => `${who} 로 연결됨`,
    /** 이메일도 요금제도 말할 수 없을 때(구독 코드 · 다른 서비스로 이어진 계정). */
    connected: "연결됨",
    apiKey: "IT가 연결해 둔 계정이에요",
    /**
     * 요금제가 필요하다는 말 — 로그인 전에 먼저 알려 헛걸음을 막는다. 소개 페이지 · README 의 같은 문장과 뜻이 같다
     * (Anthropic 공식 문서: Claude Code 는 Pro · Max · Team · Enterprise 구독, Console, 클라우드 공급자로 쓴다).
     */
    planNeed:
      "AI 계정은 유료 요금제여야 해요 — Claude Code 는 Claude Pro · Max · Team · Enterprise 계정으로 쓸 수 있어요(무료 요금제로는 쓸 수 없어요)",
    /** 알려진 쓸 수 없는 요금제 — 첫 요청 전에 막힌 AI 카드의 이유. */
    planBlocked: "이 계정의 요금제로는 Claude Code 를 쓸 수 없어요 — 유료 요금제 계정으로 다시 로그인해 주세요",
    planBlockedPill: "이 요금제로는 쓸 수 없어요",
    switchAccount: "다른 계정으로 로그인",
    /** 계정류 실패 카드 — 다시 물어도 소용없다. 계정을 고치고(요금제 · 크레딧 · 다른 계정) 다시 시도한다. */
    failWhy: "이 계정으로는 AI 를 쓸 수 없어요 — 요금제나 크레딧을 확인하고 다시 로그인해 주세요",
    /** 로그인을 연 뒤의 한 줄 — 브라우저에서 마치면 같은 말로 다시 시도한다. */
    failLoginNote: "브라우저에서 로그인을 마친 뒤 다시 시도를 눌러 주세요",
  },
  // ── 베타 막힘 보고 (2026-10-07 베타 준비 분석) — 진단 복사 곁의 안내
  report: {
    /**
     * 앱의 `기능 제안` 은 누구나 보는 공개 게시판이다(PLAN-FEEDBACK). 막힘 · 버그 보고는 거기에 붙이지 않는다 —
     * 채널의 이름은 팀마다 달라 일반 문장으로 말한다.
     */
    privateNote: "공개 게시판이 아니라 팀이 정한 비공개 채널에 붙여 주세요",
    /** 복사 단추가 진단을 모으는 동안의 글. */
    gathering: "모으는 중…",
  },
  /**
   * 도움말 메뉴(데스크톱)가 웹에 시키는 일의 답 — `문제가 생겼어요 — 진단 복사`(2026-10-08 베타 준비 분석). 메뉴의 문장은
   * 데스크톱의 copy.ts 에 있고, 여기는 복사한 뒤 토스트가 한 줄로 알리는 말이다.
   */
  help: {
    reportCopied: "진단을 복사했어요 — 담당자에게 붙여 넣어 주세요",
    reportFailed: "복사하지 못했어요 — 한 번 더 눌러 주세요",
  },
  /** 처음 여는 프로젝트의 준비 화면(U8). */
  prepare: {
    title: "이 서비스를 이 컴퓨터에서 처음 켜요",
    body: "준비에 몇 분 걸려요. 창을 닫아도 다음에 이어서 해요.",
    stepDownload: "내려받기",
    stepInstall: "설치하기",
    stepPreview: "미리보기 켜기",
    aboutTwoMinutes: "2분쯤",
    hint: "준비되는 동안 먼저 말해 두셔도 돼요 — 끝나면 바로 시작해요.",
    // ── 2026-10-06 겹판 손질 — 걸음마다 한 줄 설명 · 낭독 · 다시 시도의 바쁨(P)
    noteDownload: "처음 한 번만 받아요",
    noteInstall: "필요한 것을 설치해요 · 가장 오래 걸려요",
    notePreview: "화면을 켜는 마지막 단계예요",
    progress: "준비 진행",
    stepOf: (total: number, at: number, name: string) => `${total}단계 중 ${at}단계 · ${name}`,
    done: "준비가 끝났어요",
    retrying: "다시 시도하는 중…",
    retryStill: "아직 화면이 뜨지 않았어요 — 한 번 더 시도해 볼까요?",
  },
  /** 다시 받은 초대장의 확인 창(U11). */
  invite: {
    /** 끝난 뒤(성공)의 제목 — 확인 단계의 제목은 질문이다(`confirmTitle`). */
    title: "초대 파일을 가져왔어요",
    renewed: "연결 코드를 새 것으로 바꿨어요",
    reconnected: "만료됐던 연결이 새 코드로 다시 이어졌어요",
    reaches: (n: number) => `프로젝트 ${n}개에 이어져요`,
    addedNote: "처음 열 때 준비에 몇 분 걸려요",
    /** 새로 오는 행의 보조 단추 — 가져오기가 끝나면 그 프로젝트로 간다. 주 단추는 푸터의 `가져오기` 하나다. */
    openNow: "가져와서 열기",
    keptNote: "초대장에 없는 프로젝트도 지우지 않아요.",
    nothingChanged: "프로젝트에 바뀐 것은 없어요. 연결 코드만 새로 받았어요.",
    mine: "프로젝트 이름은 내가 정한 것이라 그대로 둬요.",
    warn: "초대 파일에는 연결 코드가 들어 있어요. 가져왔으니 파일은 지워 주세요.",
    ok: "알겠어요",
    /** 확인판의 적용 버튼 — 첫 실행과 다시 받기가 같은 말을 쓴다. */
    apply: "가져오기",
    cancel: "그만두기",
    /** 적용이 도는 동안의 한 줄 — "N개 중 M개 연결됨". */
    progressing: (done: number, total: number) => `${total}개 중 ${done}개 연결됨…`,
    /** 읽기 실패 뒤 다른 파일을 고르는 버튼. */
    otherFile: "다른 파일 열기",
    /** 행의 꼬리표(U11) — 새로 · 바뀜 · 그대로. */
    rowNew: "새로",
    rowUpdate: "바뀜",
    rowKeep: "그대로",
    /** 옛 초대장이 이름을 싣지 않았을 때만 묻는 선택 칸. */
    authorLabel: "이 작업에 적을 이름 (선택)",
    /** 파일을 읽지 못했을 때 확인판의 제목 — 「가져왔어요」가 아니다. */
    errorTitle: "초대 파일을 열지 못했어요",
    // ── 2026-10-06 겹판 손질(F) — 단계의 시제 · 하나의 주 단추 · 파일 정리를 끝으로 · 사람 말의 오류
    /** 확인 단계 — 질문과 영향의 크기. 아직 아무것도 바뀌지 않았다(가져왔어요 아님). */
    confirmTitle: "이 초대 파일을 가져올까요?",
    confirmSub: "가져오면 연결 코드가 새 것으로 바뀌어요",
    confirmSubReconnect: "가져오면 만료된 연결이 새 코드로 다시 이어져요",
    readingTitle: "초대 파일을 여는 중이에요",
    /** 적용 중 — 닫을 수 없는 이유가 머리에 선다. 지금 하는 행의 이름을 말한다. */
    applyingTitle: "가져오는 중이에요",
    applyingSub: "끝날 때까지 닫을 수 없어요",
    applyingName: (name: string) => `‘${name}’ 연결하는 중…`,
    /** 끝난 뒤 — 실패 위에는 성공의 말을 걸지 않는다. */
    partialTitle: "일부만 가져왔어요",
    partialSub: (ok: number, total: number) => `프로젝트 ${total}개 중 ${ok}개를 가져왔어요`,
    failedTitle: "가져오지 못했어요",
    tokenTitle: "연결하지 못했어요",
    tokenRefused:
      "초대 파일의 연결 코드를 받아들이지 못했어요. 프로젝트는 하나도 바뀌지 않았어요. 개발자에게 새 초대 파일을 부탁해 주세요.",
    tokenOffline:
      "연결이 끊겨 있어요. 프로젝트는 하나도 바뀌지 않았어요. 연결되면 다시 시도해 주세요.",
    rowFailed: "가져오지 못했어요",
    /** 날것의 이유를 접어 두는 머리. */
    detail: "자세히",
    until: (when: string) => `연결은 ${when}예요`,
    listHead: (n: number) => `초대장의 프로젝트 ${n}개`,
    readmeLabel: "개발자가 남긴 말",
    /** 연결이 없을 때 가져오기를 잠그는 이유 — 앞에 연결의 말(`chat.offline`)이 선다. */
    lockNote: "연결되면 가져올 수 있어요",
    /** 파일 정리 — 가져온 뒤의 일이다. 앱은 OS 휴지통에 넣는다(되살릴 수 있다). */
    warnTrash: "초대 파일에는 연결 코드가 들어 있어요. 가져왔으니 휴지통에 넣어 두세요.",
    trashFile: "초대 파일 휴지통에 넣기",
    trashed: "넣었어요 · 필요하면 휴지통에서 꺼낼 수 있어요",
    trashFailed: "휴지통에 넣지 못했어요 — 파일을 직접 지워 주세요",
    /** 읽기 실패의 사람 말 — 날것은 「자세히」 안에 접는다. */
    errNotInvite: "초대 파일이 아니에요 — 개발자에게 받은 초대 파일을 골라 주세요.",
    errSealed:
      "초대 파일을 열지 못했어요 — 파일이 손상됐을 수 있어요. 개발자에게 파일을 다시 보내 달라고 부탁해 주세요.",
    errUnreadable:
      "초대 파일을 읽지 못했어요 — 개발자에게 파일을 다시 보내 달라고 부탁해 주세요.",
    errVersion:
      "이 앱이 지원하지 않는 초대 파일이에요 — 앱을 최신 버전으로 업데이트했는지 확인해 주세요.",
    errNoToken: "초대 파일에 연결 코드가 없어요 — 개발자에게 다시 만들어 달라고 부탁해 주세요.",
    errContent:
      "초대 파일의 내용에 문제가 있어요 — 개발자에게 다시 만들어 달라고 부탁해 주세요.",
    errFile: "파일을 읽지 못했어요 — 파일을 다시 골라 주세요.",
    /** 도달 검사 — 새 연결 코드로 이 프로젝트를 제출할 수 없다. */
    reachWarn: (name: string) =>
      `‘${name}’ 프로젝트는 새 연결 코드로 제출할 수 없어요 — 개발자에게 알려 주세요.`,
  },
  /** 바뀜 행의 무엇이 바뀌었는가(U11) — 짝의 지금 값과 비교해 만든 한 줄. */
  inviteChange: {
    /** 값(브랜치 이름)은 개발 어휘라 문장에 싣지 않는다(F21, 2026-10-10 UX 조사). */
    baseBranch: "프로젝트의 기준이 바뀌어요",
    reviewers: "받을 개발자 명단이 바뀌어요",
    approve: "개발자가 미리 허락해 둔 작업이 있어요",
    defaults: "기본 모델 · 생각 시간이 바뀌어요",
    lifecycle: "작업 규칙이 바뀌어요",
  },



  // ── 단계 6 설정·업데이트
  settings: {
    title: "설정",
    ai: "AI",
    aiSub: "화면을 함께 고치는 AI와 미리보기 동작을 확인해요",
    aiConnected: "연결된 AI",
    notInstalled: "설치되지 않았어요 · 없어도 모든 일이 돼요",
    install: "설치",
    login: "로그인",
    loginNeeded: "로그인이 필요해요 · 설치는 돼 있어요",
    loginReopen: "로그인 창 다시 열기",
    loginCode: "로그인 코드 붙여넣기",
    loginCodeSend: "코드 보내기",
    theme: "테마",
    /** 테마 쪽 아래의 안내 줄 — 앱 전체를 키우고 줄이는 단축키(Windows 는 Ctrl). */
    zoom: "글자 크기",
    zoomSub: "앱 전체를 키우고 줄여요",
    themeSub: "화면 전체의 색깔이에요 · Claude 가 기본이에요",
    notify: "알림",
    /** 테마 줄의 선택지 — 설정이 보여주는 목록(lib/settings 의 PICKER_THEMES)과
     *  한 쌍이다. */
    themeNames: {
      system: "시스템 따르기",
      claude: "Claude · 기본",
      light: "밝음",
      dark: "어두움",
      "github-light": "GitHub 밝음",
      github: "GitHub 어두움",
    },
    /** 고를 수 있는 것은 `다 만들었을 때` 뿐이다 — 나머지(확인 요청 · 멈춤 · 게이트 실패 · 제출 막힘 · 개발자 쪽 사건)는 언제나 온다(notify-policy.ts). */
    notifySub: "내가 봐야 할 일과 개발자 쪽 소식은 언제나 알려요",
    notifyDone: "다 만들었을 때",
    notifyOff: "끔",
    notifyLong: "오래 걸린 답만",
    notifyAll: "모든 답",
    sound: "소리",
    testNotify: "시험 알림",
    testRow: "알림이 오는지 확인",
    openSystemNotify: "시스템 알림 설정 열기",
    testNotifyNote:
      "시험 알림이 오지 않으면 이 컴퓨터가 알림을 막아 둔 거예요. 시스템 알림 설정에서 켜 주세요.",
    connection: "연결",
    connectionSub: "개발자에게 받은 초대 파일로 이어져요",
    authorName: "작업에 적을 이름",
    authorNameSub: "제출에 작성자로 적혀요",
    connectionCode: "연결 코드",
    inviteRow: "초대 파일",
    inviteRowSub: "새 프로젝트를 더하거나 연결을 다시 이을 때 열어요",
    openInvite: "초대 파일 열기",
    resetTitle: "처음부터 다시 시작",
    resetSub: "이 컴퓨터의 프로젝트 · 작업 기록 · 설정 · 연결 정보를 모두 지우고 새 초대 파일로 시작해요",
    resetAction: "전체 초기화…",
    resetBusy: "다시 시작하는 중…",
    resetFailed: "초기화를 시작하지 못했어요. 앱을 다시 열고 시도해 주세요.",
    update: "업데이트",
    updateSub: "켤 때 · 돌아올 때 · 하루 한 번 저절로 확인해요",
    developer: "개발자용",
    developerSub: "보통은 열 일이 없어요",
    /** 왼쪽 목록의 점이 읽히는 말 — 새 버전이 있거나 연결이 곧 끝나는 쪽에 점이 서고, 쪽마다 이유를 말한다. */
    attentionUpdate: "새 버전",
    attentionSoon: "곧 끝나요",
    attentionExpired: "끝났어요",
    toolFolder: "도구 폴더",
    openFolder: "폴더 열기",
    dailyLog: "하루 로그",
    openLogFolder: "기록 폴더 열기",
    loggedIn: "로그인됨",
    testSent: "보냈어요",
    testBlocked: (reason?: string) =>
      reason ? `컴퓨터가 알림을 막았어요 — ${reason}` : "컴퓨터가 알림을 막았어요",
    testNotifyBody: "실제 알림은 이렇게 도착해요",
    close: "닫기",
    /** 연결의 남은 날(U17) — 설정 → 연결 한 줄의 만료 문장. */
    connectionUntil: (month: number, day: number) => `${month}월 ${day}일까지`,
    connectionEnding: (days: number) => `연결이 ${days}일 뒤 끝나요`,
    connectionAsked: "개발자에게 새 초대 파일을 부탁했어요",
    connectionAsk: "개발자에게 새 초대 파일을 부탁하세요",
    /** 설치 · 로그인 단추가 도는 동안의 말 — 확인이 아니라 하는 일의 이름이다. */
    installBusy: "설치하는 중…",
    loginBusy: "로그인하는 중…",
    codeSending: "보내는 중…",
    // 2026-10-04 ux-review: 작업에 적을 이름의 한 줄 — 실제로 바뀐 값에만 선다. 저장이라는 말은 없다(GUIDE 29 · F22).
    saved: "적어 두었어요",
    // 2026-10-06 설정 손질(S2): AI 카드 안의 설치 · 로그인 진행과 실패, 고른 AI 의 말, 빈 목록.
    aiInstallFailed: "설치하지 못했어요",
    aiLoginFailed: "로그인을 마치지 못했어요",
    aiLoginWaiting: "브라우저에서 로그인을 마쳐 주세요",
    detail: "자세히",
    aiCodeFailed: "코드를 보내지 못했어요 — 로그인 창을 다시 열어 새 코드를 받아 주세요",
    aiPickedNow: "다음 새 대화에 써요",
    aiPickedGone: (name: string) =>
      `${name}를 지금 쓸 수 없어요 — 다른 AI를 고르거나 아래에서 준비해 주세요`,
    aiLoading: "AI 목록을 불러오는 중이에요",
    aiNone: "쓸 수 있는 AI가 아직 없어요 — 설치하면 여기에 나타나요",
    // 2026-10-06 설정 손질(S0 · S3 · S4 · S5 · S6): 이름 저장 · 알림 기준 · 초기화 규모 · 테마 · 글자 크기.
    nameSaving: "이름을 적어 두는 중…",
    nameSaveFailed: "이름을 적어 두지 못했어요 — 다시 시도해 주세요",
    authorPlaceholder: "비워 둘 수도 있어요",
    notifyOffNote: "끝났다는 알림은 없어요 — 내가 봐야 할 일과 개발자 쪽 소식은 계속 와요",
    notifyLongNote: (minutes: number) => `${minutes}분 넘게 걸린 답만 알려요`,
    notifyAllNote: "답이 끝날 때마다 알려요",
    testSending: "보내는 중…",
    resetAsking: "확인하는 중…",
    resetCount: (projects: number, unsubmitted: number) => {
      const keep = "이미 제출한 작업과 AI 로그인은 그대로예요";
      if (projects === 0) return `지울 프로젝트는 없어요 · ${keep}`;
      return unsubmitted > 0
        ? `프로젝트 ${projects}개가 지워지고 제출하지 않은 작업 ${unsubmitted}개는 사라져요 · ${keep}`
        : `프로젝트 ${projects}개가 지워져요 · ${keep}`;
    },
    themeSystemNow: (dark: boolean) => `지금은 ${dark ? "어두움" : "밝음"}`,
    zoomIn: "키우기",
    zoomOut: "줄이기",
    zoomReset: "원래대로",
  },
  /** 업데이트 줄(U12) — 앱 · Claude Code 가 한 목록. */
  update: {
    available: (from: string, to: string) => `${from} → ${to} 있어요`,
    latest: "최신이에요",
    doneAt: (time: string) => `${time}에 업데이트했어요`,
    deferred: "도는 작업이 끝나면 설치해요",
    run: "업데이트",
    autoLabel: "새 AI 버전은 스스로 설치해요",
    autoNote: "도는 작업이 있으면 끝난 뒤에 설치해요",
    checkNow: "지금 확인",
    checking: "확인하는 중",
    foundCount: (n: number) => `새 버전 ${n}개`,
    allLatest: "모두 최신이에요",
    /** 홈의 `방금 있던 일` 한 줄 — 데몬이 AI 프로그램을 새 버전으로 바꿨다. */
    doneEvent: (name: string, version: string) => `${name} 를 ${version} 으로 업데이트했어요`,
    appRestart: "곧 새 버전으로 다시 열려요",
    releasesLink: "설치 파일 내려받기",
    retry: "다시 시도",
    useNextTime: "새 버전은 다음 새 대화부터 써요",
    current: (version: string) => `현재 ${version}`,
    appAvailable: (to: string) => `새 버전 ${to} 있어요`,
    app: "앱",
    /** 재시작 설치가 도는 동안의 말 — 내려받고 다시 시작하는 일이다. */
    appBusy: "다시 시작하는 중…",
    // 2026-10-04 ux-review: 확인 실패를 「없음」으로 말하지 않게 — 실패는 별개로 센다.
    checkFailed: "확인하지 못한 항목이 있어요",
    foundButFailed: (n: number) => `새 버전 ${n}개 · 확인 못 한 항목도 있어요`,
    rowCheckFailed: "확인하지 못했어요",
    // 2026-10-06 설정 손질(S7): 앱 줄의 걸음(내려받기 → 준비됨 → 다시 시작)과 쪽 맨 위의 요약 띠.
    appFlow: "내려받은 뒤 다시 시작하면 새 버전이 돼요",
    appDeferred: "도는 작업이 끝나면 내려받아요",
    appReady: "내려받았어요 · 다시 시작하면 새 버전이 돼요",
    appRestartNow: "지금 다시 시작",
    appLater: "나중에",
    appRestartDeferred: "도는 작업이 끝나면 다시 시작해요",
    updateFailed: "업데이트하지 못했어요",
    lastChecked: (time: string) => `마지막 확인 · ${time}`,
    summaryChecking: "새 버전을 확인하는 중이에요",
    summaryUpdating: "업데이트하는 중이에요",
    summaryFailedHint: "인터넷 연결을 확인하고 다시 눌러 보세요",
    summaryUnknown: "아직 확인하지 않았어요",
    updateNone: "확인할 프로그램이 아직 없어요",
    updateNoneSub: "AI를 설치하면 여기에 나타나요",
    notInstalledRow: "설치 전 · AI 쪽에서 설치해요",
    goAi: "AI 쪽으로",
    autoFailed: "설정을 바꾸지 못했어요 — 다시 시도해 주세요",
  },



  // ── 크래시 안내(PLAN-CRASH-PROCESS 3.A) — 와치독 문장과의 글자 동치는 시험이 지킨다.
  crash: {
    title: "화면에 문제가 생겼어요",
    body: "다시 열면 대화와 작업은 그대로예요.",
    reopen: "다시 열기",
    bootTitle: "화면이 열리지 않아요",
    repeatTitle: "같은 문제가 계속 생겨요",
    repeatBody: "대화와 작업은 보관돼 있어요. 아래 내용을 담당자에게 전해 주세요.",
    openLogs: "기록 폴더 열기",
  },



  // ── 찾기(⌘K) 창 — 셸 밖(components/shell)에 빌려 쓰는 판이라 사이드바와
  // 같은 말을 쓴다.
  palette: {
    find: "문서, 대화 이름이나 내용, 프로젝트 찾기",
    findInProject: "이 프로젝트의 대화 이름이나 내용 찾기",
    recentConvs: "최근 대화",
    projectConvs: (name: string) => `${name}의 대화`,
    commands: "명령",
    nowOpen: "지금 열림",
    noMatch: (word: string) => `'${word}'에 맞는 것이 없어요`,
    messageMatch: "대화 내용",
    noConvs: "아직 대화가 없어요",
    noConvsInProject: "이 프로젝트에 아직 대화가 없어요",
    settingsHint: "AI · 테마 · 알림 · 연결 · 업데이트",
    newConvHint: "빈 새 대화를 열어요",
    homeHint: "홈으로 가요",
    move: "이동",
    open: "열기",
    close: "닫기",
    /** 맞는 줄이 하나도 없을 때 빈 상태 아래에 서는 한 줄 — 아래 칩이 막다른 길을 열어 준다(2026-10-06 겹판 조사). */
    noMatchHelp: "다른 말로 찾아 보거나, 아래에서 바로 시작해 보세요",
    /** 프로젝트 줄을 눌러 옮기는 동안 줄 끝에 서는 말. */
    moving: "옮기는 중…",
    /** 낭독 전용 — 찾는 말을 바꾸고 잠시 뒤 결과 수를 한 번 말한다. */
    resultCount: (n: number) => `${n}개를 찾았어요`,
    plansHint: "기획서로 가요",
  },
  // ── 기능 제안(PLAN-FEEDBACK) — 사이드바 바닥의 단추와 한 장의 대화상자
  feedback: {
    button: "기능 제안",
    title: "기능 제안",
    requestLabel: "어떤 기능이 있으면 좋겠어요?",
    requestPlaceholder: "원하는 기능을 적어 주세요",
    contextLabel: "지금 어떤 점이 불편한가요? (선택)",
    contextPlaceholder: "버튼이 어디에 있는지, 화면이 어떻게 반응하는지 따위를 적어 주세요",
    requestEmpty: "무엇을 제안할지 적어 주세요.",
    requestTooLong: (max: number) => `글자 수가 너무 많아요 — ${max}자 이하로 줄여 주세요.`,
    contextTooLong: (max: number) => `불편한 점은 ${max}자 이하로 적어 주세요.`,
    count: (n: number, max: number) => `${n} / ${max}`,
    toReview: "보낼 내용 확인",
    edit: "수정하기",
    submit: "제안 보내기",
    destinationLabel: "접수 대상",
    destination: "ColoNova Design 제작팀",
    notAttached:
      "대화, 화면, 프로젝트 이름, 소스, 기록, 연결 정보, 작성 이름은 함께 보내지 않아요.",
    requestHeading: "하고 싶은 말",
    contextHeading: "불편한 점",
    sentLink: "보낸 제안 보기",
    close: "닫기",
    browserTitle: "브라우저에서 마무리해 주세요",
    browserNote:
      "아직 접수되지 않았어요. GitHub 로그인을 다시 하거나 내용을 확인해 올리면 접수가 끝나요.",
    openBrowser: "브라우저에서 마무리",
    copyTitle: "제목 복사",
    copyBody: "내용 복사",
    copied: "복사했어요",
    copyFailed: "복사하지 못했어요 — 아래 내용을 직접 선택해 복사해 주세요.",
    newIssueLink: "빈 작성 페이지 열기",
    failedTitle: "제안을 보내지 못했어요",
    failedNote: "접수가 거절됐어요. 내용을 고치거나 다시 시도해 주세요.",
    retry: "다시 시도",
    uncertainTitle: "접수 여부를 확인하지 못했어요",
    uncertainNote:
      "보내는 중에 연결이 끊겼을 수 있어요. 같은 제안을 다시 보내면 두 번 올라갈 수 있으니, 아래 목록에서 먼저 확인해 주세요.",
    checkList: "제안 목록 확인",
    copySubmitted: "보낸 내용 복사",
    acknowledgeList: "목록을 확인했어요 · 새 제안 작성",
    // ── 2026-10-06 겹판 손질(F) — 단계 머리 · 공개 고지 · 접수의 순간 · 연결 문지기
    /** 단계 머리(세 점)와 단계마다 바뀌는 판의 이름 — 낭독이 지금 무엇을 하는지 읽는다. */
    stepsLabel: "진행 단계",
    stepWrite: "쓰기",
    stepReview: "확인",
    stepSend: "접수",
    editSub: "제작팀이 직접 읽어요",
    reviewTitle: "이대로 보낼까요?",
    reviewSub: "보내기 전에 한 번 확인해 주세요",
    sendingTitle: "보내는 중이에요",
    sendingSub: "창을 닫아도 계속 보내요",
    sendingNote: "제작팀의 게시판에 올리고 있어요",
    sentHead: "접수했어요",
    /** 접수의 순간 — 큰 체크 아래 한 줄과 인사. */
    sentHero: (n: number) => `제안을 접수했어요 · #${n}`,
    sentThanks: "고마워요. 제작팀이 읽어 볼게요",
    /** 쓰는 중의 손맛 — 닫아도 초안이 남는다는 안내와 바로 확인하는 키. */
    footNote: "닫아도 쓴 내용은 남아요",
    toReviewKeys: "⌘↵",
    /** 되돌릴 수 없는 공개 — 가장 중요한 문장이 가장 눈에 띄게. */
    publicTitle: "누구나 볼 수 있는 게시판에 올라가요",
    publicBody: "제작팀의 게시판에 올라가고, 앱 버전과 운영체제만 함께 가요.",
    notAttachedTitle: "함께 보내지 않는 것",
    /** 연결이 없을 때 보내기를 잠그는 이유 — 앞에 연결의 말(`chat.offline`)이 선다. */
    lockNote: "연결되면 보낼 수 있어요. 쓴 내용은 그대로 남아요.",
    /** 요청이 나가기도 전에 막혔을 때 — 접수 여부가 불확실한 것이 아니다. */
    notSent: "보내지 못했어요 — 연결이 끊겨 있었어요. 쓴 내용은 그대로 남아 있으니 연결되면 다시 보내 주세요.",
    /** 닫은 사이의 소식 — 토스트로만 알릴 수 있다. */
    closeWhileSending: "보내는 중이에요 — 닫아도 계속 보내요",
    toastSent: "기능 제안을 접수했어요",
    toastNeedsYou: "기능 제안이 아직 끝나지 않았어요 — 다시 열어 확인해 주세요",
    browserFold: "열린 페이지가 비어 있나요?",
    browserFoldNote: "내용을 복사해서 붙여 넣으면 돼요.",
    submittedHeading: "보낸 내용",
  },
  /** 단축키 시트(⌘/) — 행의 글은 프로토콜 상수(`APP_SHORTCUTS`)에서 오고, 여기는 틀의 문장만. */
  sheet: {
    title: "단축키",
    sub: "마우스 없이도 앱을 다룰 수 있어요",
    groupApp: "앱",
    groupPreview: "미리보기",
    groupPin: "핀",
    groupComposer: "입력창",
    groupRest: "그 밖에",
    footBefore: "언제든",
    footAfter: "로 이 창을 열 수 있어요",
  },
  /** 첫 연결이 안 된 데스크톱의 안내판 — 개발자용 연결 화면(주소 붙여넣기)을 대신한다. */
  connect: {
    title: "아직 연결되지 않았어요",
    body: "연결이 되는 대로 이어져요. 계속 안 되면 앱을 다시 열어 주세요.",
    waiting: "다시 연결하는 중…",
    retry: "지금 다시 시도",
  },
  // ── 기획서(Confluence) — 동기화 1단계의 연결(설정)과 읽는 칸(오른쪽 칸의 얼굴). 두 면의 문장이 한 칸에 선다.
  plans: {
    // 연결(설정 → 연결의 기획서 상자)
    title: "기획서 연결",
    titleSub: "기획서를 이 앱에서 바로 읽고 초안으로 고쳐요",
    site: "사이트 주소",
    sitePlaceholder: "예) colosseum.atlassian.net",
    email: "이메일",
    emailPlaceholder: "예) name@company.com",
    token: "API 토큰",
    tokenPlaceholder: "토큰을 붙여 넣어 주세요",
    tokenNote: "이메일과 토큰은 한 번만 넣어요 — 저장 뒤에는 이 화면에 다시 나오지 않아요",
    tokenHelp: "토큰이 없다면 Atlassian 계정의 보안 설정에서 만들 수 있어요",
    tokenHelpLink: "토큰 만드는 곳 열기",
    connect: "연결하기",
    connecting: "연결하는 중…",
    reconnect: "다시 연결하기",
    cancel: "그만두기",
    rootQuery: "기준 페이지",
    rootSub: "이 페이지 아래의 문서를 모두 가져와요",
    rootPlaceholder: "예) 8.8 ColoNova",
    changeRoot: "바꾸기",
    findRoots: "찾기",
    finding: "찾는 중…",
    pickRoot: "고르기",
    picking: "정하는 중…",
    rootsHeading: (count: number) => `찾은 페이지 ${count}개`,
    rootsEmpty: "검색 결과가 없어요 — 다른 이름으로 찾아 보세요",
    statusNotConnected: "아직 연결하지 않았어요",
    statusConnected: (site: string) => `${site} 에 연결됐어요`,
    statusRooted: (title: string) => `기준 페이지: ${title}`,
    statusImported: (when: string, count: number) => `${when} 가져왔어요 · 문서 ${count}개`,
    statusExpired: "다시 연결이 필요해요 — 이메일과 토큰을 넣어 연결해 주세요",
    failed: (detail: string) => `연결하지 못했어요 — ${detail}`,
    // 읽는 칸 — 사이드바의 항목 · 위쪽 막대 · 가져오기 줄
    sidebar: "기획서",
    open: "기획서 열기",
    crumbNav: "지금 위치",
    listHeading: "기획서",
    importNow: "새로 가져오기",
    importing: "가져오는 중…",
    syncNever: "아직 가져온 적이 없어요",
    importUpToDate: "이미 최신이에요",
    importChanged: (count: number) => `문서 ${count}개를 새로 가져왔어요`,
    importCapped: (count: number) =>
      `한 번에 가져올 수 있는 만큼(${count}개)만 가져왔어요 — 한 번 더 눌러 나머지를 가져오세요`,
    importFailed: "가져오지 못했어요 — 잠시 뒤 다시 시도해 주세요",
    openSettings: "설정 열기",
    // 목록 — 찾기 · 폴더 접기 · 비었을 때
    treeLabel: "기획서 목록",
    filterLabel: "기획서 찾기",
    filterPlaceholder: "제목으로 찾기",
    filterClear: "찾는 말 지우기",
    docCount: (count: number) => `문서 ${count}개`,
    filterResult: (count: number) => `${count}개를 찾았어요`,
    filterNone: "맞는 문서가 없어요 — 다른 말로 찾아 보세요",
    foldOpen: (title: string) => `${title} 펼치기`,
    foldClose: (title: string) => `${title} 접기`,
    docVersions: (version: number) => `판 ${version}`,
    // Confluence 전용 항목의 종류 — 이 앱이 열지 못하는 것을 제목 옆의 작은 글로 알린다(2026-10-23 F0).
    unsupportedKind: (type: string) =>
      type === "whiteboard"
        ? "Confluence 전용 · 화이트보드"
        : type === "database"
          ? "Confluence 전용 · 데이터베이스"
          : type === "embed"
            ? "Confluence 전용 · 임베드"
            : "Confluence 전용 · 이 앱이 모르는 종류",
    emptyNoneTitle: "기획서를 이 앱에서 읽고 써요",
    // 2026-10-23 기획자 화면 손질 D7 — 초안(F1) 이후 「여기서 읽기만 한다」 는 틀린 말이 됐다.
    emptyNoneBody:
      "Confluence 에 한 번만 연결하면 기획 문서를 화면 옆에서 읽고, 이 컴퓨터의 초안으로 AI 와 함께 고칠 수 있어요. Confluence 에서 직접 고치는 길도 그대로예요.",
    connectNow: "설정에서 연결하기",
    emptyListTitle: "아직 가져온 기획서가 없어요",
    emptyListRooted: "기준 페이지 아래의 문서를 가져오면 여기에 나타나요.",
    emptyListNoRoot: "설정에서 기준 페이지를 정하면 그 아래의 문서를 가져와요.",
    emptyListExpired: "연결이 끊겨 가져오지 못했어요 — 설정에서 다시 연결해 주세요.",
    listLoading: "기획서 목록을 불러오는 중…",
    listFailed: "기획서 목록을 읽지 못했어요",
    listFailedBody: "인터넷 연결을 확인하고 다시 시도해 주세요",
    retry: "다시 시도",
    // 문서 — 본문 · 코멘트 · 읽기 실패
    backToList: "다른 문서 고르기",
    reading: "문서를 읽는 중…",
    readingNote: "Confluence 에서 가져오느라 몇 초 걸릴 수 있어요",
    docFailed: "문서를 읽지 못했어요 — 인터넷 연결을 확인하고 다시 시도해 주세요",
    docUpdated: (when: string) => `${when} 고침`,
    openInConfluence: "Confluence 에서 열기",
    macroNoteTitle: "Confluence 에서만 온전히 보이는 부분이 있어요",
    macroNoteBody: "아래 절의 상자 · 표시는 여기서 자리만 보여요. 고치려면 Confluence 에서 열어 주세요.",
    // 아래 두 마커는 데몬이 파생 마크다운에 남기는 자리 표시(`[Confluence 매크로: 이름]` ·
    // `[첨부: 파일]`)와 글자가 같아야 한다 — 본문을 그릴 때 알약 글로 바꾸는 눈금이다.
    macroMarker: "Confluence 매크로",
    attachMarker: "첨부",
    macroInline: (name: string) => `Confluence 전용 · ${name}`,
    attachInline: (name: string) => `첨부 · ${name}`,
    commentHeading: (count: number) => `안 풀린 코멘트 ${count}개`,
    commentNote: "코멘트는 Confluence 에 바로 남아요",
    commentsUnavailable: "코멘트는 지금 읽지 못했어요",
    commentAnchor: (anchor: string) => `이 부분: ${anchor}`,
    commentNoAuthor: "이름 없음",
    menu: "기획서 더보기",
    draftsInProgress: "작성 중인 초안",
    hasDraft: "초안 있음",
    focusTree: "목록에서 찾기",
  },
  // ── 기획 초안(2026-10-23 · 최종 구현 계획 F1) — 문서를 블록으로 읽고 고치는 초안 편집기. 발행은 다른 칸의 몫이다.
  drafts: {
    // 들어가는 길 — 읽는 문서의 머리에서 초안 편집기로
    edit: "고치기",
    /** 이어 보기 막대의 마지막 걸음에 붙는 표시 — 지금 문서가 아니라 그 초안을 본다는 말이다. */
    chip: "초안",
    // 머리 — 제목 · 한 줄 상태 · 닫기 · 버리기
    close: "닫기",
    discard: "초안 버리기",
    discardTitle: "이 초안을 버릴까요?",
    discardBody: "이 컴퓨터에 보관한 초안을 지워요. Confluence 의 문서는 그대로 남아요.",
    discardConfirm: "버리기",
    cancel: "그만두기",
    /** 머리 상태의 툴팁 — 개정 번호는 기획 근거 칩의 `개정 N` 과 맞춰 볼 때 쓴다. */
    meta: (revision: number, baseVersion: number | null) =>
      baseVersion === null
        ? `새 초안 · 개정 ${revision}`
        : `초안 · 개정 ${revision} · 기준 판 ${baseVersion}`,
    /**
     * 머리의 한 줄 상태(2026-10-23 기획자 화면 손질 D3) — 어디서 시작했고 무엇이 바뀌었는지를 블록 배지와 같은 말로 센다.
     * 지운 블록은 초안에 보이지 않아 여기서 세지 않는다 — 발행 확인 창이 모두 센다.
     */
    metaLine: (baseVersion: number | null, changed: number, inserted: number) => {
      const parts = [baseVersion === null ? "새 문서 초안" : `Confluence 판 ${baseVersion} 에서 시작`];
      if (changed > 0) parts.push(`고침 ${changed}`);
      if (inserted > 0) parts.push(`새로 ${inserted}`);
      return parts.join(" · ");
    },
    /**
     * 아직 Confluence 에 올리지 않은 바뀐 곳이 있는 초안의 알약 — 이 컴퓨터의 보관과 팀의 공식본을 가른다(정본 §11). 지운 블록도
     * 바뀐 곳이다 — 초안 요약의 수(`changedBlocks`)로 함께 본다.
     */
    unpublished: "아직 발행 전",
    /** 제목의 단계 표기가 1.0 이후일 때 배지 옆에 선다 — 발행이 새 판을 만든다는 안내다. */
    stageClosed: "발행하면 새 판이 돼요",
    locked: "발행을 확인하는 동안은 고칠 수 없어요 — 끝나면 다시 고칠 수 있어요.",
    /** 방송으로 다시 읽은 판 — 고치는 칸이 열려 있을 때의 한 줄(2026-10-23 화면 확인 · A4 완화). 칸의 글은 지우지 않는다. */
    reloadedOutside: "다른 창이나 대화에서 초안이 바뀌어 다시 읽었어요 — 고치던 내용을 다시 살펴 주세요.",
    staleReloaded: "초안이 다르게 바뀌어 있어 다시 읽었어요 — 방금 고친 내용을 다시 적어 주세요.",
    loadFailed: "초안을 읽지 못했어요 — 잠시 뒤 다시 시도해 주세요.",
    titleField: "제목",
    /** 새 문서 제목의 한계 — 숫자는 선로 스키마(`packages/protocol/src/draft.ts` 의 255자)와 같다(2026-10-23 화면 확인). */
    limitTitleLength: "제목은 255자까지 쓸 수 있어요",
    // 블록의 처지 배지
    statusSame: "그대로",
    statusChanged: "고침",
    statusNew: "새로",
    statusConflict: "충돌",
    // 블록의 손잡이 단추
    blockEdit: "고치기",
    addBelow: "아래에 더하기",
    moveUp: "위로",
    moveDown: "아래로",
    remove: "지우기",
    revert: "되돌리기",
    addParagraph: "문단",
    addHeading: "제목",
    addList: "목록",
    addTable: "표",
    /** 보존 조각의 상자 — 이름표는 `tokenLabel` 이 사람의 말로 바꿔 준다. */
    preservedBox: (label: string) => `${label} — Confluence 전용 조각`,
    preservedNote: "여기서는 고칠 수 없어요 — Confluence 에서 고쳐요.",
    removePreservedTitle: "이 조각을 지울까요?",
    removePreservedBody: "Confluence 의 이 조각이 발행물에서도 빠져요.",
    removeConfirm: "지우기",
    // 고치는 칸
    apply: "적용",
    editCancel: "취소",
    levelLabel: "제목 수준",
    orderedLabel: "번호 목록",
    headingField: "제목 글자",
    bodyField: "본문",
    listField: "목록 항목 — 한 줄에 하나",
    cellLabel: (row: number, col: number) => `${row}번째 줄 ${col}번째 칸`,
    addRow: "행 더하기",
    removeRow: "행 빼기",
    addColumn: "열 더하기",
    removeColumn: "열 빼기",
    legendItem: (name: string, label: string) => `⟦${name}⟧ ${label}`,
    legendNote: "⟦…⟧ 는 Confluence 의 조각 자리예요 — 지우면 그 조각이 발행물에서 빠져요.",
    // 충돌 블록 — 내 것과 Confluence 것을 나란히 보고 고른다
    conflictMine: "내 것",
    conflictTheirs: "Confluence 것",
    useMine: "내 것 쓰기",
    useTheirs: "Confluence 것 쓰기",
    // 빈 초안
    emptyGuide: "아직 내용이 없어요 — 첫 문단부터 써 보세요.",
    writeDirectly: "직접 쓰기",
    /** 토큰 · 보존 조각의 기계 이름을 사람의 말로 — 모르는 이름은 막연한 Confluence 요소로 본다. */
    tokenLabel: (machine: string) => {
      // 시험이 표본 값으로도 불러 금칙어를 잰다 — 문자가 아니면 모르는 이름으로 본다.
      const name = typeof machine === "string" ? machine : "";
      if (name === "image") return "이미지";
      if (name === "link:page") return "문서 링크";
      if (name === "link:user") return "사람 멘션";
      if (name === "link:attachment") return "첨부 링크";
      if (name === "link") return "링크";
      if (name === "emoticon") return "이모티콘";
      if (name === "date") return "날짜";
      if (name === "placeholder") return "자리 표시";
      if (name === "comment-anchor") return "코멘트 닻";
      if (name === "cell:complex") return "복잡한 셀";
      if (name === "list:nested") return "중첩 목록";
      if (name === "table:merged") return "병합 셀이 있는 표";
      if (name === "table:nested") return "표 속 표";
      if (name === "heading:complex" || name === "paragraph:complex") return "복잡한 단락";
      if (name === "hr") return "가로줄";
      if (name === "blockquote") return "인용";
      if (name === "pre") return "서식 있는 글";
      if (name === "text") return "글";
      if (name.startsWith("macro:")) {
        const macros: Record<string, string> = {
          info: "정보 상자",
          note: "메모 상자",
          warning: "경고 상자",
          tip: "팁 상자",
          status: "상태 표시",
          expand: "펼치기",
          code: "코드 블록",
          toc: "목차",
          jira: "지라 연결",
        };
        const rest = name.slice("macro:".length);
        return macros[rest] ?? `${rest} 매크로`;
      }
      if (name.startsWith("format:")) return "글 모양";
      return "Confluence 요소";
    },
    // ── 기획 대화 — 초안 편집기 안에서 AI 와 문서를 다듬는 칸(2026-10-23 · 최종 구현 계획 F1)
    threadTitle: "기획 대화",
    /** 기획 대화 머리의 한 줄 — 이 AI 가 바꾸는 것과 바꾸지 않는 것(2026-10-23 기획자 화면 손질 · 정본 §6 실행 경계). */
    threadScope: "이 AI 는 문서의 변경안만 만들어요 — 화면과 Confluence 는 바꾸지 않아요",
    threadEmpty: "무엇을 어떻게 고칠지 물어보세요 — AI 가 변경안을 만들어 보여줄게요.",
    send: "보내기",
    inputHint: "예: 둘째 절에 목표를 더하고 문단을 나눠 줘",
    aiWorking: "AI 가 쓰는 중…",
    aiFailed: "AI 가 답을 마치지 못했어요",
    readBy: (count: number) => `AI 가 문서 ${count}개를 읽었어요`,
    // 변경안 카드 — 요약 · 걸음 · 처지 배지 · 채택 단추
    opAdopted: "채택함",
    opRejected: "거절함",
    staleBadge: "오래됨",
    opStale: "초안이 바뀌어 오래된 걸음이에요",
    opMissing: "원래 자리의 블록이 없어졌어요",
    opBlank: "빈 블록",
    opReplace: (head: string) => `“${head}” 블록을 고쳐 써요`,
    opInsert: (head: string | null) =>
      head === null ? "맨 앞에 블록을 더해요" : `“${head}” 블록 뒤에 더해요`,
    opDelete: (head: string) => `“${head}” 블록을 지워요`,
    opTitle: (title: string) => `제목을 “${title}” 로 바꿔요`,
    adoptSelected: "고른 것 채택",
    adoptAll: "모두 채택",
    reject: "거절",
    reask: "다시 요청",
    reaskPrompt: "앞 변경안을 다시 써 줘",
    // 근거 — 함께 보낼 문서와 절
    addRef: "근거 더하기",
    removeRef: "근거 빼기",
    refChip: (title: string, version: number | null, sections?: readonly string[]) => {
      // 시험이 표본 값으로도 불러 금칙어를 잰다 — 문자가 아니면 빈 자리로 본다.
      const parts = [
        typeof title === "string" ? title : "",
        version === null ? null : `판 ${version}`,
        Array.isArray(sections) && sections.length > 0 ? sections.join(", ") : null,
      ];
      return parts.filter((part) => part !== null && part !== "").join(" · ");
    },
    refSearchLabel: "찾기",
    refSearchHint: "제목이나 폴더 이름으로 찾아요",
    refNone: "맞는 문서가 없어요",
    refLoadFailed: "문서 목록을 읽지 못했어요 — 근거 더하기를 다시 눌러 주세요.",
    refMeta: (version: number, folder: string) => {
      const parts = [`판 ${version}`, typeof folder === "string" && folder !== "" ? folder : null];
      return parts.filter((part) => part !== null && part !== "").join(" · ");
    },
    refSectionsLabel: "절 이름",
    refSectionsHint: "예: 배경, 목표 — 쉼표로 나눠 적어요",
    refAdd: "근거로 담기",
    // 기획 대화의 입력 한계(2026-10-23 화면 확인) — 데몬의 검사에 부딪치기 전에 화면이 먼저 지킨다.
    // 숫자는 선로 스키마(`packages/protocol/src/draft.ts`)와 같다.
    limitQuestionLength: "질문은 8,000자까지 쓸 수 있어요",
    limitRefCount: "근거는 문서 20개까지 함께 보낼 수 있어요",
    limitSectionCount: "절은 20개까지 골라 주세요",
    limitSectionLength: "절 이름은 200자까지 쓸 수 있어요",
    startWithAi: "AI 와 시작하기",
    // ── 발행(2026-10-23 · 최종 구현 계획 F2) — Confluence 에 반영하기 전에 무엇이 반영되는지 보인다
    publish: "발행",
    /** 발행 게이트가 꺼져 있을 때 단추 안의 작은 표시와 그 풀이(2026-10-23 기획자 화면 손질 U2). */
    publishOff: "꺼짐",
    publishOffHint: "발행이 아직 꺼져 있어요 — 눌러서 반영할 내용은 미리 볼 수 있어요",
    publishTitle: "Confluence 에 발행",
    publishSub: "반영되는 내용과 막힌 것이 있으면 미리 알려요.",
    publishConfirm: "발행",
    publishing: "보내는 중…",
    previewTarget: "대상",
    previewTitle: "제목",
    previewVersions: (base: number | null, remote: number | null, revision: number) =>
      `기준 판 ${base ?? "없음"} · 지금 원격 판 ${remote ?? "없음"} · 초안 개정 ${revision}`,
    changeHeading: "이번에 반영할 내용",
    changeCounts: (changed: number, inserted: number, deleted: number) => {
      const parts: string[] = [];
      if (changed > 0) parts.push(`고침 ${changed}`);
      if (inserted > 0) parts.push(`새로 ${inserted}`);
      if (deleted > 0) parts.push(`지움 ${deleted}`);
      return parts.join(" · ");
    },
    protectedRemoved: (label: string) => `${label} — 지운 조각이 발행물에서도 빠져요`,
    /** 막는 이유의 글 — 이름은 선로의 기계 이름이다(시험이 열한 갈래를 대조한다). */
    blocker: {
      "publish-disabled": "발행이 아직 꺼져 있어요 — 검증을 마친 뒤 켜요",
      "nothing-to-publish": "바뀐 내용이 없어요 — 발행할 것이 없어요",
      "remote-newer": "Confluence 에 더 새 판이 있어요",
      "remote-draft": "Confluence 에서 누군가 고치는 중인 내용이 있어요",
      "remote-draft-unknown":
        "Confluence 에서 고치는 중인지 아직 몰라요 — Confluence 에서 확인해 주세요",
      "remote-missing": "Confluence 에서 문서를 찾지 못했어요 — 지워졌을 수 있어요",
      "no-permission": "이 문서를 바꿀 권한이 없어요",
      "out-of-scope": "연결한 기획서 범위 밖의 문서예요 — 여기서 발행하지 않아요",
      "conflict-open": "충돌한 블록이 남아 있어요 — 먼저 골라 주세요",
      "pending-command": "아직 결과를 확인하지 못한 발행이 있어요 — 결과를 다시 확인해 주세요",
      "unsupported-change": "여기서 고칠 수 없는 모양이 섞여 있어요 — Confluence 에서 고쳐 주세요",
    },
    actionRebase: "원격 최신본에 맞추기",
    actionOpen: "Confluence 에서 열기",
    actionResolve: "충돌 고르러 가기",
    actionRecheck: "결과 다시 확인",
    stageRevision: "이 발행은 새 판을 만들어요 — 새 단계 표기와 사유를 골라 주세요.",
    stageNotation: "새 단계 표기",
    /** 새 단계 표기의 한계 — 숫자는 선로 스키마(`packages/protocol/src/draft.ts` 의 32자)와 같다(2026-10-23 화면 확인). */
    limitNotationLength: "단계 표기는 32자까지 쓸 수 있어요",
    stageReason: "사유",
    stageReasonPick: "사유를 고르세요",
    stageReasonSpec: "기획 오류",
    stageReasonOps: "운영 요구",
    stageReasonResource: "리소스",
    stageReasonDirect: "직접 쓰기",
    resultApplied: (version: number) => `발행했어요 — Confluence 판 ${version}`,
    resultUnknownTitle: "결과 확인 필요",
    resultUnknownBody: "보낸 내용이 Confluence 에 닿았는지 아직 몰라요. 자동으로 다시 보내지는 않아요.",
    resultConflict: "Confluence 가 그 사이 바뀌었어요 — 원격 최신본에 맞추는 것이 좋아요.",
    resultNotApplied: "발행이 Confluence 에 닿지 않았어요 — 이유를 살펴 보고 결과를 다시 확인해 주세요.",
    resultFailed: "발행이 실패했어요",
    resultClosed: "결과 확인을 두고 종료했어요 — 다시 보내지 않아요.",
    publishedNote: "Confluence 에 발행이 반영됐어요.",
    conflictNote: "충돌한 블록을 골라 주세요 — 남길 쪽을 고르면 발행할 수 있어요.",
    viewInConfluence: "Confluence 에서 보기",
    closeNoResend: "재전송 없이 종료",
    closeNoResendTitle: "결과를 확인하지 않고 종료할까요?",
    closeNoResendBody: "Confluence 에 닿았는지 모른 채 이 상태를 거둬요. 같은 내용을 다시 보내지 않아요.",
    closeNoResendConfirm: "종료",
    // ── 새 문서 초안(2026-10-23 · 최종 구현 계획 F2)
    newDoc: "새 문서",
    newDocTitle: "새 문서 만들기",
    newDocSub: "Confluence 의 고른 자리 아래에 빈 문서의 초안을 만들어요.",
    newDocParent: "들어갈 자리",
    newDocParentPick: "자리를 고르세요",
    /** 들어갈 자리가 하나도 없을 때의 안내 — 가져오기가 먼저다(2026-10-23 화면 확인). */
    newDocNoPlace: "들어갈 자리가 아직 없어요 — 기획서를 먼저 가져와요",
    newDocTemplate: "밑그림",
    newDocTemplateNone: "없음",
    create: "만들기",
    creating: "만드는 중…",
    newDraftGroup: "새 문서 초안",
    resume: "초안 이어 쓰기",
    chipCount: (changed: number) => `초안 · ${changed}`,
    // ── 화면 작업에 근거 보내기(2026-10-23 · 최종 구현 계획 F3) — 문서 · 초안을 입력창 첨부로 담는다
    sendToScreen: "화면에서 확인",
    sendTitle: "근거로 보내기",
    sendSub: "고른 문서와 절을 화면 작업의 근거로 입력창에 담아요.",
    sendScope: "보낼 범위",
    sendWhole: "문서 전체",
    sendGo: "입력창에 담기",
    /** 초안의 근거임을 알리는 안내 — 발행 전이라는 말을 먼저 한다. */
    sendDraftNote: "아직 발행하지 않은 초안이에요 — 개발자에게는 미발행으로 전해져요",
    sentToComposer: "근거를 입력창에 담았어요 — 말을 붙여 보내 주세요",
    noComposer: "입력창을 찾지 못했어요 — 대화 칸을 열고 다시 시도해 주세요",
    sendFailed: "근거를 만들지 못했어요 — 잠시 뒤 다시 시도해 주세요",
    // 전후 비교의 이름(2026-10-23 화면 전면 재설계 §4 D).
    beforeChange: "바뀌기 전",
    afterChange: "바뀐 뒤",
    noBlock: "없음",
    removedBlock: "이 블록을 지워요",
    protectedHeading: "지워지는 Confluence 전용 조각",
    currentDraft: "지금 초안",
    proposalMenu: "변경안 더보기",
    threadExpand: "기획 대화 펼치기",
    threadCollapse: "기획 대화 줄이기",
  },
  // ── 기획 근거 줄(2026-10-23 · 최종 구현 계획 F3) — 화면 대화의 입력창 위에 이번 대화가
  // 삼은 근거가 한 줄로 선다. 칩을 누르면 그 문서 · 초안으로 돌아간다.
  planRefs: {
    /** 줄 머리 — 오른쪽에 오는 칩들이 무엇인지 이름한다. */
    stripLabel: "기획 근거",
    /** 발행된 문서의 판. */
    version: (n: number) => `판 ${n}`,
    /** 아직 발행하지 않은 초안 — 미발행임을 개정과 함께 말한다. */
    draftRevision: (n: number) => `미발행 초안 · 개정 ${n}`,
    /** 첫 절 외에 더 있는 절의 수. */
    sectionsMore: (n: number) => `외 ${n}`,
    /** 접힌 칩을 펼치는 단추 — 남은 근거의 수. */
    more: (n: number) => `+${n}`,
    /** 칩의 이름표 — 누르면 기획서 칸에서 그 문서 · 초안이 열린다는 말. */
    openAria: (title: string) => `${title} 기획서에서 열기`,
  },
  // ── 문서 관리(2026-10-23 · 최종 구현 계획 F4) — 복제 · 위치 옮기기 · 휴지통 · 복구. 영구 삭제는 없다.
  docOps: {
    menu: "더보기",
    copy: "복제",
    move: "위치 옮기기",
    trash: "휴지통으로 옮기기",
    restore: "복구",
    trashList: "휴지통",
    trashTitle: "휴지통",
    trashEmptyTitle: "휴지통이 비어 있어요",
    trashEmptyBody:
      "이 앱에서 휴지통으로 옮긴 문서가 여기에 모여요. Confluence 의 휴지통에서도 되살릴 수 있어요.",
    trashListFailed: "휴지통을 읽지 못했어요 — 잠시 뒤 다시 시도해 주세요.",
    trashLoading: "휴지통을 읽는 중…",
    trashedAt: (when: string) => `${when}에 휴지통으로`,
    dialogTitle: (op: DocOpKind) =>
      op === "copy"
        ? "문서 복제"
        : op === "move"
          ? "위치 옮기기"
          : op === "restore"
            ? "문서 복구"
            : "휴지통으로 옮기기",
    dialogSub: "Confluence 에서 미리 확인하고 눌러요.",
    childCount: (n: number) => `아래 문서 ${n}개도 함께 영향받을 수 있어요`,
    hasDraft: "이 컴퓨터의 초안은 지워지지 않아요",
    /** 막는 이유의 글 — 이름은 선로의 기계 이름이다(시험이 일곱 갈래를 대조한다). */
    blocker: {
      "publish-disabled": "Confluence 에 쓰기가 아직 꺼져 있어요 — 검증을 마친 뒤 켜요",
      "remote-missing": "Confluence 에서 문서를 찾지 못했어요 — 지워졌을 수 있어요",
      "out-of-scope": "연결한 기획서 범위 밖의 문서예요 — 여기서는 옮기지 않아요",
      "no-permission": "이 문서를 바꿀 권한이 없어요",
      "has-draft": "이 컴퓨터의 초안은 지워지지 않아요",
      "not-trashed-here": "이 앱에서 휴지통으로 옮긴 문서가 아니에요 — 복구는 이 앱에서 옮긴 문서만 해요",
      "same-parent": "지금과 같은 자리예요 — 다른 자리를 골라 주세요",
    },
    target: "들어갈 자리",
    targetPick: "자리를 고르세요",
    newTitle: "새 제목",
    /** 복제 제목의 붙임 — 끝에 `사본` 이, 그다음부터 `사본 2 · 3 …` 이 붙는다. */
    copySuffix: "사본",
    copyRound: (n: number) => `사본 ${n}`,
    checking: "Confluence 에서 확인하는 중…",
    confirm: (op: DocOpKind) =>
      op === "copy" ? "복제하기" : op === "move" ? "옮기기" : op === "restore" ? "복구하기" : "휴지통으로 옮기기",
    sending: "보내는 중…",
    /** 결과 처지의 글 — applied 는 알림 한 줄, unknown 은 자동 재전송이 없다는 말을 함께 한다. */
    applied: (op: DocOpKind) =>
      op === "copy" ? "복제했어요" : op === "move" ? "옮겼어요" : op === "restore" ? "복구했어요" : "휴지통으로 옮겼어요",
    unknown: "결과를 확인하지 못했어요 — 목록을 새로 가져와 확인해 주세요. 자동으로 다시 보내지 않아요.",
    failed: "Confluence 요청이 실패했어요",
  },
  // ── 문서 코멘트(2026-10-23 · 최종 구현 계획 F4) — 기획서 문서에 바닥글 · 인라인 · 답글 · 고침 · 해결로
  // 남긴다. 코멘트는 정본인 Confluence 에 바로 기록된다.
  comments: {
    // 단추 — 코멘트 줄마다 서는 것과 입력의 것
    reply: "답글",
    edit: "고치기",
    resolve: "해결",
    send: "보내기",
    sending: "보내는 중…",
    cancel: "그만두기",
    reread: "다시 읽기",
    // 입력의 자리 표시 — 바닥글 입력은 문서 아래 늘 선다
    footerPlaceholder: "코멘트 남기기",
    replyPlaceholder: "답글 남기기",
    editPlaceholder: "고칠 내용을 적어 주세요",
    inlinePlaceholder: "이 부분에 남길 말을 적어 주세요",
    count: (left: number) => `${left}자 더 쓸 수 있어요`,
    countOver: (over: number) => `${over}자 넘었어요 — 줄여 주세요`,
    /** 적용됨의 한 줄 알림 — 명령의 종류별 문장이다. */
    applied: {
      create: "코멘트를 남겼어요",
      reply: "답글을 남겼어요",
      update: "코멘트를 고쳤어요",
      resolve: "해결로 표시했어요",
    },
    unknown: "결과를 확인하지 못했어요 — 문서를 다시 읽어 확인해 주세요. 자동으로 다시 보내지 않아요.",
    failed: "Confluence 요청이 실패했어요",
    /** 막는 이유의 글 — 이름은 선로의 기계 이름이다(시험이 여덟 갈래를 대조한다). */
    reason: {
      "publish-disabled": "지금은 이 앱에서 Confluence 에 쓰기가 꺼져 있어요 — Confluence 에서 직접 남겨 주세요",
      "out-of-scope": "연결한 기획서 범위 밖의 문서예요 — 여기서는 남기지 않아요",
      "anchor-missing": "그 문장이 문서에서 바뀌었어요 — 다시 골라 주세요",
      "anchor-ambiguous": "같은 문장이 문서에 여러 번 있어요 — 조금 더 길게 골라 주세요",
      "comment-changed": "다른 곳에서 먼저 바뀌었어요 — 다시 읽은 뒤 해 주세요",
      "comment-missing": "그 코멘트가 이미 없어요 — 문서를 다시 읽어 주세요",
      "comment-not-plain": "서식이나 멘션이 있는 코멘트는 Confluence 에서 고쳐 주세요",
      "comment-unreadable": "코멘트 본문을 읽지 못했어요 — Confluence 에서 확인해 주세요",
    },
    // 닻 — 본문에서 고른 문장의 단추와 안내
    anchorButton: "이 부분에 코멘트",
    anchor: {
      empty: "문장을 골라 주세요",
      multiBlock: "한 문단 안에서 골라 주세요",
      tooLong: "500자가 넘어요 — 조금 더 짧게 골라 주세요",
      repeated: "같은 문장이 문서에 여러 번 있어요 — 조금 더 길게 골라 주세요",
    },
    resolveConfirm: "이 코멘트를 해결로 표시할까요?",
    resolveGo: "해결로 표시",
  },
} as const;

/**
 * 개발자용 쪽의 문장(U12 · J5) — `L` 의 금칙어 검사에서 빠진다. 진단 줄은
 * 개발자의 어휘(데몬 · 프로토콜)로 쓰는 것이 읽는 사람을 위한 것이므로.
 * `test/next-labels.test.ts` 가 이 export 를 금칙어 검사에서 건너뛴다.
 */
export const DEV = {
  selfUpdateNote: "AI 프로그램의 자기 업데이트는 꺼 두고 이 앱이 대신 맡아요",
  crash: {
    details: "자세히",
  },
  /**
   * 진단 복사의 글(2026-10-07 베타 준비 분석) — 담당자가 읽는 `키: 값` 블록. 종류 · 숫자 · 버전만 싣는다(사용자의 말 ·
   * 파일 경로 · 이메일 · 프로젝트 이름 · 토큰은 한 줄도 없다). 개발자의 어휘가 정당한 자리라 `DEV` 에 둔다.
   */
  diagnostics: {
    title: "ColoNova Design 진단",
    appVersion: "앱 버전",
    os: "OS",
    protocol: "프로토콜",
    connected: "연결 정상",
    disconnected: "연결 끊김",
    daemonNode: "데몬 Node",
    tools: "도구",
    present: "있음",
    absent: "없음",
    ai: "AI",
    loggedIn: "로그인됨",
    loggedOut: "로그인 안 됨",
    account: "계정",
    accountLine: (method: string, plan: string) => `${method} · 요금제 ${plan}`,
    unknown: "알 수 없음",
    turns: "최근 7일 턴",
    turnsLine: (all: number, user: number, pins: number, machine: number) =>
      `${all}개 (직접 ${user} · 핀 ${pins} · 도구 ${machine})`,
    failures: "실패",
    failureNone: "없음",
    failureLine: (count: number, parts: string) => `${count}개 (${parts})`,
    stages: {
      length: "길이",
      auth: "로그인",
      account: "계정",
      limit: "한도",
      stream: "스트림",
      other: "기타",
    },
    stageItem: (stage: string, count: number) => `${stage} ${count}`,
    pinTurns: "핀 사용 턴",
    avgTools: "평균 도구 호출",
    firstEdit: "첫 편집까지",
    firstDelta: "첫 글자까지",
    duration: "턴 길이",
    percentLine: (p50: string, p90: string, n: number) => `p50 ${p50} · p90 ${p90} (n ${n})`,
    noData: "자료 없음",
    secondsUnit: "초",
    errors: "최근 오류",
    errorsNone: "없음",
    errorItem: (level: string, kind: string, count: number) => `${level} ${kind} ×${count}`,
    levels: { error: "오류", warn: "경고" },
    summaryMissing: "자세한 진단은 받지 못했어요 — 데몬에 닿지 못했어요",
    repoPhase: "프로젝트 준비 단계",
    failureKind: "준비 실패 종류",
    kindItem: (kind: string, gloss: string) => `${kind} (${gloss})`,
    repoKinds: {
      clone: "내려받기",
      install: "설치",
      "registry-auth": "패키지 저장소 인증",
      "pnpm-missing": "pnpm 없음",
      preview: "미리보기 서버",
      "port-undetected": "미리보기 포트를 못 찾음",
      "no-preview-command": "미리보기 명령 없음",
      conflict: "충돌",
      commands: "명령 설정",
    },
  },
} as const;
