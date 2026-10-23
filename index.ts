import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Input, Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { secureExec, validName } from "./secure.mjs";
import { copyToClipboard } from "./clipboard.mjs";

/** A fresh, local-only component per interaction. Confirmation never leaves the
 * component, and neither rendering nor copying changes the tool's private data.
 * Results describe completed actions only; masking cannot undo terminal logs.
 */
export function createSecretDialog({ name, value, tui, theme, done, signal, copy = copyToClipboard }: {
  name: string; value: string | undefined; tui: { requestRender(): void }; theme: { fg(color: any, text: string): string };
  done(result: { shown: boolean; copied: boolean }): void; signal?: AbortSignal;
  copy?: typeof copyToClipboard;
}) {
  let visible = false, shown = false, copied = false, closed = false, busy = false;
  let confirmation: "reveal" | "copy" | undefined;
  let status = "";
  const controller = new AbortController();
  const cleanup = () => {
    closed = true;
    value = undefined;
    visible = false;
    clearTimeout(timer);
    signal?.removeEventListener("abort", close);
    controller.abort();
  };
  const close = () => {
    if (closed) return;
    cleanup();
    done({ shown, copied });
  };
  // One absolute lifetime, not extended by keypresses, confirmations, or copies.
  const timer = setTimeout(close, 30_000);
  signal?.addEventListener("abort", close, { once: true });
  if (signal?.aborted) close();
  const performCopy = async () => {
    busy = true;
    status = "Copying…";
    tui.requestRender();
    try {
      const result = await copy(value ?? "", { signal: controller.signal });
      if (closed) return;
      copied ||= result.copied;
      status = result.copied ? "Copied. Clipboard is not automatically cleared." : "Copy failed. Native clipboard utility unavailable or failed.";
    } catch {
      if (!closed) status = "Copy failed."; // Never expose helper exceptions.
    } finally {
      busy = false;
      if (!closed) tui.requestRender();
    }
  };
  return {
    render(width: number) {
      if (closed) return [];
      const lines = [`Secret: ${name}`];
      if (visible) {
        // Do not interpret control bytes, including OSC/CSI escape sequences.
        const safe = (value ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, ch => `\\x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`);
        shown = true;
        // Keep the controls reachable even for large captured secrets.
        const wrapped = wrapTextWithAnsi(safe, Math.max(1, width));
        lines.push(...wrapped.slice(0, 8));
        if (wrapped.length > 8) lines.push("[Display truncated; copy uses the full value.]");
      } else lines.push("******** (masked)");
      if (confirmation) {
        lines.push(confirmation === "reveal"
          ? "Reveal? Terminal recordings/scrollback may retain the value."
          : "Copy? Other apps/clipboard history or sync may retain the value.");
        lines.push("Y: confirm • N/Esc: back");
      } else lines.push("R: reveal/hide • C: copy • Enter/Esc/Ctrl+C: close");
      if (status) lines.push(status);
      lines.push("Auto-closes after 30 seconds. Hiding does not erase recordings.");
      return lines.map((line, i) => i === 0 ? theme.fg("accent", truncateToWidth(line, width)) : truncateToWidth(line, width));
    },
    handleInput(data: string) {
      if (closed) return;
      if (matchesKey(data, Key.ctrl("c"))) { close(); return; }
      if (confirmation) {
        if (data === "y" || data === "Y") {
          const action = confirmation;
          confirmation = undefined;
          if (action === "reveal") visible = true;
          else void performCopy();
        } else if (data === "n" || data === "N" || matchesKey(data, Key.escape)) confirmation = undefined;
      } else if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) close();
      else if (data === "r" || data === "R") {
        if (visible) visible = false;
        else if (!busy) confirmation = "reveal";
      } else if (!busy && (data === "c" || data === "C")) confirmation = "copy";
      tui.requestRender();
    },
    invalidate() {},
    dispose() { if (!closed) close(); },
  };
}

export default function (pi: ExtensionAPI) {
  const vault = new Map<string, string>();
  // Every in-flight operation belongs to one vault lifetime. Forget/reload must
  // cancel pending input, queued dialogs, and captures before clearing the vault.
  let lifecycle = new AbortController();
  const operationSignal = (signal?: AbortSignal) => signal
    ? AbortSignal.any([signal, lifecycle.signal]) : lifecycle.signal;
  const resetOperations = () => {
    lifecycle.abort();
    lifecycle = new AbortController();
  };
  let dialogQueue: Promise<unknown> = Promise.resolve();
  const reply = (data: object) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    details: undefined,
  });

  pi.on("session_start", () => { resetOperations(); vault.clear(); });
  pi.on("session_shutdown", () => { resetOperations(); vault.clear(); });

  pi.registerCommand("secret", {
    description: "List secret names or clear them: /secret list | /secret clear (never enter values here)",
    handler: async (args, ctx) => {
      if (args.trim() === "clear") {
        resetOperations();
        vault.clear();
        ctx.ui.notify("Secrets forgotten.", "info");
      } else if (args.trim() === "list") {
        ctx.ui.notify([...vault.keys()].join(", ") || "No secrets stored.", "info");
      } else {
        ctx.ui.notify("Use /secret list or /secret clear. Never paste values into commands or chat.", "warning");
      }
    },
  });

  pi.registerTool(defineTool({
    name: "request_secret",
    label: "Request secret",
    exposure: "model-only",
    description: "Ask the user for a secret in a private masked dialog. Only its name and availability are returned. Use secure_exec with that name to use it. Never ask the user to paste secrets into chat. Cancelled requests must not be retried without permission.",
    parameters: Type.Object({
      name: Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$", description: "Environment variable name, e.g. GITHUB_TOKEN" }),
      reason: Type.String({ maxLength: 500, description: "Why the credential is needed and where it will be used" }),
    }),
    async execute(_id, { name, reason }, signal, _update, ctx) {
      signal = operationSignal(signal);
      if (signal.aborted) return reply({ name, available: false });
      if (!validName(name)) return reply({ available: false, error: "Invalid secret name." });
      if (vault.has(name)) return reply({ name, available: true });
      if (ctx.mode !== "tui") return reply({ name, available: false, error: "A private terminal dialog is required." });
      // Tools may run in parallel. Never open two secret dialogs at once.
      const request = dialogQueue.then(async () => {
        if (signal?.aborted) return reply({ name, available: false });
        if (vault.has(name)) return reply({ name, available: true });
        const value = await ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
          let input: Input | undefined = new Input();
          let closed = false;
          const finish = (value?: string) => {
            if (closed) return;
            closed = true;
            input = undefined;
            signal?.removeEventListener("abort", cancel);
            done(value);
          };
          const cancel = () => finish();
          input.onSubmit = (value) => {
            if (value && !value.includes("\0") && !/[\r\n]/.test(value)) finish(value);
          };
          input.onEscape = cancel;
          signal?.addEventListener("abort", cancel, { once: true });
          if (signal?.aborted) cancel();
          return {
            render(width) {
              const cleanReason = reason.replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
              return [
                theme.fg("accent", truncateToWidth(`Secret requested: ${name}`, width)),
                truncateToWidth(cleanReason, width),
                truncateToWidth("Value: " + (input?.getValue() ? "********" : ""), width),
                truncateToWidth("Enter: submit • Esc/Ctrl+C: cancel • single-line only", width),
                truncateToWidth("Held in memory. Commands may use or save it; not a sandbox.", width),
              ];
            },
            handleInput(data) {
              if (matchesKey(data, Key.ctrl("c"))) cancel();
              else input?.handleInput(data);
              tui.requestRender();
            },
            invalidate() {},
            dispose() { input = undefined; signal?.removeEventListener("abort", cancel); },
          };
        });
        if (value === undefined || signal?.aborted) return reply({ name, available: false });
        vault.set(name, value);
        return reply({ name, available: true });
      });
      dialogQueue = request.catch(() => {});
      return request;
    },
  }));

  pi.registerTool(defineTool({
    name: "capture_secret",
    label: "Capture secret",
    description: "Run a command and privately store its stdout as a named secret. Neither stdout nor stderr is returned, even on failure. Read a file or fetch an API response with the command; never put literal secret values in tool arguments. Existing names cannot be overwritten. Use show_secret to reveal locally or secure_exec to use the value.",
    parameters: Type.Object({
      name: Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }),
      command: Type.String({ description: "Command whose stdout is the value to capture. Never embed a literal secret." }),
      secrets: Type.Optional(Type.Array(Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }), { description: "Existing secrets to inject for authentication" })),
      trimNewline: Type.Optional(Type.Boolean({ description: "Remove one trailing newline (default true)" })),
      timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: 300 })),
    }),
    async execute(_id, params, signal, _update, ctx) {
      const lifetime = lifecycle;
      const result = await secureExec({
        isCurrent: () => lifecycle === lifetime && !lifetime.signal.aborted,
        command: params.command, names: params.secrets ?? [], vault, cwd: ctx.cwd,
        signal: operationSignal(signal), timeout: (params.timeout ?? 60) * 1000,
        captureName: params.name, trimNewline: params.trimNewline ?? true,
      });
      return { ...reply(result), isError: !!result.error };
    },
  }));

  pi.registerTool(defineTool({
    name: "show_secret",
    label: "Show secret locally",
    exposure: "model-only",
    description: "Open a masked local dialog for a named secret. R reveals/hides and C copies without requiring reveal; both actions require explicit confirmation. Returns only shown/copied status, never the value. Requires interactive terminal mode. Terminal recordings and clipboard history/sync may retain values.",
    parameters: Type.Object({ name: Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }) }),
    async execute(_id, { name }, signal, _update, ctx) {
      if (!validName(name)) return reply({ shown: false, copied: false, error: "Invalid secret name." });
      if (ctx.mode !== "tui") return reply({ name, shown: false, copied: false, error: "A local terminal dialog is required." });
      signal = operationSignal(signal);
      const request = dialogQueue.then(async () => {
        if (signal.aborted || !vault.has(name)) return reply({ name, shown: false, copied: false });
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        try {
          const result = await ctx.ui.custom<{ shown: boolean; copied: boolean }>((tui, theme, _kb, done) =>
            createSecretDialog({ name, value: vault.get(name), tui, theme, done, signal: controller.signal }),
          { overlay: true });
          return reply({ name, shown: result.shown, copied: result.copied });
        } finally {
          controller.abort();
          signal?.removeEventListener("abort", abort);
        }
      });
      dialogQueue = request.catch(() => {});
      return request;
    },
  }));

  pi.registerTool(defineTool({
    name: "secure_exec",
    label: "Secure exec",
    description: "Run an arbitrary shell command with named secrets injected as environment variables. Use secrets for user-authorized tasks, including saving them to files or external secret stores. Reference values as quoted environment variables, never literal values in tool arguments. Keep values out of chat: do not return them through other tools, encode them to bypass redaction, or include them in messages. Output is buffered and exact known secret values are redacted. This tool is not a sandbox and does not restrict destinations or file access.",
    parameters: Type.Object({
      command: Type.String(),
      secrets: Type.Array(Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]*$" }), { minItems: 1 }),
      timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: 300, description: "Timeout in seconds (default 60)" })),
    }),
    async execute(_id, params, signal, _update, ctx) {
      const lifetime = lifecycle;
      const result = await secureExec({
        isCurrent: () => lifecycle === lifetime && !lifetime.signal.aborted,
        command: params.command, names: params.secrets, vault,
        cwd: ctx.cwd, signal: operationSignal(signal), timeout: (params.timeout ?? 60) * 1000,
      });
      return { ...reply(result), isError: !!result.error || result.exitCode !== 0 };
    },
  }));
}
