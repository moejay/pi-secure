/** Media-only driver. Load explicitly in an isolated, offline Pi process.
 * No model is called. The only credential is fake; native clipboard is never used.
 */
import secure, { createSecretDialog } from '../../index.ts';
import { Text } from '@earendil-works/pi-tui';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
const FAKE = 'demo-only-not-a-real-credential';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export default function (pi: ExtensionAPI) {
  const tools = new Map<string, any>();
  const commands = new Map<string, any>();
  secure(new Proxy(pi, { get(target, key) {
    if (key === 'registerTool') return (tool: any) => { tools.set(tool.name, tool); };
    if (key === 'registerCommand') return (name: string, command: any) => { commands.set(name, command); };
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  }}));
  pi.on('session_start', async (_e, ctx) => {
    ctx.ui.setHeader(() => new Text('pi / pi-secure     •     OFFLINE UI DEMO', 1, 0));
    ctx.ui.setFooter(() => new Text('Fake credential only · scripted inputs · no model calls', 1, 0));
  });
  const message = (text: string) => pi.sendMessage({ customType: 'secure-demo', content: text, display: true });
  pi.registerCommand('demo', {
    description: 'Record a deterministic, fake-only media demonstration',
    handler: async (_args, ctx) => {
      message('request_secret  { name: "DEMO_TOKEN" }');
      const localCtx = { ...ctx, mode: 'tui', ui: { ...ctx.ui, custom: (factory: any) => ctx.ui.custom((tui, theme, kb, done) => {
        const component = factory(tui, theme, kb, done);
        setTimeout(() => component.handleInput(FAKE), 900);
        setTimeout(() => component.handleInput('\r'), 3300);
        return component;
      }) }};
      const requested = await tools.get('request_secret').execute('demo-request', {
        name: 'DEMO_TOKEN', reason: 'Local demo only. Enter a fake credential, not a real token.',
      }, undefined, undefined, localCtx);
      message('request_secret → ' + requested.content[0].text);
      await wait(900);
      const command = 'printf \'Token: %s\\n\' "$DEMO_TOKEN"';
      message('secure_exec\n' + command);
      const result = await tools.get('secure_exec').execute('demo-exec', { command, secrets: ['DEMO_TOKEN'] }, undefined, undefined, ctx);
      const data = JSON.parse(result.content[0].text);
      if (data.stdout !== 'Token: [REDACTED]\n') throw new Error('Demo redaction check failed');
      message('secure_exec → exit ' + data.exitCode + '\n' + data.stdout.trim());
      await wait(4000);
      await ctx.ui.custom((tui, theme, _kb, done) => {
        const dialog = createSecretDialog({ name: 'DEMO_TOKEN', value: FAKE, tui, theme, done,
          copy: async (value) => {
            if (value !== FAKE) throw new Error('Not the fake demo credential');
            return { copied: true };
          },
        });
        const timers = [
          setTimeout(() => dialog.handleInput('c'), 1600),
          setTimeout(() => dialog.handleInput('y'), 3500),
          setTimeout(() => dialog.handleInput('r'), 5700),
          setTimeout(() => dialog.handleInput('y'), 7600),
          setTimeout(() => dialog.handleInput('r'), 10100),
          setTimeout(() => dialog.handleInput('\r'), 11200),
        ];
        return { ...dialog, dispose() { timers.forEach(clearTimeout); dialog.dispose(); } };
      });
      await commands.get('secret').handler('clear', ctx);
      message('/secret clear\nSecrets forgotten.');
      const unavailable = await tools.get('secure_exec').execute('demo-after-clear', { command: 'true', secrets: ['DEMO_TOKEN'] }, undefined, undefined, ctx);
      message('After clear → ' + JSON.parse(unavailable.content[0].text).error);
      await wait(3500);
      ctx.shutdown();
    },
  });
}
