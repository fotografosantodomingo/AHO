import { ImageResponse } from 'next/og';
import { LOCALES, type Locale } from '@/i18n/config';
import { createAdminClient } from '@/lib/supabase/admin';
import { interBoldFontEntry } from '@/lib/og/load-font';

export const runtime = 'edge';
export const alt = 'AHO Blog';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Per-blog-post Open Graph image. ALSO serves as the hero image for:
 *   - The in-article <img srcset> tag (cron stamps this URL into the
 *     {HERO_IMG} placeholders at publish time)
 *   - Facebook Page distribution (passed as the `imageUrl` so FB
 *     renders the post as a photo card rather than just a link)
 *   - Instagram Business distribution (the single-image carousel
 *     entry; IG REQUIRES an image to publish at all)
 *   - LinkedIn distribution (`contentThumbnailUrl`)
 *
 * One URL, four channels — no R2 upload, no per-platform image
 * pipeline. The route is publicly accessible (the master sitemap +
 * the article page link to it), which Meta's CDN + LinkedIn's
 * scraper both need to fetch the image during the publish call.
 *
 * Layout: dark forest-green background (matches AHO's wordmark
 * surface), AHO badge top-left, headline + audience pill centered,
 * dateline at the bottom. Edge-runtime + Satori under the hood; the
 * woff2-not-supported gotcha (see CLAUDE.md 2026-05-18) means we
 * vendor Inter Bold as TTF via interBoldFontEntry().
 */

interface PageParams {
  locale: string;
  slug: string;
}

interface PostRow {
  title: string;
  summary: string;
  published_at: string;
  topic_key: string;
}

const FALLBACK_TITLE = 'AHO Blog';
const FALLBACK_SUBTITLE = 'Multi-channel real-estate marketing';

async function loadPost(slug: string, locale: string): Promise<PostRow | null> {
  const admin = createAdminClient();
  // Match the page-render's locale-aware lookup so the OG image
  // shows the title in the locale matching the article URL.
  const { data, error } = await admin
    .from('blog_posts')
    .select('title, summary, published_at, topic_key')
    .eq('slug', slug)
    .eq('language', locale)
    .eq('status', 'published')
    .maybeSingle();
  if (error) {
    console.error('[blog opengraph-image] load failed', {
      slug,
      locale,
      code: error.code,
      message: error.message,
    });
    return null;
  }
  return (data as unknown as PostRow) ?? null;
}

export default async function BlogOgImage({
  params,
}: {
  params: Promise<PageParams>;
}) {
  const { locale, slug } = await params;
  if (!LOCALES.includes(locale as Locale)) return new Response('not found', { status: 404 });

  const post = await loadPost(slug, locale);
  const title = post?.title ?? FALLBACK_TITLE;
  const subtitle = post?.summary
    ? post.summary.length > 130
      ? `${post.summary.slice(0, 127).trimEnd()}…`
      : post.summary
    : FALLBACK_SUBTITLE;
  const datelabel = post?.published_at
    ? new Date(post.published_at).toISOString().slice(0, 10)
    : '';

  const fonts = await interBoldFontEntry();

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '72px 88px',
          backgroundColor: '#1d3a2d',
          color: '#f4ede1',
          fontFamily:
            '"Inter", system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif',
        }}
      >
        {/* Top row: AHO wordmark + "Blog" chip */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: 44,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: '#ffffff',
            }}
          >
            AHO
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 14,
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.13em',
              color: '#8fa896',
              border: '1px solid #355945',
              padding: '8px 18px',
              borderRadius: 999,
            }}
          >
            Blog
          </div>
        </div>

        {/* Center: title + subtitle */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: title.length > 70 ? 56 : 68,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: '-0.02em',
              maxWidth: 1024,
              color: '#ffffff',
            }}
          >
            {title}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 24,
              fontWeight: 400,
              lineHeight: 1.4,
              maxWidth: 960,
              color: '#c8d6cb',
              marginTop: 28,
            }}
          >
            {subtitle}
          </div>
        </div>

        {/* Bottom row: domain + date */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            fontSize: 20,
            fontWeight: 500,
            color: '#8fa896',
          }}
        >
          <div style={{ display: 'flex' }}>advertisehomes.online/blog</div>
          {datelabel && <div style={{ display: 'flex' }}>{datelabel}</div>}
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
