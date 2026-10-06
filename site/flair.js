/** 비교 접이의 대화는 화면에 들어올 때 한 번만 나타난다. */
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- ② 스토리 대화 — 스크롤에 들어온 줄부터 한 줄씩 ---------- */
const talk = document.getElementById("talk");

if (talk && !reduced && "IntersectionObserver" in window) {
  talk.classList.add("fx-talk");
  const lines = [...talk.querySelectorAll(".talk__line")];
  lines.forEach((li, i) => {
    li.style.setProperty("--td", `${80 * i}ms`);
  });
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          io.unobserve(entry.target);
        }
      }
    },
    { rootMargin: "0px 0px -12% 0px" },
  );
  for (const li of lines) io.observe(li);
}
