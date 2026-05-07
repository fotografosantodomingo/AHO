import { describe, expect, it } from 'vitest';
import {
  ALLOWED_TYPES,
  MAX_BYTES,
  validateAudioUpload,
} from '@/app/api/listings/voice-import/route';
import { MAX_AUDIO_BYTES } from '@/lib/listings/import-from-voice';

/**
 * Voice-import tests focus on the validation surface that runs BEFORE
 * any Whisper/Anthropic call:
 *
 *   - File size cap (24 MB)
 *   - MIME type allowlist
 *   - MIME type normalization (strip codecs/charset suffix)
 *   - Edge cases: missing file, empty file, blank content-type
 */

/**
 * Build a fake `File` of a specific size + type. Uses a sparse
 * Uint8Array so the test stays fast even at 24 MB.
 */
function makeFakeFile(args: {
  size: number;
  type: string;
  name?: string;
}): File {
  // Avoid actually allocating 24 MB of bytes — File accepts BlobParts
  // and reports `size` based on the underlying buffers. We use a
  // single Uint8Array sized to `args.size`. Node's Blob impl handles
  // multi-MB allocations fine in vitest.
  const data = new Uint8Array(args.size);
  return new File([data], args.name ?? 'audio.bin', { type: args.type });
}

describe('MAX_BYTES + MAX_AUDIO_BYTES are aligned', () => {
  it('matches between the route and the lib (24 MB)', () => {
    expect(MAX_BYTES).toBe(24 * 1024 * 1024);
    expect(MAX_AUDIO_BYTES).toBe(24 * 1024 * 1024);
    expect(MAX_BYTES).toBe(MAX_AUDIO_BYTES);
  });
});

describe('validateAudioUpload — file presence', () => {
  it('rejects a missing file (string from FormData)', () => {
    const result = validateAudioUpload('audio.webm');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('no_file');
  });

  it('rejects null', () => {
    const result = validateAudioUpload(null);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('no_file');
  });

  it('rejects an empty file', () => {
    const file = makeFakeFile({ size: 0, type: 'audio/webm' });
    const result = validateAudioUpload(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('empty_file');
  });
});

describe('validateAudioUpload — size cap', () => {
  it('accepts files at exactly the cap', () => {
    const file = makeFakeFile({ size: MAX_BYTES, type: 'audio/webm' });
    expect(validateAudioUpload(file).ok).toBe(true);
  });

  it('rejects 24 MB + 1 byte', () => {
    const file = makeFakeFile({ size: MAX_BYTES + 1, type: 'audio/webm' });
    const result = validateAudioUpload(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errorCode).toBe('file_too_large');
      expect(result.got).toBe(MAX_BYTES + 1);
    }
  });
});

describe('validateAudioUpload — MIME allowlist', () => {
  it('accepts every type on the allowlist', () => {
    for (const type of ALLOWED_TYPES) {
      const file = makeFakeFile({ size: 1024, type });
      expect(validateAudioUpload(file).ok).toBe(true);
    }
  });

  it('accepts the spec-mentioned formats: webm, mp4, mpeg, wav, ogg', () => {
    for (const type of [
      'audio/webm',
      'audio/mp4',
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
    ]) {
      const file = makeFakeFile({ size: 1024, type });
      expect(validateAudioUpload(file).ok).toBe(true);
    }
  });

  it('rejects non-audio content-types', () => {
    for (const type of [
      'video/mp4',
      'image/jpeg',
      'text/plain',
      'application/octet-stream',
      'audio/x-pn-realaudio', // an audio/* that we don't accept
    ]) {
      const file = makeFakeFile({ size: 1024, type });
      const result = validateAudioUpload(file);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errorCode).toBe('unsupported_audio_type');
        expect(result.got).toBe(type);
      }
    }
  });
});

describe('validateAudioUpload — MIME normalization', () => {
  it('matches "audio/webm;codecs=opus" against the allowlist', () => {
    const file = makeFakeFile({ size: 1024, type: 'audio/webm;codecs=opus' });
    expect(validateAudioUpload(file).ok).toBe(true);
  });

  it('matches MediaRecorder-style mp4 with quoted codec parameters', () => {
    const file = makeFakeFile({ size: 1024, type: 'audio/mp4;codecs="mp4a.40.2"' });
    expect(validateAudioUpload(file).ok).toBe(true);
  });

  it('matches with extra whitespace around the parameter', () => {
    const file = makeFakeFile({ size: 1024, type: 'audio/ogg; codecs=vorbis' });
    expect(validateAudioUpload(file).ok).toBe(true);
  });

  it('lowercases the base mime before comparison', () => {
    const file = makeFakeFile({ size: 1024, type: 'AUDIO/WEBM;codecs=opus' });
    expect(validateAudioUpload(file).ok).toBe(true);
  });

  it('still rejects non-audio types when a parameter is appended', () => {
    const file = makeFakeFile({ size: 1024, type: 'video/mp4;codecs=avc1' });
    const result = validateAudioUpload(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errorCode).toBe('unsupported_audio_type');
  });

  it('accepts a File with empty content-type (some browsers emit blank on MediaRecorder)', () => {
    // Note: passing `type: ''` to File results in `file.type === ''`,
    // which is the documented "let Whisper sniff the bytes" path.
    const file = makeFakeFile({ size: 1024, type: '' });
    expect(validateAudioUpload(file).ok).toBe(true);
  });
});
