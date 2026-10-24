import 'dotenv/config';
import { z } from 'zod';

const key32 = z.string().regex(/^[0-9a-fA-F]{64}$/, 'must be 64 hex characters (32 bytes) — run `npm run gen:keys`');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: key32,
  PHONE_ENC_KEY: key32,
  PHONE_HASH_KEY: key32,
  OTP_HASH_KEY: key32,
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  OTP_DELIVERY: z.enum(['console']).default('console'),
  // Turns every rate limit off. For automated tests on a developer machine only; refused in production.
  // Number of proxies in front of the API (Netlify + Render = 2), so rate limits see the real visitor address.
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  DISABLE_RATE_LIMITS: z.enum(['0', '1']).default('0'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}

const env = parsed.data;
const distinct = new Set([env.JWT_ACCESS_SECRET, env.PHONE_ENC_KEY, env.PHONE_HASH_KEY, env.OTP_HASH_KEY].map((k) => k.toLowerCase()));
if (distinct.size !== 4) {
  console.error('Each secret key must be different. Run `npm run gen:keys`.');
  process.exit(1);
}
if (env.NODE_ENV === 'production' && env.OTP_DELIVERY === 'console') {
  console.error('OTP_DELIVERY=console is not allowed in production. Configure a real email/SMS provider.');
  process.exit(1);
}

if (env.NODE_ENV === 'production' && env.DISABLE_RATE_LIMITS === '1') {
  console.error('DISABLE_RATE_LIMITS=1 is not allowed in production.');
  process.exit(1);
}

export const config = { ...env, isProd: env.NODE_ENV === 'production', rateLimitsOff: env.DISABLE_RATE_LIMITS === '1' };
