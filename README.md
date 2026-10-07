# Bullsy on Render Free

One Render web service is both the game and its server. Players open the link and
play; they never install anything, log in, or see a key.

All market data comes from **Angel One SmartAPI**. The server signs in to Angel One
by itself, so there is no daily step for you.

**Honest status:** the code passes its automated tests against a stand-in for Angel
One. It has not yet been confirmed against your real Angel One account. Part 3 is
how you confirm it.

## Part 1. Put the project on GitHub

1. Unzip the project. Inside are `server`, `public`, `package.json`, `render.yaml`
   and a few others.
2. Create a GitHub repository, click **uploading an existing file**, and **drag**
   everything inside the unzipped folder into the page (dragging keeps the folders).
   `server` and `public` must appear as folders at the top level.
3. Never upload a file named `.env`.

## Part 2. Settings in Render

Service page, **Environment**. These live only in Render.

| Variable | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `BULLSY_DATA_DELAY_DAYS` | `1` delayed (default), or `0` real time |
| `ANGEL_API_KEY` | the API key of your SmartAPI app |
| `ANGEL_CLIENT_CODE` | your Angel One client code (login ID) |
| `ANGEL_PIN` | your Angel One login PIN |
| `ANGEL_TOTP_SECRET` | the key under the QR code from enabling TOTP |
| `ADMIN_PASSWORD` | a long password for your `/admin` page |
| `ANTHROPIC_API_KEY` | optional: shows the AI coach button |

Start command `node server/index.js`, build command `echo 'no build step'`,
instance type Free. Render redeploys whenever a setting or the repository changes.

## Part 3. Check that it works

1. `https://<your-link>/api/health` shows `"ok":true`.
2. `https://<your-link>/admin` (any username, your `ADMIN_PASSWORD`) shows
   **Angel One SmartAPI connection: CONNECTED** and 8 indices with values.
   If it says DISCONNECTED, the page shows Angel One's own reason, for example a
   wrong PIN, a wrong TOTP key, or a refusal because of the app's registered IP.
3. The game shows 8 Market Pulse cards with values. Play one replay to the end.
4. Real-time mode only: between 9:15 AM and 3:30 PM IST on a trading day the
   banner says LIVE MARKET DATA and values change every few seconds. Outside those
   hours it says MARKET CLOSED and nothing moves.

## Things to know

- **The server holds a full login** to the Angel One account: client code, PIN and
  TOTP key. Prefer an account with no funds in it. If any of the values has been
  shared anywhere, regenerate it in Angel One and update Render.
- **No data without a successful sign-in.** If Angel One refuses the sign-in, every
  index shows DATA UNAVAILABLE. Bullsy never makes prices up.
- **Static IP.** SmartAPI apps can be tied to registered IP addresses, and Render's
  servers do not call from your home address. If sign-in is refused for that
  reason, `/admin` will say so.
- **Free plan sleeps** after about 15 minutes without visitors; the next visitor
  waits while it wakes.
- **Real-time data on a public game:** SEBI's May 2024 circular allows price data
  for investor education with a one-day lag and no monetary incentives. Delayed
  mode fits that; real-time mode is your decision. Ask Angel One in writing whether
  their data may be shown to anonymous visitors. This is not legal advice.

Technical notes are in `docs/TECHNICAL.md`.
# BullsyAngelOne
# BullsyAngelOne
# Bullsy-AngelOne
