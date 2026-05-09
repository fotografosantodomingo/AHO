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
  // Cloudflare Images account hash. Public — appears in every
  // `imagedelivery.net/<hash>/<id>/<variant>` URL we render. Activated
  // and provisioned 2026-05-07; before that, every property image fell
  // back to R2 originals (R12 in RISKS.md, now resolved).
  NEXT_PUBLIC_CF_IMAGES_HASH: z.string().optional(),
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
  CLOUDFLARE_API_TOKEN: z.string().optional(),
  CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
  // Meta (Facebook + Instagram) OAuth + Marketing API. The App ID is
  // technically public (it appears in OAuth dialog URLs) but stays in
  // server env to discourage hard-coding. The App Secret is sensitive
  // and never reaches the client.
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  /** Graph API version override for the Meta Insights cron writer.
   *  Optional — when unset, the writer uses the version pinned in
   *  `src/lib/oauth/meta.ts` (`META_GRAPH_VERSION`). Lets ops bump the
   *  Insights writer ahead of the OAuth surface (or vice versa) without
   *  a code change. Format: `vNN.N` (e.g. `v18.0`, `v21.0`). */
  META_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, 'META_GRAPH_API_VERSION must look like v18.0')
    .optional(),
  /** Shared bearer secret for the cron-trigger HTTP routes
   *  (`/api/cron/*`). The external scheduler (Cloudflare Worker on a
   *  CRON trigger, GitHub Actions, or Upstash QStash) hits the route
   *  with `Authorization: Bearer <CRON_SECRET>` and the route refuses
   *  any other request. Same secret across LinkedIn + Meta + future
   *  cron writers — coordinated naming so ops only rotates one value. */
  CRON_SECRET: z.string().min(16).optional(),
  /** Facebook Login for Business — Configuration ID for the AHO app.
   *  Public identifier. The Configuration bundles permissions + login
   *  variant + access-token type (we use User access token; FB Pages
   *  permissions; no Instagram in v1). Replaces the old scope= param
   *  in the OAuth dialog URL. */
  META_LOGIN_CONFIG_ID: z.string().optional(),
  // Threads — separate Meta app + secret. Wired up alongside Meta but
  // not used for Sprint-1 OAuth (Threads has its own dialog endpoint).
  THREADS_APP_ID: z.string().optional(),
  THREADS_APP_SECRET: z.string().optional(),
  // AES-256 key (hex) for ad_platform_tokens encryption-at-rest.
  // Doubles as the HMAC secret for the OAuth state cookie. Lost ⇒
  // existing stored tokens are unrecoverable; users must re-connect.
  AHO_TOKEN_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, 'AHO_TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
    .optional(),
  // Anthropic API key for the AI Copywriter pipeline (Sprint 1+).
  ANTHROPIC_API_KEY: z.string().optional(),
  /** OpenAI API key — used for Whisper STT in the voice-import flow.
   *  Anthropic doesn't expose STT, so we run Whisper for transcript
   *  then hand the text to Claude for fact extraction (same shape as
   *  URL-import). Cost: ~$0.006/minute audio. */
  OPENAI_API_KEY: z.string().optional(),
  SENTRY_DSN_WEB: z.string().optional(),
  SENTRY_DSN_WORKERS: z.string().optional(),
  AHO_FOUNDER_RATE_WINDOW_END: z.string().datetime().optional(),
  // R2 — separate from the Cloudflare API token. Created in the R2 dashboard.
  R2_ENDPOINT: z.string().url().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_PROPERTY_IMAGES: z.string().optional(),
  // openexchangerates.org App ID for the price-tile currency converter.
  // Free tier = USD base, 1000 requests/month. With 24h DB cache we
  // hit it ~30×/month per process. Optional — when missing, the
  // converter no-ops and price tiles render only the source currency.
  OPENEXCHANGERATES_APP_ID: z.string().optional(),
  // LinkedIn Marketing API version. LinkedIn versions every endpoint
  // by month (e.g. `202504`); our writer pins this header
  // (`LinkedIn-Version`) per call. Bump after smoke-testing against
  // a new month's API. Optional in env so unit tests don't need it;
  // the cron route fails closed at runtime when missing.
  LINKEDIN_API_VERSION: z.string().regex(/^\d{6}$/, 'YYYYMM').optional(),
  // Shared bearer secret for cron-triggered API routes (LinkedIn /
  // Meta insights writers, etc.). The external scheduler (GitHub
  // Actions cron / cron-job.org) sends `Authorization: Bearer
  // ${CRON_SECRET}`; a missing or mismatched value yields 401. Length
  // requirement matches the random 32-byte minimum we generate via
  // `openssl rand -hex 32`.
  CRON_SECRET: z.string().min(32).optional(),
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
    NEXT_PUBLIC_CF_IMAGES_HASH: process.env.NEXT_PUBLIC_CF_IMAGES_HASH,
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
