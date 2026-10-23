import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

// Exercise the actual index.ts state machine with terminal/API boundaries stubbed.
// No Pi installation, real terminal, or native clipboard is needed by this suite.
const source = await readFile(new URL("../index.ts", import.meta.url), "utf8");
const stubs = `
const Type = new Proxy({}, { get: () => () => ({}) }); const defineTool = x => x;
const validName = name => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
let secureExec = async () => ({});
export const setSecureExec = fn => { secureExec = fn; };
const Key = { escape: 'esc', enter: 'enter', ctrl: x => 'ctrl+' + x };
const matchesKey = (data, key) => data === key;
const truncateToWidth = (s, w) => s.slice(0, Math.max(0, w));
const wrapTextWithAnsi = (s, w) => s.match(new RegExp('.{1,' + Math.max(1, w) + '}', 'g')) || [''];
const copyToClipboard = async () => ({ copied: true });
`;
const code = stubs + stripTypeScriptTypes(source).replace(/^import .*;\n/gm, "");
const { createSecretDialog, default: registerExtension, setSecureExec } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const secret = "sensitive-value";
function setup(extra = {}) {
  let result, count = 0;
  const component = createSecretDialog({
    name: "TOKEN", value: secret, tui: { requestRender() {} },
    theme: { fg: (_c, s) => s }, done: value => { result = value; count++; }, ...extra,
  });
  return { component, key: data => component.handleInput(data), render: (width = 120) => component.render(width).join("\n"),
    result: () => result, count: () => count };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test("starts masked; copy-only requires explicit confirmation and returns no value", async () => {
  let calls = 0;
  const ui = setup({ copy: async value => { calls++; assert.equal(value, secret); return { copied: true }; } });
  assert.equal(ui.render().includes(secret), false);
  ui.key("c");
  assert.match(ui.render(), /Copy\?/);
  ui.key("enter");
  assert.equal(calls, 0);
  ui.key("y");
  await flush();
  assert.equal(calls, 1);
  assert.equal(ui.render().includes(secret), false);
  assert.match(ui.render(), /Copied/);
  ui.key("esc");
  assert.deepEqual(ui.result(), { shown: false, copied: true });
});

test("reveal, hide, re-confirm reveal, copy while visible, and deny copy", async () => {
  let calls = 0;
  const ui = setup({ copy: async () => { calls++; return { copied: true }; } });
  ui.key("R");
  assert.equal(ui.render().includes(secret), false);
  ui.key("n");
  ui.key("r"); ui.key("Y");
  assert.equal(ui.render().includes(secret), true);
  ui.key("r");
  assert.equal(ui.render().includes(secret), false);
  ui.key("r");
  assert.match(ui.render(), /Reveal\?/);
  ui.key("y"); ui.render();
  ui.key("c"); ui.key("esc");
  assert.equal(calls, 0);
  ui.key("C"); ui.key("y"); await flush();
  assert.equal(ui.render().includes(secret), true);
  ui.key("enter");
  assert.deepEqual(ui.result(), { shown: true, copied: true });
});

test("copy failure and thrown exceptions are generic, retry possible", async () => {
  const ui = setup({ copy: async () => { throw new Error(secret); } });
  ui.key("c"); ui.key("y"); await flush();
  assert.match(ui.render(), /Copy failed/);
  assert.equal(ui.render().includes(secret), false);
  ui.key("c"); assert.match(ui.render(), /Copy\?/);
  ui.key("ctrl+c");
  assert.deepEqual(ui.result(), { shown: false, copied: false });
});

test("abort/dispose clears visible secret, cancels copy and ignores late success", async () => {
  for (const disposal of [false, true]) {
    const controller = new AbortController();
    let resolve, copySignal;
    const ui = setup({ signal: controller.signal, copy: (_v, { signal }) => { copySignal = signal; return new Promise(r => { resolve = r; }); } });
    ui.key("r"); ui.key("y"); ui.render();
    ui.key("c"); ui.key("y");
    if (disposal) ui.component.dispose(); else controller.abort();
    assert.equal(copySignal.aborted, true);
    assert.equal(ui.render(), "");
    resolve({ copied: true }); await flush();
    ui.key("y"); ui.component.dispose();
    assert.equal(ui.count(), 1);
    assert.deepEqual(ui.result(), { shown: true, copied: false });
  }
});

test("absolute timeout closes even at confirmation and while copy pending", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const ui = setup();
  ui.key("r");
  t.mock.timers.tick(30_000);
  assert.deepEqual(ui.result(), { shown: false, copied: false });
  assert.equal(ui.render(), "");
});

test("control bytes are escaped and large values bounded; narrow render is safe", () => {
  const ui = setup({ value: "\u001b]52;c;BAD\u0007\n" + "X".repeat(2000) });
  ui.key("r"); ui.key("y");
  const text = ui.render(40);
  assert.equal(text.includes("\u001b"), false);
  assert.match(text, /\\x1b/);
  assert.ok(text.split("\n").every(line => line.length <= 40));
  assert.doesNotThrow(() => ui.render(0));
  ui.component.dispose();
});

function extensionFixture() {
  const tools = new Map(), events = new Map(), commands = new Map();
  registerExtension({
    registerTool: tool => tools.set(tool.name, tool),
    on: (name, fn) => events.set(name, fn),
    registerCommand: (name, command) => commands.set(name, command),
  });
  const ctx = { mode: "tui", cwd: "/tmp", ui: { notify() {}, custom: async () => secret } };
  const run = (name, params, signal) => tools.get(name).execute("id", params, signal, undefined, ctx);
  return { run, ctx, events, commands };
}

test("show tool serializes only status, never secret or private display content", async () => {
  const f = extensionFixture();
  const requested = await f.run("request_secret", { name: "TOKEN", reason: "test" });
  assert.equal(JSON.stringify(requested).includes(secret), false);
  f.ctx.ui.custom = async factory => {
    let result;
    const component = factory({ requestRender() {} }, { fg: (_c, s) => s }, {}, r => { result = r; });
    component.handleInput("c"); component.handleInput("y"); await flush();
    component.handleInput("esc"); component.dispose();
    return result;
  };
  const result = await f.run("show_secret", { name: "TOKEN" });
  assert.deepEqual(JSON.parse(result.content[0].text), { name: "TOKEN", shown: false, copied: true });
  assert.equal(result.details, undefined);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("forget/start/shutdown abort pending request and queued dialogs; cannot repopulate vault", async () => {
  for (const boundary of ["clear", "session_start", "session_shutdown"]) {
    const f = extensionFixture();
    let resolveInput, dialogs = 0;
    f.ctx.ui.custom = async () => { dialogs++; return new Promise(resolve => { resolveInput = resolve; }); };
    const pending = f.run("request_secret", { name: "TOKEN", reason: "test" });
    const queued = f.run("request_secret", { name: "OTHER", reason: "test" });
    await flush();
    if (boundary === "clear") await f.commands.get("secret").handler("clear", f.ctx);
    else f.events.get(boundary)();
    // Even a hostile/late UI completion cannot commit a value after invalidation.
    resolveInput(secret);
    assert.equal(JSON.parse((await pending).content[0].text).available, false);
    assert.equal(JSON.parse((await queued).content[0].text).available, false);
    assert.equal(dialogs, 1);
    const absent = await f.run("show_secret", { name: "TOKEN" });
    assert.deepEqual(JSON.parse(absent.content[0].text), { name: "TOKEN", shown: false, copied: false });
  }
});

test("vault lifecycle signal reaches capture/exec and new lifetime remains usable", async () => {
  const signals = [], guards = [];
  setSecureExec(async ({ signal, isCurrent }) => {
    signals.push(signal);
    guards.push(isCurrent);
    assert.equal(isCurrent(), true);
    return new Promise(resolve => signal.addEventListener("abort", () => resolve({ error: "Command cancelled." }), { once: true }));
  });
  const f = extensionFixture();
  const capture = f.run("capture_secret", { name: "TOKEN", command: "test" });
  const execution = f.run("secure_exec", { secrets: ["TOKEN"], command: "test" });
  await f.commands.get("secret").handler("clear", f.ctx);
  await Promise.all([capture, execution]);
  assert.ok(signals.every(signal => signal.aborted));
  assert.ok(guards.every(isCurrent => isCurrent() === false));
  const caller = new AbortController();
  const next = f.run("capture_secret", { name: "NEXT", command: "test" }, caller.signal);
  assert.equal(signals[2].aborted, false);
  caller.abort(); await next;
  assert.equal(signals[2].aborted, true);
  setSecureExec(async () => ({}));
});
