import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile) && !process.env.BULLSY_SKIP_ENV_FILE) process.loadEnvFile(envFile);

const env = process.env;
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(+v) ? +v : d);
const port = num(env.PORT, 3000);
/* Render sets RENDER_EXTERNAL_URL to the service's public address, so nothing needs hardcoding. */
const publicUrl = (env.PUBLIC_BACKEND_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`).replace(/\/$/, '');

export const config = {
  root,
  port,
  publicUrl,
  /* Sites allowed to call the API from a browser (comma separated). Same-origin is always allowed. */
  frontendOrigins: (env.FRONTEND_ORIGIN || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean),
  adminPassword: env.ADMIN_PASSWORD || '',
  /* 1 (default) = real data one trading day late; 0 = real time. See README. */
  delayDays: Math.max(0, Math.floor(num(env.BULLSY_DATA_DELAY_DAYS, 1))),
  coachPerIpPerHour: num(env.COACH_LIMIT_PER_IP_PER_HOUR, 5), coachPerDay: num(env.COACH_LIMIT_PER_DAY, 300),
  pollMs: Math.max(2000, num(env.BULLSY_POLL_INTERVAL_MS, 5000)),
  freshMs: 120000, // a quote older than this during market hours is not called LIVE
  provider: 'angelone',
  angel: {
    apiKey: env.ANGEL_API_KEY || '', clientCode: env.ANGEL_CLIENT_CODE || '', pin: env.ANGEL_PIN || '', totpSecret: env.ANGEL_TOTP_SECRET || '',
    apiBase: (env.ANGEL_API_BASE || 'https://apiconnect.angelone.in').replace(/\/$/, ''),
    tokenOverrides: Object.fromEntries(Object.entries(env).filter(([k, v]) => k.startsWith('ANGEL_TOKEN_') && v).map(([k, v]) => [k.slice(12), v]))
  },
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  anthropicModel: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5'
};
