import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI, type ExtensionContext, type Theme } from "@earendil-works/pi-coding-agent";
import { Input, Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { secureExec, validName } from "./secure.mjs";
import { copyToClipboard } from "./clipboard.mjs";

// All private interactions use the same centered, opaque, high-emphasis panel.
const secretOverlay = { overlay: true, overlayOptions: { anchor: "center" as const, width: 78, margin: 1 } };
type SecretTheme = Pick<Theme, "style">;
function renderSecretPanel(theme: SecretTheme, width: number, title: string, body: (width: number) => string[], compact = false) {
  if (width <= 0) return [];
  const bordered = width >= 3;
  const inside = width - (bordered ? 2 : 0);
  const padding = inside >= 18 ? 2 : inside >= 4 ? 1 : 0;
  const contentWidth = Math.max(1, inside - padding * 2);
  const edge = (text: string) => theme.style(text, { fg: "accent", bg: "customMessageBg", bold: true });
  const row = (text: string, header = false) => {
    const clipped = truncateToWidth(text, contentWidth);
    const padded = " ".repeat(padding) + clipped + " ".repeat(Math.max(0, inside - padding - visibleWidth(clipped)));
    return (bordered ? edge("┃") : "") + theme.style(padded, {
      fg: header ? "accent" : "text", bg: header ? "selectedBg" : "customMessageBg", bold: header,
    }) + (bordered ? edge("┃") : "");
  };
  return [
    ...(bordered ? [edge(`┏${"━".repeat(inside)}┓`)] : []),
    ...(compact ? [truncateToWidth(title, contentWidth)] : wrapTextWithAnsi(title, contentWidth)).map(line => row(line, true)),
    ...(compact ? [] : [row("")]),
    ...body(contentWidth).flatMap(line => (compact ? [truncateToWidth(line, contentWidth)] : wrapTextWithAnsi(line, contentWidth)).map(part => row(part))),
    ...(compact ? [] : [row("")]),
    ...(bordered ? [edge(`┗${"━".repeat(inside)}┛`)] : []),
  ];
}

/** A fresh, local-only component per interaction. Confirmation never leaves the
 * component, and neither rendering nor copying changes the tool's private data.
 * Results describe completed actions only; masking cannot undo terminal logs.
 */
export function createSecretDialog({ name, value, tui, theme, done, signal, copy = copyToClipboard }: {
  name: string; value: string | undefined; tui: { requestRender(): void }; theme: SecretTheme;
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
      return renderSecretPanel(theme, width, `PRIVATE SECRET • ${name}`, contentWidth => {
        const lines = [`Secret: ${name}`];
        if (visible) {
          // Do not interpret control bytes, including OSC/CSI escape sequences.
          const safe = (value ?? "").replace(/[\x00-\x1f\x7f-\x9f]/g, ch => `\\x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`);
          shown = true;
          // Keep the controls reachable even for large captured secrets.
          const wrapped = wrapTextWithAnsi(safe, contentWidth);
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
        return lines;
      });
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

type BrowserAction = { name: string; action: "show" | "clear" } | undefined;

/** Names only. Return an action before opening another custom UI (never nest). */
export function createSecretBrowser({ names, selected, tui, theme, done, signal }: {
  names: string[]; selected?: string; tui: { requestRender(): void; terminal?: { rows: number } };
  theme: SecretTheme; done(action: BrowserAction): void; signal: AbortSignal;
}) {
  let index = Math.max(0, names.indexOf(selected ?? "")), top = 0, closed = false, confirming = false;
  const finish = (action?: BrowserAction) => {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", cancel);
    done(action);
  };
  const cancel = () => finish();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  return {
    render(width: number) {
      if (closed || width <= 0) return [];
      const height = Math.max(1, (tui.terminal?.rows ?? 24) - 2);
      const count = Math.max(1, Math.min(12, height - 6));
      const confirmation = "Y/N: forget? Esc: back";
      if (height < 7) {
        // At very short heights, spend rows on selection and actionable controls,
        // not frame chrome. Confirmation must never be sliced offscreen.
        const lines = [
          names.length ? `› ${names[index]}` : "No secrets stored.",
          confirming ? confirmation : "Enter/R: show • D: forget",
          "↑↓/jk • Esc: close",
        ];
        if (height === 1) lines.splice(0, 1);
        return lines.slice(0, height).map(line => theme.style(truncateToWidth(line, width), {
          fg: "accent", bg: "customMessageBg", bold: true,
        }));
      }
      top = Math.max(0, Math.min(top, index));
      if (index >= top + count) top = index - count + 1;
      const lines = renderSecretPanel(theme, width, "PRIVATE SECRETS • names only", contentWidth => [
        ...(names.length ? names.slice(top, top + count).map((name, offset) => {
          const text = truncateToWidth(`${top + offset === index ? "›" : " "} ${name}`, contentWidth);
          return top + offset === index ? theme.style(text, { fg: "accent", bold: true }) : text;
        }) : ["No secrets stored yet."]),
        confirming ? `Forget ${names[index]}?` : names.length ? `${index + 1}/${names.length} • ↑/↓ or j/k` : "Use request_secret or capture_secret to add one.",
        confirming ? confirmation : "Enter/R: show/copy • D/Delete: forget",
        "Esc/Ctrl+C: close",
      ], true);
      return lines;
    },
    handleInput(data: string) {
      if (closed) return;
      if (matchesKey(data, Key.ctrl("c"))) { cancel(); return; }
      if (confirming) {
        if (data === "y" || data === "Y") finish({ name: names[index], action: "clear" });
        else if (data === "n" || data === "N" || matchesKey(data, Key.escape)) confirming = false;
      } else if (matchesKey(data, Key.escape)) cancel();
      else if (names.length) {
        if (matchesKey(data, Key.down) || data === "j") index = Math.min(names.length - 1, index + 1);
        else if (matchesKey(data, Key.up) || data === "k") index = Math.max(0, index - 1);
        else if (matchesKey(data, Key.enter) || data === "r" || data === "R") finish({ name: names[index], action: "show" });
        else if (data === "d" || data === "D" || matchesKey(data, Key.delete)) confirming = true;
      }
      tui.requestRender();
    },
    invalidate() {},
    dispose() { cancel(); },
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

  // Queue the entire browser flow, but open each overlay only after the last
  // custom() has resolved. Tools queued before a browser clear keep OLD signals.
  const enqueue = <T,>(work: () => Promise<T>) => {
    const request = dialogQueue.then(work);
    dialogQueue = request.catch(() => {});
    return request;
  };
  const showLocal = async (name: string, ctx: ExtensionContext, signal: AbortSignal) => {
    if (signal.aborted || !vault.has(name)) return { shown: false, copied: false };
    return ctx.ui.custom<{ shown: boolean; copied: boolean }>((tui, theme, _kb, done) =>
      createSecretDialog({ name, value: vault.get(name), tui, theme, done, signal }), secretOverlay);
  };
  const browse = async (ctx: ExtensionContext) => {
    let signal = operationSignal();
    return enqueue(async () => {
      let selected: string | undefined;
      while (!signal.aborted) {
        const names = [...vault.keys()];
        const action = await ctx.ui.custom<BrowserAction>((tui, theme, _kb, done) =>
          createSecretBrowser({ names, selected, tui, theme, done, signal }), secretOverlay);
        if (signal.aborted || !action) return;
        selected = action.name;
        if (action.action === "show") await showLocal(action.name, ctx, signal);
        else {
          resetOperations();
          vault.delete(action.name);
          // Intentional continuation after OUR clear only. All older work stays
          // cancelled; no external reset can revive this browser.
          signal = operationSignal();
          const remaining = [...vault.keys()];
          selected = remaining[Math.min(names.indexOf(action.name), remaining.length - 1)];
        }
      }
    });
  };

  pi.registerCommand("secret", {
    description: "Browse, show or forget secrets: /secret list | /secret show NAME | /secret clear [NAME] (never enter values here)",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      if (parts[0] === "clear" && parts.length === 1) {
        resetOperations();
        vault.clear();
        ctx.ui.notify("Secrets forgotten.", "info");
      } else if (parts[0] === "clear" && parts.length === 2 && validName(parts[1])) {
        // Cancel all old operations before deletion: pending captures/dialogs
        // must not restore the name, and running commands may hold its value.
        resetOperations();
        const removed = vault.delete(parts[1]);
        ctx.ui.notify(removed ? `Secret ${parts[1]} forgotten.` : `No secret named ${parts[1]} stored.`, "info");
      } else if (parts[0] === "show" && parts.length === 2 && validName(parts[1])) {
        if (ctx.mode !== "tui") {
          ctx.ui.notify("A local terminal dialog is required.", "warning");
          return;
        }
        const name = parts[1], signal = operationSignal();
        await enqueue(async () => {
          if (signal.aborted) return;
          if (!vault.has(name)) ctx.ui.notify(`No secret named ${name} stored.`, "info");
          else await showLocal(name, ctx, signal);
        });
      } else if (args.trim() === "list") {
        if (ctx.mode === "tui") await browse(ctx);
        else ctx.ui.notify([...vault.keys()].join(", ") || "No secrets stored.", "info");
      } else {
        ctx.ui.notify("Use /secret list, /secret show NAME, /secret clear NAME, or /secret clear (all). Never paste values into commands or chat.", "warning");
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
              if (closed) return [];
              return renderSecretPanel(theme, width, `SECRET REQUEST • ${name}`, () => [
                `Secret requested: ${name}`,
                cleanReason,
                "",
                "Value: " + (input?.getValue() ? "*".repeat(Array.from(input.getValue()).length) : "(type or paste here; input is masked)"),
                "",
                "Enter: submit • Esc/Ctrl+C: cancel • single-line only",
                "Held in memory. Commands may use or save it; not a sandbox.",
              ]);
            },
            handleInput(data) {
              if (matchesKey(data, Key.ctrl("c"))) cancel();
              else input?.handleInput(data);
              tui.requestRender();
            },
            invalidate() {},
            dispose() { input = undefined; signal?.removeEventListener("abort", cancel); },
          };
        }, secretOverlay);
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
      if (!validName(params.name) || vault.has(params.name)) {
        return { ...reply({ available: false, error: "Capture name is invalid or already exists. Choose a new name." }), isError: true };
      }
      const lifetime = lifecycle;
      let result: Awaited<ReturnType<typeof secureExec>>;
      try {
        result = await secureExec({
          isCurrent: () => lifecycle === lifetime && !lifetime.signal.aborted,
          command: params.command, names: params.secrets ?? [], vault, cwd: ctx.cwd,
          signal: operationSignal(signal), timeout: (params.timeout ?? 60) * 1000,
          captureName: params.name, trimNewline: params.trimNewline ?? true,
        });
      } catch {
        return { ...reply({ name: params.name, available: false, error: "Secret capture failed; output discarded." }), isError: true };
      }
      // Never forward helper results from capture mode. A stale native ESM
      // helper can survive Pi reload and return ordinary execution output.
      if (result.error || result.available !== true || result.name !== params.name || !vault.has(params.name)) {
        const error = result.error
          ? "Secret capture failed; output discarded."
          : "Capture did not store a secret. Fully restart Pi before retrying.";
        return { ...reply({ name: params.name, available: false, error }), isError: true };
      }
      return reply({ name: params.name, available: true });
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
      return enqueue(async () => {
        const result = await showLocal(name, ctx, signal);
        return reply({ name, shown: result.shown, copied: result.copied });
      });
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
