import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadExtensions } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/loader.js";

const root = new URL("../", import.meta.url);
const sentinel = "disposable-integration-value";
const context = () => ({ cwd: process.cwd(), mode: "tui", ui: {} });
async function load(path) {
  const loaded = await loadExtensions([path], process.cwd());
  assert.deepEqual(loaded.errors, []);
  const extension = loaded.extensions[0];
  const run = (name, args, ctx) => extension.tools.get(name).definition.execute("integration", args, undefined, undefined, ctx);
  run.command = (args, ctx) => extension.commands.get("secret").handler(args, ctx);
  return run;
}
const data = result => JSON.parse(result.content[0].text);

test("real Pi loader: capture stores privately and show reveals only through local UI", async () => {
  const run = await load(fileURLToPath(new URL("index.ts", root)));
  const ctx = context();
  const captured = await run("capture_secret", { name: "INTEGRATION_TOKEN", command: `printf '${sentinel}'` }, ctx);
  assert.deepEqual(data(captured), { name: "INTEGRATION_TOKEN", available: true });
  assert.equal(JSON.stringify(captured).includes(sentinel), false);
  let localReveal = false;
  ctx.ui.custom = async factory => new Promise(resolve => {
    const component = factory({ requestRender() {} }, { fg: (_color, text) => text, style: text => text }, {}, resolve);
    assert.equal(component.render(120).join("\n").includes(sentinel), false);
    component.handleInput("r");
    component.handleInput("y");
    localReveal = component.render(120).join("\n").includes(sentinel);
    component.handleInput("\r");
    component.dispose();
  });
  const shown = await run("show_secret", { name: "INTEGRATION_TOKEN" }, ctx);
  assert.equal(localReveal, true);
  assert.deepEqual(data(shown), { name: "INTEGRATION_TOKEN", shown: true, copied: false });
  assert.equal(JSON.stringify(shown).includes(sentinel), false);
});

test("single-secret clear preserves other secrets and rejects malformed arguments", async () => {
  const run = await load(fileURLToPath(new URL("index.ts", root)));
  const ctx = context();
  const notices = [];
  ctx.ui.notify = (message) => notices.push(message);
  for (const name of ["FIRST", "SECOND"]) {
    await run("capture_secret", { name, command: `printf '${sentinel}'` }, ctx);
  }
  for (const args of ["clear BAD=NAME", "clear FIRST extra"]) {
    await run.command(args, ctx);
    assert.match(notices.at(-1), /Use \/secret/);
  }
  await run.command(" clear FIRST ", ctx);
  assert.equal(notices.at(-1), "Secret FIRST forgotten.");
  await run.command("list", { ...ctx, mode: "rpc" });
  assert.equal(notices.at(-1), "SECOND");
  const missing = await run("secure_exec", { command: "true", secrets: ["FIRST"] }, ctx);
  assert.match(data(missing).error, /unavailable/);
  const kept = await run("secure_exec", { command: 'printf "%s" "$SECOND"', secrets: ["SECOND"] }, ctx);
  assert.equal(data(kept).stdout, "[REDACTED]");
  await run.command("clear FIRST", ctx);
  assert.equal(notices.at(-1), "No secret named FIRST stored.");
  await run.command("clear", ctx);
  await run.command("list", { ...ctx, mode: "rpc" });
  assert.equal(notices.at(-1), "No secrets stored.");
  assert.equal(JSON.stringify(notices).includes(sentinel), false);
});

test("single-secret clear cancels pending captures so they cannot restore the name", async () => {
  const run = await load(fileURLToPath(new URL("index.ts", root)));
  const ctx = context();
  ctx.ui.notify = () => {};
  const pending = run("capture_secret", { name: "PENDING", command: `sleep 1; printf '${sentinel}'` }, ctx);
  await run.command("clear PENDING", ctx);
  assert.equal(data(await pending).available, false);
  const missing = await run("secure_exec", { command: "true", secrets: ["PENDING"] }, ctx);
  assert.match(data(missing).error, /unavailable/);
});

test("capture fails closed when a stale/incompatible helper returns execution output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-secure-stale-helper-"));
  try {
    await writeFile(join(dir, "index.ts"), await readFile(new URL("index.ts", root), "utf8"));
    await copyFile(new URL("clipboard.mjs", root), join(dir, "clipboard.mjs"));
    await writeFile(join(dir, "secure.mjs"), `
      export const validName = name => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
      export async function secureExec({command}) { if (command === 'throw') throw new Error('${sentinel}'); return command === 'failure' ? {error: '${sentinel}'} : {exitCode: 0, stdout: '${sentinel}', stderr: '${sentinel}'}; }
    `);
    const run = await load(join(dir, "index.ts"));
    for (const command of ["ordinary-execution", "failure", "throw"]) {
      const result = await run("capture_secret", { name: "STALE_TOKEN", command }, context());
      assert.equal(JSON.stringify(result).includes(sentinel), false, "capture must never forward helper output or diagnostics");
      assert.equal(result.isError, true);
      assert.equal(data(result).available, false);
      assert.equal("stdout" in data(result), false);
      assert.equal("stderr" in data(result), false);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("real Pi loader: direct show and browser keyboard navigation, narrow rendering and clear", async () => {
  const run = await load(fileURLToPath(new URL("index.ts", root)));
  const ctx = context(), notices = [];
  ctx.ui.notify = text => notices.push(text);
  for (const name of ["FIRST", "SECOND"]) {
    await run("capture_secret", { name, command: `printf '${sentinel}'` }, ctx);
  }
  const keys = [
    ["r", "y", "\r"], // /secret show FIRST
    ["\u001b[B", "\r"], // browser selects SECOND
    ["r", "y", "\r"], // existing reveal confirmation
    ["\u001b[3~", "y"], // delete SECOND from reopened browser
    ["\u001b"], // close fresh browser
  ];
  let dialogs = 0;
  ctx.ui.custom = async (factory, options) => new Promise(resolve => {
    assert.equal(options.overlay, true);
    const component = factory({ terminal: { rows: 18 }, requestRender() {} }, { style: text => text }, {}, resolve);
    for (const width of [0, 1, 2, 3, 12, 78]) {
      assert.ok(component.render(width).every(line => visibleWidth(line) <= width));
    }
    assert.equal(component.render(120).join("\n").includes(sentinel), false);
    for (const key of keys[dialogs++]) component.handleInput(key);
    component.dispose();
  });
  await run.command("show FIRST", ctx);
  await run.command("list", ctx);
  assert.equal(dialogs, 5);
  await run.command("list", { ...ctx, mode: "rpc" });
  assert.deepEqual(notices, ["FIRST"]);
  assert.equal(JSON.stringify(notices).includes(sentinel), false);
});
