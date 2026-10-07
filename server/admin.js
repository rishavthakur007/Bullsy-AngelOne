/* The owner-only status page at /admin. Rendered on the server; contains no secrets. */
import { INDICES, CATALOG_IDS } from './marketData/indices.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function adminPage({ config, provider, market }) {
  const q = market.getMultipleIndexQuotes(), inst = provider.instruments, ok = provider.available.length > 0;
  const rows = CATALOG_IDS.map(id => { const v = q[id], i = inst[id], shown = INDICES.some(x => x.id === id);
    return `<tr><td>${esc(id)}</td><td class="${shown ? 'ok' : 'bad'}">${shown ? 'on the website' : 'not shown'}</td><td class="n">${v && v.price != null ? v.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td><td><code>${esc(i.key)}</code></td><td>${esc(i.via)}</td></tr>`; }).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Bullsy admin</title><style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;background:#120E33;color:#FFF6E5;line-height:1.5}
main{max-width:920px;margin:0 auto;padding:24px 16px 60px} h1{color:#FFB627;margin:0 0 4px} h2{margin:28px 0 8px;font-size:1.15rem}
.card{background:#261F5C;border:2px solid #463C9C;border-radius:16px;padding:16px;margin-top:12px}
table{width:100%;border-collapse:collapse;font-size:.92rem} td,th{padding:8px 6px;border-bottom:1px solid #463C9C;text-align:left} .n{font-variant-numeric:tabular-nums}
.wrap{overflow-x:auto} code{font-size:.82rem;color:#BDB6E6} .muted{color:#BDB6E6} .ok{color:#2EE6A6} .bad{color:#FF6B81} .big{font-size:1.4rem;font-weight:800}
</style></head><body><main>
<h1>Bullsy admin</h1><p class="muted">Only you can see this page.</p>
<div class="card"><p class="big">Market data: <span class="${ok ? 'ok' : 'bad'}">${ok ? 'LOADED' : 'NOT LOADED'}</span></p>
<p>Bullsy runs on the data files in <code>data/</code>${ok ? `: real daily values from <b>${esc(provider.from)}</b> to <b>${esc(provider.asOf)}</b>, for ${provider.available.length} indices` : ''}. No market-data API is called and no login details are used.</p>
${provider.problems.length ? `<p class="bad">Problems: ${esc(provider.problems.join('; '))}</p>` : ''}${provider.notes.length ? `<p class="muted">Notes: ${esc(provider.notes.join('; '))}</p>` : ''}
<p class="muted">To add or update an index, put its daily CSV in <code>data/</code> named after the index (for example <code>SENSEX.csv</code>) and deploy again.</p></div>
<h2>Indices</h2><div class="card wrap"><table><tr><th>Index</th><th>Status</th><th>Last close</th><th>File</th><th>Contents</th></tr>${rows}</table></div>
<h2>Settings in effect</h2><div class="card"><p>Allowed frontend sites: ${config.frontendOrigins.length ? config.frontendOrigins.map(esc).join(', ') : 'this site only'}<br>AI Coach: ${config.anthropicKey ? 'on' : 'off (no ANTHROPIC_API_KEY)'}</p></div>
</main></body></html>`;
}
