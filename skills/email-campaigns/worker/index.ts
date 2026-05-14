// =============================================================================
// Email-campaigns Worker — greenfield standalone entry.
//
// Routes:
//   POST /email/send              — admin sends campaign / test / inline (JWT)
//   GET  /unsubscribe?email=&sig= — HMAC-signed self-suppression
//   POST /webhooks/brevo?secret=  — Brevo event ingest → email_logs
//   POST /newsletter/welcome      — fires welcome + admin notice after signup
//   GET  /calendar/order/:id.ics  — order reservation .ics (used by send-order-email)
//   GET  /health                  — liveness probe
//
// Brand-portable: change BRAND constants below. Everything else is generic.
// If you prefer env-var lookup (env.BRAND_NAME etc), see worker/README.md.
// =============================================================================

import {
	sendBrevoEmail,
	signUnsubscribeUrl,
	verifyUnsubscribeToken,
	unsubscribeResultPage,
	verifyCalendarToken,
	escapeHtml,
	EmailEnv,
} from './email';

// -----------------------------------------------------------------------------
// BRAND CONSTANTS — replace these for each brand. Used in:
//   - welcome email body + footer chrome
//   - admin newsletter notice ("New subscriber" template)
//   - unsubscribe confirmation page ("Back to <brand>" link)
//   - email signature / wordmark
//
// PORTABILITY: every Kibay-specific runtime string in this file is exposed
// through BRAND (chrome/identity) or CONTENT (body copy). The intent is that
// installing for another vertical means editing ONLY these two consts +
// content-template.json at the skill root. See ../content-template.json
// for the canonical shape and ../examples/real-estate/ for a non-wine example.
// -----------------------------------------------------------------------------
const BRAND = {
	name: 'Kibay',
	domain: 'kibay.com.do',
	siteUrl: 'https://kibay.com.do',
	tagline: 'Vino Espumoso Orgánico del Caribe',
	taglineEn: 'Premium Caribbean Organic Sparkling Wine',
	address: 'Bahía de Ocoa, Km 6 1/2 Hatillo, Azua 71003 · República Dominicana',
	adminPathContacts: '/admin/email/contacts',
	gold: '#D4A574', // accent rule + buttons
	timezone: 'America/Santo_Domingo',
	locale: 'es-DO',
	socials: {
		instagram: 'https://www.instagram.com/kibaywine',
		facebook: 'https://www.facebook.com/profile.php?id=61589761255222',
		tiktok: 'https://www.tiktok.com/@kibaywine',
		linkedin: 'https://www.linkedin.com/company/116054911',
	},
	copyright: '© Kibay · Hecho en la República Dominicana',
	// Reservation venue address used by /calendar/order/:id.ics — replace if
	// your brand has physical experience bookings.
	reservationLocation: 'Bahía de Ocoa, Km 6/12 Hatillo, Azua 71003, DO',
} as const;

// -----------------------------------------------------------------------------
// CONTENT — body copy for the welcome email + admin notice. Edit per vertical.
// The shape mirrors content-template.json at the skill root. {{brand_name}} and
// {{email}} / {{admin_path}} / {{first_name}} are filled in at render time.
// -----------------------------------------------------------------------------
const CONTENT = {
	newsletter_welcome: {
		subjectEs: `Bienvenido/a a ${BRAND.name} — gracias por suscribirte`,
		subjectEn: `Welcome to ${BRAND.name} — thanks for subscribing`,
		kickerEs: 'Bienvenido/a a la lista',
		kickerEn: 'Welcome to the list',
		headingGreetingEs: 'gracias por suscribirte',
		headingGreetingEn: 'thanks for subscribing',
		introEs: `Ya estás en la lista de ${BRAND.name}. Te escribiremos de vez en cuando — sin spam, sin prisa.`,
		introEn: `You're on the ${BRAND.name} list. We'll write occasionally — no spam, no rush.`,
		ctaLabelEs: `Explorar ${BRAND.name}`,
		ctaLabelEn: `Explore ${BRAND.name}`,
		ctaUrl: BRAND.siteUrl,
		unsubscribeLabelEs: 'Cancelar suscripción',
		unsubscribeLabelEn: 'Unsubscribe',
	},
	newsletter_admin_notice: {
		kicker: `${BRAND.name} admin · newsletter`,
		heading: 'Nuevo suscriptor',
		emailLabel: 'Email',
		nameLabel: 'Nombre',
		sourceLabel: 'Fuente',
		sourceValue: 'Formulario footer',
		timeLabel: 'Hora',
		ctaLabel: `Ver en ${BRAND.adminPathContacts}`,
		subjectPrefix: `[${BRAND.name}]`,
		subjectText: 'Nuevo suscriptor',
	},
	unsubscribe_page: {
		successMessage: `You won't receive marketing emails from ${BRAND.name}. You can resubscribe anytime by replying.`,
	},
} as const;

interface SupabaseEnv {
	SUPABASE_URL: string;
	SUPABASE_SERVICE_ROLE_KEY: string;
}

interface Env extends SupabaseEnv, EmailEnv {
	BREVO_WEBHOOK_SECRET?: string;
}

// CORS allowlist for browser-called endpoints. Add your admin SPA origins.
const ALLOWED_ORIGINS = new Set([
	`https://${BRAND.domain}`,
	`https://www.${BRAND.domain}`,
	'http://localhost:5173',
	'http://localhost:4173',
]);

function corsHeaders(req: Request): Record<string, string> {
	const origin = req.headers.get('Origin') || '';
	if (!ALLOWED_ORIGINS.has(origin)) return {};
	return {
		'Access-Control-Allow-Origin': origin,
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Authorization, Content-Type',
		'Access-Control-Max-Age': '86400',
		Vary: 'Origin',
	};
}

function withCors(res: Response, req: Request): Response {
	const ch = corsHeaders(req);
	if (!Object.keys(ch).length) return res;
	const headers = new Headers(res.headers);
	for (const [k, v] of Object.entries(ch)) headers.set(k, v);
	return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);

		if (req.method === 'OPTIONS' && url.pathname.startsWith('/email/')) {
			return new Response(null, { status: 204, headers: corsHeaders(req) });
		}

		if (url.pathname === '/health') return new Response('ok');

		// GET /calendar/order/:id.ics?sig=<hmac>
		{
			const m = url.pathname.match(/^\/calendar\/order\/([0-9a-f-]+)\.ics$/i);
			if (m && req.method === 'GET') {
				return handleCalendarIcs(env, m[1], url.searchParams.get('sig') || '');
			}
		}

		if (url.pathname === '/newsletter/welcome' && req.method === 'POST') {
			try {
				const body = (await req.json()) as { email?: string; first_name?: string };
				const email = (body.email || '').trim().toLowerCase();
				if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
					return withCors(jsonResp({ ok: false, error: 'invalid email' }, 400), req);
				}
				// Verify the address is actually in newsletter_subscribers before sending.
				// Prevents anon clients from spamming arbitrary addresses.
				const checkR = await fetch(
					`${env.SUPABASE_URL}/rest/v1/newsletter_subscribers?email=eq.${encodeURIComponent(email)}&select=email,first_name&limit=1`,
					{
						headers: {
							apikey: env.SUPABASE_SERVICE_ROLE_KEY,
							Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
						},
					},
				);
				const subs = (await checkR.json()) as Array<{ email: string; first_name?: string | null }>;
				if (!subs.length) {
					return withCors(jsonResp({ ok: false, error: 'not a subscriber' }, 404), req);
				}
				const firstName = body.first_name || subs[0].first_name || '';
				const unsubUrl = await signUnsubscribeUrl(env, email);
				const html = renderWelcomeEmail(firstName, unsubUrl);
				// 1. Customer welcome
				await sendBrevoEmail(env, {
					to: [{ email, name: firstName || undefined }],
					subject: CONTENT.newsletter_welcome.subjectEs,
					htmlContent: html,
					replyTo: { email: env.REVIEW_EMAIL_TO, name: BRAND.name },
					tags: ['newsletter-welcome'],
				});
				// 2. Admin notice. Best-effort: a failure here doesn't undo the customer send.
				try {
					const adminHtml = renderNewsletterAdminNotice(email, firstName);
					await sendBrevoEmail(env, {
						to: [{ email: env.REVIEW_EMAIL_TO, name: `${BRAND.name} Admin` }],
						subject: `${CONTENT.newsletter_admin_notice.subjectPrefix} ${CONTENT.newsletter_admin_notice.subjectText}: ${email}`,
						htmlContent: adminHtml,
						tags: ['newsletter-admin-notify'],
					});
				} catch (adminErr) {
					console.error('admin notify failed (non-fatal):', adminErr);
				}
				return withCors(jsonResp({ ok: true }, 200), req);
			} catch (e) {
				console.error('/newsletter/welcome error:', e);
				return withCors(jsonResp({ ok: false, error: (e as Error).message }, 500), req);
			}
		}

		if (url.pathname === '/email/send' && req.method === 'POST') {
			const auth = await verifyAdminAuth(env, req);
			if (!auth.ok) return withCors(new Response(auth.body, { status: auth.status }), req);
			try {
				return withCors(await handleEmailSend(env, req, auth.email), req);
			} catch (e) {
				console.error('/email/send error:', e);
				return withCors(jsonResp({ ok: false, error: (e as Error).message }, 500), req);
			}
		}

		if (url.pathname === '/unsubscribe' && req.method === 'GET') {
			const email = url.searchParams.get('email') || '';
			const sig = url.searchParams.get('sig') || '';
			if (!email) return unsubscribeResultPage(false, '', 'Missing email', { brandName: BRAND.name, siteUrl: BRAND.siteUrl });
			const ok = await verifyUnsubscribeToken(env, email, sig);
			if (!ok) return unsubscribeResultPage(false, email, 'Invalid or tampered link', { brandName: BRAND.name, siteUrl: BRAND.siteUrl });
			try {
				await patchContactStatusByEmail(env, email, 'unsubscribed');
			} catch (e) {
				console.error('unsubscribe: contact patch failed:', e);
			}
			// Best-effort Brevo blocklist sync.
			try {
				const r = await fetch('https://api.brevo.com/v3/contacts', {
					method: 'POST',
					headers: {
						'api-key': env.BREVO_API_KEY,
						'content-type': 'application/json',
						accept: 'application/json',
					},
					body: JSON.stringify({ email, emailBlacklisted: true, updateEnabled: true }),
				});
				if (!r.ok) {
					console.error(`unsubscribe: brevo blocklist failed: ${r.status} ${await r.text()}`);
				}
			} catch (e) {
				console.error('unsubscribe: brevo blocklist error:', e);
			}
			return unsubscribeResultPage(
				true,
				email,
				CONTENT.unsubscribe_page.successMessage,
				{ brandName: BRAND.name, siteUrl: BRAND.siteUrl },
			);
		}

		if (url.pathname === '/webhooks/brevo' && req.method === 'POST') {
			if (!env.BREVO_WEBHOOK_SECRET) {
				return new Response('webhook not configured', { status: 500 });
			}
			const secret = url.searchParams.get('secret');
			if (secret !== env.BREVO_WEBHOOK_SECRET) {
				return new Response('unauthorized', { status: 401 });
			}
			let payload: unknown;
			try {
				payload = await req.json();
			} catch {
				return new Response('bad json', { status: 400 });
			}
			const events: BrevoEvent[] = Array.isArray(payload)
				? (payload as BrevoEvent[])
				: [payload as BrevoEvent];
			for (const ev of events) {
				try {
					await handleBrevoEvent(env, ev);
				} catch (e) {
					console.error('brevo webhook event handling failed:', e, ev);
				}
			}
			return new Response('OK', { status: 200 });
		}

		return new Response('not found', { status: 404 });
	},
};

function jsonResp(obj: unknown, status = 200): Response {
	return new Response(JSON.stringify(obj), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

// =============================================================================
// Admin auth — verifies a Supabase JWT belongs to env.REVIEW_EMAIL_TO.
// =============================================================================

interface AdminAuthOk { ok: true; email: string }
interface AdminAuthErr { ok: false; status: number; body: string }

async function verifyAdminAuth(env: Env, req: Request): Promise<AdminAuthOk | AdminAuthErr> {
	const authHeader = req.headers.get('authorization') || req.headers.get('Authorization') || '';
	if (!authHeader.toLowerCase().startsWith('bearer ')) {
		return { ok: false, status: 401, body: 'missing auth' };
	}
	const userR = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
		headers: {
			apikey: env.SUPABASE_SERVICE_ROLE_KEY,
			Authorization: authHeader,
		},
	});
	if (!userR.ok) {
		return { ok: false, status: 401, body: await userR.text() };
	}
	const userJ = (await userR.json()) as { email?: string };
	if (!userJ.email || userJ.email.toLowerCase() !== env.REVIEW_EMAIL_TO.toLowerCase()) {
		return { ok: false, status: 403, body: 'forbidden' };
	}
	return { ok: true, email: userJ.email };
}

// =============================================================================
// /email/send body parsing + dispatch
// =============================================================================

interface SegmentFilter {
	segments?: string[];
	tags?: string[];
	status?: string;
}

interface InlineSendInput {
	name?: string;
	subject: string;
	htmlContent: string;
	fromName?: string;
	fromEmail?: string;
	replyTo?: string;
	segmentFilter?: SegmentFilter;
}

interface EmailSendBody {
	campaignId?: string;
	inline?: InlineSendInput;
	testTo?: string;
	recipientEmails?: string[];
}

interface CampaignRow {
	id: string;
	name: string;
	subject: string;
	html_content: string;
	from_name: string | null;
	from_email: string | null;
	reply_to: string | null;
	segment_filter: SegmentFilter | null;
	status: string;
}

interface ContactRow {
	id: string;
	email: string;
	first_name: string | null;
	last_name: string | null;
	segment: string;
	subtype_tags: string[] | null;
	merge_vars: Record<string, string | number | boolean> | null;
	status: string;
}

async function handleEmailSend(env: Env, req: Request, adminEmail: string): Promise<Response> {
	let body: EmailSendBody;
	try {
		body = (await req.json()) as EmailSendBody;
	} catch {
		return jsonResp({ ok: false, error: 'bad json' }, 400);
	}

	if (body.campaignId && body.inline) {
		return jsonResp({ ok: false, error: 'campaignId and inline are mutually exclusive' }, 400);
	}
	if (!body.campaignId && !body.inline) {
		return jsonResp({ ok: false, error: 'campaignId or inline required' }, 400);
	}

	let campaign: CampaignRow | null = null;
	let subject: string;
	let htmlContent: string;
	let fromName: string | undefined;
	let fromEmail: string | undefined;
	let replyToEmail: string | undefined;
	let segmentFilter: SegmentFilter;

	if (body.campaignId) {
		campaign = await loadCampaign(env, body.campaignId);
		if (!campaign) return jsonResp({ ok: false, error: 'campaign not found' }, 404);
		if (campaign.status === 'sent' && !body.testTo) {
			return jsonResp({ ok: false, error: 'already sent' }, 400);
		}
		subject = campaign.subject;
		htmlContent = campaign.html_content;
		fromName = campaign.from_name || undefined;
		fromEmail = campaign.from_email || undefined;
		replyToEmail = campaign.reply_to || undefined;
		segmentFilter = campaign.segment_filter || {};
	} else {
		const inline = body.inline as InlineSendInput;
		if (!inline.subject || !inline.htmlContent) {
			return jsonResp({ ok: false, error: 'inline.subject and inline.htmlContent required' }, 400);
		}
		subject = inline.subject;
		htmlContent = inline.htmlContent;
		fromName = inline.fromName;
		fromEmail = inline.fromEmail;
		replyToEmail = inline.replyTo;
		segmentFilter = inline.segmentFilter || {};
	}

	// ---- Test mode: one address, no logs, no campaign mutation -------------
	if (body.testTo) {
		const testEmail = body.testTo;
		const finalHtml = await injectUnsubscribeFooter(env, htmlContent, testEmail);
		const result = await sendBrevoEmail(env, {
			to: [{ email: testEmail }],
			subject: `[TEST] ${subject}`,
			htmlContent: finalHtml,
			fromName,
			fromEmail,
			replyTo: replyToEmail ? { email: replyToEmail } : undefined,
			tags: campaign ? [`campaign:${campaign.id}`, 'test'] : ['inline', 'test'],
		});
		return jsonResp({ ok: true, mode: 'test', sentTo: testEmail, messageId: result.messageId });
	}

	// ---- Resolve recipients --------------------------------------------------
	let recipients: ContactRow[];
	if (body.recipientEmails && body.recipientEmails.length > 0) {
		recipients = await loadContactsByEmails(env, body.recipientEmails);
		const seen = new Set(recipients.map((r) => r.email.toLowerCase()));
		for (const e of body.recipientEmails) {
			if (!seen.has(e.toLowerCase())) {
				recipients.push({
					id: '',
					email: e,
					first_name: null,
					last_name: null,
					segment: 'individual',
					subtype_tags: [],
					merge_vars: {},
					status: 'active',
				});
			}
		}
		recipients = recipients.filter((r) => r.status !== 'unsubscribed' && r.status !== 'bounced');
	} else {
		recipients = await loadContactsBySegment(env, segmentFilter);
	}

	if (campaign) {
		try {
			await patchCampaign(env, campaign.id, { status: 'sending' });
		} catch (e) {
			console.error('campaign status->sending failed:', e);
		}
	}

	let sentCount = 0;
	let failedCount = 0;
	const errors: Array<{ email: string; error: string }> = [];

	for (const c of recipients) {
		try {
			const finalHtml = await injectUnsubscribeFooter(env, htmlContent, c.email);
			const params =
				c.merge_vars && Object.keys(c.merge_vars).length > 0 ? c.merge_vars : undefined;
			const recipientName =
				[c.first_name, c.last_name].filter(Boolean).join(' ').trim() || undefined;
			const result = await sendBrevoEmail(env, {
				to: [{ email: c.email, name: recipientName, params }],
				subject,
				htmlContent: finalHtml,
				fromName,
				fromEmail,
				replyTo: replyToEmail ? { email: replyToEmail } : undefined,
				tags: campaign
					? [`campaign:${campaign.id}`, `segment:${c.segment}`]
					: ['inline', `segment:${c.segment}`],
			});
			await insertEmailLog(env, {
				campaign_id: campaign ? campaign.id : null,
				recipient: c.email,
				contact_id: c.id || null,
				message_id: result.messageId || null,
				campaign_type: c.segment,
				status: 'sent',
				sent_at: new Date().toISOString(),
			});
			sentCount++;
		} catch (e) {
			failedCount++;
			const msg = (e as Error).message || String(e);
			errors.push({ email: c.email, error: msg });
			try {
				await insertEmailLog(env, {
					campaign_id: campaign ? campaign.id : null,
					recipient: c.email,
					contact_id: c.id || null,
					message_id: null,
					campaign_type: c.segment,
					status: 'failed',
					bounce_reason: msg,
				});
			} catch (logErr) {
				console.error('failed-log insert failed:', logErr);
			}
		}
	}

	if (campaign) {
		try {
			await patchCampaign(env, campaign.id, {
				status: failedCount === recipients.length && recipients.length > 0 ? 'failed' : 'sent',
				sent_at: new Date().toISOString(),
				recipients_count: sentCount,
				sent_by: adminEmail,
			});
		} catch (e) {
			console.error('campaign finalize failed:', e);
		}
	}

	return jsonResp({
		ok: true,
		mode: campaign ? 'campaign' : 'inline',
		campaignId: campaign ? campaign.id : null,
		sentCount,
		failedCount,
		errors,
	});
}

async function injectUnsubscribeFooter(
	env: Env,
	html: string,
	recipientEmail: string,
): Promise<string> {
	const unsubUrl = await signUnsubscribeUrl(env, recipientEmail);
	const escapedEmail = escapeHtml(recipientEmail);
	const escapedUrl = escapeHtml(unsubUrl);
	const footer = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;border-top:1px solid #eee;padding-top:16px;">
<tr><td align="center" style="font-size:12px;color:#888;text-align:center;line-height:1.6;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
<a href="${escapedUrl}" style="color:#888;text-decoration:underline;">Unsubscribe</a>
&nbsp;·&nbsp;
<a href="${BRAND.siteUrl}" style="color:#888;text-decoration:underline;">${BRAND.name}</a>
<br/>
Sent to ${escapedEmail}
</td></tr></table>`;
	if (/<\/body>/i.test(html)) {
		return html.replace(/<\/body>/i, `${footer}</body>`);
	}
	return html + footer;
}

// =============================================================================
// Supabase REST helpers (service role, bypasses RLS).
// =============================================================================

function emailHeaders(env: Env): Record<string, string> {
	return {
		apikey: env.SUPABASE_SERVICE_ROLE_KEY,
		Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
		'Content-Type': 'application/json',
	};
}

async function loadCampaign(env: Env, id: string): Promise<CampaignRow | null> {
	const u = `${env.SUPABASE_URL}/rest/v1/email_campaigns?id=eq.${encodeURIComponent(
		id,
	)}&select=id,name,subject,html_content,from_name,from_email,reply_to,segment_filter,status&limit=1`;
	const r = await fetch(u, { headers: emailHeaders(env) });
	if (!r.ok) return null;
	const rows = (await r.json()) as CampaignRow[];
	return rows[0] ?? null;
}

async function patchCampaign(env: Env, id: string, fields: Record<string, unknown>): Promise<void> {
	const u = `${env.SUPABASE_URL}/rest/v1/email_campaigns?id=eq.${encodeURIComponent(id)}`;
	const r = await fetch(u, {
		method: 'PATCH',
		headers: emailHeaders(env),
		body: JSON.stringify(fields),
	});
	if (!r.ok) throw new Error(`campaign patch failed: ${r.status} ${await r.text()}`);
}

async function loadContactsByEmails(env: Env, emails: string[]): Promise<ContactRow[]> {
	if (emails.length === 0) return [];
	const list = emails.map((e) => `"${e.replace(/"/g, '\\"')}"`).join(',');
	const u = `${env.SUPABASE_URL}/rest/v1/email_contacts?email=in.(${encodeURIComponent(
		list,
	)})&select=id,email,first_name,last_name,segment,subtype_tags,merge_vars,status`;
	const r = await fetch(u, { headers: emailHeaders(env) });
	if (!r.ok) throw new Error(`contact lookup failed: ${r.status} ${await r.text()}`);
	return (await r.json()) as ContactRow[];
}

async function loadContactsBySegment(env: Env, filter: SegmentFilter): Promise<ContactRow[]> {
	const status = filter.status || 'active';
	const params: string[] = [
		'select=id,email,first_name,last_name,segment,subtype_tags,merge_vars,status',
		`status=eq.${encodeURIComponent(status)}`,
	];
	if (filter.segments && filter.segments.length > 0) {
		const seg = filter.segments.map((s) => `"${s.replace(/"/g, '\\"')}"`).join(',');
		params.push(`segment=in.(${encodeURIComponent(seg)})`);
	}
	if (filter.tags && filter.tags.length > 0) {
		const tagList = filter.tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(',');
		params.push(`subtype_tags=ov.{${encodeURIComponent(tagList)}}`);
	}
	const u = `${env.SUPABASE_URL}/rest/v1/email_contacts?${params.join('&')}`;
	const r = await fetch(u, { headers: emailHeaders(env) });
	if (!r.ok) throw new Error(`contact segment query failed: ${r.status} ${await r.text()}`);
	const rows = (await r.json()) as ContactRow[];
	return rows.filter((c) => c.status !== 'unsubscribed' && c.status !== 'bounced');
}

interface EmailLogInsert {
	campaign_id: string | null;
	recipient: string;
	contact_id: string | null;
	message_id: string | null;
	campaign_type: string | null;
	status: string;
	sent_at?: string;
	bounce_reason?: string;
}

async function insertEmailLog(env: Env, row: EmailLogInsert): Promise<void> {
	const u = `${env.SUPABASE_URL}/rest/v1/email_logs`;
	const r = await fetch(u, {
		method: 'POST',
		headers: emailHeaders(env),
		body: JSON.stringify(row),
	});
	if (!r.ok) throw new Error(`email_logs insert failed: ${r.status} ${await r.text()}`);
}

async function patchContactStatusByEmail(env: Env, email: string, status: string): Promise<void> {
	const u = `${env.SUPABASE_URL}/rest/v1/email_contacts?email=eq.${encodeURIComponent(email)}`;
	const r = await fetch(u, {
		method: 'PATCH',
		headers: emailHeaders(env),
		body: JSON.stringify({ status }),
	});
	if (!r.ok) throw new Error(`contact patch failed: ${r.status} ${await r.text()}`);
}

// =============================================================================
// Brevo webhook event mapper. Updates email_logs by message_id.
// =============================================================================

interface BrevoEvent {
	event?: string;
	email?: string;
	'message-id'?: string;
	date?: string;
	reason?: string;
	tag?: string;
	[k: string]: unknown;
}

async function handleBrevoEvent(env: Env, ev: BrevoEvent): Promise<void> {
	const eventName = (ev.event || '').toLowerCase();
	const messageId = ev['message-id'];
	const email = ev.email;
	if (!messageId) {
		console.warn('brevo webhook: event missing message-id', ev);
		return;
	}

	const patch: Record<string, unknown> = { raw_event: ev };
	let alsoSuppressContact: 'unsubscribed' | 'bounced' | null = null;
	let skipIfAlreadyOpened = false;
	let onlyIfStatusNotTerminal = false;

	switch (eventName) {
		case 'request':
		case 'sent':
			patch.status = 'sent';
			if (ev.date) patch.sent_at = new Date(ev.date).toISOString();
			onlyIfStatusNotTerminal = true;
			break;
		case 'delivered':
			patch.status = 'delivered';
			patch.delivered_at = ev.date ? new Date(ev.date).toISOString() : new Date().toISOString();
			break;
		case 'opened':
		case 'unique_opened':
			patch.status = 'opened';
			patch.opened_at = ev.date ? new Date(ev.date).toISOString() : new Date().toISOString();
			skipIfAlreadyOpened = true;
			break;
		case 'click':
		case 'clicked':
			patch.status = 'clicked';
			patch.clicked_at = ev.date ? new Date(ev.date).toISOString() : new Date().toISOString();
			break;
		case 'hard_bounce':
			patch.status = 'bounced';
			patch.bounced_at = ev.date ? new Date(ev.date).toISOString() : new Date().toISOString();
			if (ev.reason) patch.bounce_reason = ev.reason;
			alsoSuppressContact = 'bounced';
			break;
		case 'soft_bounce':
			patch.status = 'soft_bounced';
			patch.bounced_at = ev.date ? new Date(ev.date).toISOString() : new Date().toISOString();
			if (ev.reason) patch.bounce_reason = ev.reason;
			break;
		case 'spam':
			patch.status = 'spam';
			break;
		case 'unsubscribed':
			patch.status = 'unsubscribed';
			alsoSuppressContact = 'unsubscribed';
			break;
		case 'blocked':
			patch.status = 'blocked';
			if (ev.reason) patch.bounce_reason = ev.reason;
			break;
		case 'deferred':
			patch.status = 'deferred';
			if (ev.reason) patch.bounce_reason = ev.reason;
			break;
		default:
			console.warn(`brevo webhook: unhandled event '${eventName}'`);
			break;
	}

	let query = `${env.SUPABASE_URL}/rest/v1/email_logs?message_id=eq.${encodeURIComponent(messageId)}`;
	if (skipIfAlreadyOpened) {
		query += '&opened_at=is.null&status=neq.clicked';
	}
	if (onlyIfStatusNotTerminal) {
		query += '&status=in.(queued,failed)';
	}
	const r = await fetch(query, {
		method: 'PATCH',
		headers: { ...emailHeaders(env), Prefer: 'return=representation' },
		body: JSON.stringify(patch),
	});
	if (!r.ok) {
		console.error(`brevo webhook: log patch failed: ${r.status} ${await r.text()}`);
	} else {
		const updated = (await r.json()) as unknown[];
		if (!updated.length) {
			console.warn(
				`brevo webhook: no email_logs row matched message_id=${messageId} (event=${eventName})`,
			);
		}
	}

	if (alsoSuppressContact && email) {
		try {
			await patchContactStatusByEmail(env, email, alsoSuppressContact);
		} catch (e) {
			console.error(`brevo webhook: contact suppress (${alsoSuppressContact}) failed:`, e);
		}
	}
}

// =============================================================================
// Calendar (.ics) handler — used by send-order-email's "Add to calendar" button.
// Verifies HMAC, fetches order + order_items + product duration, emits VEVENT(s).
// Safe to omit if you don't have a reservation/experience product model.
// =============================================================================

interface OrderRow { id: string; order_number: string }
interface OrderItemRow {
	id: string;
	product_id: string;
	product_name: string;
	metadata: {
		reservation_date?: string;
		reservation_time?: string;
		duration_minutes?: number;
	} | null;
}
interface ProductRow { id: string; metadata: { duration_minutes?: number } | null }

const AST_OFFSET_MIN = 4 * 60; // AST = UTC-4, no DST. Adjust for your venue.

function calReservationToUtc(dateStr: string, timeStr: string): Date {
	const [y, m, d] = dateStr.split('-').map(Number);
	const [hh, mm] = timeStr.split(':').map(Number);
	return new Date(
		Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0) + AST_OFFSET_MIN * 60 * 1000,
	);
}

function calFmtIcsUtc(d: Date): string {
	const pad = (n: number): string => String(n).padStart(2, '0');
	return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
		`T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function icsEscape(s: string): string {
	return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function icsFoldLine(line: string): string {
	const encoder = new TextEncoder();
	const out: string[] = [];
	let buf = '';
	let len = 0;
	for (const ch of line) {
		const chLen = encoder.encode(ch).length;
		if (len + chLen > 75) {
			out.push(buf);
			buf = ' ' + ch;
			len = 1 + chLen;
		} else {
			buf += ch;
			len += chLen;
		}
	}
	if (buf) out.push(buf);
	return out.join('\r\n');
}

function buildIcs(events: Array<{
	uid: string;
	summary: string;
	startUtc: Date;
	endUtc: Date;
	location: string;
	description: string;
}>): string {
	const nowStamp = calFmtIcsUtc(new Date());
	const lines: string[] = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		`PRODID:-//${BRAND.name}//Reservations//EN`,
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
	];
	for (const ev of events) {
		lines.push('BEGIN:VEVENT');
		lines.push(`UID:${ev.uid}`);
		lines.push(`DTSTAMP:${nowStamp}`);
		lines.push(`DTSTART:${calFmtIcsUtc(ev.startUtc)}`);
		lines.push(`DTEND:${calFmtIcsUtc(ev.endUtc)}`);
		lines.push(`SUMMARY:${icsEscape(ev.summary)}`);
		lines.push(`LOCATION:${icsEscape(ev.location)}`);
		lines.push(`DESCRIPTION:${icsEscape(ev.description)}`);
		lines.push('STATUS:CONFIRMED');
		lines.push('END:VEVENT');
	}
	lines.push('END:VCALENDAR');
	return lines.map(icsFoldLine).join('\r\n') + '\r\n';
}

async function handleCalendarIcs(env: Env, orderId: string, sig: string): Promise<Response> {
	if (!sig) return new Response('missing sig', { status: 400 });
	const ok = await verifyCalendarToken(env, orderId, sig);
	if (!ok) return new Response('invalid signature', { status: 403 });

	const headers = {
		apikey: env.SUPABASE_SERVICE_ROLE_KEY,
		Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
	};

	const orderResp = await fetch(
		`${env.SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=id,order_number&limit=1`,
		{ headers },
	);
	if (!orderResp.ok) return new Response('order lookup failed', { status: 500 });
	const orders = (await orderResp.json()) as OrderRow[];
	if (!orders.length) return new Response('order not found', { status: 404 });
	const order = orders[0];

	const itemsResp = await fetch(
		`${env.SUPABASE_URL}/rest/v1/order_items?order_id=eq.${encodeURIComponent(orderId)}&select=id,product_id,product_name,metadata`,
		{ headers },
	);
	if (!itemsResp.ok) return new Response('items lookup failed', { status: 500 });
	const items = (await itemsResp.json()) as OrderItemRow[];
	const reservations = items.filter((i) => i.metadata?.reservation_date);
	if (reservations.length === 0) {
		// Return an empty (but valid) calendar rather than 404 for mixed orders.
		return new Response(buildIcs([]), {
			headers: {
				'Content-Type': 'text/calendar; charset=utf-8',
				'Content-Disposition': `attachment; filename="${BRAND.name.toLowerCase()}-reservation.ics"`,
			},
		});
	}

	const productIds = Array.from(new Set(reservations.map((r) => r.product_id).filter(Boolean)));
	const durationByProduct = new Map<string, number>();
	if (productIds.length > 0) {
		const idList = productIds.map((p) => `"${p.replace(/"/g, '\\"')}"`).join(',');
		const prodResp = await fetch(
			`${env.SUPABASE_URL}/rest/v1/products?id=in.(${encodeURIComponent(idList)})&select=id,metadata`,
			{ headers },
		);
		if (prodResp.ok) {
			const prodRows = (await prodResp.json()) as ProductRow[];
			for (const p of prodRows) {
				if (typeof p.metadata?.duration_minutes === 'number') {
					durationByProduct.set(p.id, p.metadata.duration_minutes);
				}
			}
		}
	}

	const events = reservations.map((r) => {
		const date = r.metadata!.reservation_date!;
		const time = r.metadata!.reservation_time || '11:00';
		const startUtc = calReservationToUtc(date, time);
		const durationMin = r.metadata?.duration_minutes ?? durationByProduct.get(r.product_id) ?? 120;
		const endUtc = new Date(startUtc.getTime() + durationMin * 60 * 1000);
		return {
			uid: `${BRAND.name.toLowerCase()}-${order.id}-${r.id}@${BRAND.domain}`,
			summary: `Reserva ${BRAND.name}: ${r.product_name}`,
			startUtc,
			endUtc,
			location: BRAND.reservationLocation,
			description: `Orden ${order.order_number} — ${BRAND.name} reservation. Questions: ${env.REVIEW_EMAIL_TO}`,
		};
	});

	return new Response(buildIcs(events), {
		headers: {
			'Content-Type': 'text/calendar; charset=utf-8',
			'Content-Disposition': `attachment; filename="${BRAND.name.toLowerCase()}-reservation.ics"`,
		},
	});
}

// =============================================================================
// Email templates — welcome + admin notice. Edit copy to match your brand.
// =============================================================================

function renderNewsletterAdminNotice(email: string, firstName: string): string {
	const when = new Date().toLocaleString(BRAND.locale, { timeZone: BRAND.timezone });
	return `<!doctype html><html><body style="margin:0;padding:0;background:#f5f5f4;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1c1917;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="padding:24px 16px;background:#f5f5f4;"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border:1px solid #e7e5e4;border-radius:8px;">
  <tr><td style="padding:20px 24px;border-bottom:1px solid #e7e5e4;">
    <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#a8a29e;">${CONTENT.newsletter_admin_notice.kicker}</div>
    <h1 style="margin:4px 0 0;font-size:18px;font-weight:600;color:#1c1917;">${CONTENT.newsletter_admin_notice.heading}</h1>
  </td></tr>
  <tr><td style="padding:20px 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-size:13px;color:#44403c;">
      <tr><td style="padding:4px 0;color:#78716c;width:130px;">${CONTENT.newsletter_admin_notice.emailLabel}</td><td style="padding:4px 0;font-family:Menlo,Consolas,monospace;color:#1c1917;">${escapeHtml(email)}</td></tr>
      ${firstName ? `<tr><td style="padding:4px 0;color:#78716c;">${CONTENT.newsletter_admin_notice.nameLabel}</td><td style="padding:4px 0;">${escapeHtml(firstName)}</td></tr>` : ''}
      <tr><td style="padding:4px 0;color:#78716c;">${CONTENT.newsletter_admin_notice.sourceLabel}</td><td style="padding:4px 0;">${CONTENT.newsletter_admin_notice.sourceValue}</td></tr>
      <tr><td style="padding:4px 0;color:#78716c;">${CONTENT.newsletter_admin_notice.timeLabel}</td><td style="padding:4px 0;">${escapeHtml(when)}</td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:0 24px 24px;">
    <a href="${BRAND.siteUrl}${BRAND.adminPathContacts}" style="display:inline-block;padding:10px 16px;background:#1c1917;color:#ffffff;border-radius:6px;font-size:13px;font-weight:500;text-decoration:none;">${CONTENT.newsletter_admin_notice.ctaLabel}</a>
  </td></tr>
</table></td></tr></table>
</body></html>`;
}

function renderWelcomeEmail(firstName: string, unsubUrl: string): string {
	const greeting = firstName ? `Hola ${escapeHtml(firstName)},` : 'Hola,';
	const socials = BRAND.socials;
	return `<!doctype html>
<html lang="es">
<body style="margin:0;padding:0;background:#f4f4f0;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0;background:#f4f4f0;">
    <tr><td align="center">
      <table role="presentation" width="560" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);">
        <tr><td style="padding:32px 40px 0;" align="center">
          <div style="font-family:Georgia,serif;font-size:30px;font-weight:600;letter-spacing:1.5px;color:#1a1a1a;">${BRAND.name}</div>
          <div style="height:2px;width:56px;background:${BRAND.gold};margin:12px auto 0;"></div>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#aaa;margin-top:10px;">${BRAND.tagline}</div>
        </td></tr>
        <tr><td style="padding:32px 40px 8px;">
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:1.5px;color:#999;">${CONTENT.newsletter_welcome.kickerEs}</div>
          <h1 style="margin:10px 0 0;font-size:24px;font-weight:600;line-height:1.3;">${greeting} ${CONTENT.newsletter_welcome.headingGreetingEs}</h1>
          <p style="margin:14px 0 0;color:#666;font-size:15px;line-height:1.65;">${CONTENT.newsletter_welcome.introEs}</p>
        </td></tr>
        <tr><td style="padding:28px 40px 8px;" align="center">
          <a href="${BRAND.siteUrl}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:600;font-size:15px;letter-spacing:0.3px;">${CONTENT.newsletter_welcome.ctaLabelEs}</a>
        </td></tr>
        <tr><td style="padding:0 40px;"><div style="height:1px;background:#eee;margin-top:24px;"></div></td></tr>
        <tr><td style="padding:24px 40px 28px;text-align:center;">
          <div style="font-family:Georgia,serif;font-size:18px;font-weight:600;color:#1a1a1a;letter-spacing:0.5px;">${BRAND.name}</div>
          <div style="font-size:11px;color:#999;margin-top:14px;">${BRAND.address}</div>
          <div style="margin-top:18px;">
            <a href="${socials.instagram}" style="display:inline-block;margin:0 6px;color:#888;font-size:12px;text-decoration:none;">Instagram</a><span style="color:#ddd;">·</span>
            <a href="${socials.facebook}" style="display:inline-block;margin:0 6px;color:#888;font-size:12px;text-decoration:none;">Facebook</a><span style="color:#ddd;">·</span>
            <a href="${socials.tiktok}" style="display:inline-block;margin:0 6px;color:#888;font-size:12px;text-decoration:none;">TikTok</a><span style="color:#ddd;">·</span>
            <a href="${socials.linkedin}" style="display:inline-block;margin:0 6px;color:#888;font-size:12px;text-decoration:none;">LinkedIn</a>
          </div>
          <div style="font-size:11px;color:#aaa;margin-top:16px;">
            <a href="${unsubUrl}" style="color:#aaa;text-decoration:underline;">${CONTENT.newsletter_welcome.unsubscribeLabelEs}</a> · <a href="${BRAND.siteUrl}" style="color:#aaa;text-decoration:none;">${BRAND.domain}</a>
          </div>
          <div style="font-size:10px;color:#bbb;margin-top:14px;letter-spacing:0.5px;text-transform:uppercase;">${BRAND.copyright}</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
