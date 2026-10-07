/* Turns the CSV files in data/ into public/data.json, the one file the game loads.
   Run after adding or changing a CSV:  npm run build
   (Netlify runs it automatically on every deploy.)
   Values are copied exactly; nothing is generated, filled in or rounded. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatasetProvider } from '../server/marketData/providers/dataset.js';
import { INDICES } from '../server/marketData/indices.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data'), out = process.env.DATA_OUT || path.join(root, 'public', 'data.json');
const p = new DatasetProvider({ dir: dataDir }), day = ms => new Date(ms + 19800000).toISOString().slice(0, 10);

for (const x of p.problems) console.warn('problem: ' + x);
for (const x of p.notes) console.info('note: ' + x);
if (!p.available.length) { console.error('No usable data files in ' + dataDir + '. public/data.json was not written.'); process.exit(1); }

const json = {
  source: 'Daily index values copied from the CSV files in data/',
  dataset: p.info(),
  indices: INDICES.filter(i => p.available.includes(i.id)),
  /* one row per real trading day: [date, open, high, low, close, shares traded or null] */
  candles: Object.fromEntries(p.available.map(id => [id, p.series[id].map(c => [day(c.t), c.o, c.h, c.l, c.c, c.v])]))
};
fs.writeFileSync(out, JSON.stringify(json));
console.info(`Wrote ${path.relative(root, out)}: ${p.available.length} indices, ${p.from} to ${p.asOf}`);
for (const id of p.available) console.info(`  ${id.padEnd(12)} ${p.instruments[id].via}`);
