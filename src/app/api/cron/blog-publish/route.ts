import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { serverEnv, publicEnv } from '@/lib/env';
import { checkCronAuth } from '@/app/api/cron/meta-insights/route';
import { BLOG_TOPIC_POOL, pickTopic, type BlogTopic } from '@/lib/blog/topic-pool';
import { PRIMARY_AUTHOR, ARTICLE_REVIEWER } from '@/lib/blog/author';
import {
  generateBlogPost,
  stampBodyPlaceholders,
} from '@/lib/blog/generate-post';
import { buildBlogSlug } from '@/lib/blog/slug';
import { distributeBlogPost } from '@/lib/blog/distribute';
import {
  translateBlogPost,
  type TranslateLocale,
} from '@/lib/blog/translate-post';
import { sendEmail } from '@/lib/email/brevo';
import { renderBlogPublishSuccessEmail } from '@/lib/email/templates/blog-publish-success';
import { renderBlogPublishFailureEmail } from '@/lib/email/templates/blog-publish-failure';

export const runtime = 'edge';

/**
 * GET /api/cron/blog-publish
 *
 * Programmatic SEO cron — fires daily at 09:00 UTC from
 * `workers/blog-publish/`, applies a 50% skip-roll for human-like
 * cadence (so the on-paper interval averages ~every 2 days while
 * being statistically irregular — no fixed-day bot footprint),
 * picks an unused topic, generates an article via Anthropic, inserts
 * it into `blog_posts(status='published')`, and emails the operator
 * with stats on success or with the failure code + raw model output
 * on rejection.
 *
 * Auth: shared CRON_SECRET bearer via checkCronAuth (same pattern as
 * the other 6 AHO crons).
 *
 * Query overrides (back-fill / dry-run / debug):
 *   ?force=1            Skip the 50% jitter — always attempt this run.
 *                       Required when the operator triggers a manual
 *                       run. The cron worker NEVER passes this.
 *   ?topic_key=<key>    Generate for the exact topic key, bypassing
 *                       the random picker. Useful for one-off
 *                       coverage. Still respects dedup unless
 *                       ?force=1 is also passed.
 *   ?dry_run=1          Generate + validate, but don't insert and
 *                       don't email. Returns the article JSON in the
 *                       HTTP response for local QA.
 *
 * Idempotency: a topic shipped in the last 90 days is excluded from
 * the random pick (see DEDUP_WINDOW_DAYS). For the same date + same
 * topic_key, `buildBlogSlug` produces the same slug — a duplicate
 * insert hits the unique index and the cron treats that as a no-op.
 */

const DEDUP_WINDOW_DAYS = 90;
const SKIP_PROBABILITY = 0.5;
const ADMIN_EMAIL = 'info@advertisehomes.online';

interface CronSummary {
  ok: boolean;
  outcome:
    | 'skipped_jitter'
    | 'all_topics_recently_covered'
    | 'no_anthropic_key'
    | 'ai_failed'
    | 'insert_failed'
    | 'published'
    | 'dry_run';
  errorCode?: string;
  topicKey?: string;
  slug?: string;
  title?: string;
}

async function handle(req: NextRequest): Promise<NextResponse<CronSummary>> {
  const env = serverEnv();
  const auth = checkCronAuth({
    authorizationHeader: req.headers.get('authorization'),
    expectedSecret: env.CRON_SECRET,
  });
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, outcome: 'no_anthropic_key', errorCode: auth.errorCode },
      { status: auth.status },
    );
  }

  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';
  const dryRun = url.searchParams.get('dry_run') === '1';
  const forcedTopicKey = url.searchParams.get('topic_key');

  // ─── Step 1: jitter ────────────────────────────────────────────────
  if (!force && Math.random() < SKIP_PROBABILITY) {
    return NextResponse.json({
      ok: true,
      outcome: 'skipped_jitter',
    });
  }

  // ─── Step 2: pick topic ────────────────────────────────────────────
  const admin = createAdminClient();
  const dedupSince = new Date(
    Date.now() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  );
  const { data: recentRows } = await admin
    .from('blog_posts')
    .select('topic_key')
    .gte('created_at', dedupSince.toISOString());
  const recentKeys = new Set<string>(
    (recentRows ?? []).map((r) => (r as { topic_key: string }).topic_key),
  );

  let topic: BlogTopic | null;
  if (forcedTopicKey) {
    topic =
      BLOG_TOPIC_POOL.find((t) => t.key === forcedTopicKey) ?? null;
    if (!topic) {
      return NextResponse.json(
        {
          ok: false,
          outcome: 'all_topics_recently_covered',
          errorCode: 'unknown_topic_key',
        },
        { status: 400 },
      );
    }
    if (!force && recentKeys.has(topic.key)) {
      return NextResponse.json(
        {
          ok: false,
          outcome: 'all_topics_recently_covered',
          errorCode: 'topic_in_dedup_window',
          topicKey: topic.key,
        },
        { status: 200 },
      );
    }
  } else {
    topic = pickTopic(recentKeys);
    if (!topic) {
      return NextResponse.json(
        { ok: true, outcome: 'all_topics_recently_covered' },
        { status: 200 },
      );
    }
  }

  // ─── Step 3: AI generate ───────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { ok: false, outcome: 'no_anthropic_key', errorCode: 'ANTHROPIC_API_KEY missing' },
      { status: 503 },
    );
  }

  const result = await generateBlogPost(topic, apiKey);

  if (!result.ok) {
    // Persist the failure as an `ai_failed` row so /admin can surface
    // a streak of failures. Also email the operator.
    const failureRowSlug = buildBlogSlug({
      title: `failed-${topic.title}`,
      topicKey: topic.key,
      isoDay: new Date().toISOString().slice(0, 10),
    });
    const { error: insertErr } = await admin.from('blog_posts').insert({
      slug: failureRowSlug,
      topic_key: topic.key,
      language: 'en',
      title: `[failed] ${topic.title}`,
      summary: '(AI generation failed — see failure_reason)',
      body_html: '<!-- generation failed -->',
      author_name: PRIMARY_AUTHOR.name,
      author_role: PRIMARY_AUTHOR.role,
      author_url: PRIMARY_AUTHOR.url,
      reviewer_name: ARTICLE_REVIEWER?.name ?? null,
      word_count: 0,
      status: 'ai_failed',
      failure_reason: `${result.error}${result.detail ? `: ${result.detail.slice(0, 280)}` : ''}`,
    });
    if (insertErr) {
      console.error('[blog-publish] ai_failed row insert failed', {
        code: insertErr.code,
        message: insertErr.message,
      });
    }

    // Failure email — always sent so the operator notices a streak.
    const failureEmail = renderBlogPublishFailureEmail({
      topicKey: topic.key,
      topicTitle: topic.title,
      failureCode: result.error,
      detail: result.detail,
      rawBodyExcerpt: result.rawBody,
      latencyMs: result.latencyMs,
      attemptedAt: new Date().toISOString(),
    });
    const emailResult = await sendEmail({
      to: ADMIN_EMAIL,
      subject: failureEmail.subject,
      html: failureEmail.html,
      text: failureEmail.text,
    });
    if (!emailResult.sent) {
      console.error('[blog-publish] failure email send failed', emailResult.error);
    }

    return NextResponse.json(
      {
        ok: false,
        outcome: 'ai_failed',
        errorCode: result.error,
        topicKey: topic.key,
      },
      { status: 200 },
    );
  }

  // ─── Step 4: stamp placeholders + build slug ──────────────────────
  const publishedAt = new Date();
  const isoDay = publishedAt.toISOString().slice(0, 10);
  const slug = buildBlogSlug({
    title: result.title,
    topicKey: topic.key,
    isoDay,
  });

  // Hero image — served dynamically by
  // src/app/[locale]/blog/[slug]/opengraph-image.tsx (Satori), one URL
  // for all 3 channels (FB Page photo card + IG single-image post +
  // LinkedIn thumbnail) AND for the in-article <img srcset>. Browser
  // scales the same 1200x630 source for the srcset variants — good
  // enough for editorial hero cards in v1.
  //
  // URL pattern: Next.js's auto-generated OG endpoint lives at
  // <segment>/opengraph-image with content-type image/png — NO `.png`
  // suffix. The .png URL 404s with an HTML body (first cron run on
  // 2026-05-19 made that mistake; patched here + the live row was
  // back-filled via a one-off UPDATE).
  const { NEXT_PUBLIC_SITE_URL: site } = publicEnv();
  const heroImageUrl = `${site}/en/blog/${slug}/opengraph-image`;
  const stampedHtml = stampBodyPlaceholders({
    html: result.bodyHtml,
    wordCount: result.wordCount,
    publishedAt,
    heroImageUrl,
    heroImageSrcsetByWidth: {
      400: heroImageUrl,
      800: heroImageUrl,
      1200: heroImageUrl,
    },
  });

  // ─── Step 5: dry-run early exit ───────────────────────────────────
  if (dryRun) {
    return NextResponse.json({
      ok: true,
      outcome: 'dry_run',
      topicKey: topic.key,
      slug,
      title: result.title,
    });
  }

  // ─── Step 6: insert (EN canonical) ────────────────────────────────
  // Generate the translation group id up-front so we can share it
  // across the EN + 6 translated sibling inserts. The DB trigger
  // would default it to row.id on a single-row insert, but we want
  // the explicit group id so the parallel translation inserts can
  // reference it without an extra round-trip read.
  const translationGroupId = crypto.randomUUID();
  const { error: insertErr } = await admin.from('blog_posts').insert({
    slug,
    translation_group_id: translationGroupId,
    topic_key: topic.key,
    language: 'en',
    title: result.title,
    summary: result.summary,
    body_html: stampedHtml,
    hero_image_url: heroImageUrl,
    author_name: result.authorName,
    author_role: result.authorRole,
    author_url: result.authorUrl,
    reviewer_name: result.reviewerName,
    reviewed_at: publishedAt.toISOString(),
    word_count: result.wordCount,
    status: 'published',
    published_at: publishedAt.toISOString(),
    model: result.model,
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    estimated_cost_usd_cents: result.estimatedCostUsdCents,
  });
  if (insertErr) {
    console.error('[blog-publish] insert failed', {
      code: insertErr.code,
      message: insertErr.message,
      details: insertErr.details,
      hint: insertErr.hint,
    });
    return NextResponse.json(
      {
        ok: false,
        outcome: 'insert_failed',
        errorCode: insertErr.code ?? 'unknown',
        topicKey: topic.key,
        slug,
      },
      { status: 500 },
    );
  }

  // ─── Step 6.5: translate to the 6 marketing locales ──────────────
  // Each translation is a parallel Anthropic Haiku call. Failures
  // skip that single locale (logged + counted in translationsByLocale)
  // — they don't roll back the EN publish. Per-locale slug is built
  // from the translated title so URLs are localized:
  //   /es/blog/captura-de-leads-de-whatsapp-...-05c32c
  //   /pl/blog/przechwytywanie-leadow-z-whatsappa-...-05c32c
  // The shared 6-char hash suffix (from buildBlogSlug) keeps them
  // group-aligned for human inspection.
  //
  // Per-locale OG hero URL points at the locale-specific slug;
  // /[locale]/blog/[slug]/opengraph-image reads the row's title and
  // renders the Satori card in the target language.
  const TARGET_LOCALES: TranslateLocale[] = ['es', 'pl', 'pt', 'de', 'fr', 'it'];
  const apiKeyForTranslation = process.env.ANTHROPIC_API_KEY ?? '';
  const translationJobs = TARGET_LOCALES.map(async (locale) => {
    const translated = await translateBlogPost({
      apiKey: apiKeyForTranslation,
      targetLocale: locale,
      enTitle: result.title,
      enSummary: result.summary,
      enBodyHtml: result.bodyHtml,
    });
    if (!translated.ok) {
      console.warn('[blog-publish] translation failed', {
        locale,
        error: translated.error,
        detail: translated.detail?.slice(0, 200),
      });
      return { locale, ok: false as const, error: translated.error };
    }
    const localeSlug = buildBlogSlug({
      title: translated.title,
      topicKey: topic.key,
      isoDay,
    });
    const localeHeroUrl = `${site}/${locale}/blog/${localeSlug}/opengraph-image`;
    const localeStampedHtml = stampBodyPlaceholders({
      html: translated.bodyHtml,
      wordCount: result.wordCount,
      publishedAt,
      heroImageUrl: localeHeroUrl,
      heroImageSrcsetByWidth: {
        400: localeHeroUrl,
        800: localeHeroUrl,
        1200: localeHeroUrl,
      },
    });
    const { error: localeInsertErr } = await admin.from('blog_posts').insert({
      slug: localeSlug,
      translation_group_id: translationGroupId,
      topic_key: topic.key,
      language: locale,
      title: translated.title,
      summary: translated.summary,
      body_html: localeStampedHtml,
      hero_image_url: localeHeroUrl,
      author_name: result.authorName,
      author_role: result.authorRole,
      author_url: result.authorUrl,
      reviewer_name: result.reviewerName,
      reviewed_at: publishedAt.toISOString(),
      word_count: result.wordCount,
      status: 'published',
      published_at: publishedAt.toISOString(),
      model: translated.model,
      input_tokens: translated.inputTokens,
      output_tokens: translated.outputTokens,
      estimated_cost_usd_cents: translated.estimatedCostUsdCents,
    });
    if (localeInsertErr) {
      console.error('[blog-publish] translated insert failed', {
        locale,
        code: localeInsertErr.code,
        message: localeInsertErr.message,
      });
      return { locale, ok: false as const, error: 'insert_failed' };
    }
    return { locale, ok: true as const, slug: localeSlug };
  });
  const translationResults = await Promise.all(translationJobs);
  const translatedOk = translationResults.filter((r) => r.ok).length;
  console.log(`[blog-publish] translations: ${translatedOk}/${TARGET_LOCALES.length} ok`);

  // ─── Step 7: distribution to admin's connected social accounts ────
  // Run AFTER the insert so the publicUrl + heroImageUrl resolve to a
  // live page. Distribution failures DO NOT roll back the post —
  // they're logged into `blog_posts.distribution` JSONB and reported
  // in the success email. The post itself is the durable artifact.
  const liveUrl = `${site}/en/blog/${slug}`;
  const distributionEnabled = process.env.BLOG_DISTRIBUTION_ENABLED !== 'false';
  const distributionEntries = await distributeBlogPost({
    admin,
    post: {
      title: result.title,
      summary: result.summary,
      publicUrl: liveUrl,
      heroImageUrl,
    },
    tokenEncryptionKey: env.AHO_TOKEN_ENCRYPTION_KEY ?? '',
    enabled: distributionEnabled && Boolean(env.AHO_TOKEN_ENCRYPTION_KEY),
  });
  // Best-effort write into the row's distribution JSONB. Don't fail
  // the cron if this update errors — the post is already live.
  {
    const { error: distErr } = await admin
      .from('blog_posts')
      .update({ distribution: distributionEntries })
      .eq('slug', slug);
    if (distErr) {
      console.error('[blog-publish] distribution JSONB update failed', {
        code: distErr.code,
        message: distErr.message,
      });
    }
  }

  // ─── Step 8: success email ────────────────────────────────────────
  const successEmail = renderBlogPublishSuccessEmail({
    title: result.title,
    slug,
    topicKey: topic.key,
    audience: topic.audience,
    wordCount: result.wordCount,
    estimatedCostUsdCents: result.estimatedCostUsdCents,
    model: result.model,
    liveUrl,
    publishedAt: publishedAt.toISOString(),
    distribution: distributionEntries,
  });
  const emailResult = await sendEmail({
    to: ADMIN_EMAIL,
    subject: successEmail.subject,
    html: successEmail.html,
    text: successEmail.text,
  });
  if (!emailResult.sent) {
    console.error('[blog-publish] success email send failed', emailResult.error);
  }

  return NextResponse.json({
    ok: true,
    outcome: 'published',
    topicKey: topic.key,
    slug,
    title: result.title,
  });
}

export async function GET(req: NextRequest): Promise<NextResponse<CronSummary>> {
  return handle(req);
}
