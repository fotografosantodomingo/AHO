import { emailLayout, escapeHtml } from './_layout';

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Sent to info@advertisehomes.online when the programmatic SEO cron
 * fails — either the Anthropic call errored (network / 4xx / 5xx) or
 * the model returned HTML that didn't pass validateBlogHtml().
 *
 * The failure_reason code maps 1:1 to one of the codes in
 * `src/lib/blog/generate-post.ts:GeneratePostError`. The body also
 * includes a truncated rawBody excerpt when one is available so the
 * operator can decide whether to relax the validator or tighten the
 * prompt without round-tripping through the DB.
 */
export function renderBlogPublishFailureEmail(args: {
  topicKey: string;
  topicTitle: string;
  failureCode: string;
  detail?: string;
  /** Truncated raw model output when a validation rule rejected it.
   *  NULL for pure-network or 4xx failures. */
  rawBodyExcerpt?: string | null;
  latencyMs: number;
  attemptedAt: string; // ISO
}): RenderedEmail {
  const subject = `[AHO] Blog publish FAILED — ${args.failureCode}`;

  const rawHtml = args.rawBodyExcerpt
    ? `<p style="margin-top: 24px;"><strong>Model output (first 800 chars)</strong></p>
       <pre style="background: #f4ede1; padding: 12px; border-radius: 8px; font-size: 12px; line-height: 1.5; overflow: auto; max-width: 100%; white-space: pre-wrap;">${escapeHtml(args.rawBodyExcerpt.slice(0, 800))}</pre>`
    : '';

  const detailHtml = args.detail
    ? `<p style="font-size: 13px; color: #6b6356;"><strong>Detail:</strong> ${escapeHtml(args.detail)}</p>`
    : '';

  const bodyHtml = `
    <p>The blog cron tried to publish but didn't ship a row.</p>
    <p style="margin: 16px 0;">
      <strong>Failure code:</strong> <code>${escapeHtml(args.failureCode)}</code><br/>
      <strong>Topic:</strong> ${escapeHtml(args.topicTitle)} (<code>${escapeHtml(args.topicKey)}</code>)<br/>
      <strong>Attempt latency:</strong> ${args.latencyMs} ms<br/>
      <strong>At:</strong> ${escapeHtml(args.attemptedAt)}
    </p>
    ${detailHtml}
    ${rawHtml}
    <p style="font-size: 13px; color: #6b6356; margin-top: 24px;">
      No row was inserted; the topic is still eligible for the next run.
      If the failure code is <code>microdata_present</code> /
      <code>missing_breadcrumb</code> / <code>missing_toc</code> /
      <code>toc_anchor_orphan</code> / <code>missing_author_bio</code>,
      tighten the prompt in <code>src/lib/blog/generate-post.ts</code> or relax
      the validator in <code>src/lib/blog/html-validate.ts</code> — whichever
      matches the real intent. If it's <code>anthropic_*</code>, the next
      run will retry naturally; no action needed unless rate-limited.
    </p>
  `;

  const text = `Blog publish FAILED

Failure code: ${args.failureCode}
Topic: ${args.topicTitle} (${args.topicKey})
Attempt latency: ${args.latencyMs} ms
At: ${args.attemptedAt}
${args.detail ? `Detail: ${args.detail}\n` : ''}
${args.rawBodyExcerpt ? `\nModel output (first 800 chars):\n${args.rawBodyExcerpt.slice(0, 800)}\n` : ''}
No row inserted; topic is still eligible for the next run.

— AHO`;

  return {
    subject,
    html: emailLayout({
      preheader: `${args.failureCode} — ${args.topicTitle.slice(0, 60)}`,
      bodyHtml,
    }),
    text,
  };
}
