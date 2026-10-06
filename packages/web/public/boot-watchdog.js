/*!
 * 마운트 전 와치독(PLAN-CRASH-PROCESS 3.A 층 1 · P-3) — index.html 의 모듈
 * 스크립트 앞에 로드되는 클래식 스크립트다. React 가 뜨기 전에 죽는 부팅
 * (모듈 로드 실패 · main 진입의 예외)을 잡아 안내판 한 장을 세운다.
 *
 * 문장이 labels.ts 의 L.crash 와 겹쳐 있는 이유: 이 파일은 번들 밖에서
 * 돌므로 labels.ts 를 import 할 수 없다. 대신 next-labels.test.ts 가
 * 글자 동치를 지킨다 — labels.ts 를 고치면 이 파일도 같이 고쳐야 한다.
 *
 * 2026-10-06 겹판 손질 — React 판(`next/CrashScreen.tsx`)과 같은 얼굴로 맞췄다: 같은 본문 ·
 * 이름 있는 alertdialog · 초점은 `다시 열기` · 날 오류는 `자세히` 로 접는다 · 저장된 테마를 따라
 * 어두운 바탕이면 어둡게(예전에는 늘 밝은 종이색이라 어두운 테마 사용자의 눈을 찔렀다).
 */
(() => {
  const BOOT_MS = 10000;
  const KEY = "colonova-design.last-crash";
  const SETTINGS_KEY = "colonova-design.settings";
  const TITLE = "화면이 열리지 않아요";
  const BODY = "다시 열면 대화와 작업은 그대로예요.";
  const REOPEN = "다시 열기";
  const DETAILS = "자세히";
  let shown = false;

  /* 번들이 살아 있다는 신호 — 마운트했거나(appMounted) 경계가 사고를 받았으면
     (appCrashed) 화면의 주인은 React 다. 와치독의 판은 번들 자체가 죽은 부팅에만. */
  const reactOwnsScreen = () =>
    document.documentElement.dataset.appMounted === "1" ||
    document.documentElement.dataset.appCrashed === "1";

  /* 직전 부팅이 남긴 사고의 한 줄 — source 접두를 붙인다. 없으면 빈줄. */
  const lastCrashLine = () => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (!raw) return "";
      const record = JSON.parse(raw);
      if (!record || typeof record.message !== "string" || !record.message) return "";
      const head = typeof record.source === "string" && record.source ? `${record.source} · ` : "";
      return `${head}${record.message}`;
    } catch {
      return "";
    }
  };

  /* 저장된 테마가 어두운 팔레트인가 — dark · github 는 어둡고, system 은 OS 를 따른다. 읽지 못하면 밝게. */
  const prefersDark = () => {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY);
      const theme = raw ? JSON.parse(raw).theme : null;
      if (theme === "dark" || theme === "github") return true;
      if (theme === "system") return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      /* 읽지 못하면 밝은 종이색 — 안내판은 늘 읽혀야 한다. */
    }
    return false;
  };

  const styled = (node, style) => {
    node.setAttribute("style", style);
    return node;
  };

  const show = (extraLine) => {
    if (shown) return;
    shown = true;
    const root = document.getElementById("root");
    try {
      if (root) root.textContent = "";
      const dark = prefersDark();
      const ink = dark ? "#e4e4e7" : "#26241f";
      const muted = dark ? "#a4a4b0" : "#5c5749";
      const paper = dark ? "#0f0f11" : "#faf9f5";
      const panel = styled(
        document.createElement("div"),
        "position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;" +
          "justify-content:center;gap:12px;padding:32px;text-align:center;overflow:auto;" +
          `background:${paper};color:${ink};` +
          "font-family:Pretendard Variable,Pretendard,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      );
      panel.setAttribute("role", "alertdialog");
      panel.setAttribute("aria-labelledby", "nx-boot-title");
      panel.setAttribute("aria-describedby", "nx-boot-body");
      const h1 = styled(
        document.createElement("h1"),
        "margin:0;font-size:22px;font-weight:650;letter-spacing:-.01em",
      );
      h1.id = "nx-boot-title";
      h1.textContent = TITLE;
      panel.appendChild(h1);
      const body = styled(
        document.createElement("p"),
        `margin:0;font-size:14px;line-height:1.6;color:${muted};max-width:420px`,
      );
      body.id = "nx-boot-body";
      body.textContent = BODY;
      panel.appendChild(body);
      const button = styled(
        document.createElement("button"),
        "margin-top:10px;padding:9px 22px;font:inherit;font-size:14px;font-weight:600;" +
          `border-radius:10px;border:1px solid ${ink};background:${ink};color:${paper};cursor:pointer`,
      );
      button.type = "button";
      button.textContent = REOPEN;
      button.addEventListener("click", () => window.location.reload());
      panel.appendChild(button);
      /* 날 오류(이번 사고 · 직전 부팅이 남긴 사고)는 접어 둔다 — 사용자가 읽을 문장이 아니다. */
      const lines = [];
      if (extraLine) lines.push(extraLine);
      const stored = lastCrashLine();
      if (stored && stored !== extraLine) lines.push(stored);
      if (lines.length > 0) {
        const fold = styled(
          document.createElement("details"),
          `margin-top:6px;max-width:560px;width:100%;font-size:13px;color:${muted}`,
        );
        const summary = styled(document.createElement("summary"), "cursor:pointer");
        summary.textContent = DETAILS;
        fold.appendChild(summary);
        const pre = styled(
          document.createElement("pre"),
          "margin:8px 0 0;padding:10px 12px;text-align:left;font-size:12px;line-height:1.5;" +
            "white-space:pre-wrap;overflow-wrap:anywhere;max-height:160px;overflow:auto;" +
            `border:1px solid ${dark ? "#2c2c32" : "#e8e4d6"};border-radius:8px;` +
            `background:${dark ? "#17171a" : "#f5f4ee"}`,
        );
        pre.textContent = lines.join("\n");
        fold.appendChild(pre);
        panel.appendChild(fold);
      }
      (root ?? document.body).appendChild(panel);
      /* 낭독기가 제목 · 본문을 읽고 곧바로 누를 수 있게 — Enter 한 번이면 다시 열린다. */
      button.focus();
    } catch {
      /* 안내판 자체가 실패하면 더 할 말이 없다 — 타이머는 이미 끝났다. */
    }
  };

  /* 마운트 전 예외는 타이머보다 먼저 안내판을 세운다. 마운트 뒤의 전역 오류는
     화면을 덮지 않는다(P-2) — 앱의 installGlobalHandlers 가 기록만 남긴다. */
  window.addEventListener("error", (event) => {
    if (reactOwnsScreen()) return;
    show(event.message || null);
  });

  window.setTimeout(() => {
    if (!reactOwnsScreen()) show(null);
  }, BOOT_MS);
})();
