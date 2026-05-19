import { emailLayout, buttonPrimary, escapeHtml } from './_layout';
import {
  renderDistributionSummary,
  type DistributionEntry,
} from '@/lib/blog/distribute';

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Sent to info@advertisehomes.online after the programmatic SEO cron
 * (workers/blog-publish) successfully generates + inserts a new
 * article. Carries the title, slug, word count, cost, and a one-click
 * link to the live post so the operator can spot-check tone + facts.
 *
 * Per PO spec: an admin-side observability signal — NOT something we
 * surface to readers. Stays operationally quiet (no celebratory copy)
 * since it fires every ~2 days.
 */
export function renderBlogPublishSuccessEmail(args: {
  title: string;
  slug: string;
  topicKey: string;
  audience: string;
  wordCount: number;
  estimatedCostUsdCents: number;
  model: string;
  liveUrl: string;
  publishedAt: string; // ISO
  /** Per-channel distribution log from distributeBlogPost(). */
  distribution: ReadonlyArray<DistributionEntry>;
}): RenderedEmail {
  const costUsd = (args.estimatedCostUsdCents / 100).toFixed(3);
  const subject = `[AHO] Blog published — ${args.title}`;

  const bodyHtml = `
    <p>The programmatic SEO cron just published a new article.</p>
    <p style="margin: 16px 0 8px;"><strong>${escapeHtml(args.title)}</strong></p>
    <p style="font-size: 13px; color: #6b6356; margin: 0 0 24px;">
      ${escapeHtml(args.audience)} · ${args.wordCount} words · ~$${costUsd} · ${escapeHtml(args.model)}
    </p>
    <p>${buttonPrimary(args.liveUrl, 'Open the live post')}</p>
    <p style="margin: 24px 0 8px;"><strong>Distribution</strong></p>
    ${renderDistributionSummary(args.distribution)}
    <p style="font-size: 13px; color: #6b6356; margin-top: 28px;">
      Topic key: <code>${escapeHtml(args.topicKey)}</code><br/>
      Slug: <code>${escapeHtml(args.slug)}</code><br/>
      Published: ${escapeHtml(args.publishedAt)}
    </p>
    <p style="font-size: 13px; color: #6b6356;">
      Spot-check tone + facts within 24h. If the post needs editing, run
      an UPDATE on <code>blog_posts</code> directly — there's no admin UI yet.
      If it's bad enough to retract, set <code>status='archived'</code> and the
      public page will 404.
    </p>
  `;

  const distLines = args.distribution
    .map((e) => {
      if (e.status === 'posted') return `  · ${e.channel}: ✓ posted${e.external_url ? ` (${e.external_url})` : ''}`;
      if (e.status === 'failed') return `  · ${e.channel}: ✗ failed (${e.error_code ?? 'unknown'})`;
      if (e.status === 'skipped') return `  · ${e.channel}: — skipped (${e.skip_reason ?? 'no_reason'})`;
      return `  · ${e.channel}: ${e.status}`;
    })
    .join('\n');

  const text = `Blog published — ${args.title}

${args.audience} · ${args.wordCount} words · ~$${costUsd} · ${args.model}

Open: ${args.liveUrl}

Distribution:
${distLines}

Topic key: ${args.topicKey}
Slug: ${args.slug}
Published: ${args.publishedAt}

Spot-check within 24h. To edit: UPDATE blog_posts. To retract: set status='archived'.

— AHO`;

  return {
    subject,
    html: emailLayout({
      preheader: `${args.wordCount} words on "${args.title.slice(0, 60)}"`,
      bodyHtml,
    }),
    text,
  };
}
