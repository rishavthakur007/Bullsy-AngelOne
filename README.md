# Bullsy

A stock-market learning game played with pretend money on **real past index
values**. Players go long or short on Indian indices, call the direction of
NIFTY 50 each round, and are scored against the real market.

There is no market-data API, no login and no key. Everything comes from the CSV
files in `data/`.

## The data

| File | Index | Rows |
|---|---|---|
| `data/NIFTY50.csv` | NIFTY 50 | daily, 7 Oct 2025 to 6 Oct 2026 |
| `data/NIFTY100.csv` | NIFTY 100 | same |
| `data/NIFTYBANK.csv` | NIFTY BANK | same |
| `data/NIFTYAUTO.csv` | NIFTY AUTO | same |
| `data/NIFTYPHARMA.csv` | NIFTY PHARMA | same |

The files are the exchange's historical index downloads, unchanged. The server
reads them as they are: one candle on a chart is one real trading day. Nothing
is generated, smoothed or filled in.

**Adding or updating an index:** put a daily CSV in `data/`, named after the
index, and deploy again. The file needs the columns Date, Open, High, Low and
Close, one row per trading day, with dates like `06-OCT-2026` or `2026-10-06`.
Known names: `NIFTY50`, `SENSEX`, `NIFTY100`, `NIFTYBANK`, `NIFTYAUTO`,
`NIFTYPHARMA`. Only indices that have a usable file appear on the website.

SENSEX is not included yet: the SENSEX file supplied had one row for the whole
year, and the game needs one row per day. Add a daily `data/SENSEX.csv` and it
appears by itself.

## How the game uses it

- A game is 8 rounds. Each round moves 1, 5 or 21 real trading days forward.
- A game starts at least 21 trading days into the data and ends inside it. "Most
  recent" plays the last days of the data; "Surprise me" picks a period;
  "Pick a date" starts from a day you choose.
- The chart holds every day from the start of the data up to the game's current
  day. Later days stay hidden. Drag it to move through time, scroll or press +
  and − to zoom, point at a day to read its values. 1W, 1M, 3M, 6M and All jump
  to the latest 5, 21, 63, 126 or all days.
- Long P&L = (current − entry) × units. Short P&L = (entry − current) × units.
- Sector Race ranks NIFTY BANK, NIFTY AUTO and NIFTY PHARMA by their real move.
- The benchmark is the same money held in NIFTY 50 over the same days.

## Run it

Needs Node.js 22 or newer. Nothing to install.

```
npm start        # http://localhost:3000
npm test         # checks every served value against the CSV files
```

## Deploy on Render

One free web service: runtime Node, build command `echo 'no build step'`, start
command `node server/index.js`, health check `/api/health`. Render redeploys
when the GitHub repository changes. No environment variables are required.

Optional settings (Render, service, Environment):

| Variable | What it does |
|---|---|
| `ADMIN_PASSWORD` | Switches on `/admin`, which lists the loaded data files |
| `ANTHROPIC_API_KEY` | Shows the "Ask the AI coach" button (each use costs money) |

The free plan sleeps after about 15 minutes without visitors; the next visitor
waits while it wakes.

## Files

```
data/                         real daily index values (CSV)
server/index.js               web server and /api/market/* endpoints
server/marketData/providers/dataset.js   reads the files in data/
server/marketData/service.js  serves quotes and history from them
public/js/market.js           the one place the game reads prices from
public/js/game.js             game, chart, trading, missions, scoring
public/js/world3d.js          3D market
test/data.test.js             server checks against the CSV files
test/e2e.js                   browser playthrough (needs Playwright)
```

Bullsy is a learning game. Nothing in it is investment advice.

## Deploy on Netlify (recommended)

Bullsy is a static site: the game loads `public/data.json`, which is built from the CSV files in `data/`. No server, API, key or password is needed.

**Quickest (no GitHub):** open https://app.netlify.com/drop and drag the `public` folder onto the page. Netlify gives you a link straight away.

**From GitHub (updates automatically):** push this project to a GitHub repository, then in Netlify choose *Add new site → Import an existing project* and pick the repository. `netlify.toml` already holds the settings (build `node scripts/build-data.js`, publish `public`). Leave the environment variables empty.

To change the data, replace a CSV in `data/`, run `npm run build`, and deploy again. The AI coach button is off on Netlify; the built-in review still works.
