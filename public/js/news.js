/* Bullsy market flashes: the news pop-ups shown after each round.
   Every flash is worked out from the real index values of the days just played
   (moves, leaders and laggards, highest or lowest closes, winning or losing runs).
   Nothing is invented: there are no made-up headlines, reasons or events. */
const News = (() => {
  let queue = [], timer = null, total = 0;
  const f2 = n => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const abs = n => Math.abs(n).toFixed(2) + '%';

  /* moves: { indexId: real % move over the round }, unit: 'trading day' | 'week' | 'month' */
  function build(moves, unit, indices) {
    const out = [], rows = indices.filter(i => moves[i.id] != null).map(i => ({ ...i, m: moves[i.id] })).sort((a, b) => b.m - a.m);
    const n = moves.NIFTY50, q = Market.quote('NIFTY50');
    if (n != null) out.push({ tone: n >= 0 ? 'up' : 'down', title: `NIFTY 50 ${n >= 0 ? 'rises' : 'falls'} ${abs(n)} over the ${unit}`, body: `The index closed at ${f2(q.price)}.` });
    if (rows.length > 1) {
      const top = rows[0], low = rows.at(-1);
      if (low.m >= 0) out.push({ tone: 'up', title: `All ${rows.length} indices close higher`, body: `${top.name} led with a gain of ${abs(top.m)}. ${low.name} gained the least, ${abs(low.m)}.` });
      else if (top.m < 0) out.push({ tone: 'down', title: `All ${rows.length} indices close lower`, body: `${low.name} fell the most, ${abs(low.m)}. ${top.name} held up best, down ${abs(top.m)}.` });
      else out.push({ tone: 'mix', title: `${top.name} leads, ${low.name} lags`, body: `${top.name} gained ${abs(top.m)} while ${low.name} lost ${abs(low.m)}.` });
    }
    /* highest or lowest close for a long time, counted on the real closes so far */
    const marks = [];
    for (const i of indices) {
      const c = Market.series(i.id).map(x => x.c), last = c.at(-1); if (c.length < 22) continue;
      let hi = 0, lo = 0;
      for (let k = c.length - 2; k >= 0 && c[k] < last; k--) hi++;
      for (let k = c.length - 2; k >= 0 && c[k] > last; k--) lo++;
      const all = c.length - 1;
      if (hi >= 21) marks.push({ n: hi, tone: 'up', title: `${i.name} at its highest close ${hi === all ? 'in this data' : 'in ' + hi + ' trading days'}`, body: `It closed at ${f2(last)}${hi === all ? ', the highest since the data begins.' : '.'}` });
      if (lo >= 21) marks.push({ n: lo, tone: 'down', title: `${i.name} at its lowest close ${lo === all ? 'in this data' : 'in ' + lo + ' trading days'}`, body: `It closed at ${f2(last)}${lo === all ? ', the lowest since the data begins.' : '.'}` });
    }
    marks.sort((a, b) => b.n - a.n).slice(0, 2).forEach(m => out.push(m));
    /* run of daily closes in one direction */
    const c = Market.series('NIFTY50').map(x => x.c); let run = 0;
    if (c.length > 3) { const dir = Math.sign(c.at(-1) - c.at(-2)); for (let k = c.length - 1; k > 0 && dir && Math.sign(c[k] - c[k - 1]) === dir; k--) run++;
      if (run >= 3) out.push({ tone: dir > 0 ? 'up' : 'down', title: `NIFTY 50 ${dir > 0 ? 'up' : 'down'} ${run} trading days in a row`, body: `It has closed ${dir > 0 ? 'higher' : 'lower'} on each of the last ${run} trading days.` }); }
    return out.slice(0, 4);
  }

  function box() { let b = document.getElementById('newsbox'); if (!b) { b = document.createElement('div'); b.id = 'newsbox'; b.setAttribute('aria-live', 'polite'); document.body.appendChild(b); } return b; }
  function next() {
    clearTimeout(timer); const b = box(), it = queue.shift();
    if (!it) { b.innerHTML = ''; return; }
    const n = total - queue.length;
    b.innerHTML = `<div class="newspop ${it.tone}" role="status"><div class="np-top"><span class="np-tag">Market flash</span><span class="np-date">${it.date || ''}</span><button class="np-x" data-news="close" aria-label="Close market flash">✕</button></div>
      <p class="np-title">${it.title}</p><p class="np-body">${it.body}</p>
      <div class="np-foot"><span>${n} of ${total}</span>${queue.length ? '<button data-news="next">Next</button>' : ''}</div></div>`;
    speak(it.title + '. ' + it.body);
    timer = setTimeout(next, 9000);
  }
  function show(items, date) { queue = items.map(i => ({ ...i, date })); total = queue.length; next(); }
  function clear() { queue = []; clearTimeout(timer); box().innerHTML = ''; }
  document.addEventListener('click', e => { const b = e.target.closest('[data-news]'); if (!b) return; if (b.dataset.news === 'close') { clear(); stopSpeaking(); } else { stopSpeaking(); next(); } });
  return { build, show, clear };
})();
