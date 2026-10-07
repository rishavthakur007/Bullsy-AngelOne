import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile) && !process.env.BULLSY_SKIP_ENV_FILE) process.loadEnvFile(envFile);

const env = process.env;
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(+v) ? +v : d);

export const config = {
  root,
  port: num(env.PORT, 3000),
  /* Folder holding one file of real daily values per index (see data/). */
  dataDir: env.DATA_DIR || path.join(root, 'data'),
  /* Sites allowed to call the API from a browser (comma separated). Same-origin is always allowed. */
  frontendOrigins: (env.FRONTEND_ORIGIN || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean),
  adminPassword: env.ADMIN_PASSWORD || '',
  /* Saved data is never real time. These keep the shared market-data service in its "completed days only" mode. */
  delayDays: 1, pollMs: 5000, freshMs: 120000,
  coachPerIpPerHour: num(env.COACH_LIMIT_PER_IP_PER_HOUR, 5), coachPerDay: num(env.COACH_LIMIT_PER_DAY, 300),
  anthropicKey: env.ANTHROPIC_API_KEY || '',
  anthropicModel: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5'
};
