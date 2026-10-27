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
const Key = { up: 'up', down: 'down', delete: 'delete', escape: 'esc', enter: 'enter', ctrl: x => 'ctrl+' + x };
const matchesKey = (data, key) => data === key;
const visibleWidth = s => s.length;
const truncateToWidth = (s, w) => s.slice(0, Math.max(0, w));
class Input {
  value = '';
  getValue() { return this.value; }
  handleInput(data) {
    if (data === 'enter') this.onSubmit?.(this.value);
    else if (data === 'esc') this.onEscape?.();
    else if (data === 'backspace') this.value = Array.from(this.value).slice(0, -1).join('');
    else this.value += data;
  }
}
const wrapTextWithAnsi = (s, w) => s.match(new RegExp('.{1,' + Math.max(1, w) + '}', 'g')) || [''];
const copyToClipboard = async () => ({ copied: true });
`;
const code = stubs + stripTypeScriptTypes(source).replace(/^import .*;\n/gm, "");
const { createSecretBrowser, createSecretDialog, default: registerExtension, setSecureExec } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const secret = "sensitive-value";
const theme = { style: text => text };
function setup(extra = {}) {
  let result, count = 0;
  const component = createSecretDialog({
    name: "TOKEN", value: secret, tui: { requestRender() {} },
    theme, done: value => { result = value; count++; }, ...extra,
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

test("both dialogs use centered overlays, strong themed frames, and wrapped narrow content", async () => {
  const f = extensionFixture();
  const styles = [];
  const styledTheme = { style(text, options) { styles.push(options); return text; } };
  const reason = "Explain why this credential is needed and exactly where it will be used. ".repeat(3);
  const name = "LONG_SECRET_NAME_FOR_WRAPPING";
  let dialogs = 0;
  f.ctx.ui.custom = async (factory, options) => {
    assert.equal(options.overlay, true);
    assert.equal(options.overlayOptions.anchor, "center");
    assert.equal(options.overlayOptions.width, 78);
    let result;
    const component = factory({ requestRender() {} }, styledTheme, {}, value => { result = value; });
    try {
      for (const width of [0, 1, 2, 3, 5, 12, 24, 78]) {
        const lines = component.render(width);
        assert.ok(lines.every(line => line.length <= width), `overflow at ${width}`);
        assert.equal(lines.join("\n").includes(secret), false);
        if (width >= 3) {
          assert.match(lines[0], /^┏━+┓$/);
          assert.match(lines.at(-1), /^┗━+┛$/);
        }
      }
      if (dialogs++ === 0) {
        // Metadata and warnings wrap, rather than silently disappearing offscreen.
        const text = component.render(24).map(line => line.slice(1, -1).trim()).join("");
        assert.ok(text.includes("SECRET REQUEST"));
        assert.ok(text.includes("not a sandbox."));
        assert.ok(text.includes("be used."));
        component.handleInput("a");
        assert.match(component.render(78).join("\n"), /Value: \* /);
        component.handleInput("😀");
        assert.match(component.render(78).join("\n"), /Value: \*{2} /);
        component.handleInput("backspace");
        assert.match(component.render(78).join("\n"), /Value: \* /);
        component.handleInput("backspace");
        assert.match(component.render(78).join("\n"), /type or paste here/);
        component.handleInput(secret);
        assert.equal(component.render(78).join("\n").includes(secret), false);
        assert.ok(component.render(78).join("\n").includes(`Value: ${"*".repeat(Array.from(secret).length)} `));
        component.handleInput("enter");
      } else {
        component.handleInput("r");
        const confirmation = component.render(24).map(line => line.slice(1, -1).trim()).join("");
        assert.ok(confirmation.replace(/\s/g, "").includes("retainthevalue."));
        assert.ok(confirmation.includes("N/Esc: back"));
        component.handleInput("n");
        component.handleInput("esc");
      }
      assert.deepEqual(component.render(78), []);
      return result;
    } finally { component.dispose(); }
  };
  await f.run("request_secret", { name, reason });
  const result = await f.run("show_secret", { name });
  assert.equal(dialogs, 2);
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.ok(styles.some(style => style.bg === "customMessageBg" && style.fg === "text"));
  assert.ok(styles.some(style => style.bg === "selectedBg" && style.bold === true));
  assert.ok(styles.some(style => style.fg === "accent" && style.bold === true));
});

test("show tool serializes only status, never secret or private display content", async () => {
  const f = extensionFixture();
  const requested = await f.run("request_secret", { name: "TOKEN", reason: "test" });
  assert.equal(JSON.stringify(requested).includes(secret), false);
  f.ctx.ui.custom = async factory => {
    let result;
    const component = factory({ requestRender() {} }, theme, {}, r => { result = r; });
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

test("browser scrolls selection in a bounded viewport, resizes safely and confirms deletion", () => {
  const controller = new AbortController();
  let result, completions = 0;
  const tui = { terminal: { rows: 18 }, requestRender() {} };
  const names = Array.from({ length: 100 }, (_, i) => `TOKEN_${String(i).padStart(3, "0")}`);
  const browser = createSecretBrowser({ names, tui, theme, signal: controller.signal,
    done: action => { result = action; completions++; } });
  for (let i = 0; i < 75; i++) browser.handleInput(i % 2 ? "j" : "down");
  let lines = browser.render(50);
  assert.ok(lines.length <= 16);
  assert.match(lines.join("\n"), /› TOKEN_075/);
  assert.equal(lines.join("\n").includes("TOKEN_000"), false);
  browser.handleInput("up"); browser.handleInput("k");
  for (const width of [0, 1, 2, 3, 12, 50]) {
    lines = browser.render(width);
    assert.ok(lines.every(line => line.length <= width));
    assert.ok(lines.length <= 16);
  }
  tui.terminal.rows = 10;
  assert.ok(browser.render(50).length <= 8);
  assert.match(browser.render(50).join("\n"), /TOKEN_073/);
  browser.handleInput("delete"); browser.handleInput("esc");
  assert.equal(result, undefined);
  browser.handleInput("d"); browser.handleInput("y");
  assert.deepEqual(result, { name: "TOKEN_073", action: "clear" });
  controller.abort(); browser.dispose();
  assert.equal(completions, 1);
  assert.deepEqual(browser.render(50), []);
});

test("browser empty state, navigation clamps, show and abort/dispose are safe", () => {
  for (const end of ["esc", "abort", "dispose"]) {
    const controller = new AbortController();
    let count = 0;
    const browser = createSecretBrowser({ names: [], tui: { requestRender() {} }, theme,
      signal: controller.signal, done: action => { assert.equal(action, undefined); count++; } });
    assert.match(browser.render(78).join("\n"), /No secrets stored/);
    for (const key of ["j", "k", "enter", "r", "d", "delete", "y"]) browser.handleInput(key);
    assert.equal(count, 0);
    if (end === "abort") controller.abort();
    else if (end === "dispose") browser.dispose();
    else browser.handleInput(end);
    browser.dispose(); assert.equal(count, 1);
  }
  for (const key of ["r", "enter"]) {
    let action;
    const browser = createSecretBrowser({ names: ["FIRST", "SECOND"], selected: "SECOND",
      tui: { requestRender() {} }, theme, signal: new AbortController().signal, done: a => { action = a; } });
    browser.handleInput("j"); browser.handleInput(key);
    assert.deepEqual(action, { name: "SECOND", action: "show" });
  }
});

const command = (f, args) => f.commands.get("secret").handler(args, f.ctx);
function interactive(f, steps) {
  let active = false, dialogs = 0;
  f.ctx.ui.custom = async (factory, options) => {
    assert.equal(active, false, "custom UIs must never be nested");
    active = true;
    assert.equal(options.overlayOptions.anchor, "center");
    let result;
    const component = factory({ terminal: { rows: 24 }, requestRender() {} }, theme, {}, r => { result = r; });
    try { await steps[dialogs++](component); } finally { component.dispose(); active = false; }
    return result;
  };
  return () => dialogs;
}

test("commands open private dialog directly, reject non-tui and malformed/missing names", async () => {
  const f = extensionFixture(), notices = [];
  f.ctx.ui.notify = text => notices.push(text);
  await f.run("request_secret", { name: "TOKEN", reason: "test" });
  const dialogs = interactive(f, [async component => {
    assert.equal(component.render(78).join("\n").includes(secret), false);
    component.handleInput("r"); component.handleInput("y");
    assert.ok(component.render(78).join("\n").includes(secret));
    component.handleInput("esc");
  }]);
  assert.equal(await command(f, "show TOKEN"), undefined);
  assert.equal(dialogs(), 1);
  await command(f, "show MISSING"); assert.match(notices.at(-1), /No secret named MISSING/);
  for (const args of ["show", "show BAD=NAME", "show TOKEN extra"]) {
    await command(f, args); assert.match(notices.at(-1), /Use \/secret/);
  }
  f.ctx.mode = "rpc";
  await command(f, "show TOKEN"); assert.match(notices.at(-1), /terminal dialog/);
  await command(f, "list"); assert.equal(notices.at(-1), "TOKEN");
  assert.equal(dialogs(), 1);
  assert.equal(JSON.stringify(notices).includes(secret), false);
});

test("browser show/copy returns to browser, clear cancels old queued tools but resumes fresh", async () => {
  const f = extensionFixture(), notices = [];
  f.ctx.ui.notify = text => notices.push(text);
  for (const name of ["FIRST", "SECOND"]) await f.run("request_secret", { name, reason: "test" });
  let queued, pending, captureSignal;
  setSecureExec(async ({ signal }) => {
    captureSignal = signal;
    return new Promise(resolve => signal.addEventListener("abort", () => resolve({ error: "cancelled" }), { once: true }));
  });
  const dialogs = interactive(f, [
    async c => {
      queued = f.run("request_secret", { name: "STALE", reason: "test" });
      pending = f.run("capture_secret", { name: "PENDING", command: "test" });
      c.handleInput("j"); c.handleInput("enter");
    },
    async c => {
      assert.match(c.render(78).join("\n"), /SECOND/);
      c.handleInput("c"); c.handleInput("y"); await flush();
      assert.equal(c.render(78).join("\n").includes(secret), false);
      c.handleInput("esc");
    },
    async c => {
      assert.match(c.render(78).join("\n"), /› SECOND/);
      c.handleInput("d"); c.handleInput("n");
      c.handleInput("delete"); c.handleInput("y");
    },
    async c => {
      const text = c.render(78).join("\n");
      assert.ok(text.includes("FIRST")); assert.equal(text.includes("SECOND"), false);
      assert.equal(captureSignal.aborted, true);
      c.handleInput("esc");
    },
  ]);
  try {
    await command(f, "list");
    assert.equal(dialogs(), 4);
    assert.equal(JSON.parse((await queued).content[0].text).available, false);
    assert.equal(JSON.parse((await pending).content[0].text).available, false);
    f.ctx.mode = "rpc"; await command(f, "list");
    assert.deepEqual(notices, ["FIRST"]);
    assert.equal(JSON.stringify(notices).includes(secret), false);
  } finally { setSecureExec(async () => ({})); }
});

test("external clear/start/shutdown cancels browser or reveal without reopening or stale tools", async () => {
  for (const boundary of ["clear TOKEN", "session_start", "session_shutdown"]) {
    for (const showing of [false, true]) {
      const f = extensionFixture();
      await f.run("request_secret", { name: "TOKEN", reason: "test" });
      let opened = 0, queued;
      f.ctx.ui.custom = async factory => new Promise(resolve => {
        opened++;
        const c = factory({ requestRender() {} }, theme, {}, resolve);
        if (showing && opened === 1) { c.handleInput("r"); return; }
        queued = f.run("request_secret", { name: "STALE", reason: "test" });
        queueMicrotask(() => {
          if (boundary.startsWith("clear")) void command(f, boundary);
          else f.events.get(boundary)();
        });
      });
      await command(f, "list");
      assert.equal(opened, showing ? 2 : 1);
      assert.equal(JSON.parse((await queued).content[0].text).available, false);
    }
  }
});

test("long-name delete keeps a dedicated confirmation visible in narrow/short viewports", () => {
  const tui = { terminal: { rows: 24 }, requestRender() {} };
  let result;
  const c = createSecretBrowser({ names: ["VERY_LONG_".repeat(20)], tui, theme,
    signal: new AbortController().signal, done: value => { result = value; } });
  c.handleInput("d");
  for (const rows of [3, 4, 5, 6, 8, 9, 10, 24]) {
    tui.terminal.rows = rows;
    for (const width of [8, 12, 24, 78]) {
      const lines = c.render(width);
      assert.ok(lines.length <= rows - 2);
      assert.ok(lines.every(line => line.length <= width));
      assert.match(lines.join("\n"), /Y\/N/, `confirmation missing at ${width}x${rows}`);
    }
  }
  c.handleInput("esc");
  assert.equal(result, undefined);
  tui.terminal.rows = 6;
  assert.match(c.render(24).join("\n"), /Enter\/R/);
  assert.match(c.render(24).join("\n"), /Esc/);
  c.dispose();
});
