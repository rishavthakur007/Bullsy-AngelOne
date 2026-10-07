/* Server checks that are independent of the game: public API, access rules, admin sign-in,
   failure handling, and that no secrets or generated prices exist. Uses the Angel One test double. */
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { startAngelMock } from './mock-angel.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, failed = 0; const ok = (c, n, x = '') => { c ? pass++ : failed++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
const AUTH = { Authorization: 'Basic ' + Buffer.from('admin:pw').toString('base64') };
const get = async (port, p, headers = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { headers }); const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch {} return { status: r.status, headers: r.headers, text, body }; };
function bullsy(port, mockPort, env = {}) {
  const child = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { PATH: process.env.PATH, BULLSY_SKIP_ENV_FILE: '1', PORT: String(port), ANGEL_API_BASE: `http://127.0.0.1:${mockPort}`, ANGEL_API_KEY: 'KEY12345', ANGEL_CLIENT_CODE: 'A12345', ANGEL_PIN: '4321',
    ANGEL_TOTP_SECRET: 'JBSWY3DPEHPK3PXP', ADMIN_PASSWORD: 'pw', FRONTEND_ORIGIN: 'https://bullsy.example', RENDER_EXTERNAL_URL: 'https://bullsy-x.onrender.com', ...env } });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d);
  return { stop: () => new Promise(r => { child.on('exit', r); child.kill(); }), logs: () => logs };
}
{
  const mock = await startAngelMock({ port: 4871 }), app = bullsy(4771, 4871); await sleep(7000);
  let pub = ''; for (const p of ['/api/health', '/api/market/config', '/api/market/status', '/api/market/quotes', '/api/market/instruments', '/', '/config.js', '/js/sound.js', '/js/world3d.js', '/js/market.js', '/js/game.js']) { const r = await get(4771, p); ok(r.status === 200, 'public ' + p); pub += r.text; }
  ok(!/KEY12345|JBSWY3DPEHPK3PXP|A12345|ANGEL_|ANTHROPIC_API_KEY|ADMIN_PASSWORD|jwt-\d/.test(pub), 'no key, login detail, secret name or session token in anything a player can load');
  ok((await get(4771, '/server/config.js')).status === 404 && (await get(4771, '/.env')).status === 404 && (await get(4771, '/..%2f.env.example')).status === 404, 'server files and settings files are not served');
  const q = (await get(4771, '/api/market/quotes')).body; ok(q.market.label === 'DELAYED' && Object.keys(q.quotes).length === 8, 'default mode is delayed, with 8 indices');
  const seen = []; const ctl = new AbortController();
  fetch('http://127.0.0.1:4771/api/market/stream', { signal: ctl.signal }).then(async r => { const dec = new TextDecoder(); for await (const c of r.body) for (const l of dec.decode(c).split('\n')) if (l.startsWith('data: ')) seen.push(JSON.parse(l.slice(6))); }).catch(() => {});
  await sleep(1500); ctl.abort(); ok(seen.length >= 1 && seen[0].quotes.NIFTY50.price > 0, 'the update stream sends data to the browser');
  ok((await get(4771, '/api/market/history/NOPE?range=1M')).status === 400 && (await get(4771, '/api/market/history/NIFTY50?range=9Y')).status === 400, 'unknown index or range is rejected');
  ok((await get(4771, '/api/market/quotes', { Origin: 'https://evil.example' })).status === 403, 'another website cannot call the API');
  const fe = await get(4771, '/api/market/quotes', { Origin: 'https://bullsy.example' }); ok(fe.status === 200 && fe.headers.get('access-control-allow-origin') === 'https://bullsy.example', 'the configured frontend site can call the API');
  ok((await get(4771, '/admin')).status === 401 && (await get(4771, '/admin/status.json')).status === 401 && (await get(4771, '/admin', { Authorization: 'Basic ' + Buffer.from('a:wrong').toString('base64') })).status === 401, 'admin needs the right password');
  const adm = await get(4771, '/admin', AUTH); ok(adm.status === 200 && /CONNECTED/.test(adm.text) && (adm.text.match(/class="s DELAYED"/g) || []).length === 8, 'admin page lists the connection and all 8 indices');
  const forged = await fetch('http://127.0.0.1:4771/admin/relogin', { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'csrf=nope', redirect: 'manual' }); ok(forged.status === 403, 'the sign-in-again button rejects a forged request');
  const csrf = adm.text.match(/name="csrf" value="([0-9a-f]+)"/)[1], logins = mock.state.logins;
  const re = await fetch('http://127.0.0.1:4771/admin/relogin', { method: 'POST', headers: { ...AUTH, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'csrf=' + csrf, redirect: 'manual' });
  ok(re.status === 303 && /signedin/.test(re.headers.get('location')) && mock.state.logins === logins + 1, 'the sign-in-again button signs in afresh');
  ok((await fetch('http://127.0.0.1:4771/api/coach', { method: 'POST', body: '{}' })).status === 501, 'AI coach is off without its key');
  ok(/^Bullsy backend listening on port 4771/m.test(app.logs()), 'server uses the PORT it is given');
  await app.stop(); await mock.close();
}
{ /* provider unreachable */
  const app = bullsy(4772, 4899); await sleep(3500);
  const q = (await get(4772, '/api/market/quotes')), h = await get(4772, '/api/market/history/NIFTY50?range=1M');
  ok(Object.values(q.body.quotes).every(v => v.status === 'UNAVAILABLE' && v.price === null), 'provider unreachable: every index UNAVAILABLE, nothing invented');
  ok(h.status === 502 && /unavailable/i.test(h.body.error) && !/angel|ECONN/i.test(h.text + q.text), 'players get a plain "unavailable" message with no internals');
  ok((await get(4772, '/')).status === 200 && (await get(4772, '/api/health')).body.ok === true, 'the site and health check still respond');
  await app.stop();
}
{ /* static checks */
  const files = ['server/index.js', 'server/admin.js', 'server/config.js', 'server/marketData/service.js', 'server/marketData/marketHours.js', 'server/marketData/providers/angelone.js', 'server/marketData/providers/totp.js', 'public/js/market.js'];
  const hits = files.filter(f => /Math\.random|randn\(|simulate|mock/i.test(fs.readFileSync(path.join(root, f), 'utf8')));
  ok(hits.length === 0, 'no random, generated or stand-in prices in the market-data code', hits.join(', '));
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.name === 'node_modules' || e.name === '.git' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const upstox = walk(root).filter(f => !f.includes(path.join('test', 'server.test.js')) && /upstox/i.test(fs.readFileSync(f, 'utf8')));
  ok(upstox.length === 0, 'nothing in the project refers to Upstox any more', upstox.map(f => path.relative(root, f)).join(', '));
}
console.log(`\n${pass} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
