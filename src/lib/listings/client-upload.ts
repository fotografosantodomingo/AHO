/**
 * Client-side upload orchestration shared between:
 *   - ImageUploader on the property edit page (post-create uploads)
 *   - ListingForm on the new-listing page (staged files uploaded as a
 *     batch right after the property is created)
 *
 * Three-step flow per file:
 *   1. POST /api/properties/{id}/images → server signs an R2 PUT URL
 *      and inserts a `property_images` row with upload_status='pending'.
 *      Server fills `alt_text_en` / `alt_text_es` from the request.
 *   2. PUT bytes directly to R2 using the presigned URL.
 *   3. POST /api/properties/{id}/images/{imageId}/confirm with width +
 *      height. Server flips the row to `confirmed`.
 *
 * Pure functions — no React state. Callers manage UI state and pass a
 * progress callback if they want per-file status updates.
 */

export interface UploadOneArgs {
  propertyId: string;
  file: File;
  altText: string;
  /** Optional callback to surface progress / errors to the UI. */
  onStatus?: (status: 'pending' | 'uploading' | 'confirmed' | 'error', errorCode?: string) => void;
}

export interface UploadOneResult {
  ok: boolean;
  imageId?: string;
  errorCode?: string;
}

export async function uploadOneFile(args: UploadOneArgs): Promise<UploadOneResult> {
  const { propertyId, file, altText, onStatus } = args;
  onStatus?.('uploading');

  // Step 1: server signs PUT URL + creates pending row.
  const signRes = await fetch(`/api/properties/${propertyId}/images`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      byteSize: file.size,
      altTextEn: altText,
      altTextEs: altText,
    }),
  });
  if (!signRes.ok) {
    const body = (await signRes.json().catch(() => ({}))) as { error?: string };
    const code = body?.error ?? `http_${signRes.status}`;
    onStatus?.('error', code);
    return { ok: false, errorCode: code };
  }
  const { imageId, uploadUrl, headers: putHeaders } = (await signRes.json()) as {
    imageId: string;
    uploadUrl: string;
    headers: Record<string, string>;
  };

  // Step 2: PUT bytes to R2.
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: putHeaders,
    body: file,
  });
  if (!putRes.ok) {
    const code = `r2_put_${putRes.status}`;
    onStatus?.('error', code);
    return { ok: false, imageId, errorCode: code };
  }

  // Step 3: read dimensions client-side (browser-only API), then confirm.
  const dims = await readImageDimensions(file).catch(() => ({ width: 0, height: 0 }));
  if (dims.width === 0 || dims.height === 0) {
    onStatus?.('error', 'dimensions_failed');
    return { ok: false, imageId, errorCode: 'dimensions_failed' };
  }
  const confirmRes = await fetch(
    `/api/properties/${propertyId}/images/${imageId}/confirm`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ width: dims.width, height: dims.height }),
    },
  );
  if (!confirmRes.ok) {
    const body = (await confirmRes.json().catch(() => ({}))) as { error?: string };
    const code = body?.error ?? `http_${confirmRes.status}`;
    onStatus?.('error', code);
    return { ok: false, imageId, errorCode: code };
  }

  onStatus?.('confirmed');
  return { ok: true, imageId };
}

export function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image_load_failed'));
    };
    img.src = url;
  });
}
