import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redact, secureExec, validName } from "../secure.mjs";

const value = "private.token+$[abc]";
const vault = new Map([["TEST_SECRET", value]]);
const run = (command, extra = {}) => secureExec({ command, names: ["TEST_SECRET"], vault, cwd: process.cwd(), ...extra });

test("redaction failure explains vault limits and safe recovery without leaking output", async () => {
  const result = await run('printf sensitive-output', {
    vault: new Map([["LARGE_SECRET", "a".repeat(100_000)]]), names: [],
  });
  assert.match(result.error, /Could not process command output; output discarded/);
  assert.match(result.error, /all stored secrets are checked/);
  assert.match(result.error, /\/secret clear NAME/);
  assert.match(result.error, /command may already have completed/);
  assert.equal("stdout" in result, false);
  assert.equal("stderr" in result, false);
  assert.equal(JSON.stringify(result).includes("sensitive-output"), false);
});

test("capture stores stdout privately and discards stderr", async () => {
  const store = new Map(vault);
  const result = await run('printf "%s\\n" "$TEST_SECRET"; echo sensitive-error >&2', { vault: store, captureName: "CAPTURED" });
  assert.deepEqual(result, { name: "CAPTURED", available: true });
  assert.equal(store.get("CAPTURED"), value);
  const used = await run('printf "%s" "$CAPTURED"', { vault: store, names: ["CAPTURED"] });
  assert.equal(used.stdout, "[REDACTED]");
});
test("failed capture never returns unknown secret output", async () => {
  const store = new Map();
  const result = await run('echo unknown-value; echo unknown-error >&2; exit 2', { vault: store, names: [], captureName: "CAPTURED" });
  assert.deepEqual(result, { error: "Capture command failed; output discarded." });
  assert.equal(store.size, 0);
});
test("capture never overwrites an existing name", async () => {
  const result = await run('echo replacement', { captureName: "TEST_SECRET" });
  assert.match(result.error, /already exists/);
  assert.equal(vault.get("TEST_SECRET"), value);
});
test("capture supports preserving newlines", async () => {
  const store = new Map();
  await run('printf "line\\n"', { vault: store, names: [], captureName: "CAPTURED", trimNewline: false });
  assert.equal(store.get("CAPTURED"), "line\n");
});
test("capture rejects empty, NUL, overflow and invalid names", async () => {
  for (const command of ["true", "printf '\\000'"]) {
    const store = new Map();
    assert.ok((await run(command, { vault: store, names: [], captureName: "CAPTURED" })).error);
    assert.equal(store.size, 0);
  }
  assert.ok((await run('echo too-much', { captureName: "CAPTURED", maxBytes: 2 })).error);
  assert.ok((await run('echo value', { captureName: "BAD=NAME" })).error);
});

test("valid environment names only", () => {
  assert.equal(validName("MY_TOKEN"), true);
  for (const name of ["", "1X", "A=B", "A\nB"]) assert.equal(validName(name), false);
});
test("redaction handles regex characters, overlaps, and empty values", () => {
  assert.equal(redact(`${value} ${value}`, [value, ""]), "[REDACTED] [REDACTED]");
  assert.equal(redact("abcdef abc", ["abc", "abcdef"]), "[REDACTED] [REDACTED]");
});
test("injects only in child and redacts both streams", async () => {
  const result = await run('printf "%s" "$TEST_SECRET"; printf "%s" "$TEST_SECRET" >&2');
  assert.deepEqual(result, { exitCode: 0, stdout: "[REDACTED]", stderr: "[REDACTED]" });
  assert.equal(process.env.TEST_SECRET, undefined);
});
test("buffers split writes before redaction", async () => {
  const result = await run("printf 'private.'; sleep 0.02; printf 'token+$[abc]'");
  assert.equal(result.stdout, "[REDACTED]");
});
test("redacts stored secrets even when not injected", async () => {
  const result = await run(`printf '%s' '${value}'`, { names: [] });
  assert.equal(result.stdout, "[REDACTED]");
});
test("missing secret fails before execution", async () => {
  assert.match((await run("echo SHOULD_NOT_RUN", { names: ["MISSING"] })).error, /unavailable/);
});
test("nonzero exit preserved and redacted", async () => {
  const result = await run('echo "$TEST_SECRET" >&2; exit 7');
  assert.equal(result.exitCode, 7);
  assert.equal(result.stderr, "[REDACTED]\n");
});
test("overflow discards output, including a potentially partial secret", async () => {
  const result = await run('printf "%s" "$TEST_SECRET"', { maxBytes: 4 });
  assert.match(result.error, /limit/);
  assert.equal(result.stdout, undefined);
});
test("timeouts terminate the process group", async () => {
  assert.match((await run("sleep 10 & wait", { timeout: 30 })).error, /timed out/);
});
test("abort terminates execution without returning raw output", async () => {
  const controller = new AbortController();
  const pending = run('printf "%s" "$TEST_SECRET"; sleep 10', { signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  assert.match((await pending).error, /cancelled/);
});
test("pre-aborted execution does not start", async () => {
  assert.match((await run("echo NO", { signal: AbortSignal.abort() })).error, /cancelled/);
});

test("redacts initial and current secrets after concurrent capture or replacement", async () => {
  const store = new Map([["ORIGINAL", "initial-private-value"]]);
  const dir = await mkdtemp(join(tmpdir(), "secure-concurrent-"));
  const gate = join(dir, "ready");
  const controller = new AbortController();
  const pending = run(`while [ ! -f ${quote(gate)} ]; do sleep 0.01; done; printf "initial-private-value current-private-value captured-private-value"; printf "captured-private-value" >&2`, {
    vault: store, names: [], signal: controller.signal,
  });
  try {
    store.set("ORIGINAL", "current-private-value");
    assert.deepEqual(await run('printf captured-private-value', { vault: store, names: [], captureName: "CAPTURED" }), {
      name: "CAPTURED", available: true,
    });
    await writeFile(gate, "ready");
    assert.deepEqual(await pending, {
      exitCode: 0, stdout: "[REDACTED] [REDACTED] [REDACTED]", stderr: "[REDACTED]",
    });
  } finally {
    controller.abort();
    await pending;
    await rm(dir, { recursive: true, force: true });
  }
});

test("aborted capture cannot repopulate a cleared vault", async () => {
  const store = new Map();
  const controller = new AbortController();
  const pending = run('printf private-value; sleep 10', {
    vault: store, names: [], captureName: "CAPTURED", signal: controller.signal,
  });
  controller.abort();
  store.clear();
  assert.match((await pending).error, /cancelled/);
  assert.equal(store.size, 0);
});

test("concurrent captures never overwrite the winner", async () => {
  const store = new Map();
  const results = await Promise.all(["one", "two"].map(text => run(`printf ${text}`, {
    vault: store, names: [], captureName: "CAPTURED",
  })));
  assert.equal(results.filter(result => result.available).length, 1);
  assert.equal(results.filter(result => result.error?.includes("already exists")).length, 1);
  assert.ok(["one", "two"].includes(store.get("CAPTURED")));
});

test("combined stream limit is inclusive and supports zero", async () => {
  assert.deepEqual(await run('printf ab; printf cd >&2', { maxBytes: 4 }), {
    exitCode: 0, stdout: "ab", stderr: "cd",
  });
  assert.match((await run('printf ab; printf cd >&2', { maxBytes: 3 })).error, /limit/);
  assert.deepEqual(await run('true', { maxBytes: 0 }), { exitCode: 0, stdout: "", stderr: "" });
  assert.match((await run('printf x', { maxBytes: 0 })).error, /limit/);
});

test("signal termination discards partial output", async () => {
  assert.deepEqual(await run('printf partial; kill -TERM $$'), {
    error: "Command terminated by signal; output discarded.",
  });
});

test("spawn failures are generic and do not expose cwd", async () => {
  const result = await run('true', { cwd: '/nonexistent/private-path-for-secure-test' });
  assert.deepEqual(result, { error: "Could not run command." });
});

test("invalid execution limits fail closed rather than disabling bounds", async () => {
  for (const timeout of [0, -1, NaN, Infinity, 2 ** 31, 1.5]) {
    assert.deepEqual(await run('echo NO', { timeout }), { error: "Invalid command options." });
  }
  for (const maxBytes of [-1, NaN, Infinity, 1.5]) {
    assert.deepEqual(await run('echo NO', { maxBytes }), { error: "Invalid command options." });
  }
  assert.equal(validName(undefined), false);
  assert.equal(validName({ toString: () => "VALID" }), false);
});

const quote = text => `'${text.replace(/'/g, "'\\''")}'`;

test("shell exit cleans background jobs even when they keep output pipes open", async () => {
  assert.deepEqual(await run('sleep 10 & echo done', { timeout: 500 }), {
    exitCode: 0, stdout: "done\n", stderr: "",
  });
});

test("shell exit cleans background jobs with redirected output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "secure-cleanup-"));
  const marker = join(dir, "survived");
  try {
    const script = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'survived'), 300)`;
    assert.equal((await run(`${quote(process.execPath)} -e ${quote(script)} >/dev/null 2>&1 & echo done`)).exitCode, 0);
    await new Promise(resolve => setTimeout(resolve, 600));
    await assert.rejects(access(marker), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("abort settles even if an escaped descendant holds output pipes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "secure-escaped-"));
  const pidFile = join(dir, "pid");
  const controller = new AbortController();
  let escapedPid;
  let deadline;
  let pending;
  try {
    const script = `const c = require('node:child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {detached:true, stdio:'inherit'}); require('node:fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); c.unref();`;
    pending = run(`${quote(process.execPath)} -e ${quote(script)}`, { signal: controller.signal, timeout: 5000 });
    for (let i = 0; i < 200; i++) {
      try { escapedPid = Number(await readFile(pidFile, "utf8")); break; }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.ok(escapedPid, "escaped process started");
    controller.abort();
    const result = await Promise.race([
      pending,
      new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("abort hung on inherited pipes")), 1000); }),
    ]);
    assert.match(result.error, /cancelled/);
  } finally {
    clearTimeout(deadline);
    controller.abort();
    if (escapedPid) {
      try { process.kill(-escapedPid, "SIGKILL"); } catch { /* Already exited. */ }
    }
    await pending;
    await rm(dir, { recursive: true, force: true });
  }
});

test("stale lifecycle guard prevents capture commit even without an abort", async () => {
  const store = new Map();
  let generation = 0;
  const initialGeneration = generation;
  const pending = run('printf private-value', {
    vault: store, names: [], captureName: "CAPTURED", isCurrent: () => generation === initialGeneration,
  });
  generation++;
  store.clear();
  assert.deepEqual(await pending, { error: "Command cancelled." });
  assert.equal(store.size, 0);
});

test("stale lifecycle rejects new execution and discards old execution output", async () => {
  assert.deepEqual(await run('echo NO', { isCurrent: () => false }), { error: "Command cancelled." });
  let current = true;
  const pending = run('printf private-result', { isCurrent: () => current });
  current = false;
  assert.deepEqual(await pending, { error: "Command cancelled." });
});

test("valid prototype-like environment names are injected normally", async () => {
  assert.deepEqual(await run('printf "%s" "$__proto__"', {
    names: ["__proto__"], vault: new Map([["__proto__", "prototype-secret"]]),
  }), { exitCode: 0, stdout: "[REDACTED]", stderr: "" });
});
