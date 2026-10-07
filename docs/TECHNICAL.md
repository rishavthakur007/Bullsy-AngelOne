# Bullsy technical notes (for developers)

## Architecture

```
Angel One SmartAPI
   |  server/marketData/providers/angelone.js   only file with Angel One tokens, URLs, formats
   |  server/marketData/providers/totp.js       one-time codes for the automatic sign-in
   v
server/marketData/service.js                    cache, status labels, history ranges
   |  server/index.js                           /api/market/*  (JSON + Server-Sent Events), /admin
   v
public/js/market.js                             the one place the game reads prices from
   v
public/js/game.js, public/js/world3d.js         Market Pulse, charts, trading, rounds, 3D market
```

To use another provider, write a file with the same methods as `angelone.js`
(`fetchQuotes`, `fetchCandles`, `fetchIntraday`, `authInfo`, `resolveInstruments`,
optionally `startStream`) and construct it in `server/index.js`.

## Angel One endpoints

| Purpose | Endpoint |
|---|---|
| Sign in (client code, PIN, TOTP) | `POST /rest/auth/angelbroking/user/v1/loginByPassword` |
| Candles | `POST /rest/secure/angelbroking/historical/v1/getCandleData` |
| Quotes, 8 indices per call | `POST /rest/secure/angelbroking/market/v1/quote/` |

Index tokens: NIFTY 50 `NSE|99926000`, SENSEX `BSE|99919000`, NIFTY BANK
`NSE|99926009`, NIFTY IT `NSE|99926008`, NIFTY AUTO `NSE|99926029`, NIFTY FIN
SERVICE `NSE|99926037`, NIFTY FMCG `NSE|99926021`, NIFTY PHARMA `NSE|99926023`.
Override with `ANGEL_TOKEN_<ID>=EXCHANGE|TOKEN`. Each is marked verified once data
arrives for it.

Limits respected: candle calls are spaced 400 ms apart (limit 3 per second); spans
stay under the per-request maximum (5-minute 100 days, 30-minute 200 days, daily
2000 days); a failed sign-in is retried at most once every 30 seconds.

## Data modes

- `BULLSY_DATA_DELAY_DAYS=1`: quotes are built from completed daily candles dated
  before today. No quote calls are made.
- `BULLSY_DATA_DELAY_DAYS=0`: one quote call for all 8 indices every
  `BULLSY_POLL_INTERVAL_MS` (default 5000) in market hours, every 5 minutes
  otherwise. Angel One's WebSocket stream is not used.

Status labels: LIVE (market open, healthy, quote under 2 minutes old), DELAYED,
MARKET CLOSED (outside 9:15 to 15:30 IST Monday to Friday, or a weekday with no
trades dated today), DATA UNAVAILABLE (no data or failed feed; last real value is
kept, marked not current, and does not move).

## Chart ranges

| Range | Live / delayed request | Replay |
|---|---|---|
| 1D | 5-minute candles of the latest session | not offered |
| 1W | 30-minute candles, 9 calendar days | last 5 daily candles |
| 1M / 3M / 6M / 1Y | daily candles, 31 / 92 / 183 / 366 calendar days | last 21 / 63 / 126 / 252 daily candles |

Replay loads about 760 calendar days of daily candles once and slices them in the
browser, never showing dates after the replay day.

## Tests

```
npm test                    # ranges, Angel One provider, server (no account needed)
node test/e2e.js            # browser playthrough (needs Playwright)
node test/charts.e2e.js     # browser timeframe checks (needs Playwright)
```

`test/mock-angel.js` is a stand-in used only by tests, reached only when a test
sets `ANGEL_API_BASE`. It holds fixed fixture numbers, not market data.

Not covered by tests: the real Angel One service, the 3D scene and the chart
library's drawing.
