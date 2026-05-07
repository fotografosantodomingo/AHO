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

const MAX_BYTES = 24 * 1024 * 1024;
const ALLOWED_TYPES = [
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
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'no_file' }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'empty_file' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'file_too_large', limit: MAX_BYTES, got: file.size },
      { status: 413 },
    );
  }
  // Some browsers leave content-type empty on MediaRecorder Blobs —
  // accept those too; Whisper sniffs the format from the bytes.
  // Normalize to the base mime — MediaRecorder usually emits
  // `audio/webm;codecs=opus`, `audio/mp4;codecs="mp4a.40.2"`, etc.
  // We only check the part before the semicolon.
  if (file.type) {
    const baseType = file.type.split(';')[0]?.trim().toLowerCase() ?? '';
    if (baseType && !ALLOWED_TYPES.includes(baseType)) {
      return NextResponse.json(
        { error: 'unsupported_audio_type', got: file.type },
        { status: 415 },
      );
    }
  }

  const localeHint = form.get('locale');
  const agentLocale =
    typeof localeHint === 'string' && /^[a-z]{2}$/i.test(localeHint)
      ? localeHint.toLowerCase()
      : undefined;

  try {
    const result = await importFromVoice({
      audio: file,
      filename: file.name || `voice-${Date.now()}.webm`,
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
    return NextResponse.json(
      { error: errorCode, message },
      { status: 502 },
    );
  }
}
