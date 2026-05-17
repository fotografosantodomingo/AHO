import { emailLayout, buttonPrimary, escapeHtml } from './_layout';

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Cost-alert email sent by the daily ai-cost-alert cron when one
 * of the configured thresholds was crossed yesterday:
 *   - Total daily AI spend > $50
 *   - Avg cost per audit > $1
 *
 * Recipient is the operator (currently hardcoded to info@), not the
 * end-user agents. The email summarizes what was crossed + links to
 * /admin/audit-costs for the full drill-down.
 */
export function renderAiCostAlertEmail(args: {
  date: string; // YYYY-MM-DD of the day being reported
  totalCostUsd: number;
  totalAudits: number;
  totalCalls: number;
  avgPerAuditUsd: number;
  triggeredThresholds: Array<{ kind: 'daily_total' | 'per_audit'; threshold: number; actual: number }>;
  dashboardUrl: string;
}): RenderedEmail {
  const subject = `[AHO] AI cost alert — ${args.date} · $${args.totalCostUsd.toFixed(2)}`;

  const thresholdLines = args.triggeredThresholds
    .map((t) => {
      if (t.kind === 'daily_total') {
        return `Daily total spend $${t.actual.toFixed(2)} crossed the $${t.threshold.toFixed(2)} threshold.`;
      }
      return `Average cost per audit $${t.actual.toFixed(2)} crossed the $${t.threshold.toFixed(2)} threshold.`;
    })
    .map((s) => `<li>${escapeHtml(s)}</li>`)
    .join('');

  const bodyHtml = `
    <p>Heads up — ${args.date} AI usage tripped one or more cost thresholds:</p>
    <ul style="line-height: 1.7;">
      ${thresholdLines}
    </ul>
    <p style="margin-top: 24px;"><strong>Day at a glance</strong></p>
    <ul style="line-height: 1.7;">
      <li>Total spend: <strong>$${args.totalCostUsd.toFixed(2)}</strong></li>
      <li>Audits: <strong>${args.totalAudits}</strong></li>
      <li>Total Anthropic calls: <strong>${args.totalCalls}</strong></li>
      <li>Avg cost per audit: <strong>$${args.avgPerAuditUsd.toFixed(2)}</strong> (target: $0.30)</li>
    </ul>
    <p style="margin: 32px 0;">${buttonPrimary(args.dashboardUrl, 'Open AI cost dashboard')}</p>
    <p style="font-size: 13px; color: #6b6356;">If yesterday's spike was expected (e.g. a soft-beta cohort onboarding day), no action needed. If it looks anomalous, check the Last-20-audits table on the dashboard for an outlier source URL or a runaway test loop.</p>
  `;

  const text = `Heads up — ${args.date} AI usage tripped one or more cost thresholds.

${args.triggeredThresholds
  .map((t) => {
    if (t.kind === 'daily_total') {
      return `· Daily total spend $${t.actual.toFixed(2)} > $${t.threshold.toFixed(2)} threshold`;
    }
    return `· Avg cost per audit $${t.actual.toFixed(2)} > $${t.threshold.toFixed(2)} threshold`;
  })
  .join('\n')}

Day at a glance:
  - Total spend: $${args.totalCostUsd.toFixed(2)}
  - Audits: ${args.totalAudits}
  - Total Anthropic calls: ${args.totalCalls}
  - Avg cost per audit: $${args.avgPerAuditUsd.toFixed(2)} (target: $0.30)

Open dashboard: ${args.dashboardUrl}

— AHO`;

  return {
    subject,
    html: emailLayout({
      preheader: `$${args.totalCostUsd.toFixed(2)} across ${args.totalAudits} audits — review on /admin/audit-costs`,
      bodyHtml,
    }),
    text,
  };
}
