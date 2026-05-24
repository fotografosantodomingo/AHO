import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { importFromVoice } from '@/lib/listings/import-from-voice';

export const runtime = 'edge';

/**
 * POST /api/listings/voice-import
 *
 * Multipart audio → Whisper transcript → Claude facts. Day 6 of the
 * Content Hub roadmap. The "in-the-field" workflow from
 * docs/CONTENT_HUB_VISION.md: agent walks out of a property, taps
 * Voice Note, talks for 30s-3min, taps Stop. ~10s later the new-listing
 * form is filled.
 *
 * Auth: signed-in user. No plan gate (acquisition feature). Cost is
 * Whisper $0.006/min + Claude ~$0.06 per call ≈ $0.07 per listing —
 * well within budget at any tier.
 *
 * Multipart form:
 *   - file: audio blob (mp3/m4a/webm/wav/ogg, ≤24 MB ≈ ~10 min)
 *   - locale: optional agent UI locale (improves Whisper accuracy)
 */

export const MAX_BYTES = 24 * 1024 * 1024;
export const ALLOWED_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/wav',
  'audio/webm',
  'audio/ogg',
  'audio/flac',
];

export type AudioValidationResult =
  | { ok: true }
  | { ok: false; errorCode: 'no_file' | 'empty_file' | 'file_too_large' | 'unsupported_audio_type'; got?: string | number };

/**
 * Pure-function audio-upload validator: enforces "must be a File",
 * non-empty, ≤ MAX_BYTES, and (when a content-type is present)
 * normalizes `audio/webm;codecs=opus` style values to the base mime
 * before checking against ALLOWED_TYPES. Empty `file.type` is
 * permitted because some browsers leave it blank on MediaRecorder
 * blobs and Whisper sniffs the format from the bytes.
 *
 * Exported so unit tests can exercise the matrix without
 * mocking the auth + Supabase + Whisper boundary.
 */
export function validateAudioUpload(file: unknown): AudioValidationResult {
  if (!(file instanceof File)) return { ok: false, errorCode: 'no_file' };
  if (file.size === 0) return { ok: false, errorCode: 'empty_file' };
  if (file.size > MAX_BYTES) {
    return { ok: false, errorCode: 'file_too_large', got: file.size };
  }
  if (file.type) {
    const baseType = file.type.split(';')[0]?.trim().toLowerCase() ?? '';
    if (baseType && !ALLOWED_TYPES.includes(baseType)) {
      return { ok: false, errorCode: 'unsupported_audio_type', got: file.type };
    }
  }
  return { ok: true };
}

export async function POST(req: NextRequest) {
  const supabase = await createServerSupabaseClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: 'invalid_multipart' },
      { status: 400 },
    );
  }

  const file = form.get('file');
  // Some browsers leave content-type empty on MediaRecorder Blobs —
  // validateAudioUpload accepts those (Whisper sniffs the format from
  // the bytes). MediaRecorder usually emits `audio/webm;codecs=opus`,
  // `audio/mp4;codecs="mp4a.40.2"`, etc. — the helper normalizes to
  // the base mime before the allowlist check.
  const validation = validateAudioUpload(file);
  if (!validation.ok) {
    const status =
      validation.errorCode === 'file_too_large'
        ? 413
        : validation.errorCode === 'unsupported_audio_type'
          ? 415
          : 400;
    const body: Record<string, unknown> = { error: validation.errorCode };
    if (validation.errorCode === 'file_too_large') {
      body.limit = MAX_BYTES;
      if (validation.got !== undefined) body.got = validation.got;
    } else if (validation.errorCode === 'unsupported_audio_type' && validation.got !== undefined) {
      body.got = validation.got;
    }
    return NextResponse.json(body, { status });
  }
  // Narrow: validation.ok === true means file is a valid File.
  const audioFile = file as File;

  const localeHint = form.get('locale');
  const agentLocale =
    typeof localeHint === 'string' && /^[a-z]{2}$/i.test(localeHint)
      ? localeHint.toLowerCase()
      : undefined;

  try {
    const result = await importFromVoice({
      audio: audioFile,
      filename: audioFile.name || `voice-${Date.now()}.webm`,
      agentLocale,
    });
    return NextResponse.json(
      {
        facts: result,
        transcript: result.transcript,
      },
      { status: 200 },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[listings/voice-import]', message);
    let errorCode = 'voice_extract_failed';
    if (/Whisper API/i.test(message)) errorCode = 'transcription_failed';
    else if (/Audio file too large/i.test(message)) errorCode = 'file_too_large';
    // Don't echo raw exception text — Whisper / Claude errors can
    // include upstream API hints or transcript fragments. Stable code
    // is enough for the form to render a friendly localized message.
    return NextResponse.json(
      { error: errorCode },
      { status: 502 },
    );
  }
}
