import type { MessageBoxOptions } from "electron";

/**
 * 데스크톱이 사용자에게 건네는 문장 한 벌 — OS 알림 · 네이티브 대화상자 · 설정이 그대로 보여 주는
 * 오류 문장(2026-10-06 겹판 조사 · N). 알림센터에서 앱 안의 말과 같은 목소리로 읽히도록 한 곳에 모은다.
 *
 * - 말투는 해요체 하나다. 사용자가 읽는 말은 보관 · 제출 · 반영됨 뿐이다(docs/GUIDE.md 「알아 둘 말은
 *   둘뿐이다」). 개발 어휘와 옛 말(저장 · 넘기기 · 합침 · 반려 · 최신화)은 `test/notices.test.ts` 가 막는다.
 * - 웹 문장(`packages/web/src/next/labels.ts` 의 `L`)은 import 할 수 없다 — 같은 사건을 같은 말로 하려고
 *   값을 옮겨 적고 출처를 주석에 남긴다. 웹 문장을 고치면 여기서 같은 말을 찾아 함께 고친다(시험이
 *   옮겨 적은 문장이 어긋나면 잡는다).
 * - 두 단추 상자의 문법도 여기 산다 — 안전한 쪽이 첫 단추 · 기본 · Esc 의 답이고, 일을 벌이는 단추는 그
 *   뒤다. mac 은 첫 단추가 오른쪽, Windows 는 왼쪽이라 순서가 상자마다 뒤집히면 한 앱 안에서 손이 헷갈린다.
 * - 새 문장은 여기에만 더한다. 다른 desktop 파일에는 한글 리터럴을 쓰지 않는다(시험이 막는다).
 *
 * 이 파일은 타입 말고는 아무것도 부르지 않는다 — 시험이 dist 에서 Electron 없이 곧장 읽는다.
 * 문장의 `${}` 안에는 따옴표 · 백틱을 쓰지 않는다(시험의 리터럴 훑기가 그 모양을 모른다).
 */

/** 알림 한 장의 줄 — 제목은 `<이름> · <꼬리>` 로 서고, 꼬리는 12 자를 넘지 않는다(길면 배너에서 잘린다). */
export interface NoticeLine {
  tail: string;
  body: string;
}

/** 알림 한 장 — 제목 전체가 문장인 것(AI 업데이트)은 `title` 을 직접 든다. */
export interface NoticeText {
  title: string;
  body: string;
}

// ---------------------------------------------------------------------------
// OS 알림 — 데몬이 건넨 사건(DaemonNotice)의 문장. 이름(대화 · 프로젝트)은 notices.ts 가 앞에 붙인다.
// ---------------------------------------------------------------------------

export const NOTICE = {
  done: { tail: "완료", body: "AI가 화면 작업을 마쳤어요. 미리보기를 확인해 보세요." },
  // 설정의 알림 줄이 `확인 요청과 멈춤은 언제나 알려요` 라고 말한다 — 같은 말로 부른다.
  crashed: { tail: "멈춤", body: "AI가 멈췄어요. 대화에서 이유를 확인할 수 있어요." },
  askQuestion: { tail: "답 필요", body: "AI가 질문의 답을 기다려요. 대화에서 답해 주세요." },
  askPermission: {
    tail: "확인 필요",
    body: "AI가 진행해도 되는지 기다려요. 대화에서 확인해 주세요.",
  },
  // 게이트의 네 단계 — 사용자 말로는 보관 · 제출 · 화면 확인 · 개발자 작업과의 겹침이다.
  gate: {
    save: { tail: "보관하지 못했어요", body: "보관을 마치지 못했어요. AI에게 고치도록 맡겼어요." },
    handoff: {
      tail: "제출하지 못했어요",
      body: "제출을 마치지 못했어요. AI에게 고치도록 맡겼어요.",
    },
    screen: { tail: "화면 확인", body: "만든 화면에서 오류를 찾았어요. AI에게 고치도록 맡겼어요." },
    refresh: {
      tail: "최신 작업과 겹쳤어요",
      body: "개발자가 반영한 최신 작업과 아직 보관하지 않은 작업이 겹쳤어요. AI에게 정리를 맡겼어요.",
    },
  } satisfies Record<"save" | "handoff" | "refresh" | "screen", NoticeLine>,
  // 개발자 쪽 사건 — 단위는 프로젝트다(커미티 B1+A, 2026-09-15).
  handoff: {
    // 웹 L.work.changedEmptyMerged 와 같은 말.
    merged: {
      tail: "반영됨",
      body: "개발자가 이번 작업을 반영했어요. 다음에 고치는 것부터 새 작업이에요.",
    },
    // 웹 L.chat.closed 와 같은 말.
    closed: {
      tail: "요청 닫힘",
      body: "개발자가 이번 요청을 닫았어요 — 작업은 새 요청으로 옮겨 두었어요.",
    },
    changes_requested: {
      tail: "코멘트가 왔어요",
      body: "개발자가 코멘트를 남겼어요. AI에게 반영을 맡겼어요 — 끝나면 알려 드려요.",
    },
    // 웹 L.cards.reviewDone(`반영해 같은 요청에 다시 제출했어요`)과 같은 말 — 개발자에게 가는 일은 제출이다.
    replied: {
      tail: "다시 제출됨",
      body: "개발자 코멘트를 AI가 반영해 같은 요청에 다시 제출했어요.",
    },
  } satisfies Record<"merged" | "closed" | "changes_requested" | "replied", NoticeLine>,
  comments: (count: number): NoticeLine => ({
    tail: "개발자 코멘트",
    body: `개발자 코멘트 ${count}건 — AI에게 반영을 맡겼어요.`,
  }),
  // 병합이 어떤 일인지 알면 그 일의 이름으로 말한다(2026-10-08 베타 준비 분석 · A2b) — 웹 L.landed.head 와 같은 말.
  mergedTitled: (title: string): NoticeLine => ({
    tail: "반영됨",
    body: `‘${title}’ 일이 반영됐어요. 다음에 고치는 것부터 새 작업이에요.`,
  }),
  ready: { tail: "준비됐어요", body: "처음 여는 준비가 끝났어요. 바로 말을 걸 수 있어요." },
  // 제목은 짧게, `개발자에게 알렸어요` 는 몸글로(2026-10-06). 연결 코드가 끝난 막힘은 개발자에게 알린 것이
  // 아니라 사용자의 손이 필요한 일이다 — 알렸다고 말하지 않는다(웹 L.problem.notifiedSubmit · reconnectInvite).
  submitBlocked: {
    notified: {
      tail: "제출하지 못했어요",
      body: "개발자에게 알렸어요. 계속 만들 수 있고, 풀리면 도구가 다시 제출해요.",
    },
    // 웹 L.problem.reconnectInvite 와 같은 말.
    auth: {
      tail: "제출하지 못했어요",
      body: "연결 코드가 만료됐어요. 개발자에게 받은 새 초대 파일을 열어 주세요. 대화와 작업은 그대로예요.",
    },
    // 연결 코드의 권한 부족 — 새 초대 파일이 해결이 아니다(웹 L.problem.blockedPermission 과 같은 말).
    permission: {
      tail: "제출하지 못했어요",
      body: "연결 코드의 권한이 모자라요. 작업은 보관돼 있고, 개발자가 코드의 권한을 고치면 도구가 다시 제출해요.",
    },
    // 이 기계의 인터넷 문제 — 개발자에게 알렸다고 말하지 않는다(웹 L.problem.blockedNetwork 와 같은 말).
    network: {
      tail: "제출하지 못했어요",
      body: "인터넷 연결이 끊겨 멈췄어요. 작업은 보관돼 있고, 연결되면 도구가 다시 제출해요.",
    },
  } satisfies Record<"notified" | "auth" | "permission" | "network", NoticeLine>,
  updateDone: (agent: string, version: string): NoticeText => ({
    title: "AI를 업데이트했어요",
    body: `${agent} ${version} — 다음 새 대화부터 써요.`,
  }),
};

// ---------------------------------------------------------------------------
// 앱 업데이트 — 알림과, 설정의 업데이트 줄이 그대로 보여 주는 오류 문장.
// 업데이트는 설정 → 업데이트에서 한다(`지금 확인` · `업데이트` · `지금 다시 시작`).
// ---------------------------------------------------------------------------

/** 교체 결과 파일에 이유가 없을 때. */
const SWAP_UNKNOWN = "알 수 없는 문제가 생겼어요";

export const UPDATE = {
  available: (version: string): NoticeText => ({
    title: "새 버전이 있어요",
    body: `ColoNova Design ${version} — 설정 → 업데이트에서 설치할 수 있어요.`,
  }),
  prepared: (version: string): NoticeText => ({
    title: "새 버전이 준비됐어요",
    // 도는 AI 일이 있으면 누른 뒤에도 그 일이 끝나기를 기다린다 — 그래서 `지금` 이라고 말하지 않는다.
    body: `ColoNova Design ${version} — 다시 시작하면 새 버전이 돼요. 누르면 다시 시작해요.`,
  }),
  prepareFailed: (error: string): NoticeText => ({
    title: "업데이트를 준비하지 못했어요",
    body: `${error} — 설정 → 업데이트에서 다시 시도할 수 있어요.`,
  }),
  swapDone: (version: string): NoticeText => ({
    title: "앱을 업데이트했어요",
    body: `ColoNova Design ${version} — 새 버전으로 바뀌었어요.`,
  }),
  swapFailed: (reason: string | undefined): NoticeText => ({
    title: "업데이트하지 못했어요",
    body: `${reason ?? SWAP_UNKNOWN} — 누르면 기록을 열어요.`,
  }),
  // 아래는 `{ error }` · 던진 오류로 렌더러에 가서 설정의 업데이트 줄에 그대로 선다.
  checkTimeout: "업데이트 확인이 시간 안에 끝나지 않았어요",
  downloadFailed: (status: number): string => `업데이트 파일을 내려받지 못했어요 (HTTP ${status})`,
  nothingToInstall: "설치할 업데이트를 찾지 못했어요 — 지금 확인을 다시 눌러 주세요.",
  nothingPrepared: "준비된 업데이트가 없어요 — 지금 확인을 눌러 주세요.",
  devGuarded: "개발 실행에서는 앱을 바꾸지 않아요",
  fromDiskImage:
    "앱이 디스크 이미지(DMG)에서 실행 중이에요 — 응용 프로그램 폴더로 옮긴 뒤 다시 시도해 주세요.",
  // self-update.ts 의 검증 · 계획 오류.
  verifyFailed: (name: string): string =>
    `내려받은 파일을 확인하지 못했어요 (${name}) — 다시 시도해도 안 되면 담당자에게 알려 주세요.`,
  diskLow: (gigabytes: number, where: string): string =>
    `디스크 공간이 모자라요 — 업데이트에는 ${gigabytes}GB 이상의 여유가 필요해요. (${where})`,
  unsupportedPlatform: (platform: string): string =>
    `이 운영체제(${platform})에서는 앱을 스스로 업데이트할 수 없어요`,
  noTarget: "업데이트할 앱의 위치를 알 수 없어요",
};

/**
 * 교체 스크립트가 결과 파일에 적는 실패 이유 — 다음 실행이 `UPDATE.swapFailed` 의 몸글로 읽어 준다.
 * 로그 파일의 줄은 개발자가 읽는 것이라 스크립트에 남지만, 알림에 실리는 이유는 여기 한 곳이다.
 */
export const SWAP_FAILED = {
  notQuit: "앱이 끝나지 않아 업데이트를 마치지 못했어요",
  unpack: "내려받은 파일을 풀지 못했어요",
  noApp: "내려받은 파일 안에 앱이 없어요",
  moveAway: "기존 앱을 치우지 못했어요 — 설치 위치의 권한을 확인해 주세요",
  place: "새 앱을 놓지 못해 이전 버전으로 되돌렸어요",
  installerFailed: (code: string): string => `설치 프로그램이 오류로 끝났어요 (종료 코드 ${code})`,
  installerLaunch: "설치 프로그램을 실행하지 못했어요",
};

// ---------------------------------------------------------------------------
// 렌더러 다리 — 시험 알림 · 알림 설정 화면 · 초대 파일 지우기.
// ---------------------------------------------------------------------------

export const BRIDGE = {
  // 웹 L.settings.testNotify · testNotifyBody 와 같은 말 — 설정의 시험 단추가 이 알림을 띄운다.
  testNotice: { title: "시험 알림", body: "실제 알림은 이렇게 도착해요" },
  noNotifySettings: "이 컴퓨터에는 알림 설정 화면이 없어요.",
  inviteMissing: "지울 초대 파일을 찾지 못했어요.",
};

// ---------------------------------------------------------------------------
// 애플리케이션 메뉴 — menu.ts 가 읽는다(한글 리터럴은 거기 두지 않는다). 도움말은 막혔을 때 앱 안에서
// 도움을 찾는 입구다(2026-10-08 베타 준비 분석 — 기록 폴더 하나뿐이던 메뉴를 채웠다): 사용 설명서 ·
// 진단 복사 · 기록 폴더. 진단 복사의 글은 웹이 모아 복사하고(설정의 개발자용 쪽과 같은 글), 앱은 알려 줄 뿐이다.
// ---------------------------------------------------------------------------

export const MENU = {
  edit: "편집",
  view: "보기",
  window: "창",
  help: "도움말",
  /** 개발 실행에서만 서는 항목 — 사용자의 메뉴에는 없다. */
  devTools: "개발자 도구",
  helpGuide: "사용 설명서 열기",
  helpReport: "문제가 생겼어요 — 진단 복사",
  helpLogs: "기록 폴더 열기",
};

// ---------------------------------------------------------------------------
// 네이티브 대화상자 — 두 단추 상자의 문법: 안전한 쪽이 첫 단추 · 기본 · Esc 의 답이다.
// ---------------------------------------------------------------------------

/** 두 단추 상자의 답 — `safe`(첫 단추)가 기본 · Esc 이고 `other`(둘째)가 일을 벌인다. */
export const ANSWER = { safe: 0, other: 1 } as const;

function safeFirst(
  type: "warning" | "question",
  text: { title: string; message: string; detail?: string },
  buttons: readonly [safe: string, other: string],
): MessageBoxOptions {
  return {
    type,
    ...text,
    buttons: [...buttons],
    defaultId: ANSWER.safe,
    cancelId: ANSWER.safe,
    // Windows 는 단추 이름이 낯설면 명령 링크로 그린다 — 상자마다 모양이 갈리지 않게 막는다.
    noLink: true,
  };
}

/** 작업 중 종료(창 닫기 · ⌘Q) — 취소가 기본이고, 끝내면 무엇이 멈추고 무엇이 남는지 말한다. */
export function quitOptions(): MessageBoxOptions {
  return safeFirst(
    "warning",
    {
      title: "작업이 진행 중이에요",
      message: "AI가 작업 중이에요. 지금 끝내면 하던 작업이 멈춰요.",
      // 보관은 답을 낸 차례마다 도구가 스스로 한다 — 끝난 답은 이미 보관돼 있고, 도는 답은 아니다
      // (docs/DEVELOPERS.md 「자동 보관 · 제출 · 반영됨」).
      detail: "이미 끝난 답은 보관돼 있어요.",
    },
    ["취소", "그만두고 끝내기"],
  );
}

/** 처음부터 다시 시작 — 지워지는 것과 남는 것을 말하고, 도는 일이 있으면 그 일도 멈춘다고 말한다. */
export function resetOptions(busy: boolean): MessageBoxOptions {
  const lines = [
    "프로젝트 파일, 대화와 작업 기록, 앱 설정, 연결 정보를 지워요. 목록에서 삭제했지만 컴퓨터에 남아 있는 프로젝트도 포함돼요. 제출하지 않은 작업은 되돌릴 수 없어요.",
    "이미 개발자에게 제출한 작업과 Claude·Codex 로그인은 유지돼요. 앱이 다시 열리면 새 초대 파일을 넣어 주세요.",
  ];
  if (busy) lines.push("지금 AI가 일하는 중이에요. 다시 시작하면 그 일도 멈춰요.");
  return safeFirst(
    "warning",
    {
      title: "처음부터 다시 시작",
      message: "이 컴퓨터의 모든 프로젝트와 설정을 지울까요?",
      detail: lines.join("\n\n"),
    },
    ["취소", "모두 지우고 다시 시작"],
  );
}

/** 화면이 10분 안에 여러 번 꺼졌을 때 — 다시 열기가 기본이다(상태는 전부 데몬에 있다). */
export function crashLoopOptions(): MessageBoxOptions {
  return safeFirst(
    "warning",
    {
      title: "화면이 계속 꺼져요",
      message: "화면이 10분 안에 여러 번 꺼졌어요. 다시 열면 대화와 작업은 그대로예요.",
    },
    ["다시 열기", "끝내기"],
  );
}

/** 화면이 멈췄을 때 — 기다리기가 기본이다. 다시 열어도 잃는 것이 없다고 먼저 말한다. */
export function unresponsiveOptions(): MessageBoxOptions {
  return safeFirst(
    "question",
    {
      title: "화면이 멈췄어요",
      message: "잠시 기다리면 저절로 돌아올 수 있어요.",
      detail: "다시 열어도 대화와 작업은 그대로예요.",
    },
    ["기다리기", "다시 열기"],
  );
}

/** 시작 실패 상자의 답 — 어느 단추든 앱은 끝난다. 첫째는 기록 폴더를 열고 끝낸다. */
export const START_ANSWER = { openLogs: 0, quit: 1 } as const;

/** 날 오류가 길어도 상자가 화면을 넘지 않게. */
const REASON_MAX = 300;

function clip(text: string): string {
  if (text.length <= REASON_MAX) return text;
  return `${text.slice(0, REASON_MAX)}…`;
}

/**
 * 시작하지 못했을 때 — 막다른 길에 출구(기록 폴더 열기)를 단다. 날 오류는 `detail` 로 내리고,
 * 기록 폴더의 자리도 적어 둔다(끝내기를 골라도 담당자에게 전할 수 있게).
 */
export function startFailedOptions(reason: string, logsDir: string): MessageBoxOptions {
  const facts: string[] = [];
  const flat = reason.trim();
  if (flat) facts.push(`자세한 내용: ${clip(flat)}`);
  facts.push(`기록 폴더: ${logsDir}`);
  return {
    type: "error",
    title: "ColoNova Design",
    message: "ColoNova Design을 시작하지 못했어요",
    detail: [
      "앱을 다시 열어 주세요. 계속 안 되면 기록 폴더의 내용을 담당자에게 전해 주세요.",
      facts.join("\n"),
    ].join("\n\n"),
    buttons: ["기록 폴더 열기", "끝내기"],
    defaultId: START_ANSWER.openLogs,
    cancelId: START_ANSWER.quit,
    noLink: true,
  };
}

/** 시작 중 초기화의 남은 정리가 끝나지 못했을 때 — 시작 실패 상자의 자세한 내용으로 간다. */
export function resetUnfinished(reason: string): string {
  return `초기화를 마치지 못했어요. 일부 데이터는 이미 지워졌을 수 있어요. 앱을 다시 열면 남은 정리를 이어가요.\n${reason}`;
}
