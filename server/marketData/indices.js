/* The indices Bullsy knows how to show. Only the ones that have a data file in
   data/ appear on the website: keepOnly() trims these lists at startup. */
export const INDICES = [
  { id: 'NIFTY50',     name: 'NIFTY 50',     short: 'NIFTY 50',  emoji: '📈', group: 'benchmark' },
  { id: 'SENSEX',      name: 'SENSEX',       short: 'SENSEX',    emoji: '📊', group: 'benchmark' },
  { id: 'NIFTY100',    name: 'NIFTY 100',    short: 'NIFTY 100', emoji: '💯', group: 'benchmark' },
  { id: 'NIFTYBANK',   name: 'NIFTY BANK',   short: 'BANK',      emoji: '🏦', group: 'sector' },
  { id: 'NIFTYAUTO',   name: 'NIFTY AUTO',   short: 'AUTO',      emoji: '🚗', group: 'sector' },
  { id: 'NIFTYPHARMA', name: 'NIFTY PHARMA', short: 'PHARMA',    emoji: '💊', group: 'sector' }
];
export const INDEX_IDS = INDICES.map(i => i.id);
export const INDEX_BY_ID = Object.fromEntries(INDICES.map(i => [i.id, i]));
export const CATALOG_IDS = INDEX_IDS.slice();          // the full list, before trimming

export function keepOnly(ids) {
  const keep = INDICES.filter(i => ids.includes(i.id));
  INDICES.splice(0, INDICES.length, ...keep);
  INDEX_IDS.splice(0, INDEX_IDS.length, ...keep.map(i => i.id));
  for (const id of Object.keys(INDEX_BY_ID)) if (!ids.includes(id)) delete INDEX_BY_ID[id];
}
