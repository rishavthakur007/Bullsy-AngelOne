/* Browser playthrough on the real data files in data/. Needs Playwright (optional).
   Set SHOTS=<folder> to save screenshots. */
import { spawn } from 'node:child_process'; import path from 'node:path'; import { fileURLToPath } from 'node:url'; import { createRequire } from 'node:module';
const require = createRequire(import.meta.url); const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), sleep = ms => new Promise(r => setTimeout(r, ms)), shots = process.env.SHOTS;
let pass = 0, failed = 0; const ok = (c, n, x = '') => { c ? pass++ : failed++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
/* a plain file server, exactly like Netlify: no Bullsy server, no API */
const app = spawn('python3', ['-m', 'http.server', '4710', '--bind', '127.0.0.1', '--directory', path.join(root, 'public')]); await sleep(1500);
const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errs = [], bad = [], outside = []; page.on('pageerror', e => errs.push(e.message));
page.on('request', r => { if (r.url().includes('/api/')) bad.push('API call: ' + r.url()); });
page.on('request', r => { const h = new URL(r.url()).hostname; if (h !== '127.0.0.1') outside.push(h); });
const shot = async (name, sel) => { if (!shots) return; if (sel) await page.locator(sel).first().screenshot({ path: path.join(shots, name + '.png') }); else await page.screenshot({ path: path.join(shots, name + '.png'), fullPage: true }); };
const view = () => page.evaluate(() => ({ ...Chart.view(), days: Chart.days(), sum: document.querySelector('.chartsum').textContent, note: document.querySelector('.chartnote').textContent, on: [...document.querySelectorAll('[data-range].on')].map(b => b.dataset.range), candles: document.querySelectorAll('.cv svg rect[fill^="var(--"]').length }));

/* ---- home page ---- */
await page.goto('http://127.0.0.1:4710/'); await page.waitForSelector('.pcard'); await sleep(1200);
const names = await page.$$eval('.pc-name', e => e.map(x => x.textContent.replace(/^\S+\s/, '')));
ok(names.join('|') === 'NIFTY 50|NIFTY 100|NIFTY BANK|NIFTY AUTO|NIFTY PHARMA', 'the site lists exactly the 5 indices that have data', names.join('|'));
ok((await page.textContent('[data-sel=NIFTY50] .pc-val')) === '22,776.10' && (await page.textContent('[data-sel=NIFTYPHARMA] .pc-val')) === '26,549.60', 'cards show the last real close from the files (NIFTY 50 22,776.10 on 6 Oct 2026)');
const banner = await page.textContent('.banner');
ok(/REAL PAST MARKET DATA/.test(banner) && /7 Oct.* 2025/.test(banner) && /6 Oct.* 2026/.test(banner), 'banner says real past data, 7 Oct 2025 to 6 Oct 2026', banner);
ok(await page.locator('[data-set=mode]').count() === 0 && await page.locator('.pcard .spark').count() === 5, 'no live-market option; every card has a mini chart');
await shot('1-home');

/* ---- start a game on the latest period ---- */
await page.click('[data-act=start]'); await page.waitForSelector('.cv svg');
let v = await view(); const total = await page.evaluate(() => Market.state.replay.dates.length);
ok(total === 247 && v.days === total - 8 && v.on[0] === '3M' && /^Showing 63 trading days/.test(v.sum), `the chart holds every real day up to the game day (${v.days} of ${total}; the 8 days still to be played are hidden)`, JSON.stringify(v));
const seen = {};
for (const r of ['1W', '1M', '3M', '6M', 'All']) { await page.click(`[data-range="${r}"]`); await sleep(60); seen[r] = await view(); await shot('2-chart-' + r, '#chartbox'); }
const want = { '1W': 5, '1M': 21, '3M': 63, '6M': 126, All: v.days };
ok(Object.keys(want).every(r => Math.round(seen[r].count) === want[r] && seen[r].bounds[1] === v.days - 1 && seen[r].on[0] === r && seen[r].sum.startsWith(`Showing ${want[r]} trading days`)), '1W, 1M, 3M, 6M and All show 5, 21, 63, 126 and all days, each ending on the game day');
ok(new Set(Object.values(seen).map(s => s.sum)).size === 5 && seen['1W'].candles < seen['1M'].candles && seen['1M'].candles < seen['6M'].candles && seen['6M'].candles < seen.All.candles, 'each range draws a different number of candles and a different summary');
const truth = await page.evaluate(() => { const d = Market.series(S.sel), a = d[d.length - 21], b = d.at(-1); return 'Showing 21 trading days: ' + pct((b.c / a.o - 1) * 100); });
ok(seen['1M'].sum.startsWith(truth), '1M summary equals the real change over those 21 days', seen['1M'].sum + ' vs ' + truth);

/* ---- moving the chart ---- */
await page.click('[data-range="1M"]'); const box = await page.locator('.cv').boundingBox();
await page.mouse.move(box.x + 200, box.y + 120); await page.mouse.down(); await page.mouse.move(box.x + 500, box.y + 120, { steps: 6 }); await page.mouse.up(); await sleep(120);
let p = await view();
ok(Math.round(p.count) === 21 && p.bounds[1] < v.days - 1 && p.on.length === 0 && /later days? (is|are) to the right/.test(p.note), `dragging slides the chart back in time (now ending ${v.days - 1 - p.bounds[1]} days earlier)`, JSON.stringify(p));
await shot('3-chart-dragged', '#chartbox');
await page.mouse.move(box.x + 300, box.y + 120); await page.mouse.wheel(0, 300); await sleep(120); const out = await view();
await page.mouse.wheel(0, -600); await sleep(120); const inn = await view();
ok(out.count > p.count + 5 && inn.count < out.count - 5, `scrolling zooms out and in (${Math.round(p.count)} to ${Math.round(out.count)} to ${Math.round(inn.count)} days)`);
await page.click('[data-act=czout]'); await sleep(60); const zo = await view(); await page.click('[data-act=czin]'); await sleep(60); const zi = await view();
ok(zo.count > inn.count && zi.count < zo.count, 'the + and − buttons zoom too');
await page.locator('.cv').focus(); await page.keyboard.press('ArrowLeft'); await sleep(60); const kb = await view();
ok(kb.start < zi.start || zi.start === 0, 'arrow keys move the chart');
await page.mouse.move(box.x + 250, box.y + 100); await sleep(80);
const read = await page.textContent('.chartread'); ok(/\d{4}: open [\d,.]+, high [\d,.]+, low [\d,.]+, close [\d,.]+/.test(read), 'pointing at a day shows its real open, high, low and close', read);
for (let i = 0; i < 30; i++) await page.keyboard.press('ArrowRight');
const far = await view(); ok(far.bounds[1] === v.days - 1, 'the chart cannot be moved past the game day (no peeking at later days)');
await page.click('[data-range="3M"]'); await page.click('[data-sel=NIFTYPHARMA]'); await sleep(100); const ph = await view();
ok(ph.sum !== seen['3M'].sum && /Showing 63/.test(ph.sum) && (await page.textContent('#selhead')).includes('NIFTY PHARMA'), 'choosing another index loads that index into the chart');

/* ---- trading and rounds on real moves ---- */
await page.click('[data-sel=NIFTYBANK]'); await page.fill('#amt', '20000'); await page.click('[data-act=long]');
await page.click('[data-sel=NIFTYPHARMA]'); await page.fill('#amt', '20000'); await page.click('[data-act=short]');
await page.click('[data-sel=NIFTY100]'); await page.click('[data-act=q-long]'); await page.click('[data-sel=NIFTYAUTO]'); await page.click('[data-act=q-long]');
const before = await page.evaluate(() => ({ bk: Market.price('NIFTYBANK'), ph: Market.price('NIFTYPHARMA'), posBk: position('NIFTYBANK'), posPh: position('NIFTYPHARMA'), tot: total(), date: Market.replayDate() }));
ok(Math.abs(before.tot - 100000) < 0.01 && before.date === '2026-09-23', 'the latest game starts on 23 Sep 2026, 8 trading days before the data ends', before.date);
await page.click('[data-act=hint]'); await page.click('[data-act=up]'); await sleep(250);
const after = await page.evaluate(() => ({ bk: Market.price('NIFTYBANK'), ph: Market.price('NIFTYPHARMA'), posBk: position('NIFTYBANK'), posPh: position('NIFTYPHARMA'), date: Market.replayDate(), days: Chart.days(), recap: S.recap }));
ok(after.date === '2026-09-24' && after.days === v.days + 1, 'a round moves to the next real trading day and the chart gains that day');
ok(Math.abs(after.posBk.pnl - (after.bk - before.bk) * before.posBk.qty) < 0.01, 'LONG P&L = (current − entry) × units, from the real move');
ok(Math.abs(after.posPh.pnl - (before.ph - after.ph) * before.posPh.qty) < 0.01, 'SHORT P&L = (entry − current) × units, from the real move');
const race = await page.evaluate(() => { const r = Market.state.replay, a = r.dates[r.cursor - 1], b = r.dates[r.cursor]; const real = SECTORS().map(s => ({ id: s.id, ret: (r.series[s.id].get(b).c / r.series[s.id].get(a).c - 1) * 100 })).sort((x, y) => y.ret - x.ret); return { real: real[0].id, shown: S.recap.secs[0].id, n: S.recap.secs.length }; });
ok(race.real === race.shown && race.n === 3, 'Sector Race ranks BANK, AUTO and PHARMA by their real move');
const nw = await page.evaluate(() => { const r = S.recap, c = Market.series('NIFTY50').map(x => x.c), real = (c.at(-1) / c.at(-2) - 1) * 100;
  return { pop: document.querySelector('.newspop .np-title')?.textContent || '', want: 'NIFTY 50 ' + (real >= 0 ? 'rises ' : 'falls ') + Math.abs(real).toFixed(2) + '%', n: r.news.length, list: document.querySelectorAll('.flashes li').length, said: spoken.join(' | '), close: c.at(-1).toLocaleString('en-IN', { minimumFractionDigits: 2 }), body: document.querySelector('.newspop .np-body')?.textContent || '' }; });
ok(nw.pop.startsWith(nw.want) && nw.body.includes(nw.close) && nw.n >= 2 && nw.list === nw.n, `a news pop-up appears after the round, built from the real move ("${nw.pop}. ${nw.body}"), with ${nw.n} flashes listed`, JSON.stringify(nw));
ok(nw.said.includes(nw.want), 'the voice-over reads the flash aloud');
await page.click('[data-news="next"]'); const pop2 = await page.textContent('.newspop .np-title');
await page.click('[data-act="voice"]'); const off = await page.evaluate(() => { const n = spoken.length; speak('x'); return spoken.length === n && document.querySelector('[data-act="voice"]').textContent; });
await page.click('[data-act="voice"]'); await page.click('[data-news="close"]');
ok(pop2 !== nw.pop && off === 'Voice off' && !(await page.$('.newspop')), `Next shows the following flash ("${pop2}"); Voice off silences it; the pop-up can be closed`);
await shot('4-play');
for (let i = 0; i < 7; i++) { await page.click(i % 2 ? '[data-act=up]' : '[data-act=down]'); await sleep(120); }
await page.waitForSelector('.rank');
const fin = await page.evaluate(() => ({ idx: S.final.idx, expect: setup.budget * Market.price('NIFTY50') / S.startPx.NIFTY50, end: Market.replayDate(), rounds: S.log.rounds.length, xp: S.xp, tip: S.final.review.tips[0] }));
ok(fin.end === '2026-10-06' && fin.rounds === 8 && Math.abs(fin.idx - fin.expect) < 0.01 && fin.xp > 0, 'after 8 rounds the game ends on 6 Oct 2026, scored against real NIFTY 50');
console.log('   coach:', fin.tip);
await shot('5-result');

/* ---- other start options ---- */
await page.click('[data-act=reset]'); await page.click('[data-set=pace][data-val=month]'); await page.click('[data-set=start][data-val=surprise]'); await page.click('[data-act=start]'); await page.waitForSelector('.cv svg');
const sur = await page.evaluate(() => { const r = Market.state.replay; return { cursor: r.cursor, left: r.dates.length - 1 - r.cursor, off: [...document.querySelectorAll('[data-range][disabled]')].map(b => b.dataset.range), days: Chart.days() }; });
ok(sur.cursor >= 21 && sur.left >= 168 && sur.off.every(r => RANGE(r) > sur.days), `a month-by-month surprise game fits inside the year (day ${sur.cursor + 1}, ${sur.left} days left); ranges longer than the history so far are switched off: ${sur.off.join(', ') || 'none'}`);
function RANGE(r) { return { '1W': 5, '1M': 21, '3M': 63, '6M': 126 }[r]; }
ok(errs.length === 0 && bad.length === 0, 'no page errors or failed requests', errs.concat(bad).join(' | '));
ok(!outside.some(h => /jsdelivr|tradingview|angel|upstox/.test(h)), 'no chart library or market-data API is contacted', [...new Set(outside)].join(', '));
await browser.close(); app.kill();
console.log(`\n${pass} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
