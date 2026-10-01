/**
 * 스크롤 · 포인터 모션 층 — hero3d.js 가 히어로를 맡는다면 여기는 그 밖을 맡는다.
 *
 * 1. 여정 머리카락: 문서를 읽은 만큼 차오르는 최상단 진행 줄.
 * 2. 벤토 카드: 포인터를 따라 살짝 기울고(--mx/--my 로 그 자리에 빛이 앉는다).
 *
    prefers-reduced-motion 이면 진행 줄만 남긴다(스크롤에만 반응한다).
 *    기울임은 정밀 포인터(마우스)에서만 — 터치 · 축소 화면은 건드리지 않는다.
 */

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---- 여정 머리카락 ---- */
const bar = document.getElementById("scroll-progress");
if (bar) {
  let ticking = false;
  const update = () => {
    ticking = false;
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const p = max > 0 ? Math.min(1, window.scrollY / max) : 0;
    bar.style.transform = `scaleX(${p.toFixed(4)})`;
  };
  addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
  update();
}

/* ---- 벤토 카드 기울임 — rAF 로 굳혀 한 프레임에 한 번만 쓴다 ---- */
if (!reduced && matchMedia("(pointer: fine)").matches) {
  for (const cell of document.querySelectorAll(".bento__cell")) {
    let raf = 0;
    let mx = 50;
    let my = 50;
    let rx = 0;
    let ry = 0;
    const apply = () => {
      raf = 0;
      cell.style.setProperty("--mx", `${mx.toFixed(1)}%`);
      cell.style.setProperty("--my", `${my.toFixed(1)}%`);
      // 기존 hover 의 살짝 뜨기(-3px)를 각도와 함께 유지한다
      cell.style.transform =
        `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-3px)`;
    };
    cell.addEventListener("pointerenter", () => cell.classList.add("is-tilting"));
    cell.addEventListener("pointermove", (e) => {
      const r = cell.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      mx = px * 100;
      my = py * 100;
      ry = (px - 0.5) * 4.4; // 최대 ±2.2deg — 제품의 담백한 말투를 해치지 않는 폭
      rx = (0.5 - py) * 3.6;
      if (!raf) raf = requestAnimationFrame(apply);
    });
    cell.addEventListener("pointerleave", () => {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      cell.classList.remove("is-tilting");
      cell.style.transform = ""; // CSS 의 0.55s 복귀가 이어 받는다
    });
  }
}
