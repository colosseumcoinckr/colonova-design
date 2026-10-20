/**
 * 앱이 놓인 자리(2026-10-20 비개발자 mac 설치 검토). 응용 프로그램 폴더 밖에서 실행하면 생기는 일이 둘이다.
 * DMG 안이나 Gatekeeper 가 옮겨 둔 임시 자리(App Translocation)에서는 자가 업데이트가 앱을 갈아 끼우지 못한다.
 * 그리고 DMG 를 꺼내면 앱이 사라진다. 첫 실행에서 옮기기를 권하고(main.ts), 업데이트는 같은 판정으로
 * 막는다(app-updates.ts). 판정은 순수다 — electron 없이 시험이 읽는다.
 */

/** 지금 실행 파일이 설치 자리가 아닌 곳(디스크 이미지 · Gatekeeper 의 임시 자리)에 있는가. */
export function runningOutsideInstall(execPath: string): boolean {
  return execPath.startsWith("/Volumes/") || execPath.includes("/AppTranslocation/");
}

export interface MoveOfferInput {
  platform: string;
  /** 개발 실행(`pnpm dev:desktop`)은 옮기지 않는다. */
  packaged: boolean;
  underTest: boolean;
  /**
   * `app.isInApplicationsFolder()` — 홈 폴더의 Applications 도 응용 프로그램 폴더로 친다고 읽힌다 [추정]. 아니면 그
   * 자리로 옮긴 사람은 켤 때마다 질문을 받는다 — `다시 묻지 않기` 가 그 출구다.
   */
  inApplications: boolean;
  /** 지난번에 `다시 묻지 않기` 를 골랐다. */
  declined: boolean;
  /**
   * 초대 파일을 더블클릭해 앱이 켜졌다 — 옮기면 앱이 다시 켜지며 그 파일을 잃는다. 이번에는 묻지 않고
   * 다음 실행에 묻는다.
   */
  pendingInvite: boolean;
}

/** 첫 화면 전에 `응용 프로그램 폴더로 옮길까요?` 를 물을지. mac 만 묻는다. */
export function shouldOfferMove(input: MoveOfferInput): boolean {
  return (
    input.platform === "darwin" &&
    input.packaged &&
    !input.underTest &&
    !input.inApplications &&
    !input.declined &&
    !input.pendingInvite
  );
}
