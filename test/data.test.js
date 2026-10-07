/* Checks that Bullsy serves exactly what is in the data files, and nothing else.
   Runs on the real files in data/. No network, no API, no login details. */
import { spawn } from 'node:child_process'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { parseCsv, parseDate } from '../server/marketData/providers/dataset.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), dataDir = path.join(root, 'data'), sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, failed = 0; const ok = (c, n, x = '') => { c ? pass++ : failed++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
const AUTH = { Authorization: 'Basic ' + Buffer.from('admin:pw').toString('base64') }, day = ms => new Date(ms + 19800000).toISOString().slice(0, 10);
const get = async (port, p, headers = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { headers }); const text = await r.text(); let body = null; try { body = JSON.parse(text); } catch {} return { status: r.status, headers: r.headers, text, body }; };
function bullsy(port, env = {}) { const child = spawn(process.execPath, ['server/index.js'], { cwd: root, env: { PATH: process.env.PATH, BULLSY_SKIP_ENV_FILE: '1', PORT: String(port), ADMIN_PASSWORD: 'pw', FRONTEND_ORIGIN: 'https://bullsy.example', ...env } });
  let logs = ''; child.stdout.on('data', d => logs += d); child.stderr.on('data', d => logs += d); return { stop: () => new Promise(r => { child.on('exit', r); child.kill(); }), logs: () => logs }; }
/* an independent, deliberately simple reading of the exchange CSV, to compare the server against */
const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
const rawRows = id => fs.readFileSync(path.join(dataDir, id + '.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map(l => { const f = l.split(','), [d, m, y] = f[0].split('-'); return { date: `${y}-${MON[m]}-${d}`, o: +f[1], h: +f[2], l: +f[3], c: +f[4] }; }).sort((a, b) => a.date < b.date ? -1 : 1);
const IDS = ['NIFTY50', 'NIFTY100', 'NIFTYBANK', 'NIFTYAUTO', 'NIFTYPHARMA'];

/* 1. reading files */
ok(parseDate('06-OCT-2026') === '2026-10-06' && parseDate('6 October 2026') === '2026-10-06' && parseDate('2026-10-06') === '2026-10-06' && parseDate('10/05/2026') === null && parseDate('06-Oct-26') === null, 'dates are read only when unambiguous (day-month name-year or year-month-day)');
{ const r = parseCsv('﻿Date ,Open ,High ,Low ,Close ,Shares Traded ,Turnover\n06-OCT-2026,22603.25,22776.1,22561.6,22776.1,328807304,28097.24\n05-OCT-2026,"22,532.40",22621.8,22397.1,22555.75,-,1\nbad row,1,2,3,4,5,6\n');
  ok(r.candles.length === 2 && r.skipped === 1 && r.candles[0].c === 22776.1 && r.candles[1].o === 22532.4 && r.candles[1].v === null && day(r.candles[0].t) === '2026-10-06', 'a CSV row is read exactly as written; an unreadable row is skipped and counted, never repaired');
  let msg = ''; try { parseCsv('Year,Open,High,Low,Close\n2026,85255.55,85883.50,71292.88,73067.81\n'); } catch (e) { msg = e.message; }
  ok(/needs daily rows with Date/.test(msg), 'a yearly summary file (one row per year) is refused: daily rows are required'); }

/* 2. the server on the real files */
{
  const app = bullsy(4771); await sleep(1500);
  const cfg = (await get(4771, '/api/market/config')).body, q = (await get(4771, '/api/market/quotes')).body;
  ok(cfg.indices.map(i => i.id).join() === IDS.join() && cfg.dataset.from === '2025-10-07' && cfg.dataset.to === '2026-10-06', 'the 5 indices with data files are offered, covering 7 Oct 2025 to 6 Oct 2026', JSON.stringify(cfg.dataset));
  let exact = true, rows = 0;
  for (const id of IDS) { const raw = rawRows(id), got = (await get(4771, `/api/market/history/${id}?range=REPLAY`)).body.candles; rows += got.length;
    if (got.length !== raw.length || got.some((c, i) => day(c.t) !== raw[i].date || c.o !== raw[i].o || c.h !== raw[i].h || c.l !== raw[i].l || c.c !== raw[i].c)) { exact = false; ok(false, id + ' history differs from its file'); }
    const v = q.quotes[id], last = raw.at(-1), prev = raw.at(-2);
    if (!(v.status === 'HISTORICAL' && v.price === last.c && v.prevClose === prev.c && v.open === last.o && v.high === last.h && v.low === last.l && Math.abs(v.changePct - (last.c / prev.c - 1) * 100) < 1e-9)) { exact = false; ok(false, id + ' card values differ from its file', JSON.stringify(v)); } }
  ok(exact && rows === 247 * 5, `every one of the ${rows} daily values served matches the CSV files exactly (open, high, low, close, date)`);
  ok(q.market.label === 'HISTORICAL' && Object.keys(q.quotes).length === 5, 'data is labelled as past data, never LIVE or DELAYED');
  const n = {}; for (const r of ['1M', '3M', '6M', '1Y']) { const h = (await get(4771, `/api/market/history/NIFTYBANK?range=${r}`)).body.candles; n[r] = h.length; if (day(h.at(-1).t) !== '2026-10-06') ok(false, r + ' should end on the last data day'); }
  ok(n['1M'] < n['3M'] && n['3M'] < n['6M'] && n['6M'] < n['1Y'] && n['1Y'] === 247, 'date ranges return different amounts of data, all ending on the last data day', JSON.stringify(n));
  ok((await get(4771, '/api/market/history/SENSEX?range=1M')).status === 400 && (await get(4771, '/api/market/history/NIFTY50?range=9Y')).status === 400, 'an index without a data file, or an unknown range, is rejected');
  let pub = ''; for (const p of ['/api/health', '/', '/config.js', '/js/sound.js', '/js/world3d.js', '/js/market.js', '/js/game.js']) { const r = await get(4771, p); ok(r.status === 200, 'public ' + p); pub += r.text; }
  ok(!/ADMIN_PASSWORD|ANTHROPIC_API_KEY|api[_-]?key/i.test(pub), 'no secret names in anything a player can load');
  ok((await get(4771, '/server/config.js')).status === 404 && (await get(4771, '/.env')).status === 404 && (await get(4771, '/data/NIFTY50.csv')).status === 404 && (await get(4771, '/..%2fdata%2fNIFTY50.csv')).status === 404, 'server files, settings and raw data files are not served directly');
  ok((await get(4771, '/api/market/quotes', { Origin: 'https://evil.example' })).status === 403 && (await get(4771, '/api/market/quotes', { Origin: 'https://bullsy.example' })).headers.get('access-control-allow-origin') === 'https://bullsy.example', 'only the configured frontend site may call the API from another address');
  ok((await get(4771, '/admin')).status === 401 && (await get(4771, '/admin', { Authorization: 'Basic ' + Buffer.from('a:wrong').toString('base64') })).status === 401, 'admin needs the right password');
  const adm = await get(4771, '/admin', AUTH); ok(adm.status === 200 && /Market data: <span class="ok">LOADED/.test(adm.text) && /SENSEX<\/td><td class="bad">not shown/.test(adm.text) && /No market-data API is called/.test(adm.text), 'admin page shows the loaded files and that SENSEX has none');
  ok((await fetch('http://127.0.0.1:4771/api/coach', { method: 'POST', body: '{}' })).status === 501, 'AI coach is off without its key');
  ok(/5 indices loaded from data\//.test(app.logs()) && /No market-data API is called/.test(app.logs()), 'the server log lists the loaded files');
  await app.stop();
}
/* 3. other data folders */
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bullsy-data-'));
  for (const id of IDS) { const lines = fs.readFileSync(path.join(dataDir, id + '.csv'), 'utf8').trim().split(/\r?\n/); fs.writeFileSync(path.join(dir, id + '.csv'), [lines[0], ...lines.slice(61)].join('\n')); }   // drop the newest 60 days
  fs.copyFileSync(path.join(dir, 'NIFTY50.csv'), path.join(dir, 'SENSEX.csv'));                       // stands in for a daily SENSEX file
  const app = bullsy(4772, { DATA_DIR: dir }); await sleep(1500);
  const cfg = (await get(4772, '/api/market/config')).body, m = (await get(4772, '/api/market/history/NIFTYAUTO?range=1M')).body.candles;
  ok(cfg.indices.some(i => i.id === 'SENSEX') && cfg.indices.length === 6, 'adding a daily SENSEX.csv makes SENSEX appear, with no code change');
  ok(m.length >= 18 && day(m.at(-1).t) === cfg.dataset.to && cfg.dataset.to < '2026-08-01', `data that ends earlier (${cfg.dataset.to}) still gives a full last month: ranges count back from the data's last day, not today's date`);
  await app.stop();
  fs.writeFileSync(path.join(dir, 'SENSEX.csv'), 'Year,Open,High,Low,Close\n2026,85255.55,85883.50,71292.88,73067.81\n'); fs.writeFileSync(path.join(dir, 'NIFTYPHARMA.csv'), 'Date,Open,High,Low,Close\n');
  const app2 = bullsy(4773, { DATA_DIR: dir }); await sleep(1500);
  const cfg2 = (await get(4773, '/api/market/config')).body;
  ok(!cfg2.indices.some(i => i.id === 'SENSEX' || i.id === 'NIFTYPHARMA') && cfg2.indices.length === 4 && /SENSEX\.csv: needs daily rows/.test(app2.logs()) && /NIFTYPHARMA\.csv: no rows/.test(app2.logs()), 'an unusable file leaves that index off the site and is named in the log; the rest still work');
  await app2.stop();
  const app3 = bullsy(4774, { DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'bullsy-none-')) }); await sleep(1200);
  const c3 = (await get(4774, '/api/market/config')).body; ok(c3.indices.length === 0 && (await get(4774, '/')).status === 200 && /No usable data files/.test(app3.logs()), 'with no data files the site still starts and says data is unavailable; nothing is made up');
  await app3.stop();
}
/* 4. the code itself */
{
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const server = walk(path.join(root, 'server')), code = server.concat(walk(path.join(root, 'public')));
  ok(!server.some(f => /Math\.random|randn\(|simulate/i.test(fs.readFileSync(f, 'utf8'))), 'no random or generated prices anywhere in the server');
  const api = code.filter(f => /angelone|upstox|smartapi|lightweight-charts|tradingview/i.test(fs.readFileSync(f, 'utf8')));
  ok(api.length === 0, 'no market-data API or outside chart library is referenced by the site', api.map(f => path.relative(root, f)).join(', '));
  const rnd = fs.readFileSync(path.join(root, 'public/js/game.js'), 'utf8').split('\n').filter(l => /Math\.random\(\)/.test(l) && !/ pick = /.test(l));
  ok(rnd.length === 1 && /setup\.start === 'surprise'/.test(rnd[0]), 'in the game, chance is used only for mascot lines and for picking which real period a surprise game plays');
}
console.log(`\n${pass} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
