/** Media-only choreography: real Pi components and authenticated localhost HTTP.
 * Scripted input, no model calls, synthetic credential, no clipboard operations.
 */
import secure from '../../index.ts';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { Text } from '@earendil-works/pi-tui';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
const TOKEN = 'example-local-api-token';
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
    ctx.ui.setHeader(() => new Text('pi / private build', 1, 0));
    ctx.ui.setFooter(() => new Text('', 0, 0));
  });
  // Plain terminal narration, not fabricated assistant reasoning or tool messages.
  pi.registerMessageRenderer('build-workflow', (message) => new Text(String(message.content), 1, 0));
  const message = (text: string) => pi.sendMessage({ customType: 'build-workflow', content: text, display: true });
  pi.registerCommand('demo', {
    description: 'Record the local build example',
    handler: async (_args, ctx) => {
      let authenticated = 0;
      const body = JSON.stringify({ build: 184, branch: 'main', status: 'passed', checks: '12 / 12' }, null, 2) + '\n';
      const server = createServer((req, res) => {
        if (req.url !== '/builds/latest') { res.writeHead(404).end(); return; }
        if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401).end('Unauthorized\n'); return; }
        authenticated++;
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(body);
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fixture did not bind');
      const url = `http://127.0.0.1:${address.port}/builds/latest`;
      try {
        if ((await fetch(url)).status !== 401) throw new Error('Fixture must require authentication');
        message('Check the latest private build.\nrequest_secret  BUILD_TOKEN');
        const localCtx = { ...ctx, mode: 'tui', ui: { ...ctx.ui, custom: (factory: any) => ctx.ui.custom((tui, theme, kb, done) => {
          const component = factory(tui, theme, kb, done);
          const timers = [setTimeout(() => component.handleInput(TOKEN), 900), setTimeout(() => component.handleInput('\r'), 3700)];
          return { ...component, dispose() { timers.forEach(clearTimeout); component.dispose?.(); } };
        }) }};
        const requested = await tools.get('request_secret').execute('local-request', {
          name: 'BUILD_TOKEN', reason: 'Read the latest build from the private localhost API.',
        }, undefined, undefined, localCtx);
        if (!JSON.parse(requested.content[0].text).available) throw new Error('Token not stored');
        message('request_secret → BUILD_TOKEN available');
        await wait(900);
        const command = `curl --fail --silent --show-error --noproxy '*' \\\n  -H "Authorization: Bearer $BUILD_TOKEN" \\\n  ${url}`;
        message('secure_exec · BUILD_TOKEN\n' + command);
        const result = await tools.get('secure_exec').execute('local-exec', { command, secrets: ['BUILD_TOKEN'] }, undefined, undefined, ctx);
        const data = JSON.parse(result.content[0].text);
        if (data.exitCode !== 0 || data.stdout !== body || authenticated !== 1) throw new Error('Authenticated local request failed');
        message('Result · exit 0\n' + data.stdout.trim());
        await wait(5200);
        // Invoke the real show_secret tool; only its presentation is non-overlay.
        const revealCtx = { ...ctx, mode: 'tui', ui: { ...ctx.ui, custom: (factory: any) => ctx.ui.custom((tui, theme, kb, done) => {
          const dialog = factory(tui, theme, kb, done);
          const timers = [
            setTimeout(() => dialog.handleInput('r'), 1700),
            setTimeout(() => dialog.handleInput('y'), 3800),
            setTimeout(() => dialog.handleInput('r'), 6400),
            setTimeout(() => dialog.handleInput('\r'), 7500),
          ];
          return { ...dialog, dispose() { timers.forEach(clearTimeout); dialog.dispose?.(); } };
        }) }};
        const shown = await tools.get('show_secret').execute('local-reveal', { name: 'BUILD_TOKEN' }, undefined, undefined, revealCtx);
        const reveal = JSON.parse(shown.content[0].text);
        if (!reveal.shown || reveal.copied) throw new Error('Expected reveal without copy');
        await commands.get('secret').handler('clear', ctx);
        const unavailable = await tools.get('secure_exec').execute('local-after-clear', { command: 'true', secrets: ['BUILD_TOKEN'] }, undefined, undefined, ctx);
        const cleared = JSON.parse(unavailable.content[0].text);
        if (!cleared.error) throw new Error('Clear did not remove the token');
        message('/secret clear\nBUILD_TOKEN is no longer available.');
        writeFileSync('verification.json', JSON.stringify({ unauthenticated: 401, authenticated: 200, requests: authenticated, revealed: reveal.shown, copied: reveal.copied, cleared: true }));
        await wait(4100);
      } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        ctx.shutdown();
      }
    },
  });
}
