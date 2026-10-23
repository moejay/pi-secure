import { spawn } from "node:child_process";

const FAILED = "Clipboard unavailable or copy failed.";

/** Native clipboard only: never OSC 52 (which can leak into terminal logs).
 * Values go only to stdin, never argv, environment, diagnostics, or results.
 * Linux helpers may retain a background selection owner; we do not clear the
 * clipboard automatically, since that could erase a newer clipboard value.
 * spawnImpl/platform/env are injectable so tests never touch a real clipboard.
 * @param {string} value
 * @param {{signal?: AbortSignal, timeout?: number, spawnImpl?: typeof spawn,
 *   platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv}} [options]
 */
export async function copyToClipboard(value, {
  signal, timeout = 5000, spawnImpl = spawn,
  platform = process.platform, env = process.env,
} = {}) {
  if (signal?.aborted) return { copied: false, error: "Copy cancelled." };
  const candidates = platform === "darwin" ? [["/usr/bin/pbcopy", []]] :
    platform === "linux" ? [
      ...(env.WAYLAND_DISPLAY ? [["wl-copy", ["--type", "text/plain;charset=utf-8"]]] : []),
      ...(env.DISPLAY ? [["xclip", ["-selection", "clipboard", "-in"]], ["xsel", ["--clipboard", "--input"]]] : []),
    ] : [];
  // Preserve display/session connectivity, but do not pass unrelated credentials.
  const childEnv = {};
  for (const key of ["PATH", "HOME", "LANG", "LC_ALL", "DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS"]) {
    if (typeof env[key] === "string") childEnv[key] = env[key];
  }
  const duration = Number.isFinite(timeout) ? Math.min(10000, Math.max(1, timeout)) : 5000;
  const deadline = Date.now() + duration;
  for (const [command, args] of candidates) {
    if (signal?.aborted) return { copied: false, error: "Copy cancelled." };
    if (Date.now() >= deadline) return { copied: false, error: "Copy timed out." };
    const result = await new Promise((resolve) => {
      let child, settled = false, timer;
      const finish = (result, kill = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (kill) {
          // Do not wait for close: a broken helper must not keep the UI alive.
          try { child?.kill("SIGKILL"); } catch { /* Best effort. */ }
        }
        child?.stdin?.destroy();
        resolve(result);
      };
      const abort = () => finish({ copied: false, error: "Copy cancelled." }, true);
      try {
        child = spawnImpl(command, args, { shell: false, stdio: ["pipe", "ignore", "ignore"], env: childEnv });
        child.on("error", (error) => finish({ copied: false, missing: error?.code === "ENOENT" }, true));
        // stdout/stderr are discarded at the OS boundary, including on failure.
        child.on("exit", (code, exitSignal) => finish({ copied: code === 0 && !exitSignal }));
        child.stdin.on("error", () => finish({ copied: false }, true));
        timer = setTimeout(() => finish({ copied: false, error: "Copy timed out." }, true), Math.max(1, deadline - Date.now()));
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        else child.stdin.end(value, "utf8");
      } catch (error) {
        finish({ copied: false, missing: error?.code === "ENOENT" }, true);
      }
    });
    if (result.copied) return { copied: true };
    // Only absent executables trigger fallback. A failed write is not retried.
    if (!result.missing) return { copied: false, error: result.error ?? FAILED };
  }
  return { copied: false, error: FAILED };
}
