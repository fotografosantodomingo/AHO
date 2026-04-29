import type { Config } from 'drizzle-kit';

if (!process.env.SUPABASE_POOLER_URL) {
  // eslint-disable-next-line no-console
  console.warn(
    '[drizzle.config] SUPABASE_POOLER_URL is not set. ' +
      'drizzle-kit commands will fail until the Supabase project is provisioned ' +
      'and the pooler URL is added to .env.local.',
  );
}

export default {
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.SUPABASE_POOLER_URL ?? '',
  },
  verbose: true,
  strict: true,
} satisfies Config;
