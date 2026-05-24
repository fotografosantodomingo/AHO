import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const runtime = 'edge';

/**
 * PUT /api/leads/:id/notes
 *
 * Persist agent-private notes on a lead. Auto-saved by the per-lead
 * detail page on textarea blur (see `LeadNotesEditor`).
 *
 * Auth + scope are RLS-driven: the user-context Supabase client runs
 * the UPDATE under the caller's session, and the existing
 * `leads_org_member_update` policy on `public.leads` ensures only
 * org members in qualifying roles (owner / manager / agent) can write.
 * If the caller isn't authorized for the lead's org, the UPDATE either
 * surfaces 42501 or returns no row (RLS soft-denies select-then-update);
 * both cases collapse to a 403.
 *
 * Notes column was added in `0009_leads.sql`; `0042_lead_notes.sql`
 * makes the add idempotent for any environment that predates 0009.
 *
 * Empty / whitespace-only input is normalized to NULL so the column
 * stays clean and sentinel queries (`notes is null`) keep working.
 */

const NotesSchema = z.object({
  // 8000 chars is generous for an internal scratchpad without inviting a
  // wall of pasted email threads to live in a `text` column. Adjust
  // upward if real-world usage demands.
  notes: z.string().max(8000).nullable(),
});

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json(
      { ok: false, errorCode: 'invalid_id' },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, errorCode: 'invalid_json' },
      { status: 400 },
    );
  }
  const parsed = NotesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        errorCode: 'invalid_input',
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) {
    return NextResponse.json(
      { ok: false, errorCode: 'unauthenticated' },
      { status: 401 },
    );
  }

  // Empty / whitespace-only → NULL. Treats "" the same as "no notes".
  const trimmed = parsed.data.notes?.trim() ?? '';
  const value = trimmed.length === 0 ? null : trimmed;

  const { data: updated, error } = await supabase
    .from('leads')
    .update({ notes: value })
    .eq('id', id)
    .select('id')
    .maybeSingle();

  if (error) {
    if (error.code === '42501') {
      return NextResponse.json(
        { ok: false, errorCode: 'forbidden' },
        { status: 403 },
      );
    }
    console.error('[PUT /api/leads/:id/notes]', error);
    return NextResponse.json(
      { ok: false, errorCode: 'db_error' },
      { status: 500 },
    );
  }
  if (!updated) {
    // RLS filtered the row out — caller can't see / update this lead.
    return NextResponse.json(
      { ok: false, errorCode: 'forbidden' },
      { status: 403 },
    );
  }

  // Re-render the per-lead detail page so the timeline pulls in the
  // fresh `updated_at`.
  revalidatePath('/[locale]/dashboard/leads/[id]', 'page');
  return NextResponse.json({ ok: true });
}
