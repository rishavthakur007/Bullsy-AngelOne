/* Bullsy server. No dependencies: Node 22+ only.
   - Serves the game from public/
   - Public API under /api/market/* : read-only real past index data, loaded from the files in data/
   - /admin (password protected) for the site owner
   No market-data API is called. The optional AI coach key stays in this process. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { DatasetProvider } from './marketData/providers/dataset.js';
import { keepOnly } from './marketData/indices.js';
import { MarketDataService, INDICES } from './marketData/service.js';
import { adminPage } from './admin.js';

/* All market data comes from the files in data/. Only indices that have a usable file are shown. */
const provider = new DatasetProvider({ dir: config.dataDir });
keepOnly(provider.available);
const market = new MarketDataService(provider, config);
const publicDir = path.join(config.root, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const started = Date.now();

const send = (res, status, body, type = 'application/json', extra = {}) => {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};
const fail = (res, e) => send(res, e?.rateLimited ? 429 : 502, { error: 'Market data temporarily unavailable' });
async function readBody(req, limit = 200000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw new Error('Request too large'); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

/* ---------- CORS: only the Bullsy frontend may call the API from a browser ---------- */
function allowOrigin(req, res) {
  const origin = req.headers.origin; if (!origin) return true;                    // not a cross-site browser call
  let host = ''; try { host = new URL(origin).host; } catch {}
  if (host === req.headers.host) return true;                                    // same site
  if (!config.frontendOrigins.includes(origin.replace(/\/$/, ''))) return false;
  res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

/* ---------- admin authentication (HTTP Basic over HTTPS) ---------- */
const digest = s => crypto.createHash('sha256').update(String(s)).digest();
function isAdmin(req) {
  if (!config.adminPassword) return false;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || ''); if (!m) return false;
  const text = Buffer.from(m[1], 'base64').toString('utf8'), pass = text.slice(text.indexOf(':') + 1);
  return crypto.timingSafeEqual(digest(pass), digest(config.adminPassword));
}
async function requireAdmin(req, res) {
  if (!config.adminPassword) { send(res, 503, 'Admin is switched off. Set ADMIN_PASSWORD on the server.', 'text/plain'); return false; }
  if (isAdmin(req)) return true;
  await new Promise(r => setTimeout(r, 800));                                     // slow down guessing
  send(res, 401, 'Sign in required.', 'text/plain', { 'WWW-Authenticate': 'Basic realm="Bullsy admin", charset="UTF-8"' }); return false;
}

/* ---------- AI Coach: real trade log in, advice out. Rate limited because each call costs money. ---------- */
const coachHits = new Map(); let coachDay = { day: '', n: 0 };
function coachAllowed(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(), now = Date.now(), day = new Date().toISOString().slice(0, 10);
  if (coachDay.day !== day) coachDay = { day, n: 0 };
  const hits = (coachHits.get(ip) || []).filter(t => now - t < 3600000);
  if (hits.length >= config.coachPerIpPerHour || coachDay.n >= config.coachPerDay) return false;
  hits.push(now); coachHits.set(ip, hits); coachDay.n++; if (coachHits.size > 5000) coachHits.clear();
  return true;
}
async function coach(facts) {
  const prompt = 'You are the coach in Bullsy, a stock-market learning game played with virtual money on REAL Indian index data. ' +
    'Using ONLY the game data below, tell the player what they could have done differently to improve their return. ' +
    'Every market move you mention must be a number that appears in the data; do not invent prices, moves, news or reasons why the market moved. ' +
    'Write 4 numbered recommendations, each one or two sentences, naming the indices and the actual percentage moves involved. ' +
    'Separate what was knowable at the time (spreading across sectors, position size, leaving cash idle, holding losing shorts) from pure hindsight (which index happened to win). ' +
    'End with one sentence of encouragement. Plain text only, no markdown, under 180 words. This is a game: do not give real-world investment advice.\n\nGame data (JSON):\n' + JSON.stringify(facts).slice(0, 20000);
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { 'content-type': 'application/json', 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: config.anthropicModel, max_tokens: 600, messages: [{ role: 'user', content: prompt }] })
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) { console.error('[coach] ' + (json.error?.message || res.status)); throw new Error('AI coach request failed'); }
  return (json.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost'), p = url.pathname;
  try {
    /* ================= public API ================= */
    if (p.startsWith('/api/')) {
      if (!allowOrigin(req, res)) return send(res, 403, { error: 'This site is not allowed to use the Bullsy API.' });
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      if (p === '/api/health') return send(res, 200, { ok: true, uptimeSeconds: Math.round((Date.now() - started) / 1000), data: market.getMarketStatus().label });
      if (p === '/api/market/config') return send(res, 200, { indices: INDICES, coach: !!config.anthropicKey, dataset: provider.info() });
      if (p === '/api/market/status') { const m = market.getMarketStatus(); return send(res, 200, { label: m.label, sessionOpen: m.sessionOpen, istDate: m.istDate, istTime: m.istTime, delayDays: m.delayDays, feedOk: !m.feed.error }); }
      if (p === '/api/market/quotes') return send(res, 200, publicSnapshot(market.snapshot()));
      if (p === '/api/market/instruments') { const inst = market.getInstruments(); return send(res, 200, INDICES.map(i => ({ id: i.id, name: i.name, group: i.group, available: inst[i.id].verified }))); }
      if (p.startsWith('/api/market/history/')) {
        try { return send(res, 200, await market.getIndexHistory(decodeURIComponent(p.slice(20)), url.searchParams.get('range') || '1M')); }
        catch (e) { return /^Unknown/.test(e.message) ? send(res, 400, { error: e.message }) : fail(res, e); }
      }
      if (p === '/api/market/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        const push = data => res.write(`data: ${JSON.stringify(publicSnapshot(data))}\n\n`);
        push(market.snapshot());
        const off = market.subscribeToMarketUpdates(null, push), beat = setInterval(() => res.write(': keep-alive\n\n'), 25000);
        req.on('close', () => { off(); clearInterval(beat); });
        return;
      }
      if (p === '/api/coach' && req.method === 'POST') {
        if (!config.anthropicKey) return send(res, 501, { error: 'AI coach is not available.' });
        if (!coachAllowed(req)) return send(res, 429, { error: 'The AI coach is busy. Please try again later.' });
        try { return send(res, 200, { text: await coach(JSON.parse(await readBody(req) || '{}').facts || {}) }); }
        catch (e) { return send(res, 502, { error: 'The AI coach could not answer this time.' }); }
      }
      return send(res, 404, { error: 'Not found' });
    }

    /* ================= admin (site owner only) ================= */
    if (p === '/admin' || p.startsWith('/admin/')) {
      if (!(await requireAdmin(req, res))) return;
      if (p === '/admin') return send(res, 200, adminPage({ config, provider, market }), 'text/html; charset=utf-8', { 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
      if (p === '/admin/status.json') return send(res, 200, { ...market.snapshot(), dataset: provider.info(), files: provider.instruments, problems: provider.problems });
      return send(res, 404, 'Not found', 'text/plain');
    }

    /* ================= the game (static files) ================= */
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
    const file = path.normalize(path.join(publicDir, p === '/' ? 'index.html' : decodeURIComponent(p)));
    if (!file.startsWith(publicDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Cache-Control': 'public, max-age=300' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error('[server] ' + p + ':', e); if (!res.headersSent) send(res, 500, { error: 'Server error' });
  }
});
/* Players get market data and its status, never provider error text or internals. */
function publicSnapshot(s) {
  const quotes = {};
  for (const [id, q] of Object.entries(s.quotes)) { const { source, verified, note, ...rest } = q; quotes[id] = { ...rest, note: q.status === 'UNAVAILABLE' && q.price == null ? 'Market data temporarily unavailable.' : note && !/token|password|file|data\//i.test(note) ? note : null }; }
  const m = s.market;
  return { quotes, market: { label: m.label, sessionOpen: m.sessionOpen, istDate: m.istDate, istTime: m.istTime, delayDays: m.delayDays } };
}

server.listen(config.port, '0.0.0.0', async () => {
  console.info(`Bullsy backend listening on port ${config.port}`);
  if (!config.adminPassword) console.warn('[admin] ADMIN_PASSWORD is not set, so /admin is switched off.');
  if (!config.frontendOrigins.length) console.info('[cors] FRONTEND_ORIGIN is not set: only this site itself can call the API from a browser.');
  await market.start();
  if (!provider.available.length) console.error('[data] No usable data files in data/. The site will show DATA UNAVAILABLE until index files are added.');
  else console.info(`[data] ${provider.available.length} indices loaded from data/, real daily values from ${provider.from} to ${provider.asOf}. No market-data API is called.\n` + provider.available.map(id => `  ${id.padEnd(12)} ${provider.instruments[id].key.padEnd(22)} ${provider.instruments[id].via}`).join('\n'));
  for (const p of provider.problems) console.warn('[data] problem: ' + p);
  for (const n of provider.notes) console.info('[data] note: ' + n);
});
