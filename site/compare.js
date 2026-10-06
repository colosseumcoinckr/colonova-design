/**
 * compare.js — 어제와 오늘을 한 자리에서 가르는 손잡이.
 *
 * 포인터 · 터치 · 키보드(← → · Home/End)로 자르는 자리를 옮긴다. 판정은 없다 —
 * 보여 주는 것만 한다. 움직임은 사용자의 손이므로 prefers-reduced-motion 에서도
 * 드래그는 그대로 둔다. 손잡이는 슬라이더로 읽힌다.
 */

const cmp = document.getElementById("cmp");
const cmpStage = document.getElementById("cmp-stage");

if (cmp && cmpStage) {
  const handle = cmpStage.querySelector(".cmp__handle");
  let cut = 50;

  const apply = () => {
    cmpStage.style.setProperty("--cut", `${cut.toFixed(2)}%`);
    handle?.setAttribute("aria-valuenow", String(Math.round(cut)));
    handle?.setAttribute(
      "aria-valuetext",
      `이전 방식 ${Math.round(cut)}% · ColoNova ${100 - Math.round(cut)}%`,
    );
    // 한쪽이 거의 다 보이면 그쪽 태그만 밝힌다 — 판정은 여전히 사용자의 몫.
    cmp.classList.toggle("cmp--left", cut < 34);
    cmp.classList.toggle("cmp--right", cut > 66);
  };

  const fromPointer = (e) => {
    const r = cmpStage.getBoundingClientRect();
    cut = Math.min(96, Math.max(4, ((e.clientX - r.left) / r.width) * 100));
    apply();
  };

  let dragging = false;
  cmpStage.addEventListener("pointerdown", (e) => {
    dragging = true;
    cmpStage.setPointerCapture(e.pointerId);
    fromPointer(e);
  });
  cmpStage.addEventListener("pointermove", (e) => {
    if (dragging) fromPointer(e);
  });
  const stop = () => {
    dragging = false;
  };
  cmpStage.addEventListener("pointerup", stop);
  cmpStage.addEventListener("pointercancel", stop);

  handle?.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 10 : 3;
    if (e.key === "ArrowLeft") {
      cut = Math.max(4, cut - step);
      apply();
      e.preventDefault();
    } else if (e.key === "ArrowRight") {
      cut = Math.min(96, cut + step);
      apply();
      e.preventDefault();
    } else if (e.key === "Home") {
      cut = 4;
      apply();
      e.preventDefault();
    } else if (e.key === "End") {
      cut = 96;
      apply();
      e.preventDefault();
    }
  });

  apply();
}
