import { z } from 'zod';

/**
 * Validated environment configuration.
 *
 * - `NEXT_PUBLIC_*` variables are inlined into the client bundle by Next.js.
 *   Never put a secret behind that prefix.
 * - Server-only secrets are validated lazily inside `serverEnv()` so client
 *   bundles don't fail at build time when secrets aren't available there.
 */

const publicSchema = z.object({
  // Required at build + runtime — no default. A missing value used to silently
  // resolve to localhost:3000, which then leaked into Supabase email-redirect
  // URLs in deployed builds. Better to fail at module-load than to ship a
  // build that emails users a localhost link.
  NEXT_PUBLIC_SITE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: z.string().url().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  // Cloudflare Turnstile site key. When set, the auth forms render the
  // bot-challenge widget and the form refuses to submit without a token.
  // Pair with the SECRET key configured in Supabase Project Settings →
  // Auth → Captcha (so Supabase can verify tokens server-side).
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
  // Cloudflare R2 public dev URL (or custom domain) for serving the
  // bucket's contents read-only to browsers. Used by listing-card +
  // property-gallery as a fallback when no Cloudflare Images variant
  // ID exists. Format: https://pub-<hash>.r2.dev (no trailing slash).
  NEXT_PUBLIC_R2_PUBLIC_URL: z.string().url().optional(),
});

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  SUPABASE_DB_PASSWORD: z.string().optional(),
  SUPABASE_POOLER_URL: z.string().optional(),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  // Brevo (transactional emails sent FROM AHO — welcome, lead notifications,
  // admin new-user notifications, 3DS-challenge). Note: Supabase auth emails
  // (signup confirmation, password reset, magic link) go through Supabase's
  // own SMTP config, NOT this key. Both must be wired separately.
  BREVO_API_KEY: z.string().optional(),
  BREVO_FROM_EMAIL: z.string().email().optional(),
  BREVO_FROM_NAME: z.string().optional(),
  /** Where admin notifications (new signups, etc.) get delivered. */
  ADMIN_EMAIL: z.string().email().optional(),
  // Resend was the previous email provider. Kept optional in the schema so
  // legacy `.env.local` files don't fail validation; no code reads it.
  RESEND_API_KEY: z.string().optional(),
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  SENTRY_DSN_WEB: z.string().optional(),
  SENTRY_DSN_WORKERS: z.string().optional(),
  AHO_FOUNDER_RATE_WINDOW_END: z.string().datetime().optional(),
  // R2 — separate from the Cloudflare API token. Created in the R2 dashboard.
  R2_ENDPOINT: z.string().url().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_PROPERTY_IMAGES: z.string().optional(),
});

export type PublicEnv = z.infer<typeof publicSchema>;
export type ServerEnv = z.infer<typeof serverSchema>;

let cachedPublic: PublicEnv | null = null;
let cachedServer: ServerEnv | null = null;

export function publicEnv(): PublicEnv {
  if (cachedPublic) return cachedPublic;
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    NEXT_PUBLIC_R2_PUBLIC_URL: process.env.NEXT_PUBLIC_R2_PUBLIC_URL,
  });
  if (!parsed.success) {
    throw new Error(
      'Invalid public environment: ' + JSON.stringify(parsed.error.flatten().fieldErrors),
    );
  }
  cachedPublic = parsed.data;
  return cachedPublic;
}

export function serverEnv(): ServerEnv {
  if (cachedServer) return cachedServer;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      'Invalid server environment: ' + JSON.stringify(parsed.error.flatten().fieldErrors),
    );
  }
  cachedServer = parsed.data;
  return cachedServer;
}
