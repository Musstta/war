import { resolve } from 'path';

export const PORT = parseInt(process.env.PORT ?? '3001', 10);

// [DEFERRED SECURITY] ADMIN_KEY and SESSION_SECRET must be real secrets before production.
// See docs/persistent-world-tech-stack.md §11 for the hardening checklist.
export const ADMIN_KEY = process.env.ADMIN_KEY ?? 'dev-only-insecure-key';

// Cookie signing secret — must be ≥ 32 characters.
export const SESSION_SECRET =
  process.env.SESSION_SECRET ?? 'dev-only-session-secret-change-before-prod';

export const TICK_SCHEDULE = process.env.TICK_SCHEDULE ?? '0 0 * * *';

export const DATA_FILE =
  process.env.DATA_FILE ?? resolve(__dirname, '../../engine/src/data/americas.json');
