import 'server-only';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { serverEnv } from '@/lib/env';

export type R2Body = ArrayBuffer | Uint8Array | Blob;

/**
 * R2 (Cloudflare's S3-compatible object store) signing helpers.
 *
 * R2 uses S3 protocol with these specifics:
 *   - Endpoint: `https://<account-id>.r2.cloudflarestorage.com`
 *   - Region: `auto` (R2 ignores it but the SDK requires a value)
 *   - Path-style URLs (forced via `forcePathStyle: true`)
 *
 * Signed URL TTL is 5 minutes — tight enough to limit risk if a URL leaks,
 * long enough for normal upload latency on consumer connections.
 */

const SIGNED_URL_EXPIRY_SECONDS = 300;

let cachedClient: S3Client | null = null;

function getClient(): S3Client {
  if (cachedClient) return cachedClient;
  const env = serverEnv();
  if (!env.R2_ENDPOINT || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    throw new Error(
      'R2 credentials are not set. R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY must all be present.',
    );
  }
  cachedClient = new S3Client({
    endpoint: env.R2_ENDPOINT,
    region: 'auto',
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
  return cachedClient;
}

interface PresignArgs {
  bucket: string;
  key: string;
  contentType: string;
  /** Override the default 5-minute TTL only for tests / special cases. */
  expiresInSeconds?: number;
}

export interface PresignResult {
  uploadUrl: string;
  expiresAt: string;
}

export async function presignPut(args: PresignArgs): Promise<PresignResult> {
  const client = getClient();
  const command = new PutObjectCommand({
    Bucket: args.bucket,
    Key: args.key,
    ContentType: args.contentType,
  });
  const expiresIn = args.expiresInSeconds ?? SIGNED_URL_EXPIRY_SECONDS;
  const uploadUrl = await getSignedUrl(client, command, { expiresIn });
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  return { uploadUrl, expiresAt };
}

interface PutObjectArgs {
  bucket: string;
  key: string;
  body: R2Body;
  contentType: string;
}

/**
 * Server-side PUT directly into R2 — used by flows where the bytes already
 * live on the server (URL-import photo migration). Distinct from
 * `presignPut` which hands a signed URL back to the browser for a direct
 * upload. Both end up at the same `r2_key`.
 */
export async function putObject(args: PutObjectArgs): Promise<void> {
  const client = getClient();
  const body =
    args.body instanceof Blob
      ? new Uint8Array(await args.body.arrayBuffer())
      : args.body instanceof ArrayBuffer
      ? new Uint8Array(args.body)
      : args.body;
  await client.send(
    new PutObjectCommand({
      Bucket: args.bucket,
      Key: args.key,
      Body: body,
      ContentType: args.contentType,
    }),
  );
}

/** Test seam — reset the cached client between unit-test runs. */
export function __resetR2ClientForTests() {
  cachedClient = null;
}
