/**
 * 재생 벤치(PLAN-HARNESS §3.A)의 순수 함수 — 시나리오 읽기 · 핀 턴 만들기 ·
 * 통계 행 모으기 · 끝 판정 · 판정 · 요약 · 비교. 네트워크와 git 은 bench.mjs 가
 * 갖고, 이 파일은 검증하기 쉽도록 부작용을 파일 읽기(loadScenarios ·
 * collectRows · loadSheet) 정도로만 둔다.
 * 데몬의 대상 고르기(syncTargets)는 dist 를 가져다 쓴다 — 시험은 빌드 뒤에
 * 돈다(2026-11-03 · A안 0-2 1층 채점기).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { syncTargets } from "../../packages/daemon/dist/screen-plan-sync.js";
import { markTurn } from "../../packages/protocol/dist/index.js";

const TURN_STATS_PREFIX = "turn-stats-";

// ---------------------------------------------------------------------------
// 시나리오 — JSON 파일 하나가 시나리오의 배열이다.
//
//   { "id": "search", "kind": "user", "text": "…",
//     "expect": { "files": ["server.js"], "contains": ["…"] } }
//   { "id": "pin-title", "kind": "pin", "note": "제목을 더 크게 해 줘",
//     "pins": [{ "screen": "list", "text": "회원 목록" }],
//     "expect": { "files": ["server.js"] } }
//
// `expect.files` 의 각 항목은 바뀐 파일 경로의 부분 문자열, `expect.contains` 의
// 각 항목은 바뀐 파일 어느 하나의 지금 내용에 들어 있어야 하는 문자열이다.
// ---------------------------------------------------------------------------

/** 시나리오 하나를 검사한다 — 문제가 있으면 Error, 없으면 조용히 돌아온다. */
function validateScenario(item, index) {
  const where = `시나리오 ${index + 1}번`;
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`${where} — 시나리오는 객체여야 합니다.`);
  }
  const id = item.id;
  if (typeof id !== "string" || id.trim() === "") {
    throw new Error(`${where} — id 가 비어 있습니다.`);
  }
  const at = `${where}(${id})`;
  if (item.kind === "user") {
    if (typeof item.text !== "string" || item.text.trim() === "") {
      throw new Error(`${at} — user 시나리오에 text 가 없습니다.`);
    }
  } else if (item.kind === "pin") {
    if (typeof item.note !== "string" || item.note.trim() === "") {
      throw new Error(`${at} — pin 시나리오에 note(메모)가 없습니다.`);
    }
    if (!Array.isArray(item.pins) || item.pins.length === 0) {
      throw new Error(`${at} — pin 시나리오에 pins 목록이 없습니다.`);
    }
    for (const [i, pin] of item.pins.entries()) {
      if (typeof pin?.screen !== "string" || pin.screen.trim() === "") {
        throw new Error(`${at} — pins[${i}] 의 screen 이 없습니다.`);
      }
      if (typeof pin?.text !== "string" || pin.text.trim() === "") {
        throw new Error(`${at} — pins[${i}] 의 text 가 없습니다 — 벤치의 핀은 글자 핀입니다.`);
      }
    }
  } else if (item.kind === "compare") {
    // 맞춰 보기(2026-11-02 · 같이 고치기 UX 계획 0단계) — 문서 하나의 어긋남을 재는 한 편. 정답은
    // compare-sheet.json 이 갈고리 삼는다 — 여기선 문서와 기대 절만 받는다.
    if (typeof item.pageId !== "string" || item.pageId.trim() === "") {
      throw new Error(`${at} — compare 시나리오에 pageId 가 없습니다.`);
    }
    if (item.sheet !== undefined && typeof item.sheet !== "string") {
      throw new Error(`${at} — sheet 는 문자열(정답표의 문서 제목)이어야 합니다.`);
    }
  } else if (item.kind === "suggest") {
    // 화면 제안(2026-11-03 · A안 0-2 C8) — 정책을 바꾸는 말을 보낸 뒤 답의 어긋남 줄을 재는 한 편.
    if (typeof item.pageId !== "string" || item.pageId.trim() === "") {
      throw new Error(`${at} — suggest 시나리오에 pageId 가 없습니다.`);
    }
    if (item.sheet !== undefined && typeof item.sheet !== "string") {
      throw new Error(`${at} — sheet 는 문자열(정답표의 문서 제목)이어야 합니다.`);
    }
    if (typeof item.brief !== "string" || item.brief.trim() === "") {
      throw new Error(`${at} — suggest 시나리오에 brief(정책을 바꾸는 말)가 없습니다.`);
    }
  } else {
    throw new Error(
      `${at} — kind 는 "user" · "pin" · "compare" · "suggest" 이어야 합니다(${JSON.stringify(item.kind)}).`,
    );
  }
  const expect = item.expect;
  if (expect === null || typeof expect !== "object" || Array.isArray(expect)) {
    throw new Error(`${at} — expect 가 없습니다.`);
  }
  if (item.kind === "compare" || item.kind === "suggest") {
    // compare 는 어긋남 한 절 이상을 기대하는 견본만 둔다. suggest 는 빈 목록도 받는다 —
    // 정책과 화면이 이미 맞는 편의 「잘못 짚음 없음」을 재기 때문이다(2026-11-03 · A안 0-2).
    const label = item.kind === "compare" ? "compare" : "suggest";
    if (
      !Array.isArray(expect.sections) ||
      expect.sections.some((s) => typeof s !== "string" || s === "")
    ) {
      throw new Error(`${at} — ${label} 시나리오의 expect.sections 는 절 목록이어야 합니다.`);
    }
    if (item.kind === "compare" && expect.sections.length === 0) {
      throw new Error(`${at} — compare 시나리오의 expect.sections 는 비어 있지 않아야 합니다.`);
    }
    return;
  }
  if (
    !Array.isArray(expect.files) ||
    expect.files.length === 0 ||
    expect.files.some((f) => typeof f !== "string" || f === "")
  ) {
    throw new Error(`${at} — expect.files 는 비어 있지 않은 경로 조각 목록이어야 합니다.`);
  }
  if (
    expect.contains !== undefined &&
    (!Array.isArray(expect.contains) || expect.contains.some((s) => typeof s !== "string"))
  ) {
    throw new Error(`${at} — expect.contains 는 문자열 목록이어야 합니다.`);
  }
}

/** 시나리오 배열을 검사한다 — id 중복과 각 항목의 모양. */
export function validateScenarios(list) {
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error("시나리오 파일은 비어 있지 않은 배열이어야 합니다.");
  }
  const seen = new Set();
  for (const [i, item] of list.entries()) {
    validateScenario(item, i);
    if (seen.has(item.id)) {
      throw new Error(`시나리오 id "${item.id}" 가 겹칩니다.`);
    }
    seen.add(item.id);
  }
  return list;
}

/** 시나리오 파일을 읽고 검사한다. */
export function loadScenarios(file) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    throw new Error(`시나리오 파일을 읽지 못했습니다 — ${file}: ${error.message}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`시나리오 파일이 JSON 이 아닙니다 — ${file}: ${error.message}`);
  }
  return validateScenarios(data);
}

// ---------------------------------------------------------------------------
// 핀 턴 — packages/web/src/lib/preview-turns.ts 의 pinsToTurn 을 따르되,
// 벤치가 아는 줄만 싣는다(문장 · 안내 한 줄 · `1. <글자> — "<글자>"` · 메모 한
// 줄). 마커의 items[].id 는 session.send 의 pinHints[].id 와 같은 값이다.
// ---------------------------------------------------------------------------

/** 마커의 items 와 pinHints 가 함께 쓰는 핀 id — 시나리오 id + 순번. */
export function pinIds(scenario) {
  return (scenario.pins ?? []).map((_, i) => `${scenario.id}-${i + 1}`);
}

/** session.send 의 pinHints — id 가 턴 마커의 items[].id 에 닿아야 한다. */
export function pinHints(scenario) {
  return (scenario.pins ?? []).map((pin, i) => ({
    id: pinIds(scenario)[i],
    text: pin.text,
    screen: pin.screen,
  }));
}

/** session.send 의 pins — 이 턴이 가리킨 화면(게이트가 다시 열 대상). */
export function pinsOf(scenario) {
  return (scenario.pins ?? []).map((pin) => ({ screen: pin.screen }));
}

/**
 * 핀 시나리오가 에이전트에게 실어 보낼 턴 본문(마커 포함 한 줄 머리).
 * 문장과 메모는 같은 말이다 — 실제 입력창에서 담기(↵)가 메모를 문장 칸에
 * 옮기는 흐름이 그대로이기 때문이다.
 */
export function pinTurnText(scenario) {
  const sentence = scenario.note.trim();
  const pins = scenario.pins;
  const spread = new Set(pins.map((pin) => pin.screen)).size > 1;
  const ids = pinIds(scenario);
  const marker = {
    kind: "comments",
    screen: spread ? `화면 ${new Set(pins.map((pin) => pin.screen)).size}곳` : pins[0].screen,
    ...(sentence ? { note: sentence } : {}),
    items: pins.map((pin, i) => ({
      id: ids[i],
      label: pin.text,
      comment: sentence,
      ...(spread ? { screen: pin.screen } : {}),
    })),
  };
  const blocks = pins
    .map((pin, i) => {
      const rows = [`${i + 1}. ${pin.text} — "${pin.text}"${spread ? ` · ${pin.screen}` : ""}`];
      if (sentence) rows.push(`   ${sentence}`);
      return rows.join("\n");
    })
    .join("\n\n");
  const lines = [
    ...(sentence ? [sentence, ""] : []),
    "아래는 사용자가 가리킨 자리입니다 — 사용자의 말대로 해 주세요.",
    "",
    blocks,
  ];
  return markTurn(marker, lines.join("\n"));
}

// ---------------------------------------------------------------------------
// 통계 행 모으기 — turn-stats-<UTC 날짜>.jsonl 의 한 줄이 한 행이다.
// ---------------------------------------------------------------------------

/** 오늘과 어제(UTC)의 turn-stats 파일 경로 — 자정 무렵 걸린 턴을 덮는다. */
export function statsFiles(logDir, now = new Date()) {
  const day = (d) => `${TURN_STATS_PREFIX}${d.toISOString().slice(0, 10)}.jsonl`;
  return [join(logDir, day(now)), join(logDir, day(new Date(now.getTime() - 86_400_000)))];
}

/** 주어진 파일들에서 이 세션의 행만 — 깨진 줄과 다른 세션은 무시한다. */
export function collectRows(files, sessionId) {
  const rows = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // 그 날의 파일이 아직 없을 수 있다.
    }
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let row;
      try {
        row = JSON.parse(trimmed);
      } catch {
        continue; // 쓰다 만 줄이나 깨진 줄은 행이 아니다.
      }
      if (row === null || typeof row !== "object" || row.sessionId !== sessionId) continue;
      rows.push(row);
    }
  }
  rows.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return rows;
}

// ---------------------------------------------------------------------------
// 끝 판정 — 시나리오가 한 턴의 자식이다. 턴 행은 turn.end 의 정산에서 내려오므로
// 그 자체로 턴의 끝이다(2026-10-20 내장 게이트 제거 뒤 새 실행에는 gateset 행이
// 오지 않는다). gateset 이 뒤따르는 옛 기록만 reopened 의 고침 턴 하나를 더
// 기다린다(게이트는 두 번 서지 않는다).
// ---------------------------------------------------------------------------

/**
 * rows 는 이 세션의 행(at 순). { done, waiting } — waiting 은 지금 기다리는
 * 것의 이름("turn" | "reopen-turn")이다.
 */
export function turnProgress(rows) {
  const turns = rows.filter((row) => row.kind !== "gateset");
  if (turns.length === 0) return { done: false, waiting: "turn" };
  const gates = rows.filter((row) => row.kind === "gateset");
  const lastTurn = turns[turns.length - 1];
  const gated = gates.filter((row) => row.at > lastTurn.at);
  if (gated.length === 0) return { done: true };
  const lastGate = gated[gated.length - 1];
  if (lastGate.reopened === true) {
    const reopened = turns.filter((row) => row.at > lastGate.at).length;
    return reopened >= 1 ? { done: true } : { done: false, waiting: "reopen-turn" };
  }
  return { done: true };
}

// ---------------------------------------------------------------------------
// 판정 — 시나리오의 expect 와 실제로 바뀐 것을 대조한다.
// ---------------------------------------------------------------------------

/**
 * contents 는 바뀐 파일 경로 → 지금 내용의 Map(읽지 못한 파일은 빼둔다).
 * lastTurn 은 마지막 턴 행(없을 수 있다). 참이 되어야 할 세 가지:
 *   expect.files 의 각 조각이 바뀐 파일 중 하나의 경로에 들어 있다
 *   expect.contains 의 각 문자열이 바뀐 파일 중 하나의 내용에 있다
 *   마지막 턴 행의 isError 가 false
 */
export function judge(scenario, changed, contents, lastTurn) {
  const reasons = [];
  const expect = scenario.expect ?? {};
  const changedList = changed ?? [];
  for (const file of expect.files ?? []) {
    if (!changedList.some((path) => path.includes(file))) {
      reasons.push(`바뀐 파일에 ${file} 이 없습니다`);
    }
  }
  for (const needle of expect.contains ?? []) {
    const hit = changedList.some((path) => (contents.get(path) ?? "").includes(needle));
    if (!hit) reasons.push(`바뀐 파일 어디에도 "${needle}" 문장이 없습니다`);
  }
  if (!lastTurn) {
    reasons.push("끝난 턴이 없습니다");
  } else if (lastTurn.isError) {
    reasons.push(`마지막 턴이 오류로 끝났습니다(${lastTurn.failure ?? "other"})`);
  }
  return { pass: reasons.length === 0, reasons };
}

/**
 * 맞춰 보기의 판정(2026-11-02 · 같이 고치기 UX 계획 0단계) — result 는 `draft.compare` 의 답.
 * 놓친 절(expect.sections 에 있는데 rows 에 없는 것)과 잘못 짚은 절(rows 에 있는데 expect 에 없는
 * 것)을 다 잰다 — 정확도 재는 자리다(같은 계획 §6 기준 견본).
 */
export function judgeCompare(scenario, result) {
  const reasons = [];
  const rows = result?.rows ?? [];
  const got = rows.map((row) => row.section);
  for (const section of scenario.expect.sections) {
    if (!got.includes(section)) reasons.push(`놓친 절 — ${section}`);
  }
  for (const section of got) {
    if (!scenario.expect.sections.includes(section)) reasons.push(`잘못 짚은 절 — ${section}`);
  }
  return { pass: reasons.length === 0, reasons };
}

/**
 * 1층 채점(2026-11-03 · A안 0-2) — 정답표의 화면 요청마다 데몬의 `syncTargets` 를 1층 바닥 재료(근거 없음 ·
 * 그 요청의 화면 주소 · 연결 표)로 돌려, 기대 문서가 대상에 들었는지 센다. `opts.links` 를 주면 그 연결 줄
 * (plans-map 의 MapLink 모양 — 진짜 pageId)를 쓴다 — 그때는 정답표의 docs[].pageId 가 다 채워져 있어야 하고,
 * 비어 있으면 사람 말로 멈춘다. 주지 않으면 정답표의 `links`(doc 제목 모양)를 가짜 pageId 로 바꿔 쓴다.
 * 돌려주는 것은 `{ total, hit, missed, extra }` — `missed` 는 기대 문서(doc)가 있는데 대상에 없는 요청,
 * `extra` 는 기대에 없는 문서가 대상에 든 요청(doc: null 요청에 문서가 골라진 것 포함)이다. 한 요청이
 * 둘 다일 수 있다. `hit` 은 둘 다 아닌 요청 수다(2026-11-03 후속 — 놓침과 잘못 닿음을 가른다).
 */
export function scoreTargets(sheet, opts = {}) {
  if (sheet === null || typeof sheet !== "object" || !Array.isArray(sheet.requests)) {
    throw new Error("정답표에 requests 목록이 없습니다.");
  }
  const docs = Array.isArray(sheet.docs) ? sheet.docs : [];
  const pageIdOf = new Map(docs.map((doc) => [doc.title, doc.pageId ?? null]));
  const useFileLinks = Array.isArray(opts.links);
  if (useFileLinks) {
    const missing = docs
      .filter((doc) => typeof doc.pageId !== "string" || doc.pageId === "")
      .map((doc) => doc.title);
    if (missing.length > 0) {
      throw new Error(
        `정답표의 문서 pageId 가 비어 있습니다 — 실측 전에 채워 주세요: ${missing.join(" · ")}`,
      );
    }
  }
  const idOf = (title) => {
    if (!useFileLinks) return `bench-doc:${title}`;
    const pageId = pageIdOf.get(title);
    if (pageId === undefined) {
      throw new Error(`정답표의 문서 목록에 없는 제목입니다 — ${title}`);
    }
    return pageId;
  };
  const links = useFileLinks
    ? opts.links.map((row) => ({
        pageId: row.pageId,
        route: row.route,
        section: row.section ?? null,
      }))
    : (Array.isArray(sheet.links) ? sheet.links : []).map((row) => ({
        pageId: idOf(row.doc),
        route: row.route,
        section: row.section ?? null,
      }));
  const missed = [];
  const extra = [];
  let hit = 0;
  for (const request of sheet.requests) {
    if (typeof request.route !== "string" || request.route.trim() === "") {
      throw new Error(`요청 ${request.id} 에 화면 주소(route)가 없습니다.`);
    }
    const targets = syncTargets({ links, refs: [], sessionId: "bench", routes: [request.route] });
    const expected = request.doc === null ? null : idOf(request.doc);
    const found = targets.some((target) => target.pageId === expected);
    const stray = targets.some((target) => target.pageId !== expected);
    if (expected !== null && !found) missed.push(request.id);
    if (stray) extra.push(request.id);
    if ((expected === null || found) && !stray) hit += 1;
  }
  return { total: sheet.requests.length, hit, missed, extra };
}

/** 정답표 파일을 읽는다 — 읽기 · JSON 깨짐은 사람 말로 멈춘다. */
export function loadSheet(file) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`정답표를 읽지 못했습니다 — ${file}: ${error.message}`);
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`정답표가 객체가 아닙니다 — ${file}`);
  }
  return data;
}

/**
 * 흔들림 재기(2026-11-03 · A안 0-2) — `--repeat` 으로 한 시나리오를 여러 번 돈 결과에서, 짚은 절 묶음
 * (entry.sections)이 그 시나리오의 첫 회와 달라진 회 수의 합이다. 절을 읽지 못해 sections 가 없는 회는
 * 센 것도 · 기준도 되지 않는다. `{ total, byId }` 를 돌려준다.
 */
export function countFlaky(entries) {
  const byId = {};
  const baseline = new Map();
  for (const entry of entries ?? []) {
    if (!Array.isArray(entry.sections)) continue;
    const got = JSON.stringify([...entry.sections].sort());
    if (!baseline.has(entry.id)) {
      baseline.set(entry.id, got);
      byId[entry.id] = 0;
      continue;
    }
    if (baseline.get(entry.id) !== got) byId[entry.id] += 1;
  }
  return { total: Object.values(byId).reduce((acc, n) => acc + n, 0), byId };
}

// ---------------------------------------------------------------------------
// 요약과 비교 — 표의 한 줄 / 두 결과 파일의 같은 id 끼리.
// ---------------------------------------------------------------------------

/** 결과 파일의 시나리오 항목 하나 → 표 한 줄의 칸. */
export function summaryOf(entry) {
  const turns = entry.turns ?? [];
  const sum = (key) => turns.reduce((acc, turn) => acc + (turn.tools?.[key] ?? 0), 0);
  const browserMs = turns.every((turn) => turn.browserMs === null || turn.browserMs === undefined)
    ? null
    : turns.reduce((acc, turn) => acc + (turn.browserMs ?? 0), 0);
  // 비용 · 토큰(2026-10-02) — 턴 행의 costUsd · tokens 는 프로바이더가 알려 준 턴만 값이
  // 있다. 하나도 없으면 null(모르는 것을 0 으로 적지 않는다). 캐시 적중률은 실행 전체의
  // 가중 평균 — 입력 전체(새 입력 + 캐시 읽기 + 캐시 쓰기) 가운데 캐시에서 읽은 몫.
  const costUsd = turns.every((turn) => turn.costUsd === null || turn.costUsd === undefined)
    ? null
    : turns.reduce((acc, turn) => acc + (turn.costUsd ?? 0), 0);
  const measured = turns.filter((turn) => turn.tokens !== null && typeof turn.tokens === "object");
  const outputTokens =
    measured.length === 0
      ? null
      : measured.reduce((acc, turn) => acc + (turn.tokens.output ?? 0), 0);
  const cacheDenominator = measured.reduce(
    (acc, turn) =>
      acc + (turn.tokens.input ?? 0) + (turn.tokens.cacheRead ?? 0) + (turn.tokens.cacheWrite ?? 0),
    0,
  );
  const cacheHitRate =
    cacheDenominator > 0
      ? measured.reduce((acc, turn) => acc + (turn.tokens.cacheRead ?? 0), 0) / cacheDenominator
      : null;
  return {
    id: entry.id,
    pass: entry.pass === true,
    // 턴을 안 만드는 종류(compare · suggest)는 entry.ms 가 총 시간을 잡는다(2026-11-03 · A안 0-2).
    ms:
      typeof entry.ms === "number"
        ? entry.ms
        : turns.reduce((acc, turn) => acc + (turn.durationMs ?? 0), 0),
    costUsd,
    outputTokens,
    cacheHitRate,
    firstEditMs: turns[0]?.firstEditMs ?? null,
    contextTokens: turns.every(
      (turn) => turn.contextTokens === null || turn.contextTokens === undefined,
    )
      ? null
      : Math.max(...turns.map((turn) => turn.contextTokens ?? 0)),
    browser: sum("browser"),
    browserMs,
    exec: sum("exec"),
    reopened: entry.gate?.reopened === true,
  };
}

/** 중앙값 — 짝수면 가운데 둘의 평균. 빈 목록은 null. */
export function median(values) {
  const nums = values
    .filter((v) => typeof v === "number" && !Number.isNaN(v))
    .sort((a, b) => a - b);
  if (nums.length === 0) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 1 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/**
 * 두 결과 파일(a = 기준, b = 비교)의 같은 id 끼리 칸을 맞춘다 — `--repeat` 으로
 * 같은 id 가 여러 행 있을 수 있으니 각 쪽의 중앙값으로 접는다. 한쪽에만 있는
 * id 도 행으로 남기고, 비는 칸은 null 로 둔다.
 */
export function compareResults(a, b) {
  const ids = new Set([...(a.scenarios ?? []), ...(b.scenarios ?? [])].map((s) => s.id));
  const rows = [];
  for (const id of ids) {
    const left = (a.scenarios ?? []).filter((s) => s.id === id).map(summaryOf);
    const right = (b.scenarios ?? []).filter((s) => s.id === id).map(summaryOf);
    const metric = (key) => ({
      a: left.length === 0 ? null : median(left.map((r) => r[key])),
      b: right.length === 0 ? null : median(right.map((r) => r[key])),
    });
    const ms = metric("ms");
    const costUsd = metric("costUsd");
    rows.push({
      id,
      passA: left.filter((r) => r.pass).length,
      passB: right.filter((r) => r.pass).length,
      countA: left.length,
      countB: right.length,
      ms,
      costUsd,
      outputTokens: metric("outputTokens"),
      cacheHitRate: metric("cacheHitRate"),
      costChange:
        costUsd.a === null || costUsd.b === null || costUsd.a === 0
          ? null
          : (costUsd.b - costUsd.a) / costUsd.a,
      firstEditMs: metric("firstEditMs"),
      contextTokens: metric("contextTokens"),
      browser: metric("browser"),
      browserMs: metric("browserMs"),
      exec: metric("exec"),
      // 변화율 — a 가 0 이거나 어느 쪽이 비면 null.
      msChange: ms.a === null || ms.b === null || ms.a === 0 ? null : (ms.b - ms.a) / ms.a,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 표 — 고정 폭 텍스트. 열의 값은 ms 를 초로 환산하고, 없으면 "-".
// ---------------------------------------------------------------------------

const padEnd = (text, width) => String(text).padEnd(width);
const padStart = (text, width) => String(text).padStart(width);
const seconds = (ms) => (typeof ms === "number" ? `${(ms / 1000).toFixed(1)}s` : "-");
const num = (value) => (value === null || value === undefined ? "-" : String(value));
const percent = (ratio) =>
  ratio === null ? "-" : `${ratio > 0 ? "+" : ""}${(ratio * 100).toFixed(0)}%`;
const usd = (value) => (typeof value === "number" ? `$${value.toFixed(3)}` : "-");
const share = (ratio) => (typeof ratio === "number" ? `${Math.round(ratio * 100)}%` : "-");

/** run 결과 표 — 시나리오 한 줄. */
export function renderSummaryTable(entries) {
  const rows = entries.map(summaryOf);
  const head = [
    padEnd("시나리오", 16),
    padStart("통과", 5),
    padStart("총 시간", 9),
    padStart("첫 편집", 9),
    padStart("컨텍스트", 10),
    padStart("browser", 8),
    padStart("browserMs", 10),
    padStart("exec", 6),
    padStart("게이트 재개", 11),
    padStart("비용", 8),
    padStart("캐시", 5),
  ].join(" ");
  const line = (row) =>
    [
      padEnd(row.id.slice(0, 16), 16),
      padStart(row.pass ? "통과" : "실패", 5),
      padStart(seconds(row.ms), 9),
      padStart(seconds(row.firstEditMs), 9),
      padStart(num(row.contextTokens), 10),
      padStart(String(row.browser), 8),
      padStart(seconds(row.browserMs), 10),
      padStart(String(row.exec), 6),
      padStart(row.reopened ? "있음" : "-", 11),
      padStart(usd(row.costUsd), 8),
      padStart(share(row.cacheHitRate), 5),
    ].join(" ");
  return [head, head.replace(/[^ ]/g, "-"), ...rows.map(line)].join("\n");
}

/** compare 결과 표 — 같은 id 끼리 중앙값과 총 시간 변화율. */
export function renderCompareTable(rows, nameA = "a", nameB = "b") {
  const pair = (m) => `${seconds(m.a)} → ${seconds(m.b)}`;
  const head = [
    padEnd("시나리오", 16),
    padStart(`통과 ${nameA}→${nameB}`, 12),
    padStart("총 시간", 20),
    padStart("Δ", 7),
    padStart("첫 편집", 20),
    padStart("컨텍스트", 16),
    padStart("exec", 12),
    padStart("비용", 18),
    padStart("Δ", 7),
    padStart("캐시", 12),
  ].join(" ");
  const line = (row) =>
    [
      padEnd(row.id.slice(0, 16), 16),
      padStart(`${row.passA}/${row.countA} → ${row.passB}/${row.countB}`, 12),
      padStart(pair(row.ms), 20),
      padStart(percent(row.msChange), 7),
      padStart(pair(row.firstEditMs), 20),
      padStart(`${num(row.contextTokens.a)} → ${num(row.contextTokens.b)}`, 16),
      padStart(`${num(row.exec.a)} → ${num(row.exec.b)}`, 12),
      padStart(`${usd(row.costUsd.a)} → ${usd(row.costUsd.b)}`, 18),
      padStart(percent(row.costChange), 7),
      padStart(`${share(row.cacheHitRate.a)} → ${share(row.cacheHitRate.b)}`, 12),
    ].join(" ");
  return [head, head.replace(/[^ ]/g, "-"), ...rows.map(line)].join("\n");
}
