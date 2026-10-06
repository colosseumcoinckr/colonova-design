/**
 * 소개 페이지의 제품 데모. 장면을 고르거나 재생을 시작한다.
 * 화면 밖으로 나가거나 탭을 숨기면 멈춘다. 실제 작업은 실행하지 않는다.
 * 2026-10-06: 사용자 요청. 처음부터 읽을 수 있는 장면을 둔다.
 */
const $ = (id) => document.getElementById(id);
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const appwin = $("appwin");
const steps = [...document.querySelectorAll(".demo-step")];
const flowSteps = [...document.querySelectorAll("#flow .flow__step")];
const play = $("demo-play");
const caption = $("demo-caption");
const captions = [
  "“회원 목록에 검색창을 넣어 줘” 한마디로 시작해요.",
  "고칠 곳을 찍고 “검색창은 좁게”라고 말하세요.",
  "바뀐 화면을 확인하고, 개발자에게 한마디를 얹어 제출해요.",
  "제출한 작업은 개발자의 확인을 기다려요.",
  "개발자가 작업을 합치면 알려 줘요. 서비스 공개 여부는 담당자에게 확인하세요.",
];
let scene = 0;
let timer = null;

function pause() {
  clearTimeout(timer);
  timer = null;
  if (play) {
    play.setAttribute("aria-pressed", "false");
    play.replaceChildren();
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "▷";
    play.append(icon, " 재생");
  }
}

function setScene(index) {
  if (!appwin) return;
  scene = index;
  appwin.classList.add("demo-live");
  appwin.dataset.phase = ["reply", "pin", "confirm", "review", "merged"][index];
  const show = (id, on) => $(id)?.classList.toggle("show", on);
  for (const id of ["demo-usermsg", "demo-aimsg", "demo-screencard", "demo-meta", "demo-search"])
    show(id, true);
  for (const id of ["demo-pin", "demo-bubble", "demo-chip"]) show(id, index === 1);
  show("demo-confirm", index === 2);
  show("demo-receipt", index >= 3);
  show("demo-merged", index === 4);
  $("demo-aitext").textContent =
    index === 1
      ? "검색창 폭을 줄여 옆 칸과 나란히 맞췄어요."
      : "검색창을 넣었습니다. 미리보기에서 확인해 보세요.";
  $("demo-note").textContent = "검색창 폭만 봐 주세요";
  const submit = $("demo-submit");
  submit.textContent = index >= 3 ? "제출됐어요" : "제출";
  submit.classList.toggle("done", index >= 3);
  const active = index === 4 ? 2 : index >= 3 ? 1 : 0;
  const labels =
    index === 4
      ? ["제출됨", "확인됨", "개발자 반영 완료"]
      : index === 3
        ? ["제출됨", "개발자 확인을 기다려요", "개발자 반영"]
        : ["제출 전 · 화면 2개", "개발자 확인", "개발자 반영"];
  for (let i = 0; i < 3; i += 1) {
    const dot = $(`demo-dot${i}`);
    dot?.classList.toggle("on", i === active);
    dot?.classList.toggle("done", i < active);
    if (dot) dot.querySelector("b").textContent = labels[i];
  }
  steps.forEach((button, i) => {
    button.setAttribute("aria-pressed", String(i === Math.min(index, 2)));
  });
  const flowIndex = index >= 3 ? 3 : index;
  flowSteps.forEach((button, i) => {
    button.classList.toggle("on", i === flowIndex);
    button.setAttribute("aria-pressed", String(i === flowIndex));
  });
  for (let i = 0; i < 3; i += 1) {
    const dot = $(`jline-${i}`);
    dot?.classList.toggle("on", i === active);
    dot?.classList.toggle("done", i < active);
  }
  for (let i = 0; i < 2; i += 1)
    $(`jline-rail${i}`)?.style.setProperty("width", i < active ? "100%" : "0");
  if (caption) caption.textContent = captions[index];
  const mobileCaption = $("demo-mobile-caption");
  if (mobileCaption) mobileCaption.textContent = captions[index];
}

steps.forEach((button, i) => {
  button.addEventListener("click", () => {
    pause();
    setScene(i);
  });
});
flowSteps.forEach((button, i) => {
  button.addEventListener("click", () => {
    pause();
    setScene(i === 3 ? 4 : i);
  });
});

play?.addEventListener("click", () => {
  if (timer !== null) {
    pause();
    return;
  }
  if (scene >= 4) setScene(0);
  play.setAttribute("aria-pressed", "true");
  play.textContent = "Ⅱ 일시정지";
  const advance = () => {
    setScene(scene + 1);
    if (scene >= 4) pause();
    else timer = setTimeout(advance, motion.matches ? 4500 : 3500);
  };
  timer = setTimeout(advance, motion.matches ? 4500 : 3500);
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) pause();
});
motion.addEventListener("change", pause);
if (appwin && "IntersectionObserver" in window) {
  new IntersectionObserver(([entry]) => {
    if (!entry.isIntersecting) pause();
  }).observe(appwin);
}
if (appwin) {
  setScene(0);
  document.querySelector(".demo-controls").hidden = false;
}

/* ---------- 스크롤 리빌 ----------
   .js 를 먼저 달아 숨김 상태를 켜고, 들어온 요소에 .in 을 단다. 여기서 실패하면 .js 가
   달리지 않아 페이지는 그냥 다 보인다. IntersectionObserver 가 답하지 않는 환경(숨겨진
   탭 등)을 위해 스크롤 폴백을 둔다. */
document.documentElement.classList.add("js");

// 카드 묶음은 차례로 올라온다 — 자식마다 순번(--i)을 매긴다.
for (const list of document.querySelectorAll("[data-stagger]")) {
  for (const [i, el] of [...list.children].entries()) el.style.setProperty("--i", String(i));
}

const revealTargets = [...document.querySelectorAll(".section, .appwin")];
const revealInView = () => {
  for (const el of revealTargets) {
    if (el.classList.contains("in")) continue;
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight * 0.92 && rect.bottom > 0) el.classList.add("in");
  }
};
if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  for (const el of revealTargets) observer.observe(el);
}
window.addEventListener("scroll", revealInView, { passive: true });
revealInView();
