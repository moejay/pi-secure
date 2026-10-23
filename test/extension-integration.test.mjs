import { test } from "node:test";
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
  return (name, args, ctx) => loaded.extensions[0].tools.get(name).definition.execute("integration", args, undefined, undefined, ctx);
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
    const component = factory({ requestRender() {} }, { fg: (_color, text) => text }, {}, resolve);
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
