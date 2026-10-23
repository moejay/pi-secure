import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { copyToClipboard } from "../clipboard.mjs";

const secret = "private\nvalue\u001b]52;c;never";
function mockSpawn(action) {
  const calls = [];
  const spawnImpl = (command, args, options) => {
    const child = new EventEmitter();
    let input = "";
    child.stdin = new Writable({ write(chunk, _encoding, cb) { input += chunk; cb(); } });
    child.kill = (signal) => { child.killed = signal; return true; };
    calls.push({ command, args, options, child, input: () => input });
    queueMicrotask(() => action(child, calls.length));
    return child;
  };
  return { spawnImpl, calls };
}

test("mac copies exact bytes only on stdin; no shell, output, or credential environment", async () => {
  const mock = mockSpawn(child => child.emit("exit", 0, null));
  assert.deepEqual(await copyToClipboard(secret, { ...mock, platform: "darwin", env: { PATH: "/bin", TOKEN: secret } }), { copied: true });
  const call = mock.calls[0];
  assert.equal(call.command, "/usr/bin/pbcopy");
  assert.deepEqual(call.args, []);
  assert.equal(call.input(), secret);
  assert.equal(JSON.stringify(call.options).includes(secret), false);
  assert.equal(call.options.env.TOKEN, undefined);
  assert.equal(call.options.shell, false);
  assert.deepEqual(call.options.stdio, ["pipe", "ignore", "ignore"]);
});

test("Linux prefers Wayland, falls back to X11 only for missing helpers", async () => {
  const mock = mockSpawn((child, n) => n < 3 ? child.emit("error", { code: "ENOENT", message: secret }) : child.emit("exit", 0));
  assert.deepEqual(await copyToClipboard(secret, { ...mock, platform: "linux", env: { WAYLAND_DISPLAY: "wayland-0", DISPLAY: ":0" } }), { copied: true });
  assert.deepEqual(mock.calls.map(c => c.command), ["wl-copy", "xclip", "xsel"]);
  assert.deepEqual(mock.calls[1].args, ["-selection", "clipboard", "-in"]);
});

test("unsupported/headless platforms fail closed without spawning or OSC52", async () => {
  for (const platform of ["win32", "linux"]) {
    const mock = mockSpawn(() => assert.fail("must not spawn"));
    const result = await copyToClipboard(secret, { ...mock, platform, env: {} });
    assert.equal(result.copied, false);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test("nonzero exit, signal death, spawn throw, stdin error produce generic errors", async () => {
  for (const action of [c => c.emit("exit", 1), c => c.emit("exit", null, "SIGTERM"), c => c.stdin.emit("error", new Error(secret)), c => c.emit("error", new Error(secret))]) {
    const mock = mockSpawn(action);
    const result = await copyToClipboard(secret, { ...mock, platform: "linux", env: { WAYLAND_DISPLAY: "w", DISPLAY: ":0" } });
    assert.equal(result.copied, false);
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(mock.calls.length, 1);
  }
  assert.equal((await copyToClipboard(secret, { platform: "darwin", spawnImpl() { throw new Error(secret); } })).copied, false);
});

test("timeout is bounded even when killed helper never exits", async () => {
  const mock = mockSpawn(() => {});
  const result = await copyToClipboard(secret, { ...mock, platform: "darwin", timeout: 10 });
  assert.deepEqual(result, { copied: false, error: "Copy timed out." });
  assert.equal(mock.calls[0].child.killed, "SIGKILL");
});

test("abort before spawn and during write is bounded and ignores late completion", async () => {
  const controller = new AbortController();
  controller.abort();
  const mock = mockSpawn(() => {});
  assert.equal((await copyToClipboard(secret, { ...mock, signal: controller.signal })).copied, false);
  assert.equal(mock.calls.length, 0);
  const active = new AbortController();
  const running = copyToClipboard(secret, { ...mock, platform: "darwin", signal: active.signal });
  active.abort();
  assert.deepEqual(await running, { copied: false, error: "Copy cancelled." });
  assert.equal(mock.calls[0].child.killed, "SIGKILL");
  mock.calls[0].child.emit("error", new Error(secret));
  mock.calls[0].child.emit("exit", 0);
});
