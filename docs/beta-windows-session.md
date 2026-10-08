# 첫 Windows 베타 세션 대본 — 2026-10-07

> 출처: 베타 준비 분석 2026-10-07. 사용자 확정(같은 날): 회사 망은 일반 인터넷이고, Windows 는 실제 베타
> 테스터로 검증한다. 그래서 이 문서는 출시 게이트가 아니라 **진행자가 테스터 옆에서 화면을 공유받으며 밟는
> 대본**이다(60~90분). 프록시 · 사내 인증서 항목은 없다.

Windows 설치 파일은 한 번도 실행된 적이 없다(`packages/desktop/electron-builder.yml`). 지금까지 Windows 쪽 판단은
전부 코드를 읽고 한 추정이었다. 이 세션이 그 추정을 실기로 바꾼다 — 한 항목씩 `[확인]` 이나 `[실패]` 로 적어 간다.

## 이 문서를 읽는 법

- 항목은 13개이고, 모두 **하는 일 → 합격 기준 → 실패 시 볼 파일**의 순서다. 합격 기준은 눈으로 셀 수 있게 적었다
  (창이 몇 개 · 프로세스가 몇 줄 · 몇 초).
- **이번 수리**는 2026-10-07 에 코드로 고친 것이다. 코드를 읽고 Node · Windows 의 문서화된 동작과 맞대어 고쳤지
  Windows 에서 돌려 본 것이 아니다 — 이 세션이 확인한다. 수리 목록과 아직 추정인 것은
  `docs/DEVELOPERS.md` 의 「Windows 코드 수리와 첫 베타 세션」에 있다.
- `[예상]` 은 코드로 보아 실패가 예상되는 것이다. 실패해도 이 세션의 실패가 아니라 **알려진 한계의 확인**이다.
- 시간이 모자라면 1 · 2 · 3 · 5 · 7 · 8 · 12 를 먼저 하고 4 · 6 · 9 · 10 · 11 · 13 은 줄인다.
- 개인정보: 테스터의 이름 · 계정 이름 · 이메일 · 한 말 · 폴더 경로는 기록에 적지 않는다. 종류와 숫자만 적는다.

## 세션 전 사전 확인

세션 며칠 전에 테스터 PC 에서 한다. 결과는 아래 「세션 기록」 머리에 적는다.

1. **스마트 앱 컨트롤**(Windows 보안 → 앱 및 브라우저 컨트롤 → 스마트 앱 컨트롤 설정). 상태를 `켬 · 평가 · 끔` 으로
   적는다. **켬이면 서명 없는 설치 파일이 앱별 예외 없이 막힌다** — 이 PC 로는 1번에서 멈춘다(서명 결정이 필요하다는
   증거로 기록한다). 한 번 끄면 되돌릴 수 없다고 안내돼 있으니 테스터 PC 에서 끄지 않는다. 다른 PC 를 쓴다.
2. **개인 PC 인지 회사 관리 기기인지**. 설정 → 계정 → 회사 또는 학교 액세스에 연결된 계정이 있는지, 보안 프로그램
   (EDR · AppLocker 같은 실행 제한)이 있는지 묻는다. 관리 기기면 막힘이 이 앱 탓인지 정책 탓인지 가르기 어려우니
   그 사실을 기록한다.
3. **사용자 이름이 한글인지 · 공백이 있는지**. 명령 프롬프트에서 `echo %USERPROFILE%` 를 쳐 경로를 본다. 한글 이름
   계정과 공백 이름 계정을 **일부러 한 명씩 넣는다**(둘 다 가진 계정이면 한 명으로 족하다) — 5 · 7 · 10 번이 이 계정에서만
   깨질 수 있다. 탐색기의 `다운로드` 가 `OneDrive` 아래에 있는지도 적는다(11번).
4. **Claude 요금제로 로그인되는지**. 테스터가 자기 Claude 구독으로 claude.ai 에 로그인하고 한 문장을 주고받아 본다.
   앱은 알려진 쓸 수 없는 요금제(`free`)만 첫 요청 전에 막는다(5번의 `이 요금제로는 쓸 수 없어요` 카드). 요금제를 모르는 계정은
   막지 않는다 — 무료 계정이 이렇게 보일 수 있다 [추정]. 그때는 4번의 첫 요청이 `이 계정으로는 AI 를 쓸 수 없어요` 로 실패한다
   (2026-10-07 베타 준비 분석 — `DEVELOPERS.md` 의 「계정 · 요금제와 베타 진단」). 비용을 누가 내는지(결정 대기)도 이때 적는다.
5. (선택) **Windows 개발 기계가 있으면** 세션 전에 순수 시험을 돌린다. 한 번이라도 통과하면 코드 쪽 추정이 `[확인]` 에 가까워진다.

   ```powershell
   pnpm install ; pnpm -r build
   node --test packages/daemon/test/child-shell.test.ts packages/daemon/test/preview-claim.test.ts packages/daemon/test/project-slug.test.ts packages/daemon/test/claude-delete-all.test.ts packages/daemon/test/child-hide.test.ts packages/desktop/test/daemon-start.test.ts
   ```
6. 화면 공유를 하되 녹화는 테스터가 동의한 때만 한다. 녹화를 하지 않아도 되도록 기록은 진행자가 그 자리에서 적는다.

## 준비물

- 릴리스 페이지의 설치 파일 `colonova-design-Setup-<버전>-win-x64.exe`. 12번을 하려면 **한 단계 낮은 버전**의 설치 파일과
  새 버전이 올라간 릴리스가 함께 있어야 한다(없으면 12번은 다음 릴리스 때).
- 테스트용 GitHub 레포 두 개(작은 Vite 앱). **초대장은 같은 레포를 같은 프로젝트로 보므로 서로 다른 레포여야 한다**.
  - 레포 B(정상): `package.json` 의 `"dev": "vite"`. 프로젝트 이름 `회원`.
  - 레포 A(함정): `"dev": "FOO=bar vite"`, 줄바꿈을 건드리지 않는 `.sh` 파일 하나, **경로가 260자를 넘는 파일** 하나.
    프로젝트 이름 `결제`. `회원` 과 `결제` 는 **글자 수가 같은 한글 이름**이라 10번을 겸한다.
- 초대 파일 두 개 — `node scripts/make-invite.mjs --repo <레포 B 주소> --token <연결 코드> --name 회원 --out 회원.colonova-invite`
  와 같은 식으로 레포 A 도(`--name 결제`). `--name` 은 레포가 하나일 때만 쓴다.
- `scripts/orphan-check.mjs` 파일(진행자 USB). 테스터 PC 에 Node 가 없어도 앱이 싣고 온 Node 로 돈다:
  `& "$env:LOCALAPPDATA\Programs\ColoNova Design\resources\bin\node.exe" .\orphan-check.mjs before`(설치 위치를 바꾸지 않았다면).
  이 문서의 `<설치>` 는 그 폴더(`%LOCALAPPDATA%\Programs\ColoNova Design`)다.
- 포트를 막아 둘 PowerShell 두 창(9번): `$l = [Net.Sockets.TcpListener]::new([Net.IPAddress]::IPv6Any, 5173); $l.Server.DualMode = $true; $l.Start()`
  와 같은 줄의 3000 번. 창을 닫으면 풀린다.

## 진행

### 1. 설치 파일 받아 설치하기 (5분)

- **하는 일**: 설치 파일을 실행한다. 서명이 없어 SmartScreen 이 뜨면 `추가 정보` → `실행` 을 누른다. 마법사를 기본값으로 끝까지 간다.
- **합격 기준**
  - 관리자 암호 입력창(UAC)이 **0번** 뜬다. 마법사의 설치 대상이 `나 전용`(현재 사용자)이 기본으로 골라져 있다.
  - 설치 위치가 `%LOCALAPPDATA%\Programs\ColoNova Design` 이고 `<설치>\resources\bin` 이 있다.
  - 설치가 끝나면 앱이 열리고, 시작 메뉴에 바로 가기가 **1개** 생긴다. 걸린 시간을 적는다.
  - SmartScreen 이 `추가 정보` 로 지나가진다. 막혀서 `실행` 이 없으면 사전 확인 1번의 경우다 — 기록하고 멈춘다.
- **실패 시 볼 파일**: `packages/desktop/electron-builder.yml`, `packages/desktop/build/installer.nsh`.

### 2. 첫 실행 3분 관찰 (5분)

- **하는 일**: 앱을 처음 켜고 3분 동안 화면을 그대로 둔다. 손대지 말고 보기만 한다. 끝난 뒤 도움말 메뉴의 `기록 폴더 열기` 로 가장 새 `daemon-<날짜>.log` 를 연다.
- **합격 기준**
  - **검은 콘솔 창이 한 번도 뜨지 않는다(0)**. 번쩍임도 센다. *(이번 수리: 모든 자식 호출의 `windowsHide`)*
  - Windows 방화벽의 `허용` 상자가 **0번** 뜬다 [추정 — 데몬은 127.0.0.1 만 듣는다].
  - 앱 창이 5초 안에 첫 화면(`ColoNova Design 을 시작해요`)과 세 칸(`도구 준비` · `AI 연결` · `초대 파일`)을 그린다.
  - 로그에 `C:\Users\<이름>` 형태의 계정 이름이 **남지 않는다**(`~` 로 눌려 있다). 단 `D:\Users\…` · 소문자 `c:\users\…` 는
    눌리지 않는다 — 계정이 그런 위치면 [예상 실패]로 기록한다(`log.ts` 의 Windows 패턴은 `C:\Users` 하나다).
- 도움말: 창에 메뉴 막대가 안 보이면 `Alt` 를 누른다(창이 `autoHideMenuBar` 라 Windows 는 숨어 있다 — 비개발자가 도움말을 찾을 수 있는지 적는다). 도움말에는 `사용 설명서 열기` · `문제가 생겼어요 — 진단 복사` · `기록 폴더 열기` 가 있다. 진단 복사를 누르면 `진단을 복사했어요` 토스트가 서고 붙여 넣으면 `키: 값` 글이 나온다.
- **실패 시 볼 파일**: `packages/daemon/src/child.ts`, `packages/daemon/test/child-hide.test.ts`(예외 명단), `packages/daemon/src/log.ts`, `packages/desktop/src/menu.ts`.

### 3. 번들 도구 확인 (5분)

- **하는 일**: PowerShell 에서 앱이 싣고 온 도구를 직접 부른다.
  `& "<설치>\resources\bin\node.exe" -v`,
  `& "<설치>\resources\bin\cmd\git.exe" --version`,
  `& "<설치>\resources\bin\usr\bin\bash.exe" -c "ls; grep -V"`.
  Windows 보안 → 바이러스 및 위협 방지 → 보호 기록에 이 파일들의 격리가 있는지 본다. 앱의 `도구 준비` 칸을 본다.
- **합격 기준**
  - 세 명령이 **각각 한 번에** 버전이나 목록을 찍는다(오류 0).
  - 보호 기록에 `resources\bin` 아래 파일의 격리 · 차단이 **0건**이다.
  - `도구 준비` 칸이 5초 안에 통과로 바뀐다(`확인하는 중…` 에서 오래 머물지 않는다).
- **실패 시 볼 파일**: `packages/daemon/src/environment.ts`(`bundledToolEnv` · `gitCandidates` · `resolveNodeVersion`), `packages/daemon/src/onboarding.ts`, `packages/desktop/scripts/bundle-runtimes.mjs`.

### 4. AI 에게 도구 시켜 보기 (5분 — `AI 연결` 이 된 뒤)

- **하는 일**: 대화에서 AI 에게 시킨다. 「터미널에서 `git --version` 과 `node -v` 와 `pnpm -v` 를 실행해서 결과를 알려 줘. 그다음 `git commit` 도 한 번 해 봐.」
- **합격 기준**
  - 앞의 셋이 **모두 성공**해 버전이 대화에 나온다.
  - `git commit` 은 막히고 가드 문장 `보관과 제출은 이 도구가 합니다 — git 명령 없이 파일만 고쳐 주세요…` 가 나온다.
  - 진행 줄에 AI 가 쓴 도구 이름이 보이면 **`PowerShell` 이 있는지** 적는다. 가드의 훅은 둘이다 — `Bash`(git 쓰기 · 뻔한 파괴 명령)와 파일 쓰기 도구(`Write` · `Edit` 따위)에만 걸리므로 PowerShell 도구로 우회되는지가 이 항목의 관찰점이다. git 의 `core.hooksPath` 가드는 별개로 한 겹 더 있다 [추정].
- **실패 시 볼 파일**: `packages/daemon/src/environment.ts`(번들 bash 를 `CLAUDE_CODE_GIT_BASH_PATH` 로 알림), `packages/daemon/src/git-guard.ts`, `packages/daemon/src/write-guard.ts`, `packages/daemon/src/agent/drivers/claude/session.ts`.

### 5. Claude 설치와 로그인 — 한글 · 공백 계정 (10분)

- **하는 일**: `AI 연결` 칸의 설치를 누른다. 끝나면 이어서 브라우저가 열린다 — 테스터 계정으로 로그인한다. 사전 확인 3번의 한글/공백 이름 계정에서 한다. 마지막으로 와이파이를 껐다 켜며 설치를 한 번 일부러 실패시켜 문장을 본다(선택).
- **합격 기준**
  - 진행 줄이 `내려받는 중…` → `설치하는 중…` → `확인하는 중…` 의 **세 칸**을 차례로 지난다. 걸린 시간을 적는다.
  - 설치 뒤 `곧 브라우저가 열려요` 가 뜨고 **브라우저가 열린다**. 로그인을 마치면 앱이 저절로 `<이메일> · <요금제> 로 연결됨` 으로 넘어간다(이메일 · 요금제를 못 읽으면 `연결됨`, API 키면 `API 키로 연결됨`). 이메일은 기록에 옮기지 않고 요금제 종류만 적는다.
  - **계정 경로에 공백 · 한글이 있어도 같은 흐름이 성공한다.** `claude.exe` 가 `%USERPROFILE%\.local\bin` 에 있다. *(이번 수리: `.exe` 를 셸 없이 직접 띄움)*
  - 일부러 낸 실패의 문장이 원인에 맞는다(인터넷이 끊기면 `인터넷 연결을 확인한 뒤 다시 시도해 주세요.`).
  - 로그인 실패 문장 끝에 **깨진 글자(`�`·물음표 덩어리)가 붙어 있으면** 적는다 — 자식의 마지막 줄이 그대로 붙는 자리다(`DEVELOPERS.md` 의 자식 출력 인코딩).
- **실패 시 볼 파일**: `packages/daemon/src/agent-install.ts`, `packages/daemon/src/onboarding.ts`(`AgentLogin`), `packages/daemon/src/child.ts`(`shellPlan`), `packages/daemon/src/environment.ts`(`claudeCandidates`).

### 6. 두 네트워크 길 (3분)

- **하는 일**: 일반 인터넷 전제라 프록시는 보지 않는다. 대신 **서로 다른 두 길**이 모두 되는지만 본다 — 초대 파일 가져오기(Node 의 fetch)와 설정 → 업데이트의 `지금 확인`(Electron 의 `net`).
- **합격 기준**: 둘 다 오류 없이 끝난다. 초대 파일 가져오기는 7번에서 하고(그때 GitHub 에 닿는 데몬의 fetch 가 쓰인다), 여기서는 `지금 확인` 이 `최신이에요` 나 새 버전 안내로 끝나는지만 본다.
- **실패 시 볼 파일**: `packages/daemon/src/github.ts`, `packages/desktop/src/app-updates.ts`.

### 7. 첫 프로젝트 준비 — 정상 레포와 함정 레포 (15분)

- **하는 일**
  - 7-A: `회원`(레포 B) 초대 파일을 `초대 파일` 칸에 끌어다 놓는다. 가져오기를 누르고 준비 카드를 지켜본다.
  - 7-A′ **초대 파일 더블클릭 실기 확인**: 끌어 놓는 대신 파일을 **더블클릭**해 본다 — (1) 앱이 꺼져 있을 때 앱이 켜지며 같은 확인이 뜨는가, (2) 앱이 켜져 있을 때 다른 초대 파일(`결제`)을 더블클릭하면 창이 앞으로 오고 확인이 이어서 뜨는가(열린 확인이 있으면 그것이 끝난 뒤), (3) 탐색기의 `종류` 열이 `ColoNova Design 초대 파일` 이고 아이콘이 앱의 것인가, (4) 이 앱을 제거한 뒤 그 파일을 더블클릭하면 이 앱으로 열리지 않는가(연결이 지워졌는가). 한글 · 공백이 든 계정 폴더의 `다운로드` 에서도 해 본다.
  - 7-B: `결제`(레포 A)를 같은 식으로 들인다. 이 레포는 일부러 함정이 있다.
- **합격 기준**
  - 7-A′: 더블클릭이 위 (1)~(4)처럼 열린다 — 확인 카드는 끌어 놓았을 때와 같고 `파일 지우기`(`휴지통에 넣기`)가 이어진다. 안 열리면 어느 쪽인지 적는다: 아무 일도 없다(연결 등록 실패 — `installer.nsh` · `fileAssociations`) · 앱만 켜지고 카드가 없다(`process.argv` 에 경로가 오지 않음 [추정]) · 두 번째 더블클릭이 창만 앞으로 가져온다(`second-instance` 의 `argv`).
  - 7-A: 준비 카드가 `내려받기` → `설치하기` → `미리보기 켜기` **세 단계**를 지나 `준비가 끝났어요` 가 된다. 작업 관리자(또는 `Get-CimInstance Win32_Process -Filter "Name='node.exe'"`)에서 서버 트리가 **하나**다 — `cmd.exe` 아래 `node.exe` 몇 개이고, 같은 서버가 두 트리로 뜨지 않는다(`node.exe` 개수를 적는다). 그동안 **콘솔 창이 0개**다.
  - 7-B 깊은 경로: 클론이 `Filename too long` 으로 실패하는지 적는다. git 설정이 `core.longpaths` 를 건드리지 않아 MinGit 기본값에 달렸다 [추정].
  - 7-B `.sh`: `& "<설치>\resources\bin\cmd\git.exe" -C <클론 폴더> ls-files --eol` 에서 그 `.sh` 가 `w/lf` 이면 합격이다. `w/crlf` 면 줄바꿈 설정(`core.autocrlf`)이 파일을 바꾼 것이니 적는다 [추정].
  - 7-B `FOO=bar vite` **[예상 실패]**: `pnpm run dev` 의 스크립트 본문을 pnpm 이 cmd 로 읽어 `KEY=값` 접두를 모른다. 준비 카드가 미리보기 단계에서 멈추는지, 오류 문장이 어떻게 보이는지(깨진 한글 포함), 도구가 스스로 AI 에게 맡긴 준비 실패 대화(`…에서 문제를 찾아 AI에게 맡겼어요` 카드 · 덮개 `AI가 막힌 곳을 고치고 있어요` · 문제 문장 `AI가 고치는 중이에요`)에서 AI 가 레포의 `package.json` 을 고치려 드는지를 **그대로 적는다**. 성공하면 그것도 적는다. 이 관찰이 `추정으로 남김` 의 판정 자리다(후보: pnpm 의 `shell-emulator` 환경 설정, bash 를 스크립트 셸로).
- **실패 시 볼 파일**: `packages/daemon/src/repo-core.ts`(클론), `packages/daemon/src/repo-bringup.ts`(설치 · 미리보기), `packages/daemon/src/repo-config.ts`(명령 조립), `packages/daemon/src/preview-claim.ts`(포트 읽기).

### 8. 서버가 남지 않는가 — 창 닫기 · 강제 종료 (10분)

- **하는 일**: 앱을 켜기 **전에** `orphan-check.mjs before` 를 돌려 둔다. 앱에서 `회원` 의 미리보기를 띄운다(`결제` 가 안 뜨면 한 프로젝트로 한다).
  - 8-1: 창을 닫는다(앱이 끝난다). 10초 뒤 `orphan-check.mjs after`.
  - 8-2: 앱을 다시 켜 미리보기를 띄운다. 작업 관리자의 세부 정보 탭에서 가장 위의 `ColoNova Design.exe` 를 **`프로세스 트리 끝내기` 가 아니라 `작업 끝내기`(그 프로세스 하나)** 로 끝낸다 — 앱이 죽어도 자식이 따라 죽지 않는 상황을 흉내 낸다. `after` 를 돌린다. 앱을 다시 켠다.
- **합격 기준**
  - 8-1: `after` 가 `통과 — 남은 프로세스 없음`(**0줄**)이다. `claude` · `node` · `cmd` · `conhost` 가 한 줄도 남지 않는다. *(이번 수리: `taskkill /T /F` 트리 킬)*
  - 8-2 **[예상]**: 서버 트리(`node` · `cmd`)가 남는다 — 앱이 죽으면 아무도 거두지 않고, Windows 에서는 다음 실행이 이전 서버를 거두지 않는다(`reclaimStalePreview` 가 건너뛴다). 다시 켠 앱이 미리보기를 **띄우는지**와 **다른 포트로 뜨는지**를 적는다. 남은 프로세스는 `taskkill /PID <pid> /T /F` 로 치운다.
  - 프로젝트를 두 개 이상 번갈아 열어도 서버가 사라지지 않고 따뜻하게 남는다(최근 두 개까지가 정상이다).
- **실패 시 볼 파일**: `packages/daemon/src/preview-claim.ts`(`treeKillPlan`), `packages/daemon/src/repo-bringup.ts`(`killPreview` · `reclaimStalePreview`), `scripts/orphan-check.mjs`, `packages/desktop/src/main.ts`(`will-quit`).

### 9. 포트가 막혀 있을 때 (5분)

- **하는 일**
  - 9-1: 준비물의 PowerShell 두 창으로 5173 · 3000 을 막아 두고 앱을 켜 `회원` 의 미리보기를 띄운다. 막는 줄은 IPv4 · IPv6 둘 다 잡는 것이어야 한다(Vite 는 `localhost` 를 IPv6 로 푸는 일이 많다).
  - 9-2: 앱을 끈다. `netsh int ipv4 show excludedportrange protocol=tcp` 로 **제외 대역**을 본다. 대역 안의 포트 하나를 `%APPDATA%\ColoNova Design\desktop-settings.json` 의 `"port"` 에 적는다. 앱을 켠다.
    대역이 하나도 없으면 이 항목은 진행자 PC 에서 한다: 관리자 PowerShell 에서 `netsh int ipv4 add excludedportrange protocol=tcp startport=<포트> numberofports=1` 로 만들고, 끝나면 `delete excludedportrange` 로 지운다 [해 본 적 없음].
- **합격 기준**
  - 9-1: 미리보기가 **다른 포트**로 떠 `준비가 끝났어요` 가 된다(막은 포트와 부딪치지 않는다).
  - 9-2: 앱이 **시작 실패 상자 없이** 열린다. `desktop-settings.json` 의 `"port"` 가 **새 값으로 바뀌어 있다**. 옛 판은 `listen EACCES` 로 시작 실패 상자(`기록 폴더 열기` · `끝내기`)가 매번 떴다. *(이번 수리: EACCES 도 임시 포트로 물러난다)*
- **실패 시 볼 파일**: `packages/desktop/src/daemon-start.ts`, `packages/desktop/src/main.ts`(`bootApp`), `packages/desktop/src/desktop-settings.ts`.

### 10. 글자 수가 같은 한글 프로젝트 둘 (5분)

- **하는 일**: 이미 들인 `결제` 와 `회원` 이 그 둘이다. 폴더를 연다(프로젝트 정보 카드의 `폴더 열기`). 두 프로젝트에서 각각 대화를 하나씩 만들고 한쪽에서 말을 보낸다.
- **합격 기준**
  - `%USERPROFILE%\.colonova-design\projects\` 에 `결제-xxxxxx` 와 `회원-xxxxxx`(여섯 자리 16진수 접미)가 **서로 다른 폴더**로 있다. 화면의 프로젝트 이름은 `결제` · `회원` 그대로다. *(이번 수리: ASCII 접미)*
  - `%USERPROFILE%\.claude\projects\` 에 두 프로젝트의 대화 폴더가 **둘로 나뉘어** 있다(폴더 이름이 접미 때문에 다르다).
  - 두 프로젝트의 대화 목록이 섞이지 않는다.
  - 알아 둘 것: 지금의 화면에는 **한 프로젝트의 대화만 지우는 길이 없다**(`전체 초기화…` 는 모두 지운다). 그래서 `대화 모두 지우기` 가 이웃의 대화를 지우는지는 이 세션에서 눈으로 볼 수 없고, 데몬 시험(`claude-delete-all.test.ts`)이 단언한다.
- **실패 시 볼 파일**: `packages/daemon/src/projects.ts`(`slugify`), `packages/daemon/src/agent/drivers/claude/driver.ts`(`deleteAll`).

### 11. OneDrive 가 가져간 다운로드 폴더 (5분 — 해당하는 계정만)

- **하는 일**: 탐색기의 `다운로드` 가 OneDrive 아래인 계정에서, 거기에 둔 초대 파일을 창에 끌어다 놓는다. 설정 → 업데이트에서 새 버전을 받는다면 설치 파일이 **어디에 받아지는지** 본다(12번과 같이 해도 된다).
- **합격 기준**
  - 초대 파일 가져오기가 성공한다(온라인 전용 파일이면 내려받은 뒤에).
  - 업데이트 설치 파일의 위치를 적는다. 코드는 `다운로드` 폴더에 받으므로 OneDrive 계정에서는 **동기화된다** — 알려진 한계로 기록한다(합격 · 불합격이 아니라 기록이다).
- **실패 시 볼 파일**: `packages/desktop/src/app-updates.ts`(`downloads`), `packages/web/src/lib/invite-bus.ts`.

### 12. 업데이트 — 미리보기를 띄운 채 (10분)

- **하는 일**: 한 단계 낮은 버전이 깔린 앱에서 `회원` 의 미리보기를 띄워 둔 채 설정 → 업데이트 → `지금 확인` → `업데이트` 를 누른다. 끝난 뒤 PowerShell 에서 `Get-Content $env:TEMP\colonova-design-update.log -Tail 20 -Encoding UTF8` 로 교체 기록을 본다.
- **합격 기준**
  - 앱이 닫히고 **1분 안에** 새 버전이 다시 열린다. 업데이트 도중 **PowerShell 창이 보이지 않는다**. *(이번 수리: 교체 스크립트의 `windowsHide`)*
  - 설정에 `<시각>에 업데이트했어요` 가 보이고 알림이 온다. 로그의 마지막 줄이 `swap done` 이다.
  - 설치 프로그램이 `파일이 사용 중` 으로 멈추지 않는다 — 미리보기 서버(`<설치>\resources\bin\node.exe`)가 앱 종료와 함께 거두어졌다는 뜻이다. 로그에 `설치가 끝났습니다` 가 있고 `설치 프로그램이 오류로 끝났습니다` 가 없다. *(이번 수리: 트리 킬)*
- **실패 시 볼 파일**: `packages/desktop/src/app-updates.ts`, `packages/desktop/src/win-self-update.ts`, `packages/desktop/src/self-update.ts`.

### 13. 막히면 담당자에게 한 덩어리로 (5분)

- **하는 일**: 위에서 난 실패 하나를 골라(없으면 7-B 의 `FOO=bar` 오류) 비개발자가 되어 도움말의 `문제가 생겼어요 — 진단 복사` 나 설정의 개발자용 쪽 `담당자에게 보낼 내용 복사` 를 누르고 메모장에 붙여넣는다(둘은 같은 글이다).
- **합격 기준**
  - **한 번의 복사로** 한 덩어리가 나온다(여러 곳을 돌며 모으지 않는다).
  - 붙여넣은 글에 **테스터의 이름 · 계정 이름 · 한 말 · 폴더 경로가 없다**.
  - 진행자가 그 글만 보고 **어느 항목이 왜 실패했는지 짐작할 수 있다**. 짐작이 안 되면 무엇이 빠졌는지 그대로 적는다 — 그것이 진단 복사가 채울 것이다.
  - 붙여넣은 글에 깨진 글자가 있으면 적는다(자식의 출력이 섞이는 자리다).
- **실패 시 볼 파일**: `packages/web/src/next/settings/DeveloperPage.tsx`.

## 세션 뒤 기록 방법

1. 세션이 끝나는 대로 아래 「세션 기록」 표를 채운다. 항목마다 `[확인]` · `[실패]` · `[예상 확인]`(예상한 한계가 그대로 나왔다) 중 하나와 **한 줄**(종류와 숫자만)을 적는다. 합격 기준의 숫자(창 0개 · 0줄 · 몇 초)는 그대로 적는다.
2. `[실패]` 는 같은 날 이슈로 올리고, 이 문서의 해당 항목 아래에 이슈 번호를 적는다. 그다음 `docs/DEVELOPERS.md` 「Windows 코드 수리와 첫 베타 세션」의 `코드로 확실한 것` 줄에 `Windows 실기 [확인]`/`[실패]` 와 날짜를 덧붙이고, `추정` 항목은 결과대로 `확인`으로 옮기거나 수리 항목으로 올린다.
3. 7-B 의 `FOO=bar` 결과로 `추정으로 남김` 을 정한다 — 증상이 어떻게 보였는지에 따라 후보 둘(pnpm `shell-emulator` · bash 스크립트 셸) 중 하나를 시험하거나, 레포 쪽 `cross-env` 안내로 돌린다.
4. 막힌 곳의 근거는 `진단 복사` 한 덩어리 하나만 붙인다(이름 · 말 · 경로가 없는 것). 화면 캡처에 이름이 보이면 가린다.
5. 코드가 고쳐지면 같은 항목을 다음 세션에서 다시 밟는다. 이 문서는 지우지 않고 세션마다 아래에 표를 하나씩 더한다.

### 세션 기록 (복사해서 쓴다)

| 머리 | 값 |
| --- | --- |
| 날짜 · 앱 버전 · Windows 버전 | |
| 스마트 앱 컨트롤 · 관리 기기 · 계정 이름 종류(한글/공백/둘 다) · OneDrive 다운로드 | |
| Claude 요금제 로그인 · 비용을 낸 쪽 | |

| # | 결과 | 한 줄 (종류와 숫자만) |
| --- | --- | --- |
| 1 설치 | | |
| 2 첫 실행 3분 — 콘솔 창 개수 · 방화벽 상자 수 | | |
| 3 번들 도구 | | |
| 4 AI 도구 — `PowerShell` 도구 | | |
| 5 설치 · 로그인(한글/공백 계정) | | |
| 6 두 네트워크 길 | | |
| 7-A 정상 레포 — 서버 `node.exe` 벌 수 · 콘솔 창 | | |
| 7-B 함정 레포 — 긴 경로 · `.sh` · `FOO=bar` | | |
| 8-1 창 닫기 — 남은 프로세스 줄 수 | | |
| 8-2 강제 종료 — 남은 줄 수 · 새 포트 | | |
| 9 포트 — 점유 · 제외 대역 | | |
| 10 한글 프로젝트 둘 — 폴더 이름 · 대화 폴더 | | |
| 11 OneDrive | | |
| 12 업데이트 — 걸린 초 · 창 | | |
| 13 진단 복사 | | |

## 수리와 세션 번호

| 2026-10-07 에 코드로 고친 것 | 이 세션에서 확인하는 곳 |
| --- | --- |
| 모든 자식 호출의 `windowsHide`(검은 콘솔 창) | 2 · 7-A · 12 |
| 미리보기 서버 트리 킬 `taskkill /T /F` | 8-1 · 12 |
| 프로세스 표(`descendantPids`) — 셸 없이 PowerShell + CSV | 7-A(서버가 주소를 안 찍는 경우의 준비 판정) |
| 셸을 거치는 호출의 따옴표 · `.exe` 직접 실행 | 5 |
| 저장 포트 EACCES 폴백 | 9-2 |
| 한글 프로젝트 폴더의 ASCII 접미 | 10 |
| 초대 파일 더블클릭 열기(파일 연결 · `process.argv` · `second-instance`) — 2026-10-08 | 7-A′ |

아직 추정인 것: `FOO=bar` 류 스크립트(7-B) · 강제 종료 뒤 남는 서버(8-2) · 방화벽 상자(2) · 긴 경로와 줄바꿈 설정(7-B) ·
자식 출력의 인코딩(5 · 13) · OneDrive 의 설치 파일(11) · PowerShell 도구와 가드(4).
범위 밖: Windows 서명 · 스마트 앱 컨트롤 · SmartScreen(결정 대기), 프록시 · 사내 인증서.
