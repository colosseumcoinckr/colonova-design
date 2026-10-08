import assert from "node:assert/strict";
import { test } from "node:test";
import { canFallBackToEphemeral, startDaemonServer } from "../src/daemon-start.ts";

/**
 * 데몬의 첫 시작 (2026-10-07, 베타 준비 분석): 저장 포트가 점유(EADDRINUSE)이거나 Windows 의 예약
 * 포트 대역에 들어가 접근 거부(EACCES)이면 임시 포트로 물러난다. 후자를 모르던 옛 판은 어제 잘 뜬
 * 저장 포트가 오늘 예약 대역에 들어가면 시작 실패 상자를 영구히 반복했다. electron 없이 가짜 서버로 돈다.
 */

function fail(code: string | undefined): Error {
  const error = new Error(`listen ${code ?? "?"}`) as NodeJS.ErrnoException;
  if (code !== undefined) error.code = code;
  return error;
}

/** 포트마다 정해 둔 실패를 내는 가짜 서버 공장 — 만든 포트의 차례를 `made` 에 남긴다. */
function factory(failures: Record<number, Error>) {
  const made: number[] = [];
  const started: number[] = [];
  const make = (port: number) => {
    made.push(port);
    return {
      port,
      async start() {
        const error = failures[port];
        if (error) throw error;
        started.push(port);
      },
    };
  };
  return { make, made, started };
}

test("저장 포트가 열려 있으면 그 포트로 한 번에 뜬다", async () => {
  const f = factory({});
  const server = await startDaemonServer(f.make, 41000);
  assert.equal(server.port, 41000);
  assert.deepEqual(f.made, [41000]);
});

test("저장 포트가 없으면(첫 실행) 임시 포트로 뜬다", async () => {
  const f = factory({});
  const server = await startDaemonServer(f.make, null);
  assert.equal(server.port, 0);
  assert.deepEqual(f.made, [0]);
});

test("저장 포트가 점유(EADDRINUSE)면 임시 포트로 물러난다", async () => {
  const f = factory({ 41000: fail("EADDRINUSE") });
  const server = await startDaemonServer(f.make, 41000);
  assert.equal(server.port, 0);
  assert.deepEqual(f.made, [41000, 0]);
  assert.deepEqual(f.started, [0]);
});

test("저장 포트가 예약 대역이라 접근 거부(EACCES)여도 임시 포트로 물러난다 — 오류 상자가 반복되지 않는다", async () => {
  const f = factory({ 51234: fail("EACCES") });
  const server = await startDaemonServer(f.make, 51234);
  assert.equal(server.port, 0);
  assert.deepEqual(f.made, [51234, 0]);
});

test("저장 포트가 없는데 실패하면 물러날 곳이 없다 — 그대로 던진다", async () => {
  for (const code of ["EACCES", "EADDRINUSE"]) {
    const f = factory({ 0: fail(code) });
    await assert.rejects(startDaemonServer(f.make, null), { code });
    assert.deepEqual(f.made, [0]);
  }
});

test("그 밖의 실패는 물러나지 않고 던진다 — 서버를 다시 만들지도 않는다", async () => {
  for (const code of ["EADDRNOTAVAIL", "EMFILE", "ENOENT", undefined]) {
    const f = factory({ 41000: fail(code) });
    await assert.rejects(startDaemonServer(f.make, 41000), /listen/);
    assert.deepEqual(f.made, [41000]);
  }
});

test("물러난 임시 포트도 실패하면 그 오류를 던진다", async () => {
  const f = factory({ 41000: fail("EACCES"), 0: fail("EMFILE") });
  await assert.rejects(startDaemonServer(f.make, 41000), { code: "EMFILE" });
  assert.deepEqual(f.made, [41000, 0]);
});

test("물러남의 판정은 오류의 코드와 저장 포트 유무만 본다", () => {
  assert.equal(canFallBackToEphemeral(fail("EACCES"), 41000), true);
  assert.equal(canFallBackToEphemeral(fail("EADDRINUSE"), 41000), true);
  assert.equal(canFallBackToEphemeral(fail("EACCES"), null), false);
  assert.equal(canFallBackToEphemeral(fail("EPERM"), 41000), false);
  assert.equal(canFallBackToEphemeral(null, 41000), false);
  assert.equal(canFallBackToEphemeral(undefined, 41000), false);
  assert.equal(canFallBackToEphemeral("EACCES", 41000), false);
});
