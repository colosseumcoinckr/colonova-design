/** 읽은 만큼 채워지는 진행 줄. 입력하는 카드는 기울이지 않는다. */
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
  addEventListener(
    "scroll",
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
  update();
}
