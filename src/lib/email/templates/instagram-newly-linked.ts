import { emailLayout, buttonPrimary, escapeHtml } from './_layout';

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Email sent by the daily Instagram drift cron when an agent has
 * newly linked an IG Business account to one of their FB Pages in
 * Meta Business Suite — but hasn't yet clicked "Reconnect" on AHO,
 * so we haven't seen the IG account in our token store.
 *
 * Phase 3 of `docs/INSTAGRAM_SHARING_PLAN.md`. One email per
 * (agent, IG account); the `meta_drift_notifications` table
 * de-duplicates so the same agent doesn't get re-pinged every day.
 *
 * Voice: short, helpful, action-oriented. Single CTA to /dashboard/social.
 */
export function renderInstagramNewlyLinkedEmail(args: {
  agentName: string | null;
  igUsername: string | null;
  pageName: string | null;
  reconnectUrl: string;
}): RenderedEmail {
  const greeting = args.agentName ? `Hi ${args.agentName},` : 'Hi,';
  const igLabel = args.igUsername ? `@${args.igUsername}` : 'your Instagram Business account';
  const pageLabel = args.pageName ? `<strong>${escapeHtml(args.pageName)}</strong>` : 'one of your Facebook Pages';

  const subject = args.igUsername
    ? `Instagram (@${args.igUsername}) is ready to publish on AHO`
    : 'Instagram is ready to publish on AHO';

  const bodyHtml = `
    <p>${greeting}</p>
    <p>We noticed you linked Instagram ${escapeHtml(igLabel)} to ${pageLabel} in Meta Business Suite — nice.</p>
    <p>One last step on AHO: click <strong>Reconnect</strong> on your Social dashboard so we can write the Instagram token into your account. After that, the Instagram checkbox shows up alongside Facebook on every listing share.</p>
    <p style="margin: 32px 0;">${buttonPrimary(args.reconnectUrl, 'Open Social dashboard')}</p>
    <p style="font-size: 13px; color: #6b6356;">Takes ~10 seconds. You'll see the Meta consent screen one more time — just approve and you're done.</p>
  `;

  const text = `${greeting}

We noticed you linked Instagram ${args.igUsername ? `@${args.igUsername}` : 'your IG Business account'} to ${args.pageName ?? 'one of your Facebook Pages'} in Meta Business Suite.

One last step on AHO: click "Reconnect" on your Social dashboard so we can write the Instagram token into your account.

${args.reconnectUrl}

Takes ~10 seconds. You'll see the Meta consent screen one more time — approve and you're done.

— AHO`;

  return {
    subject,
    html: emailLayout({
      preheader: args.igUsername
        ? `Click Reconnect to enable Instagram publishing for @${args.igUsername}`
        : 'Click Reconnect to enable Instagram publishing',
      bodyHtml,
    }),
    text,
  };
}
