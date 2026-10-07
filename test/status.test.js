/* When may a quote be called LIVE? Checked with a recording stand-in provider that reports
   the market open, so the result does not depend on the time of day the test is run. */
import { MarketDataService } from '../server/marketData/service.js';
import { INDEX_IDS } from '../server/marketData/indices.js';
let pass = 0, failed = 0; const ok = (c, n, x = '') => { c ? pass++ : failed++; console.log(`${c ? 'PASS' : 'FAIL'}  ${n}${c ? '' : '  ' + x}`); };
const quiet = { info() {}, warn() {}, error() {} }, cfg = d => ({ delayDays: d, freshMs: 120000, pollMs: 2000 });
function provider({ segment, age = 0, fail = false }) {
  const quote = () => Object.fromEntries(INDEX_IDS.map(id => [id, { price: 100.5, prevClose: 100, open: 100, high: 101, low: 99.5, ts: Date.now() - age }]));
  return { name: 'fake', instruments: Object.fromEntries(INDEX_IDS.map(id => [id, { key: id, verified: true }])), async resolveInstruments() {},
    async fetchQuotes() { if (fail) throw Object.assign(new Error('provider refused'), { auth: true }); return quote(); }, async fetchCandles() { return []; }, async fetchIntraday() { return []; },
    ...(fail ? {} : { startStream(ids, h) { this.h = h; h.onState('open'); h.onSegments({ NSE_INDEX: segment, BSE_INDEX: segment }); }, stopStream() {} }) };
}
async function run(opts, delay = 0) { const p = provider(opts), s = new MarketDataService(p, cfg(delay), quiet); await s.start(); const out = { q: s.getMultipleIndexQuotes(), m: s.getMarketStatus(), s, p }; s.stop(); return out; }

let r = await run({ segment: 'NORMAL_OPEN' });
ok(INDEX_IDS.every(id => r.q[id].status === 'LIVE') && r.m.label === 'LIVE', 'market open + fresh provider timestamp = LIVE');
ok(Math.abs(r.q.NIFTY50.changePct - 0.5) < 1e-9 && r.q.NIFTY50.change === 0.5, 'change and change % are computed from price and previous close');
r = await run({ segment: 'NORMAL_OPEN', age: 10 * 60000 });
ok(INDEX_IDS.every(id => r.q[id].status === 'DELAYED'), 'market open but the last update is 10 minutes old = DELAYED, not LIVE');
r = await run({ segment: 'NORMAL_OPEN', age: 3 * 86400000 });
ok(INDEX_IDS.every(id => r.q[id].status === 'CLOSED'), 'market hours but no trades dated today (holiday) = MARKET CLOSED');
r = await run({ segment: 'NORMAL_CLOSE' });
ok(INDEX_IDS.every(id => r.q[id].status === 'CLOSED') && r.m.label === 'CLOSED', 'provider reports the market closed = MARKET CLOSED even with a fresh value');
r = await run({ segment: 'NORMAL_OPEN', fail: true });
ok(INDEX_IDS.every(id => r.q[id].status === 'UNAVAILABLE' && r.q[id].price === null) && r.m.label === 'UNAVAILABLE' && r.m.feed.authError, 'provider failing = DATA UNAVAILABLE with no value');
/* a feed that breaks after delivering: last value kept, marked unavailable */
{ const p = provider({ segment: 'NORMAL_OPEN' }), s = new MarketDataService(p, cfg(0), quiet); await s.start(); p.h.onState('error', new Error('feed dropped'));
  const q = s.getIndexQuote('NIFTY50'); s.stop(); ok(q.status === 'UNAVAILABLE' && q.price === 100.5 && /last value/i.test(q.note), 'feed breaks mid-session = last genuine value kept, labelled UNAVAILABLE, not LIVE'); }
console.log(`\n${pass} passed, ${failed} failed`); process.exit(failed ? 1 : 0);
