/* Bullsy's only source of market data: files of real daily index values in data/,
   one per index, named after the index id (NIFTY50.csv, NIFTYBANK.csv, ...).

   Accepted formats:
   - CSV as downloaded from the exchange's historical index data page
     (columns Date, Open, High, Low, Close; optional Shares Traded / Volume)
   - JSON: { "candles": [ { "t": <ms>, "o": .., "h": .., "l": .., "c": .., "v": .. } ] }

   Nothing here creates, fills in or alters a price. A row that cannot be read is
   skipped and counted; a file that cannot be used leaves that index off the site. */
import fs from 'node:fs';
import path from 'node:path';
import { ProviderError } from './errors.js';
import { CATALOG_IDS } from '../indices.js';

const istDay = ms => new Date(ms + 19800000).toISOString().slice(0, 10);
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/* "06-OCT-2026", "6 October 2026", "06-Oct-26" is refused (2-digit year), "2026-10-06" */
export function parseDate(text) {
  const s = String(text).trim(); let m;
  if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = /^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/,]+(\d{4})$/.exec(s))) { const mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; if (mo) return `${m[3]}-${String(mo).padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  return null;
}
function splitCsvLine(line) {
  const out = []; let cur = '', quoted = false;
  for (const ch of line) { if (ch === '"') quoted = !quoted; else if (ch === ',' && !quoted) { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur); return out.map(c => c.trim());
}
const number = s => { const n = Number(String(s).replace(/,/g, '')); return Number.isFinite(n) ? n : NaN; };

export function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('no rows');
  const head = splitCsvLine(lines[0]).map(h => h.toLowerCase()), col = (...names) => head.findIndex(h => names.some(n => h === n || h.startsWith(n + ' ')));
  const iD = col('date'), iO = col('open'), iH = col('high'), iL = col('low'), iC = col('close'), iV = col('shares traded', 'volume', 'vol.');
  if ([iD, iO, iH, iL, iC].some(i => i < 0)) throw new Error('needs daily rows with Date, Open, High, Low and Close columns (found: ' + head.join(', ') + ')');
  const candles = []; let skipped = 0;
  for (const line of lines.slice(1)) {
    const f = splitCsvLine(line), day = parseDate(f[iD]), o = number(f[iO]), h = number(f[iH]), l = number(f[iL]), c = number(f[iC]), v = iV >= 0 ? number(f[iV]) : NaN;
    if (!day || !(o > 0 && h > 0 && l > 0 && c > 0)) { skipped++; continue; }
    candles.push({ t: Date.parse(day + 'T00:00:00+05:30'), o, h, l, c, v: v > 0 ? v : null });
  }
  return { candles, skipped };
}

function load(dir, id) {
  const csv = path.join(dir, id + '.csv'), json = path.join(dir, id + '.json');
  if (fs.existsSync(csv)) { const r = parseCsv(fs.readFileSync(csv, 'utf8')); return { ...r, file: id + '.csv' }; }
  if (fs.existsSync(json)) {
    const rows = JSON.parse(fs.readFileSync(json, 'utf8')).candles || [];
    const candles = rows.filter(c => Number.isFinite(c.t) && c.o > 0 && c.h > 0 && c.l > 0 && c.c > 0).map(c => ({ t: c.t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v > 0 ? c.v : null }));
    return { candles, skipped: rows.length - candles.length, file: id + '.json' };
  }
  return null;
}

export class DatasetProvider {
  constructor(cfg, log = console) {
    this.name = 'dataset'; this.label = 'Saved data files'; this.cfg = cfg; this.log = log;
    this.series = {}; this.instruments = {}; this.problems = []; this.notes = [];
    for (const id of CATALOG_IDS) {
      let candles = [], file = ['.csv', '.json'].map(x => id + x).find(f => fs.existsSync(path.join(cfg.dir, f))) || null;
      try {
        const r = load(cfg.dir, id);
        if (r) {
          const byDay = new Map(); for (const c of r.candles) byDay.set(c.t, c);        // one row per day
          candles = [...byDay.values()].sort((a, b) => a.t - b.t);
          if (candles.length < 30) throw new Error(candles.length ? `only ${candles.length} usable daily rows (30 or more are needed)` : 'no usable daily rows');
          if (r.skipped) this.notes.push(`${file}: ${r.skipped} unreadable row(s) skipped`);
        }
      } catch (e) { candles = []; this.problems.push(`${file || id}: ${e.message}`); }
      this.series[id] = candles;
      this.instruments[id] = { key: file ? 'data/' + file : '(no file)', verified: candles.length > 0, via: candles.length ? `${candles.length} daily rows, ${istDay(candles[0].t)} to ${istDay(candles.at(-1).t)}` : file ? 'file could not be used' : 'no data file' };
    }
    this.available = CATALOG_IDS.filter(id => this.series[id].length);
    const ends = this.available.map(id => istDay(this.series[id].at(-1).t)).sort(), starts = this.available.map(id => istDay(this.series[id][0].t)).sort();
    /* The data's own last day. Every "latest month" window is counted back from here, not from today's date. */
    this.asOf = ends.length ? ends.at(-1) : null; this.from = starts.length ? starts[0] : null;
  }
  info() { return { from: this.from, to: this.asOf, indices: this.available.length }; }
  configured() { return !!this.asOf; }
  authInfo() { return { kind: 'dataset', configured: !!this.asOf, loggedIn: !!this.asOf, lastLoginAt: null, lastError: this.problems.join('; ') || null }; }
  async resolveInstruments() { return this.instruments; }
  async fetchQuotes() { throw new ProviderError('Saved data has no live quotes'); }
  async fetchIntraday() { return []; }
  /* from / to are IST dates, inclusive. Only daily data exists. */
  async fetchCandles(id, unit, interval, from, to) {
    const all = this.series[id]; if (!all || !all.length) throw new ProviderError('No saved data for ' + id);
    if (unit !== 'days') return [];
    return all.filter(c => { const d = istDay(c.t); return d >= from && d <= to; });
  }
}
