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
        const snapshots: Record<string, string[]> = {};
        const scripted = (plans: [number, string][][], labels: string[]) => {
          let step = 0;
          return { ...ctx, ui: { ...ctx.ui, custom: (factory: any, options: any) => {
            const label = labels[step], keys = plans[step++];
            if (!keys) throw new Error('Unexpected dialog');
            return ctx.ui.custom((tui, theme, kb, done) => {
              const component = factory(tui, theme, kb, done);
              const timers = keys.map(([ms, key]) => setTimeout(() => component.handleInput(key), ms));
              return { ...component, render(width: number) {
                const lines = component.render(width);
                const text = lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
                (snapshots[label] ??= []).push(text);
                return lines;
              }, dispose() { timers.forEach(clearTimeout); component.dispose?.(); } };
            }, options); // Preserve the extension's real centered overlay settings.
          } } };
        };
        const localCtx = scripted([[
          [700, 'example-'], [1400, 'local-'], [2100, 'api-'], [2800, 'token'], [4400, '\r'],
        ]], ['request']);
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
        await wait(3100);
        message('/secret show BUILD_TOKEN');
        const showCtx = scripted([[
          [1600, 'r'], [3300, 'y'], [5100, 'r'], [6200, '\r'],
        ]], ['command-show']);
        await commands.get('secret').handler('show BUILD_TOKEN', showCtx);
        // Populate enough synthetic names to exercise actual viewport scrolling.
        for (let n = 1; n <= 14; n++) {
          const name = `DEMO_TOKEN_${String(n).padStart(2, '0')}`;
          const result = await tools.get('capture_secret').execute('seed', {
            name, command: "printf '%s' synthetic-browser-fixture",
          }, undefined, undefined, ctx);
          if (!JSON.parse(result.content[0].text).available) throw new Error('Seed failed');
        }
        message('/secret list\nBrowse synthetic names. Scroll, show, then forget one.');
        const browserCtx = scripted([
          [...Array.from({ length: 14 }, (_, n): [number, string] => [1000 + n * 160, 'j']), [4700, '\r']],
          [[2300, '\r']],
          [[1800, 'd'], [3700, 'y']],
          [[2300, '\x1b']],
        ], ['browser-scroll', 'browser-show', 'browser-forget', 'browser-after']);
        await commands.get('secret').handler('list', browserCtx);
        const removed = await tools.get('secure_exec').execute('verify-forgotten', {
          command: 'true', secrets: ['DEMO_TOKEN_14'],
        }, undefined, undefined, ctx);
        if (!JSON.parse(removed.content[0].text).error) throw new Error('Browser clear failed');
        const has = (label: string, text: string) => snapshots[label]?.some(s => s.includes(text));
        const assertions = {
          liveMaskCounts: [8, 14, 18, 23].every(n => has('request', 'Value: ' + '*'.repeat(n) + ' ')),
          requestNeverRevealed: !snapshots.request.some(s => s.includes(TOKEN)),
          commandShowMasked: has('command-show', '******** (masked)'),
          revealConfirmed: has('command-show', 'Reveal?') && has('command-show', TOKEN),
          browserScrolled: has('browser-scroll', '15/15') && has('browser-scroll', '› DEMO_TOKEN_14'),
          browserNamesOnly: !snapshots['browser-scroll'].some(s => s.includes(TOKEN) || s.includes('synthetic-browser-fixture')),
          browserShowMasked: has('browser-show', 'PRIVATE SECRET • DEMO_TOKEN_14') && has('browser-show', '******** (masked)'),
          browserClearConfirmed: has('browser-forget', 'Forget DEMO_TOKEN_14?') && has('browser-forget', 'Y/N: forget?'),
          browserClearRemoved: !snapshots['browser-after'].some(s => s.includes('DEMO_TOKEN_14')) && has('browser-after', '14/14'),
        };
        if (Object.values(assertions).some(ok => !ok)) throw new Error(JSON.stringify(assertions));
        await commands.get('secret').handler('clear', ctx);
        const unavailable = await tools.get('secure_exec').execute('local-after-clear', { command: 'true', secrets: ['BUILD_TOKEN'] }, undefined, undefined, ctx);
        const cleared = JSON.parse(unavailable.content[0].text);
        if (!cleared.error) throw new Error('Clear did not remove the token');
        message('/secret clear\nBUILD_TOKEN is no longer available.');
        writeFileSync('verification.json', JSON.stringify({ unauthenticated: 401, authenticated: 200, requests: authenticated, assertions, clipboardActions: 0, cleared: true }));
        await wait(3200);
      } finally {
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        ctx.shutdown();
      }
    },
  });
}
