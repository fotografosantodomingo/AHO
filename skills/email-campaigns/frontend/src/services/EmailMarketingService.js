// Thin wrapper around the Cloudflare Worker /email/send endpoint.
// Auth: forwards the current Supabase session's access_token as a bearer.
import { supabase } from '@/lib/customSupabaseClient';
import { EMAIL_WORKER_BASE_URL } from '@/config/emailWorker';

export async function getCurrentSessionToken() {
	const { data, error } = await supabase.auth.getSession();
	if (error) throw error;
	const token = data?.session?.access_token;
	if (!token) {
		throw new Error('Not authenticated — please sign in again.');
	}
	return token;
}

/**
 * Send a campaign via the worker.
 *
 * One of these forms must be supplied:
 *   { campaignId }              — full broadcast: worker resolves recipients
 *                                 from the campaign's segment_filter.
 *   { campaignId, testTo }      — send a single test to one address; do not
 *                                 mark the campaign as sent.
 *   { recipientEmails, inline } — ad-hoc transactional send. `inline` carries
 *                                 { subject, htmlContent, fromName, fromEmail,
 *                                   replyTo } when no saved campaign is used.
 */
export async function sendCampaign({
	campaignId,
	testTo,
	recipientEmails,
	inline,
} = {}) {
	const token = await getCurrentSessionToken();
	const body = {};
	if (campaignId) body.campaignId = campaignId;
	if (testTo) body.testTo = testTo;
	if (recipientEmails) body.recipientEmails = recipientEmails;
	if (inline) body.inline = inline;

	const res = await fetch(`${EMAIL_WORKER_BASE_URL}/email/send`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(body),
	});

	let json = null;
	try {
		json = await res.json();
	} catch {
		/* response might be empty */
	}

	if (!res.ok) {
		const msg = json?.error || json?.message || `Worker error ${res.status}`;
		const err = new Error(msg);
		err.status = res.status;
		err.payload = json;
		throw err;
	}

	return json || {};
}

export default { sendCampaign, getCurrentSessionToken };
