// 부품(fixture) 페이지를 한 번에 스크린샷한다 — orca 의 fixtures:shot 을 colonova
// 꼴로 옮겼다(2026-10-25). Electron 을 켜지 않고 packages/web/dev 의 부품 그림을
// 초 단위로 얻는 게 목적이다. 검사가 아니라 눈으로 보는 루프다 — 픽셀 단언은
// 시험(pnpm test)의 몫이다.
//
// 사용: node scripts/web-fixture-shot.mjs [부품 …]  — 이름은 파일 줄기(home-fixture · chip-fixture …).
// 필요: 전역 Playwright — cold 시험(test/cold/run.js)과 같은 자리다(npm i -g --prefix ~/.local playwright).
//       레포의 의존성이 아니다.
// 결과: packages/web/fixtures-out/<부품>.png — 산출물이라 커밋하지 않는다(.gitignore).
import { mkdirSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(repo, "packages", "web");
const outDir = path.join(webDir, "fixtures-out");

/** 전역 Playwright — 못 찾으면 설치 법을 알려준다. */
function loadChromium() {
  const require = createRequire(import.meta.url);
  // cold 시험의 macOS 자리(.local/lib/…) 와 Windows npm 의 자리(.local/node_modules/…).
  const spots = [
    path.join(homedir(), ".local", "lib", "node_modules", "playwright"),
    path.join(homedir(), ".local", "node_modules", "playwright"),
    "playwright",
  ];
  for (const spot of spots) {
    try {
      return require(spot).chromium;
    } catch {
      // 다음 자리를 본다.
    }
  }
  console.error("Playwright 를 찾지 못했다 — cold 시험과 같은 전역 설치가 필요하다:");
  console.error("  npm i -g --prefix ~/.local playwright");
  process.exit(1);
}

const chromium = loadChromium();
const wanted = new Set(process.argv.slice(2));
const pages = readdirSync(path.join(webDir, "dev"))
  .filter((file) => file.endsWith(".html"))
  .filter((file) => wanted.size === 0 || wanted.has(file.slice(0, -".html".length)));
if (pages.length === 0) {
  console.error("찍을 부품이 없다 — packages/web/dev/*.html (또는 준 이름이 틀렸다)");
  process.exit(1);
}

// vite 의 개발 서버를 스크립트 안에서 띄운다 — dev/*.html 은 빌드가 아닌 개발 서버의
// 진입점이다(knip 참조). 포트 0 으로 켜 둔 dev:web(29173) 과 부딪히지 않는다.
const requireFromWeb = createRequire(path.join(webDir, "package.json"));
const { createServer } = requireFromWeb("vite");
const server = await createServer({
  root: webDir,
  server: { host: "127.0.0.1", port: 0, strictPort: false },
});
await server.listen();
const base = (server.resolvedUrls?.local ?? [])[0] ?? "http://127.0.0.1:5173/";

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1520, height: 960 } });
  const page = await context.newPage();
  mkdirSync(outDir, { recursive: true });
  let failed = 0;
  for (const file of pages) {
    const errors = [];
    page.removeAllListeners("console");
    page.removeAllListeners("pageerror");
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text().slice(0, 200)}`);
    });
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message.slice(0, 200)}`));
    const out = path.join(outDir, `${file.slice(0, -".html".length)}.png`);
    try {
      await page.goto(new URL(`dev/${file}`, base).toString(), {
        waitUntil: "load",
        timeout: 60_000,
      });
      // 개발 서버의 첫 변환과 글자·그림의 마감을 기다린다.
      await page.waitForTimeout(1_200);
      await page.screenshot({ path: out, fullPage: true });
      const mark = errors.length === 0 ? "✓" : "!";
      const note = errors.length === 0 ? "" : ` — 콘솔 오류 ${errors.length}건`;
      console.log(
        mark +
          " " +
          file +
          " → " +
          path.relative(repo, out) +
          " (" +
          statSync(out).size +
          " bytes)" +
          note,
      );
      for (const error of errors) console.log(`    ${error}`);
    } catch (error) {
      failed += 1;
      console.error(`✗ ${file} — ${error.message}`);
    }
  }
  await context.close();
  if (failed > 0) process.exit(1);
} finally {
  await browser.close();
  await server.close();
}
