/* Bullsy game. All prices come from Market (public/js/market.js).
   This file contains no price generation: a round's result is the difference
   between two genuine prices. Math.random appears only in pick() for mascot
   lines and in the optional "Surprise me" choice of which real dates to replay. */

/* ================= Constants ================= */
const ROUNDS = 8, FD_RATE = 0.065, XP_STEP = 300;
const LEVELS = ['Calf', 'Young bull', 'Street bull', 'Raging bull', 'Bullsy legend'];
const COLORS = { NIFTY50: 0x0E5A40, SENSEX: 0xC2410C, NIFTY100: 0x1E88A8, NIFTYBANK: 0x3B5BDB, NIFTYAUTO: 0xD9822B, NIFTYPHARMA: 0x8E4EC6 };
const PACES = { day: { steps: 1, unit: 'trading day', perPct: 1 }, week: { steps: 5, unit: 'week', perPct: .5 }, month: { steps: 21, unit: 'month', perPct: .3 } };
const MISSIONS = {
  watcher: { n: 'Market Watcher', d: 'Call the real direction of NIFTY 50 right 3 times in a row' },
  hunter: { n: 'Sector Hunter', d: 'Be long the sector that really wins a round' },
  bull: { n: 'Bull Run', d: 'Profit on a long from a real rise' },
  bear: { n: 'Bear Attack', d: 'Profit on a short from a real fall' },
  master: { n: 'Market Master', d: 'Hold positions in 4 or more indices at once' },
  index: { n: 'Beat the market', d: 'Finish above NIFTY 50' }
};
const CHIP = { LIVE: '🟢 LIVE', DELAYED: '🟡 DELAYED', CLOSED: '🔴 MARKET CLOSED', UNAVAILABLE: '⚠️ DATA UNAVAILABLE', REPLAY: '🔵 REPLAY', HISTORICAL: '🔵 PAST DATA' };
const QUIPS = {
  hello: ['Moo! I am Bullsy. These are the real Indian indices. Set up your game below.'],
  start: ['Real indices, one brave calf. Tap a tower and take a position!'],
  long: ['Long it is. Horns up!', 'Into the basket it goes.'],
  short: ['Betting on a fall? My bear cousin approves.', 'Short and spicy. Watch it closely.'],
  close: ['Position closed. Cash smells nice too.'],
  wait: ['The clock is running on the real market. No peeking into the future!'],
  level: ['Level up! Look at you grow.'],
  end: ['What a ride. Scroll down for your report card.']
};

/* ================= Helpers ================= */
const inr = n => (n < 0 ? '-' : '') + '₹' + Math.round(Math.abs(n)).toLocaleString('en-IN');
const lvl2 = n => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = n => (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
const cls = n => (n >= 0 ? 'up' : 'down');
const pick = a => a[Math.floor(Math.random() * a.length)];
const css = n => '#' + n.toString(16).padStart(6, '0');
const istTime = ms => new Date(ms).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false }) + ' IST';
const niceDate = d => new Date(d + 'T00:00:00+05:30').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
function say(t) { const b = $('#bubble'); b.textContent = t; b.hidden = false; b.classList.remove('wob'); void b.offsetWidth; b.classList.add('wob'); speak(t, true); }

/* ================= State ================= */
let setup = { budget: 100000, mode: 'replay', pace: 'day', start: 'recent', startDate: '', liveMin: 5, fav: 'NIFTYBANK' };
let S = null, RP = null, boot = { ready: false, error: null }, busy = false, setupErr = '';
const IDX = () => Market.state.cfg.indices;
const SECTORS = () => IDX().filter(i => i.group === 'sector');
const meta = id => IDX().find(i => i.id === id);
/* current genuine price; if a feed gap leaves none, the last genuine one seen is used for valuing only */
function px(id) { const p = Market.price(id); if (p != null) { if (S) S.lastPx[id] = p; return p; } return S ? S.lastPx[id] ?? null : null; }
const units = id => S.hold[id] || 0;
const invested = () => Object.keys(S.hold).reduce((t, id) => t + S.hold[id] * (px(id) || 0), 0);
const total = () => S.cash + invested();
const shortVal = () => Object.keys(S.hold).reduce((t, id) => t + (S.hold[id] < 0 ? -S.hold[id] * (px(id) || 0) : 0), 0);
/* a short locks its sale money plus the same again as a deposit, so it uses free cash just like a long */
const free = () => S.cash - 2 * shortVal();
const level = () => Math.min(LEVELS.length, 1 + Math.floor(S.xp / XP_STEP));
const stamp = () => (S.mode === 'replay' ? Market.replayDate() : new Date().toISOString());
const stampText = s => (S.mode === 'replay' ? niceDate(s) : istTime(Date.parse(s)));

/* LONG P&L = (current - entry) x units.  SHORT P&L = (entry - current) x units. */
function position(id) {
  const u = units(id); if (!u) return null;
  const qty = Math.abs(u), entry = Math.abs(S.cost[id]) / qty, current = px(id);
  return { id, name: meta(id).name, side: u > 0 ? 'LONG' : 'SHORT', qty, entry, current, value: qty * current,
    pnl: u > 0 ? (current - entry) * qty : (entry - current) * qty, movePct: (current / entry - 1) * 100 };
}

function addXP(n, why) {
  const before = level(); S.xp += n; toast('+' + n + ' XP  ' + why);
  if (level() > before) { toast('Level up: ' + LEVELS[level() - 1], true); sfx.level(); World.celebrate(); say(pick(QUIPS.level)); }
}
function done(key) { if (S.missions[key]) return; S.missions[key] = true; addXP(100, 'Mission: ' + MISSIONS[key].n); }
function flash(m) { S.msg = m; render(); }

/* ================= Starting a game ================= */
async function newGame() {
  if (busy) return; busy = true; setupErr = ''; render();
  try {
    if (setup.mode === 'replay') {
      RP = RP || await Market.loadReplay();
      /* a game needs a month of real history before it and room for its rounds after it */
      const step = PACES[setup.pace].steps, max = RP.dates.length - 1 - ROUNDS * step, min = 21;
      if (max < min) throw new Error('There is not enough real history for ' + ROUNDS + ' rounds at this pace. Choose a faster pace.');
      let start = max;
      if (setup.start === 'surprise') start = min + Math.floor(Math.random() * (max - min + 1));
      else if (setup.start === 'date' && setup.startDate) { const i = RP.dates.findIndex(d => d >= setup.startDate); start = Math.max(min, Math.min(max, i < 0 ? max : i)); }
      Market.useReplay(RP, start);
    } else {
      Market.useLive();
      if (Market.state.cfg.dataset) throw new Error('This game runs on saved past market data, so there are no live rounds. Play Historical replay.');
      if (Market.state.cfg.delayDays > 0) throw new Error('This server shows data one trading day late, so live rounds are switched off. Play Historical replay.');
      if (Market.price('NIFTY50') == null) throw new Error('Market data temporarily unavailable, so a live game cannot start. Try Historical replay.');
    }
  } catch (e) { busy = false; setupErr = e.message; Market.useLive(); render(); return; }
  busy = false;
  const startPx = {}; IDX().forEach(i => { startPx[i.id] = Market.price(i.id); });
  const first = meta(setup.fav) && Market.tradable(setup.fav) ? setup.fav : (IDX().find(i => Market.tradable(i.id)) || IDX()[0]).id;
  S = { phase: 'play', mode: setup.mode, round: 0, cash: setup.budget, hold: {}, cost: {}, sel: first, amt: Math.round(setup.budget / 10), range: Market.series(first).length >= 63 ? '3M' : 'All',
    startPx, lastPx: { ...startPx }, lastMove: {}, t0: Date.now(), d0: stamp0(), vHist: [setup.budget], iHist: [setup.budget], fHist: [setup.budget],
    pending: null, recap: null, msg: '', xp: 0, streak: 0, right: 0, scored: 0, hints: 2, shields: 1, hintOn: false, shieldOn: false, traded: false, usedShort: false, noRange: {},
    missions: { watcher: false, hunter: false, bull: false, bear: false, master: false, index: false },
    log: { cash: [], closed: [], rounds: [], touched: {} }, final: null, ai: null };
  World.storm(false); say(pick(QUIPS.start)); sfx.up();
  render(); World.focus(S.sel); Chart.show(S.sel, RANGES.includes(S.range) ? S.range : '3M'); window.scrollTo(0, 0);
}
function stamp0() { return setup.mode === 'replay' ? Market.replayDate() : new Date().toISOString(); }

/* ================= Trading ================= */
function canTrade(id, amount) {
  if (!Market.tradable(id)) { flash('There is no genuine price for ' + meta(id).name + ' right now, so it cannot be traded.'); return false; }
  if (amount !== undefined && !(amount >= 100)) { flash('Enter an amount of ₹100 or more.'); return false; }
  return true;
}
function opened(id) {
  S.log.touched[id] = true;
  if (!S.traded) { S.traded = true; addXP(20, 'First trade'); }
  if (Object.keys(S.hold).length >= 4) done('master');
}
function goLong(amount) {
  const id = S.sel; if (!canTrade(id, amount)) return;
  if (units(id) < 0) return flash('You are short ' + meta(id).name + '. Close the short before going long.');
  if (amount > free() + .01) return flash('Not enough free cash. You have ' + inr(Math.max(0, free())) + '.');
  const p = px(id); S.cash -= amount; S.hold[id] = units(id) + amount / p; S.cost[id] = (S.cost[id] || 0) + amount;
  sfx.buy(); World.coins(id); opened(id); say(pick(QUIPS.long));
  flash('Long ' + inr(amount) + ' of ' + meta(id).name + ' at ' + lvl2(p) + '.');
}
function goShort(amount) {
  const id = S.sel; if (!canTrade(id, amount)) return;
  if (units(id) > 0) return flash('You are long ' + meta(id).name + '. Close it before shorting.');
  if (amount > free() + .01) return flash('Not enough free cash. You have ' + inr(Math.max(0, free())) + '.');
  const p = px(id); S.cash += amount; S.hold[id] = units(id) - amount / p; S.cost[id] = (S.cost[id] || 0) - amount; S.usedShort = true;
  sfx.sell(); World.bearJump(); opened(id); say(pick(QUIPS.short));
  flash('Short ' + inr(amount) + ' of ' + meta(id).name + ' at ' + lvl2(p) + '. You gain if it falls and lose if it rises.');
}
function closePosition() {
  const id = S.sel, pos = position(id); if (!pos) return; if (!canTrade(id)) return;
  S.cash += pos.side === 'LONG' ? pos.value : -pos.value;
  S.log.closed.push({ index: pos.name, side: pos.side, entryLevel: +pos.entry.toFixed(2), exitLevel: +pos.current.toFixed(2), indexMovePctSinceEntry: +pos.movePct.toFixed(2), profit: Math.round(pos.pnl), closedAt: stampText(stamp()) });
  delete S.hold[id]; delete S.cost[id];
  if (pos.pnl > 0) done(pos.side === 'LONG' ? 'bull' : 'bear');
  sfx.sell(); say(pick(QUIPS.close));
  flash('Closed your ' + pos.side.toLowerCase() + ' on ' + pos.name + ' for a ' + (pos.pnl >= 0 ? 'profit' : 'loss') + ' of ' + inr(Math.abs(pos.pnl)) + '. The index moved ' + pct(pos.movePct) + ' from your entry.');
}

/* ================= Rounds: results come only from real price changes ================= */
function snapshot() { const s = { net: total(), px: {}, at: stamp() }; IDX().forEach(i => { s.px[i.id] = Market.price(i.id); }); return s; }
function play(call) {
  if (S.pending) return;
  if (!S.traded) return flash('Open at least one position first.');
  if (S.mode === 'replay') {
    const snap = snapshot();
    if (!Market.step(PACES[setup.pace].steps)) return flash('There is no more real data after this date.');
    return resolveRound(call, snap);
  }
  if (Market.label().key !== 'LIVE') return flash('Live rounds need a moving market, and it is not live right now. Your positions stay open; come back in market hours or end the game.');
  S.pending = { call, snap: snapshot(), endsAt: Date.now() + setup.liveMin * 60000 }; S.msg = ''; S.hintOn = false;
  sfx.tap(); say(pick(QUIPS.wait)); render();
}
function resolveRound(call, snap) {
  const moves = {}; IDX().forEach(i => { const a = snap.px[i.id], b = Market.price(i.id); moves[i.id] = a && b ? (b / a - 1) * 100 : null; });
  S.lastMove = moves; S.round++; S.hintOn = false; S.msg = ''; S.noRange = {};
  let shield = '';
  if (S.shieldOn) { const loss = snap.net - total(); if (loss > 0) { S.cash += loss / 2; shield = 'Your hedge shield paid back ' + inr(loss / 2) + '.'; } else shield = 'Your hedge shield was not needed.'; S.shieldOn = false; }
  const after = total(), you = (after / snap.net - 1) * 100, mkt = moves.NIFTY50;
  const secs = SECTORS().filter(s => moves[s.id] != null).map(s => ({ id: s.id, name: s.name, ret: moves[s.id] })).sort((x, y) => y.ret - x.ret);
  const right = mkt == null || mkt === 0 ? null : (mkt > 0) === (call === 'up');
  const elapsedYears = S.mode === 'replay' ? (Date.parse(Market.replayDate()) - Date.parse(S.d0)) / 31557600000 : (Date.now() - S.t0) / 31557600000;
  const nNow = Market.price('NIFTY50');
  S.vHist.push(after); S.iHist.push(nNow && S.startPx.NIFTY50 ? setup.budget * nNow / S.startPx.NIFTY50 : S.iHist.at(-1)); S.fHist.push(setup.budget * Math.pow(1 + FD_RATE, elapsedYears));
  S.log.cash.push(Math.max(0, free()) / after);
  S.log.rounds.push({ round: S.round, from: stampText(snap.at), to: stampText(stamp()), nifty50MovePct: mkt == null ? null : +mkt.toFixed(2), portfolioMovePct: +you.toFixed(2),
    call: call === 'up' ? 'rise' : 'fall', callRight: right, sectorMovesPct: secs.map(s => ({ sector: s.name, movePct: +s.ret.toFixed(2) })) });
  const news = News.build(moves, PACES[setup.pace].unit, IDX());
  S.recap = { mkt, you, call, right, shield, secs, news, from: snap.at, to: stamp() };

  addXP(20, 'Round complete');
  if (you > 0) addXP(20, 'Portfolio grew');
  if (right === true) { S.streak++; S.right++; S.scored++; addXP(30 + 20 * Math.min(S.streak, 4), 'Good call'); if (S.streak >= 3) done('watcher'); }
  else if (right === false) { S.streak = 0; S.scored++; }
  const open = Object.keys(S.hold).map(position);
  if (secs.length) {
    if (open.some(p => p.side === 'LONG' && p.id === secs[0].id)) { addXP(30, 'Long the winning sector'); done('hunter'); }
    if (secs[0].id === setup.fav) addXP(40, 'Your sector won the round');
  }
  if (open.some(p => p.side === 'SHORT' && moves[p.id] < 0)) { addXP(30, 'A short paid off'); World.bearJump(); }
  if (open.some(p => p.side === 'LONG' && p.pnl > 0)) done('bull');
  if (open.some(p => p.side === 'SHORT' && p.pnl > 0)) done('bear');

  const stormy = mkt != null && mkt <= -1; World.storm(stormy); if (stormy) World.shake();
  if (you >= 0) { World.jump(); sfx.up(); } else { World.sad(); sfx.down(); }
  say(roundLine(moves, open));
  News.show(news, stampText(stamp()));
  if (S.round >= ROUNDS) finish();
  render(true); if (S.phase === 'play') Chart.show(S.sel, RANGES.includes(S.range) ? S.range : '3M'); window.scrollTo(0, 0);
}
/* Mascot line built from the real moves of the round. */
function roundLine(moves, open) {
  const p = open.filter(o => moves[o.id] != null).sort((a, b) => Math.abs(moves[b.id]) - Math.abs(moves[a.id]))[0];
  if (p) { const m = moves[p.id], good = (p.side === 'LONG') === (m > 0);
    return `${p.name} ${m >= 0 ? 'rose' : 'fell'} ${Math.abs(m).toFixed(2)}% this round. Your ${p.side.toLowerCase()} ${good ? 'is moving in your favour!' : 'took a knock. Horns up.'}`; }
  return moves.NIFTY50 != null ? `NIFTY 50 ${moves.NIFTY50 >= 0 ? 'rose' : 'fell'} ${Math.abs(moves.NIFTY50).toFixed(2)}% this round.` : 'No NIFTY 50 data arrived for this round.';
}
function trendText() {
  const rows = IDX().map(i => { const s = Market.spark(i.id); return s.length > 1 ? { n: i.short, r: (s.at(-1) / s[0] - 1) * 100 } : null; }).filter(Boolean).sort((a, b) => b.r - a.r);
  if (!rows.length) return 'No recent data to scan yet.';
  return 'Real recent trend (' + (S.mode === 'replay' ? 'last 20 sessions' : 'this session') + '): ' + rows.map(r => `${r.n} ${pct(r.r)}`).join(', ') + '. Past moves do not promise the next one.';
}

function finish() {
  const fin = total(), idx = S.iHist.at(-1), fd = S.fHist.at(-1), ret = (fin / setup.budget - 1) * 100, iret = (idx / setup.budget - 1) * 100;
  if (fin > idx) done('index');
  let title, line;
  if (ret > iret + 2) { title = 'Market wizard'; line = 'You beat NIFTY 50 by a clear margin. Play another period to see how much was skill and how much was luck.'; }
  else if (ret >= iret - 2) { title = 'Steady investor'; line = 'You finished close to NIFTY 50, which is what most professionals manage on a good day.'; }
  else if (ret > 0) { title = 'Slow climber'; line = 'You made money, though NIFTY 50 made more. Check which positions held you back.'; }
  else { title = 'Bruised beginner'; line = 'You ended below where you started. It cost you nothing here, which is the point of practising.'; }
  const score = Math.max(0, S.xp + Math.round(Math.max(-30, ret) * 30));
  let best = null, bestLine = '';
  try { best = JSON.parse(localStorage.getItem('bullsy-best')); } catch (e) {}
  if (!best || score > best.score) { try { localStorage.setItem('bullsy-best', JSON.stringify({ score })); } catch (e) {} bestLine = best ? 'New high score. Your old best was ' + best.score.toLocaleString('en-IN') + '.' : ''; }
  else bestLine = 'Your high score on this device is ' + best.score.toLocaleString('en-IN') + '.';
  S.final = { fin, idx, fd, ret, iret, title, line, score, bestLine };
  S.final.review = review(S.final);
  S.phase = 'result'; S.pending = null; World.storm(false); say(pick(QUIPS.end)); if (fin > idx) World.celebrate();
}

/* ================= Coach review: built only from real trades and real index moves ================= */
function review(f) {
  const tips = [], avg = a => (a.length ? a.reduce((t, v) => t + v, 0) / a.length : 0);
  const open = Object.keys(S.hold).map(position).map(p => ({ index: p.name, side: p.side, entryLevel: +p.entry.toFixed(2), currentLevel: +p.current.toFixed(2), indexMovePctSinceEntry: +p.movePct.toFixed(2), profit: Math.round(p.pnl), status: 'open at the end' }));
  const all = S.log.closed.map(c => ({ ...c, status: 'closed' })).concat(open).sort((a, b) => a.profit - b.profit);
  const moves = IDX().map(i => { const a = S.startPx[i.id], b = px(i.id); return a && b ? { index: i.name, movePct: +((b / a - 1) * 100).toFixed(2), traded: !!S.log.touched[i.id] } : null; }).filter(Boolean).sort((a, b) => b.movePct - a.movePct);
  const cashPct = avg(S.log.cash) * 100, why = p => `${p.index} ${p.indexMovePctSinceEntry >= 0 ? 'rose' : 'fell'} ${Math.abs(p.indexMovePctSinceEntry).toFixed(2)}% after your entry`;
  const worst = all[0], bestP = all.at(-1);
  if (worst && worst.profit < 0) tips.push(`Your ${worst.side.toLowerCase()} on ${worst.index} lost ${inr(Math.abs(worst.profit))} because ${why(worst)}. A smaller position would have limited the damage.`);
  if (bestP && bestP.profit > 0 && bestP !== worst) tips.push(`Your ${bestP.side.toLowerCase()} on ${bestP.index} made ${inr(bestP.profit)} because ${why(bestP)}.`);
  if (cashPct > 25) tips.push(`On average ${cashPct.toFixed(0)}% of your money sat unused. Idle cash earns nothing, so a broad NIFTY 50 position would have put it to work.`);
  if (f.fin < f.idx) tips.push(`NIFTY 50 moved ${pct(f.iret)} over the game against your ${pct(f.ret)}. Simply holding NIFTY 50 would have beaten your picks.`);
  if (moves.length && !moves[0].traded && moves[0].movePct > 0) tips.push(`With hindsight, the strongest index was ${moves[0].index} at ${pct(moves[0].movePct)}, and you never traded it. Nobody knows that in advance, so treat it as luck, not a mistake.`);
  if (moves.length && moves.at(-1).movePct < -1 && !S.usedShort) tips.push(`${moves.at(-1).index} fell ${Math.abs(moves.at(-1).movePct).toFixed(2)}%. A short there would have gained, though that too is hindsight.`);
  if (S.scored) tips.push(`You called NIFTY 50's direction right ${S.right} of ${S.scored} times. Short-term direction is close to a coin toss even for experts.`);
  if (!tips.length) tips.push('You stayed invested and kept up with the market. Try a different pace or period for a new challenge.');
  const facts = { mode: S.mode === 'replay' ? 'historical replay of real daily closes' : 'live market', periodFrom: stampText(S.d0), periodTo: stampText(stamp()), startingCash: setup.budget, finalValue: Math.round(f.fin), returnPct: +f.ret.toFixed(2),
    nifty50ReturnPct: +f.iret.toFixed(2), fixedDepositValue: Math.round(f.fd), averageCashPct: +cashPct.toFixed(0), positions: all, realIndexMovesOverTheGame: moves, rounds: S.log.rounds,
    rightDirectionCalls: `${S.right} of ${S.scored}`, usedShortSelling: S.usedShort, trendScansUnused: S.hints, hedgeShieldUnused: S.shields, missionsCompleted: Object.keys(MISSIONS).filter(k => S.missions[k]).map(k => MISSIONS[k].n) };
  return { tips: tips.slice(0, 5), facts, positions: all };
}
async function askCoach() {
  const game = S; game.ai = { state: 'loading', text: '' }; render();
  try {
    const res = await fetch(Market.api + '/api/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ facts: game.final.review.facts }) });
    const body = await res.json(); if (!res.ok) throw new Error(body.error || 'failed');
    game.ai = { state: 'done', text: body.text };
  } catch (e) { game.ai = { state: 'error', text: '', msg: 'The AI coach could not answer this time. The review above still applies.' }; }
  if (S === game) render();
}

/* ================= Charts ================= */
/* Small SVG line chart for net worth (game values, not market prices). */
function svgChart(series, o) {
  const W = 600, H = 190, L = 6, Rr = 6, T = 14, B = 22;
  const all = series.flatMap(s => s.v); let lo = Math.min(...all), hi = Math.max(...all);
  if (hi === lo) { hi += 1; lo -= 1; } const pad = (hi - lo) * .08; lo -= pad; hi += pad;
  const n = Math.max(...series.map(s => s.v.length));
  const x = i => L + (W - L - Rr) * (n === 1 ? 0 : i / (n - 1)), y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  let out = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.aria}">`;
  [0, .5, 1].forEach(f => { const yy = T + (H - T - B) * f; out += `<line x1="${L}" x2="${W - Rr}" y1="${yy}" y2="${yy}" stroke="var(--line)"/>`; });
  out += `<text x="${L}" y="${T - 3}" font-size="11" fill="var(--muted)">${o.fmt(hi - pad)}</text><text x="${L}" y="${H - B + 13}" font-size="11" fill="var(--muted)">${o.fmt(lo + pad)}</text>`;
  out += `<text x="${W - Rr}" y="${H - 4}" font-size="11" fill="var(--muted)" text-anchor="end">${o.end}</text>`;
  series.forEach(s => {
    const d = s.v.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ');
    out += `<path d="${d}" fill="none" stroke="${s.c}" stroke-width="${s.w || 2.5}" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? 'stroke-dasharray="6 5"' : ''}/>`;
    const li = s.v.length - 1; out += `<circle cx="${x(li)}" cy="${y(s.v[li])}" r="4.5" fill="${s.c}"/>`;
  });
  return out + '</svg>';
}
function sparkSvg(id) {
  const v = Market.spark(id); if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v), W = 120, H = 30, y = p => 2 + (H - 4) * (1 - (hi === lo ? .5 : (p - lo) / (hi - lo)));
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${v.map((p, i) => (i / (v.length - 1) * W).toFixed(1) + ',' + y(p).toFixed(1)).join(' ')}" fill="none" stroke="${v.at(-1) >= v[0] ? 'var(--up)' : 'var(--down)'}" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

/* Index chart, drawn here as SVG from the real daily values, so it needs no outside library.
   It always holds every day from the start of the data up to the game's current day (later days
   stay hidden), and it can be moved: drag to slide through time, scroll or press + and - to zoom,
   point at a day to read its values. Nothing is smoothed or filled in: one candle = one real day. */
const RANGE_DAYS = { '1W': 5, '1M': 21, '3M': 63, '6M': 126 };
const RANGES = ['1W', '1M', '3M', '6M', 'All'];
const Chart = (() => {
  const W = 720, H = 330, L = 6, R = 74, T = 12, B = 26, PW = W - L - R, PH = H - T - B, MINBARS = 5;
  const host = document.createElement('div'); host.id = 'chartbox';
  host.innerHTML = '<p class="chartsum"></p><div class="cv" tabindex="0" role="img"></div><p class="chartread muted"></p><p class="muted chartnote"></p>';
  const [sum, cv, read, note] = host.children;
  let data = [], id = null, view = { start: 0, count: 1 }, hover = null, drag = null, queued = false;
  const day = c => Market.istDay(c.t), short = c => { const d = new Date(c.t + 19800000); return d.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]; };

  function clamp() {
    const n = data.length; view.count = Math.min(n, Math.max(Math.min(MINBARS, n), view.count)); view.start = Math.max(0, Math.min(n - view.count, view.start));
  }
  /* which preset, if any, the current window matches */
  function preset() {
    const n = data.length, k = Math.round(view.count);
    if (k >= n) return 'All';
    return Object.keys(RANGE_DAYS).find(r => RANGE_DAYS[r] === k && Math.abs(view.start - (n - k)) < .5) || 'custom';
  }
  function changed() { if (S && S.phase === 'play') { S.range = preset(); renderRanges(); } paintSoon(); }
  function setRange(range) { const n = data.length, k = RANGE_DAYS[range]; view.count = k ? Math.min(k, n) : n; view.start = n - view.count; clamp(); }
  /* (re)load the selected index up to the game's current day and show the chosen range, ending at the latest day */
  function show(newId, range) { id = newId; data = Market.series(id); hover = null; drag = null; setRange(RANGES.includes(range) ? range : 'All'); if (S) S.range = preset(); renderRanges(); paint(); }
  function zoom(f, frac = 1) { if (!data.length) return; const anchor = view.start + frac * view.count; view.count *= f; clamp(); view.start = anchor - frac * view.count; clamp(); changed(); }
  function pan(bars) { view.start += bars; clamp(); changed(); }
  function bounds() { const n = data.length, a = Math.max(0, Math.round(view.start)), b = Math.min(n - 1, a + Math.max(1, Math.round(view.count)) - 1); return [a, b]; }
  function paintSoon() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; paint(); }); }

  function paint() {
    const n = data.length;
    if (!n) { cv.innerHTML = ''; sum.textContent = ''; read.textContent = ''; note.textContent = 'No market data is available for this index.'; return; }
    const [a, b] = bounds(), vis = data.slice(a, b + 1), bw = PW / view.count, x = i => L + (i - view.start + .5) * bw;
    let lo = Math.min(...vis.map(c => c.l)), hi = Math.max(...vis.map(c => c.h)); const pad = (hi - lo) * .07 || hi * .01; lo -= pad; hi += pad;
    const y = v => T + PH * (1 - (v - lo) / (hi - lo));
    let s = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><clipPath id="cvclip"><rect x="${L}" y="0" width="${PW}" height="${H - B}"/></clipPath></defs>`;
    for (let g = 0; g <= 4; g++) { const v = lo + (hi - lo) * g / 4, yy = y(v); s += `<line x1="${L}" x2="${L + PW}" y1="${yy}" y2="${yy}" stroke="var(--line)" stroke-opacity=".6"/><text x="${W - 4}" y="${yy + 4}" font-size="11" fill="var(--muted)" text-anchor="end">${lvl2(v)}</text>`; }
    const every = Math.max(1, Math.ceil(view.count / 6));
    for (let i = a; i <= b; i++) if (i % every === 0 && x(i) > L + 18 && x(i) < L + PW - 18) s += `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${H - B}" stroke="var(--line)" stroke-opacity=".35"/><text x="${x(i)}" y="${H - 8}" font-size="11" fill="var(--muted)" text-anchor="middle">${short(data[i])}${new Date(data[i].t + 19800000).getUTCMonth() === 0 || i === a ? " '" + String(new Date(data[i].t + 19800000).getUTCFullYear()).slice(2) : ''}</text>`;
    s += '<g clip-path="url(#cvclip)">';
    const body = Math.max(1, bw * .66);
    for (let i = Math.max(0, a - 1); i <= Math.min(n - 1, b + 1); i++) { const c = data[i], col = c.c >= c.o ? 'var(--up)' : 'var(--down)', X = x(i);
      s += `<line x1="${X}" x2="${X}" y1="${y(c.h)}" y2="${y(c.l)}" stroke="${col}" stroke-width="${bw < 4 ? 1 : 1.5}"/><rect x="${X - body / 2}" y="${y(Math.max(c.o, c.c))}" width="${body}" height="${Math.max(1, Math.abs(y(c.o) - y(c.c)))}" fill="${col}"/>`; }
    if (hover != null && hover >= a && hover <= b) s += `<line x1="${x(hover)}" x2="${x(hover)}" y1="${T}" y2="${H - B}" stroke="var(--ink)" stroke-dasharray="3 3"/><circle cx="${x(hover)}" cy="${y(data[hover].c)}" r="4.5" fill="var(--ink)" stroke="var(--deep)" stroke-width="2"/>`;
    s += '</g>';
    if (b === n - 1) { const yy = y(data[n - 1].c); s += `<line x1="${L}" x2="${L + PW}" y1="${yy}" y2="${yy}" stroke="var(--gold)" stroke-dasharray="2 4"/><rect x="${L + PW + 2}" y="${yy - 9}" width="${R - 4}" height="18" rx="4" fill="var(--gold)"/><text x="${W - 5}" y="${yy + 4}" font-size="11" font-weight="700" fill="var(--deep)" text-anchor="end">${lvl2(data[n - 1].c)}</text>`; }
    cv.innerHTML = s + '</svg>';
    const first = data[a], last = data[b], chg = (last.c / first.o - 1) * 100, H2 = Math.max(...vis.map(c => c.h)), L2 = Math.min(...vis.map(c => c.l));
    sum.innerHTML = `<b>Showing ${vis.length} trading day${vis.length > 1 ? 's' : ''}: <span class="num ${cls(chg)}">${pct(chg)}</span></b> <span class="muted num">${niceDate(day(first))} to ${niceDate(day(last))}, from ${lvl2(first.o)} to ${lvl2(last.c)}. High ${lvl2(H2)}, low ${lvl2(L2)}.</span>`;
    cv.setAttribute('aria-label', `${meta(id).name} daily candle chart, ${vis.length} trading days from ${niceDate(day(first))} to ${niceDate(day(last))}, change ${pct(chg)}`);
    if (hover != null && data[hover]) { const c = data[hover], p = data[hover - 1], d = p ? (c.c / p.c - 1) * 100 : null;
      read.innerHTML = `<b style="color:var(--ink)">${niceDate(day(c))}</b>: open ${lvl2(c.o)}, high ${lvl2(c.h)}, low ${lvl2(c.l)}, close <b style="color:var(--ink)">${lvl2(c.c)}</b>${d == null ? '' : ` <span class="${cls(d)}">(${pct(d)} on the day)</span>`}`; }
    else read.textContent = 'Drag the chart to move through time. Scroll or press + and − to zoom. Point at a day to see its values.';
    note.textContent = `Real daily values from ${niceDate(day(data[0]))} to ${niceDate(day(data[n - 1]))}` + (b < n - 1 ? `. ${n - 1 - b} later day${n - 1 - b > 1 ? 's are' : ' is'} to the right: drag left to see ${n - 1 - b > 1 ? 'them' : 'it'}.` : '. Days after the game\'s current day stay hidden until you reach them.');
  }

  const scale = () => W / cv.getBoundingClientRect().width;
  const indexAt = clientX => { const r = cv.getBoundingClientRect(), px = (clientX - r.left) * scale(); return Math.round(view.start + (px - L) / PW * view.count - .5); };
  cv.addEventListener('pointerdown', e => { if (!data.length) return; drag = { x: e.clientX, start: view.start, moved: false }; try { cv.setPointerCapture(e.pointerId); } catch (_) {} });
  cv.addEventListener('pointermove', e => {
    if (!data.length) return;
    if (drag) { const dx = (e.clientX - drag.x) * scale(); if (Math.abs(dx) > 3) drag.moved = true; view.start = drag.start - dx / (PW / view.count); clamp(); hover = null; if (drag.moved) changed(); return; }
    const [a, b] = bounds(), i = Math.max(a, Math.min(b, indexAt(e.clientX))); if (i !== hover) { hover = i; paintSoon(); }
  });
  const end = () => { drag = null; };
  cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
  cv.addEventListener('pointerleave', () => { if (!drag && hover != null) { hover = null; paintSoon(); } });
  cv.addEventListener('wheel', e => { if (!data.length) return; e.preventDefault(); const r = cv.getBoundingClientRect(), frac = Math.max(0, Math.min(1, ((e.clientX - r.left) * scale() - L) / PW)); zoom(Math.exp(Math.max(-60, Math.min(60, e.deltaY)) * .004), frac); }, { passive: false });
  cv.addEventListener('keydown', e => { const step = Math.max(1, Math.round(view.count / 5));
    if (e.key === 'ArrowLeft') pan(-step); else if (e.key === 'ArrowRight') pan(step); else if (e.key === '+' || e.key === '=') zoom(.7); else if (e.key === '-') zoom(1 / .7); else return; e.preventDefault(); });

  return { host, show, zoom, pan, days: () => data.length, view: () => ({ ...view, bounds: bounds(), preset: preset() }) };
})();

/* ================= Views ================= */
function pulseCard(i) {
  const q = Market.quote(i.id), u = S && S.phase === 'play' ? units(i.id) : 0, has = q.price > 0;
  const when = !has ? '' : q.status === 'REPLAY' ? 'Close on ' + niceDate(q.date) : q.status === 'HISTORICAL' && q.ts ? 'Close on ' + niceDate(Market.istDay(q.ts)) : q.ts ? (q.status === 'UNAVAILABLE' ? 'Last updated ' : 'Updated ') + istTime(q.ts) + (q.status === 'UNAVAILABLE' ? ', not current' : '') : '';
  return `<span class="pc-top"><span class="pc-name">${i.emoji} ${i.name}</span><span class="chip ${q.status}">${CHIP[q.status]}</span></span>
    ${has ? `<span class="pc-val num">${lvl2(q.price)}</span>
      ${q.change != null ? `<span class="pc-chg num ${cls(q.change)}">${q.change >= 0 ? '▲' : '▼'} ${q.change >= 0 ? '+' : ''}${lvl2(q.change)} (${pct(q.changePct)})</span>` : '<span class="pc-chg muted">Change not available</span>'}
      <span class="pc-meta num">${q.prevClose != null ? 'Prev close ' + lvl2(q.prevClose) : ''}${q.high != null && q.low != null ? `<br>High ${lvl2(q.high)}, low ${lvl2(q.low)}` : ''}</span>
      ${sparkSvg(i.id)}<span class="pc-time">${when}</span>`
    : `<span class="pc-val muted">No data</span><span class="pc-meta">${q.note || 'Market data temporarily unavailable.'}</span>`}
    ${u ? `<span class="own ${u < 0 ? 'sh' : ''}">${u < 0 ? 'short' : 'long'}</span>` : ''}`;
}
function pulse() {
  const card = i => `<button class="pcard" data-sel="${i.id}" style="--c:${css(COLORS[i.id])}" aria-pressed="${!!S && S.phase === 'play' && S.sel === i.id}">${pulseCard(i)}</button>`;
  return `<section class="panel mpulse"><h3>Market Pulse</h3>
    <h4 class="pgroup">Market</h4><div class="pgrid two">${IDX().filter(i => i.group === 'benchmark').map(card).join('')}</div>
    <h4 class="pgroup">Sectors</h4><div class="pgrid">${SECTORS().map(card).join('')}</div></section>`;
}
function banner() {
  const l = Market.label(), m = Market.state.market, st = Market.state;
  let detail;
  if (l.key === 'REPLAY') detail = 'Real closing values for ' + niceDate(Market.replayDate()) + '. This is history, not today\'s market.';
  else if (!st.connected) detail = st.error || 'Connecting to the Bullsy server.';
  else if (l.key === 'UNAVAILABLE') detail = 'Market data temporarily unavailable. No prices are being made up; values return when the data does.';
  else if (l.key === 'CLOSED') detail = 'Showing the last genuine values. Prices do not move until the market reopens (9:15 AM to 3:30 PM IST, Monday to Friday).';
  else if (l.key === 'HISTORICAL') { const d = Market.state.cfg.dataset; detail = `Real closing values from ${niceDate(d.from)} to ${niceDate(d.to)}. This is past data, not today's market.`; }
  else if (l.key === 'DELAYED') detail = m.delayDays > 0 ? `Real data shown ${m.delayDays} trading day late.` : 'The provider has not sent a recent update.';
  else detail = 'Real prices from the market-data provider, IST ' + m.istTime + '.';
  return `<div class="banner ${l.key}"><b>${l.emoji} ${l.text}</b><span>${detail}</span></div>`;
}
function hudStats() {
  if (!S) return '';
  const lv = level(), into = lv >= LEVELS.length ? 100 : (S.xp % XP_STEP) / XP_STEP * 100, tv = total(), ret = (tv / setup.budget - 1) * 100;
  return `<div class="lvl"><b>Lv ${lv} ${LEVELS[lv - 1]}</b> <span class="muted num">${S.xp} XP</span><div class="xpbar"><i style="width:${into}%"></i></div></div>
    <div class="stat"><span>Streak</span><b class="num">🔥 ${S.streak}</b></div>
    <div class="stat"><span>Round</span><b class="num">${Math.min(S.round + 1, ROUNDS)}/${ROUNDS}</b></div>
    <div class="stat"><span>Free cash</span><b class="num">${inr(Math.max(0, free()))}</b></div>
    <div class="stat"><span>Net worth</span><b class="num ${cls(ret)}">${inr(tv)}</b></div>`;
}
function hud() { return `<span class="logo"><img src="logo-mark.png" alt="">Bullsy</span><span id="hudstats" class="hudstats">${hudStats()}</span><button class="icon" data-act="voice" aria-pressed="${voiceOn}">${voiceOn ? 'Voice on' : 'Voice off'}</button><button class="icon" data-act="mute" aria-label="${muted ? 'Turn sound on' : 'Turn sound off'}">${muted ? 'Sound off' : 'Sound on'}</button>`; }
function choice(group, val, label, sub, disabled) {
  return `<button class="choice" data-set="${group}" data-val="${val}" aria-pressed="${String(setup[group]) === String(val)}" ${disabled ? 'disabled' : ''}>${label}<small>${sub}</small></button>`;
}
function liveSubText() { const k = Market.label().key; return Market.state.cfg.dataset ? 'Off: this game uses past data' : Market.state.cfg.delayDays > 0 ? 'Off: data is one day delayed' : k === 'LIVE' ? 'Market is open now' : k === 'CLOSED' ? 'Market is closed now' : 'Data unavailable now'; }
function viewSetup() {
  if (!boot.ready) return `<div class="hero"><img class="biglogo" src="logo.png" alt="Bullsy: Trade, Learn, Grow"><h1 hidden>Bullsy</h1><p>${boot.error ? '⚠️ ' + boot.error : 'Loading the market data.'}</p></div>`;
  const delayed = Market.state.cfg.delayDays > 0, liveSub = liveSubText();
  return `
  <div class="hero"><img class="biglogo" src="logo.png" alt="Bullsy: Trade, Learn, Grow"><h1 hidden>Bullsy</h1><p>Learn the market on ${IDX().length} real Indian indices with pretend money. Go long, go short, call NIFTY 50 and beat the benchmark. Every price is a real past market value.</p></div>
  <div id="bannerbox">${banner()}</div>
  <div id="pulsebox">${pulse()}</div>
  <div class="panel" style="margin-top:14px">
    <div class="q" style="margin-top:0"><h3>Your starting cash</h3><div class="choices" style="align-items:center">
      <label class="field"><span>₹</span><input id="budget" type="number" inputmode="numeric" min="5000" max="10000000" step="1000" value="${setup.budget}" aria-label="Budget in rupees"></label>
      ${[25000, 100000, 500000].map(v => `<button class="btn alt small" data-budget="${v}">${inr(v)}</button>`).join('')}</div></div>
    ${setup.mode === 'replay' ? `
    <div class="q"><h3>Pace of each round</h3><div class="choices">
      ${choice('pace', 'day', 'Day by day', ROUNDS + ' real trading days')}${choice('pace', 'week', 'Week by week', ROUNDS + ' real weeks')}${choice('pace', 'month', 'Month by month', ROUNDS + ' real months')}</div></div>
    <div class="q"><h3>Which period?</h3><div class="choices" style="align-items:center">
      ${choice('start', 'recent', 'Most recent', 'Ends at the latest data')}${choice('start', 'surprise', 'Surprise me', 'A period picked for you')}${choice('start', 'date', 'Pick a date', 'Start from a day you choose')}
      ${setup.start === 'date' ? `<label class="field"><input id="startDate" type="date" value="${setup.startDate}" min="${Market.state.cfg.dataset.from}" max="${Market.state.cfg.dataset.to}" aria-label="Game start date" style="width:170px"></label>` : ''}</div>
      <p class="muted" style="font-size:.88rem;margin-top:6px">The data covers ${niceDate(Market.state.cfg.dataset.from)} to ${niceDate(Market.state.cfg.dataset.to)}.</p></div>`
    : `<div class="q"><h3>Length of each round</h3><div class="choices">
      ${choice('liveMin', 1, '1 minute', 'Quick rounds')}${choice('liveMin', 5, '5 minutes', 'Standard')}${choice('liveMin', 15, '15 minutes', 'Patient')}</div>
      <p class="muted" style="font-size:.88rem;margin-top:6px">Live rounds run in real time, because the real market cannot be fast-forwarded. They only run while the market is open.</p></div>`}
    <div class="q"><h3>Back a sector</h3><div class="choices">${SECTORS().map(s => choice('fav', s.id, s.emoji + ' ' + s.short, 'Bonus XP when it wins')).join('')}</div></div>
    ${setupErr ? `<p class="err">⚠️ ${setupErr}</p>` : ''}
    <div class="row"><button class="btn" data-act="start" ${busy ? 'disabled' : ''}>${busy ? 'Loading real market data...' : 'Enter the market'}</button></div>
  </div>`;
}
function selHead() {
  const i = meta(S.sel), q = Market.quote(S.sel);
  return `<h2><i class="dot" style="background:${css(COLORS[i.id])}"></i>${i.emoji} ${i.name} <span class="chip ${q.status}">${CHIP[q.status]}</span></h2>
    ${q.price > 0 ? `<p class="selval"><b class="num">${lvl2(q.price)}</b> ${q.change != null ? `<span class="num ${cls(q.change)}">${q.change >= 0 ? '▲' : '▼'} ${q.change >= 0 ? '+' : ''}${lvl2(q.change)} (${pct(q.changePct)})</span>` : ''}</p>` : '<p class="selval muted">⚠️ Market data temporarily unavailable for this index.</p>'}`;
}
function rangesHtml() {
  const n = Chart.days();
  return RANGES.map(r => { const need = RANGE_DAYS[r] || 0, off = need > n;
    return `<button class="btn alt small ${S.range === r ? 'on' : ''}" data-range="${r}" aria-pressed="${S.range === r}" ${off ? 'disabled title="Not enough past days yet at this point in the game"' : ''}>${r}</button>`; }).join('') +
    '<span style="flex:1"></span><button class="btn alt small" data-act="czout" aria-label="Zoom out">－</button><button class="btn alt small" data-act="czin" aria-label="Zoom in">＋</button>';
}
function renderRanges() { const el = $('#ranges'); if (el && S) el.innerHTML = rangesHtml(); }
function tradeBox() {
  const pos = position(S.sel), fr = Math.max(0, free()), ok = Market.tradable(S.sel);
  return `<p style="margin-top:10px">You have <b class="num">${inr(fr)}</b> free cash. ${pos ? `You are <b>${pos.side.toLowerCase()}</b> ${inr(pos.value)} from ${lvl2(pos.entry)}, now <b class="num ${cls(pos.pnl)}">${pos.pnl >= 0 ? '+' : ''}${inr(pos.pnl)}</b>.` : 'No position in this index.'}</p>
    <div class="trade">
      <label class="field"><span>₹</span><input id="amt" type="number" inputmode="numeric" min="100" step="100" value="${S.amt}" aria-label="Amount in rupees" style="width:120px"></label>
      ${[10, 25, 50].map(p => `<button class="btn alt small" data-amt="${p}">${p}%</button>`).join('')}<button class="btn alt small" data-amt="max">Max</button>
    </div>
    <div class="trade">
      ${pos && pos.side === 'SHORT' ? '' : `<button class="btn rise" data-act="long" ${ok && fr >= 100 ? '' : 'disabled'}>▲ ${pos ? 'Add to long' : 'Go long'}</button>`}
      ${pos && pos.side === 'LONG' ? '' : `<button class="btn fall" data-act="short" ${ok && fr >= 100 ? '' : 'disabled'}>▼ ${pos ? 'Add to short' : 'Short'}</button>`}
      ${pos ? `<button class="btn" data-act="close" ${ok ? '' : 'disabled'}>Close position</button>` : ''}
    </div>
    ${S.msg ? `<p style="margin-top:8px;font-weight:700" role="status">${S.msg}</p>` : ''}
    <p class="muted" style="font-size:.82rem;margin-top:8px">Long gains when the index rises: (current − entry) × units. 🐻 Short gains when it falls: (entry − current) × units. A short uses free cash just like a long.</p>`;
}
function callBox() {
  const unit = S.mode === 'replay' ? PACES[setup.pace].unit : setup.liveMin + ' minute' + (setup.liveMin > 1 ? 's' : '');
  if (S.pending) return `<h3>Round ${S.round + 1} is running on the real market</h3>
    <p class="muted" style="margin-top:2px">You called a ${S.pending.call === 'up' ? 'rise' : 'fall'} in NIFTY 50. The round is settled with whatever the market really does.</p>
    <p class="countdown num" id="cd"></p>`;
  const liveBlocked = S.mode === 'live' && Market.label().key !== 'LIVE';
  return `<h3>Call NIFTY 50 to ${S.mode === 'replay' ? 'move to the next ' + unit : 'start a ' + unit + ' round'}</h3>
    <p class="muted" style="margin-top:2px">${!S.traded ? 'Open at least one position first.' : liveBlocked ? 'The market is not live right now, so a new round cannot start.' : 'Will NIFTY 50 really be higher or lower after the next ' + unit + '? A right call earns XP.'}</p>
    <div class="calls"><button class="btn rise" data-act="up" ${S.traded && !liveBlocked ? '' : 'disabled'}>▲ It will rise</button><button class="btn fall" data-act="down" ${S.traded && !liveBlocked ? '' : 'disabled'}>▼ It will fall</button></div>
    <div class="powers">
      <button class="btn alt small" data-act="hint" ${S.hints && !S.hintOn ? '' : 'disabled'}>🔮 Trend scan (${S.hints} left)</button>
      <button class="btn alt small ${S.shieldOn ? 'on' : ''}" data-act="shield" ${S.shields && !S.shieldOn ? '' : 'disabled'}>🛡 ${S.shieldOn ? 'Shield is on this round' : 'Hedge shield (' + S.shields + ' left)'}</button>
    </div>
    ${S.hintOn ? `<p class="hintbox">🔮 ${trendText()}</p>` : ''}
    <p class="muted" style="font-size:.82rem;margin-top:8px">The scan shows each index's real recent trend. The shield pays back half of this round's loss.</p>
    ${S.round ? '<div class="row"><button class="btn alt small" data-act="endnow">End game and see my report</button></div>' : ''}`;
}
function portfolioBox() {
  const ps = Object.keys(S.hold).map(position);
  const rows = ps.map(p => `<tr><td>${meta(p.id).short}</td><td>${p.side === 'LONG' ? 'Long' : 'Short'}</td><td class="num">${lvl2(p.entry)}</td><td class="num">${lvl2(p.current)}</td><td class="num ${cls(p.pnl)}">${p.pnl >= 0 ? '+' : ''}${inr(p.pnl)}</td></tr>`).join('');
  return `<h3>Your positions</h3>
    ${ps.length ? `<div class="scroll"><table class="rows"><tr><th>Index</th><th>Side</th><th>Entry</th><th>Now</th><th>P&amp;L</th></tr>${rows}</table></div>` : '<p class="muted" style="margin-top:4px">None yet. Tap a tower or a Market Pulse card, then go long or short.</p>'}
    ${S.round ? svgChart([{ v: S.iHist, c: 'var(--muted)', dash: 1, w: 2 }, { v: S.vHist, c: 'var(--gold)', w: 3 }], { aria: 'Your net worth against NIFTY 50', end: 'Now', fmt: inr }) + '<div class="legend"><span><i style="background:var(--gold)"></i>You</span><span><i style="background:var(--muted)"></i>Same money in NIFTY 50</span></div>' : ''}`;
}
function recapBox() {
  const r = S.recap; if (!r) return '';
  return `<div class="panel recap"><p class="big">${stampText(r.from)} to ${stampText(r.to)}: NIFTY 50 ${r.mkt == null ? 'data unavailable' : `<span class="${cls(r.mkt)}">${pct(r.mkt)}</span>`}, you <span class="${cls(r.you)}">${pct(r.you)}</span></p>
    <p style="margin-top:4px">You called a ${r.call === 'up' ? 'rise' : 'fall'}. ${r.right === true ? '<b class="up">Good call.</b>' : r.right === false ? '<b class="down">Wrong call, streak reset.</b>' : 'NIFTY 50 did not move or had no data, so the call was not scored.'} ${r.shield}</p>
    ${r.secs.length ? `<p class="secs"><b>Sector Race (real moves):</b> ${r.secs.map((x, i) => `<span><i style="background:${css(COLORS[x.id])}"></i>${i ? '' : '🏆 '}${meta(x.id).short} <b class="num ${cls(x.ret)}">${pct(x.ret)}</b></span>`).join('')}</p>` : '<p class="muted">No sector data arrived for this round.</p>'}
    ${r.news && r.news.length ? `<ul class="flashes">${r.news.map(n => `<li class="${n.tone}"><b>${n.title}.</b> ${n.body}</li>`).join('')}</ul>` : ''}</div>`;
}
function viewPlay() {
  return `<div id="bannerbox">${banner()}</div><div id="recapbox">${recapBox()}</div><div id="pulsebox">${pulse()}</div>
  <div class="grid">
    <div class="col"><div class="panel"><div id="selhead">${selHead()}</div><div class="seg" id="ranges" style="margin-top:8px">${rangesHtml()}</div><div id="chartslot"></div><div id="tradebox">${tradeBox()}</div></div></div>
    <div class="col"><div class="panel" id="callbox">${callBox()}</div><div class="panel" id="portfolio">${portfolioBox()}</div>
      <div class="panel"><h3>Missions</h3>${Object.keys(MISSIONS).map(k => `<div class="mission ${S.missions[k] ? 'done' : ''}"><span class="box">${S.missions[k] ? '✓' : ''}</span><div><b>${MISSIONS[k].n} <span class="muted" style="font-weight:400">+100 XP</span></b><span>${MISSIONS[k].d}</span></div></div>`).join('')}</div></div>
  </div>`;
}
function viewResult() {
  const f = S.final, lv = level(), unit = S.mode === 'replay' ? stampText(S.d0) + ' to ' + stampText(stamp()) : 'your live session';
  const badges = Object.keys(MISSIONS).map(k => [MISSIONS[k].n, MISSIONS[k].d, S.missions[k]]).concat([['Beat the bank', 'Did better than a 6.5% a year fixed deposit over the same time', f.fin > f.fd]]);
  const coachOn = Market.state.cfg.coach;
  return `<div id="bannerbox">${banner()}</div>
  <div class="panel rank"><p class="muted">Over ${unit} you are a</p><h1>${f.title}</h1>
    <p class="score num">Score ${f.score.toLocaleString('en-IN')}, Lv ${lv} ${LEVELS[lv - 1]}</p><p>${f.line}</p>${f.bestLine ? `<p class="muted">${f.bestLine}</p>` : ''}</div>
  <div class="stats">
    <div class="panel"><span>You started with</span><b class="num">${inr(setup.budget)}</b></div>
    <div class="panel"><span>You ended with</span><b class="num ${cls(f.ret)}">${inr(f.fin)} (${pct(f.ret)})</b></div>
    <div class="panel"><span>Same money in NIFTY 50</span><b class="num">${inr(f.idx)} (${pct(f.iret)})</b></div>
    <div class="panel"><span>Fixed deposit, same time</span><b class="num">${inr(f.fd)}</b></div>
    <div class="panel"><span>Right NIFTY 50 calls</span><b class="num">${S.right} of ${S.scored}</b></div>
  </div>
  <div class="panel" style="margin-top:12px"><h3>How your money moved</h3>
    ${svgChart([{ v: S.fHist, c: 'var(--up)', dash: 1, w: 2 }, { v: S.iHist, c: 'var(--muted)', dash: 1, w: 2 }, { v: S.vHist, c: 'var(--gold)', w: 3.5 }], { aria: 'Your net worth against NIFTY 50 and a fixed deposit', end: 'End', fmt: inr })}
    <div class="legend"><span><i style="background:var(--gold)"></i>You</span><span><i style="background:var(--muted)"></i>NIFTY 50 (real)</span><span><i style="background:var(--up)"></i>Fixed deposit</span></div></div>
  <div class="panel coach"><h3>Coach's review: what the real market did to your trades</h3>
    <ol>${f.review.tips.map(t => `<li>${t}</li>`).join('')}</ol>
    ${coachOn ? `<div class="row"><button class="btn" data-act="coach" ${S.ai && S.ai.state === 'loading' ? 'disabled' : ''}>${S.ai && S.ai.state === 'done' ? 'Ask the AI coach again' : S.ai && S.ai.state === 'loading' ? 'AI coach is thinking...' : 'Ask the AI coach for a personal plan'}</button></div>` : ''}
    ${S.ai ? `<div id="aiout" aria-live="polite">${S.ai.state === 'loading' ? 'Thinking...' : ''}</div>${S.ai.msg ? `<p class="muted" style="margin-top:8px">${S.ai.msg}</p>` : ''}` : ''}
  </div>
  <h3 style="margin-top:18px">Badges: ${badges.filter(b => b[2]).length} of ${badges.length}</h3>
  <div class="badges">${badges.map(b => `<div class="badge ${b[2] ? 'won' : ''}"><b>${b[2] ? '🏅 ' : ''}${b[0]}</b><span>${b[1]}</span></div>`).join('')}</div>
  <div class="row"><button class="btn" data-act="again">Play again</button><button class="btn alt" data-act="reset">Change my setup</button></div>
  <p class="note">Bullsy is a learning game played with pretend money. Index values are real market data from the server's data provider; nothing here is investment advice.</p>`;
}

/* ================= Rendering ================= */
function towerItems() {
  const playing = S && S.phase === 'play';
  return IDX().map(i => {
    const q = Market.quote(i.id), p = Market.price(i.id);
    const perf = p == null ? null : playing && S.mode === 'replay' ? (S.startPx[i.id] ? (p / S.startPx[i.id] - 1) * 100 : null) : q.changePct;
    return { id: i.id, perf, last: S ? S.lastMove[i.id] ?? null : null, pos: playing ? units(i.id) : 0 };
  });
}
function syncWorld(flashNow) { World.sync(towerItems(), S && S.phase === 'play' ? S.sel : null, !!flashNow, S && S.mode === 'replay' && S.phase === 'play' ? PACES[setup.pace].perPct : 1); }
function quickCard() {
  const qk = $('#quick'), playing = S && S.phase === 'play'; qk.hidden = !playing; $('.zoom').hidden = false; if (!playing) { $('#tt').hidden = true; return; }
  const i = meta(S.sel), q = Market.quote(S.sel), pos = position(S.sel), tenth = Math.round(setup.budget / 10);
  qk.innerHTML = `<div><b class="disp">${i.short}</b> <span class="num">${q.price > 0 ? lvl2(q.price) : 'no data'}</span>${q.changePct != null ? ` <span class="num ${cls(q.changePct)}">${pct(q.changePct)}</span>` : ''}<small>Drag to spin, tap a tower to pick it</small></div>
    ${pos ? `<button class="btn small" data-act="close">Close ${pos.side.toLowerCase()}</button>` : `<button class="btn small rise" data-act="q-long">Long ${inr(tenth)}</button><button class="btn small fall" data-act="q-short">Short ${inr(tenth)}</button>`}`;
}
function render(flashNow) {
  document.body.classList.toggle('home', !S); if (!S) News.clear();
  $('#hud').innerHTML = hud();
  $('#ui').innerHTML = !S ? viewSetup() : S.phase === 'play' ? viewPlay() : viewResult();
  const slot = $('#chartslot'); if (slot) slot.appendChild(Chart.host);
  if (S && S.ai && S.ai.text) { const o = $('#aiout'); if (o) o.textContent = S.ai.text; }
  quickCard(); if (boot.ready) syncWorld(flashNow);
}
/* Light refresh when genuine data arrives: updates numbers without touching inputs. */
function refresh() {
  if (!boot.ready) return;
  const set = (sel, html) => { const el = $(sel); if (el) el.innerHTML = html; };
  set('#bannerbox', banner()); if (!S) set('[data-set="mode"][data-val="live"] small', liveSubText());
  IDX().forEach(i => { const el = document.querySelector(`[data-sel="${i.id}"].pcard`); if (el) el.innerHTML = pulseCard(i); });
  if (S && S.phase === 'play') { set('#hudstats', hudStats()); set('#selhead', selHead()); set('#portfolio', portfolioBox()); quickCard(); }
  syncWorld(false);
}
Market.on(what => { if (what !== 'mode') refresh(); });

/* live round clock */
setInterval(() => {
  if (!S || !S.pending) return;
  const left = S.pending.endsAt - Date.now(), cd = $('#cd');
  if (left <= 0) { const p = S.pending; S.pending = null; return resolveRound(p.call, p.snap); }
  if (cd) { const now = Market.price('NIFTY50'), a = p0(); cd.innerHTML = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')} left${now && a ? `<br><span class="${cls(now - a)}" style="font-size:1rem">NIFTY 50 so far ${pct((now / a - 1) * 100)}</span>` : ''}`; }
  function p0() { return S.pending.snap.px.NIFTY50; }
}, 1000);
/* keep intraday charts in step with the server once a minute */
setInterval(() => { if (S && S.phase === 'play' && S.mode === 'live' && !document.hidden && (S.range === '1D' || S.range === '1W')) Chart.show(S.sel, RANGES.includes(S.range) ? S.range : '3M'); }, 60000);

/* ================= Input ================= */
function readInputs() {
  const b = $('#budget'); if (b) setup.budget = Math.floor(+b.value || 0);
  const d = $('#startDate'); if (d) setup.startDate = d.value;
  const a = $('#amt'); if (a && S) S.amt = Math.floor(+a.value || 0);
}
function select(id) { if (!S || S.phase !== 'play' || !meta(id)) return; S.sel = id; S.msg = ''; sfx.tap(); render(); World.focus(id); Chart.show(id, S.range); }
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  readInputs();
  if (b.dataset.set) { const g = b.dataset.set, v = b.dataset.val; setup[g] = g === 'liveMin' ? +v : v; setupErr = ''; sfx.tap(); return render(); }
  if (b.dataset.budget) { setup.budget = +b.dataset.budget; sfx.tap(); return render(); }
  if (b.dataset.sel) return select(b.dataset.sel);
  if (b.dataset.range) { sfx.tap(); return Chart.show(S.sel, b.dataset.range); }
  if (b.dataset.amt) { const fr = Math.max(0, free()); S.amt = Math.floor(b.dataset.amt === 'max' ? fr : setup.budget * +b.dataset.amt / 100); S.msg = ''; return render(); }
  switch (b.dataset.act) {
    case 'mute': muted = !muted; return render();
    case 'voice': voiceOn = !voiceOn; if (!voiceOn) stopSpeaking(); else speak('Voice over is on.', true); return render();
    case 'start': if (!(setup.budget >= 5000 && setup.budget <= 10000000)) { setupErr = 'Enter a budget between ₹5,000 and ₹1,00,00,000.'; return render(); } return newGame();
    case 'long': return goLong(S.amt);
    case 'short': return goShort(S.amt);
    case 'close': return closePosition();
    case 'q-long': return goLong(Math.min(Math.round(setup.budget / 10), Math.floor(Math.max(0, free()))));
    case 'q-short': return goShort(Math.min(Math.round(setup.budget / 10), Math.floor(Math.max(0, free()))));
    case 'up': case 'down': return play(b.dataset.act);
    case 'hint': S.hints--; S.hintOn = true; sfx.tap(); return render();
    case 'shield': S.shields--; S.shieldOn = true; sfx.tap(); return render();
    case 'endnow': finish(); render(); return window.scrollTo(0, 0);
    case 'coach': return askCoach();
    case 'again': S = null; return newGame();
    case 'reset': S = null; Market.useLive(); World.storm(false); say(pick(QUIPS.hello)); render(); return window.scrollTo(0, 0);
    case 'czin': return Chart.zoom(.7);
    case 'czout': return Chart.zoom(1 / .7);
    case 'zin': return World.zoomBy(-.15);
    case 'zout': return World.zoomBy(.15);
  }
});
document.addEventListener('input', e => { if (e.target.id === 'amt' && S) S.amt = Math.floor(+e.target.value || 0); if (e.target.id === 'budget') setup.budget = Math.floor(+e.target.value || 0); });

/* ================= Boot ================= */
World.init(id => select(id), (id, x, y) => {
  const t = $('#tt'); if (!id || !boot.ready) { t.hidden = true; return; }
  const i = meta(id), q = Market.quote(id), pos = S && S.phase === 'play' ? position(id) : null, r = $('#stage').getBoundingClientRect();
  t.innerHTML = `<b>${i.emoji} ${i.name}</b><br>${q.price > 0 ? `<span class="num">${lvl2(q.price)}</span>${q.changePct != null ? ` <span class="num ${cls(q.changePct)}">${pct(q.changePct)}</span>` : ''}` : 'No data'}<br>${CHIP[q.status]}${pos ? `<br>You are ${pos.side.toLowerCase()}: ${pos.pnl >= 0 ? '+' : ''}${inr(pos.pnl)}` : ''}`;
  t.hidden = false; t.style.left = Math.min(r.width - 196, Math.max(8, x - r.left + 16)) + 'px'; t.style.top = Math.max(8, y - r.top - 96) + 'px';
});
World.wide(true);
say(pick(QUIPS.hello));
render();
Market.init().then(() => {
  boot.ready = true;
  if (Market.state.cfg.delayDays > 0 && setup.mode === 'live') setup.mode = 'replay';
  World.build(IDX().map(i => ({ id: i.id, label: i.emoji + ' ' + i.short, color: COLORS[i.id] })));
  render();
}).catch(e => { boot.error = 'Market data unavailable: the data file could not be loaded. Please refresh the page.'; render(); });
