import { spawn } from "node:child_process";

export const validName = (name) => typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);

export function redact(text, values) {
  const secrets = [...new Set(values)].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!secrets.length) return text;
  const pattern = secrets.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return text.replace(new RegExp(pattern, "g"), "[REDACTED]");
}

// No raw output, command, environment, or exception is returned to the caller.
// Lifecycle owners should abort in-flight work and invalidate isCurrent before
// clearing/replacing the vault. The guard also protects the capture commit.
export async function secureExec({ command, names, vault, cwd, signal, timeout = 60_000, maxBytes = 1_048_576, captureName = /** @type {string | undefined} */ (undefined), trimNewline = true, isCurrent = () => true }) {
  if (typeof command !== "string" || !Array.isArray(names) ||
      !Number.isSafeInteger(timeout) || timeout < 1 || timeout > 2_147_483_647 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    return { error: "Invalid command options." };
  }
  if (captureName !== undefined && (!validName(captureName) || vault.has(captureName))) {
    return { error: "Capture name is invalid or already exists. Choose a new name." };
  }
  if (signal?.aborted || !isCurrent()) return { error: "Command cancelled." };
  const env = Object.assign(Object.create(null), process.env);
  const values = [...vault.values()];
  for (const name of names) {
    if (!validName(name) || !vault.has(name)) return { error: "A requested secret is unavailable. Use request_secret first." };
    env[name] = vault.get(name);
  }
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn("/bin/sh", ["-c", command], { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      resolve({ error: "Could not start command." });
      return;
    }
    let stdout = [], stderr = [], size = 0, failure, finished = false;
    const killGroup = () => {
      if (!child.pid) return;
      try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ }
    };
    const stop = (reason) => {
      if (finished) return;
      failure ??= reason;
      stdout.length = 0; stderr.length = 0;
      killGroup();
      // An escaped descendant can retain these pipes after the shell dies.
      // Never wait for it to close them after cancellation/overflow/timeout.
      child.stdout.destroy();
      child.stderr.destroy();
    };
    const abort = () => stop("Command cancelled.");
    const timer = setTimeout(() => stop("Command timed out."), timeout);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const collect = (target) => (chunk) => {
      if (failure || finished) return;
      size += chunk.length;
      if (size > maxBytes) {
        stop("Command output limit exceeded; output discarded.");
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.stdout.on("error", () => stop("Could not read command output."));
    child.stderr.on("error", () => stop("Could not read command output."));
    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      let result;
      try {
        if (signal?.aborted || !isCurrent()) failure ??= "Command cancelled.";
        if (failure) result = { error: failure };
        else if (captureName !== undefined) {
          // Never return stdout OR stderr in capture mode, including on failure.
          let value = Buffer.concat(stdout).toString("utf8");
          if (trimNewline) value = value.replace(/\r?\n$/, "");
          if (code !== 0) result = { error: "Capture command failed; output discarded." };
          else if (!value || value.includes("\0")) result = { error: "Captured output is empty or contains NUL; discarded." };
          else if (vault.has(captureName)) result = { error: "Secret name already exists; captured output discarded." };
          else {
            vault.set(captureName, value);
            result = { name: captureName, available: true };
          }
        } else if (code === null) result = { error: "Command terminated by signal; output discarded." };
        else {
          // Preserve launch-time values even if forgotten/replaced, but also
          // protect secrets captured by concurrent commands before this result.
          const redactions = [...values, ...vault.values()];
          result = {
            exitCode: code,
            stdout: redact(Buffer.concat(stdout).toString("utf8"), redactions),
            stderr: redact(Buffer.concat(stderr).toString("utf8"), redactions),
          };
        }
      } catch {
        // Fail closed if output decoding/redaction cannot be completed.
        result = { error: "Could not process command output; output discarded to prevent secret exposure. Redaction can fail when a stored secret is very large or many secrets accumulate; all stored secrets are checked, not just those injected. Use /secret list, then /secret clear NAME to forget an unneeded secret, or /secret clear to forget all secrets, and retry. The command may already have completed; check its effects before rerunning." };
      }
      stdout.length = 0; stderr.length = 0;
      resolve(result);
    };
    // A successful shell must not leave background jobs running, even when
    // they redirect their output and therefore do not delay the close event.
    child.on("exit", killGroup);
    child.on("error", () => { stop("Could not run command."); finish(null); });
    child.on("close", finish);
  });
}
