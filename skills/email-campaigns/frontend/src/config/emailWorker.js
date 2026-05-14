// Cloudflare Worker base URL for the email-marketing send endpoint.
// The worker exposes POST /email/send and verifies the caller's Supabase
// session via the Authorization: Bearer <access_token> header.
export const EMAIL_WORKER_BASE_URL =
	'https://kibay-drive-pipeline.sweet-math-09d2.workers.dev';
