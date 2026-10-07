/* Bullsy market data. Every screen (Market Pulse, chart, 3D market, trading,
   missions, scoring, coach) reads prices from here and nowhere else.

   The data is one static file, data.json: real daily index values copied from
   the CSV files in data/. There is no server call, no API and no login.

   Two views of the same data:
     HOME   - the latest day in the data
     REPLAY - a game moving day by day through the data; days after the game's
              current day are never handed out

   Nothing in this file creates, smooths or estimates a price. */
const Market = (() => {
  const st = { cfg: null, mode: 'live', market: null, connected: false, error: null, replay: null, all: {} };
  const subs = new Set();
  const notify = what => subs.forEach(fn => { try { fn(what); } catch (e) { console.error(e); } });
  const istDay = ms => new Date(ms + 19800000).toISOString().slice(0, 10);

  async function init() {
    const res = await fetch('data.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('data.json could not be loaded');
    const json = await res.json();
    for (const [id, rows] of Object.entries(json.candles)) st.all[id] = rows.map(r => ({ t: Date.parse(r[0] + 'T00:00:00+05:30'), o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
    /* coach: only when the site is run with the optional Bullsy server and an AI key (see config.js) */
    st.cfg = { indices: json.indices.filter(i => st.all[i.id] && st.all[i.id].length), dataset: json.dataset, coach: window.BULLSY_COACH === true, delayDays: 1 };
    st.market = { label: 'HISTORICAL', delayDays: 1 }; st.connected = true;
    return st.cfg;
  }
  const meta = id => st.cfg.indices.find(i => i.id === id);
  function useLive() { st.mode = 'live'; st.replay = null; notify('mode'); }

  /* ---------------- replay ---------------- */
  /* Keeps only the trading days that every index has, so all indices move on the same real days. */
  async function loadReplay() {
    const series = {};
    for (const i of st.cfg.indices) series[i.id] = new Map(st.all[i.id].map(c => [istDay(c.t), c]));
    if (!series.NIFTY50) throw new Error('NIFTY 50 data is missing, so a game cannot start.');
    let dates = [...series.NIFTY50.keys()];
    for (const id of Object.keys(series)) dates = dates.filter(d => series[id].has(d));
    dates.sort();
    if (dates.length < 30) throw new Error('There is not enough data for a game.');
    return { series, dates, failed: [], cursor: dates.length - 1, start: dates.length - 1 };
  }
  function useReplay(rp, startIndex) { rp.cursor = rp.start = startIndex; st.replay = rp; st.mode = 'replay'; notify('mode'); }
  function step(n) { const r = st.replay; if (!r || r.cursor + n > r.dates.length - 1) return false; r.cursor += n; notify('quotes'); return true; }

  /* a quote is one real daily candle plus the close of the real day before it */
  function asQuote(id, c, p, status) {
    const change = p ? c.c - p.c : null;
    return { ...meta(id), status, price: c.c, prevClose: p ? p.c : null, open: c.o, high: c.h, low: c.l, volume: c.v, change, changePct: p ? change / p.c * 100 : null,
      ts: Date.parse(istDay(c.t) + 'T15:30:00+05:30'), date: istDay(c.t) };
  }
  function quote(id) {
    const m = meta(id); if (!m) return { id, status: 'UNAVAILABLE', price: null };
    if (st.mode === 'replay' && st.replay) { const r = st.replay, s = r.series[id]; return asQuote(id, s.get(r.dates[r.cursor]), r.cursor > 0 ? s.get(r.dates[r.cursor - 1]) : null, 'REPLAY'); }
    const a = st.all[id]; return asQuote(id, a.at(-1), a.at(-2) || null, 'HISTORICAL');
  }
  const price = id => { const q = quote(id); return q && q.price > 0 ? q.price : null; };
  const tradable = id => { const q = quote(id); return q.price > 0 && q.status !== 'UNAVAILABLE'; };
  const replayDate = () => (st.replay ? st.replay.dates[st.replay.cursor] : null);

  /* Every real daily candle for an index from the start of the data up to the game's current day. Later days are never returned. */
  function series(id) { const r = st.replay, s = r && r.series[id]; return st.mode === 'replay' && s ? r.dates.slice(0, r.cursor + 1).map(d => s.get(d)) : []; }
  /* The last 20 real closes, for the small card charts. */
  function spark(id) {
    if (st.mode === 'replay' && st.replay) { const r = st.replay, s = r.series[id]; return s ? r.dates.slice(Math.max(0, r.cursor - 19), r.cursor + 1).map(d => s.get(d).c) : []; }
    return (st.all[id] || []).slice(-20).map(c => c.c);
  }

  /* Overall data label shown in the banner. This data is never live. */
  function label() {
    if (st.mode === 'replay') return { key: 'REPLAY', emoji: '🔵', text: 'HISTORICAL MARKET REPLAY' };
    return st.cfg ? { key: 'HISTORICAL', emoji: '🔵', text: 'REAL PAST MARKET DATA' } : { key: 'UNAVAILABLE', emoji: '⚠️', text: 'MARKET DATA UNAVAILABLE' };
  }

  return { api: String(window.BULLSY_API_BASE || '').replace(/\/$/, ''), init, state: st, on: fn => { subs.add(fn); return () => subs.delete(fn); }, useLive, loadReplay, useReplay, step, quote, price, tradable, replayDate, series, spark, label, istDay };
})();
