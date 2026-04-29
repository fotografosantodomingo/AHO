'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { LEAD_STATUSES } from '@/db/schema';

/**
 * Server Action: update a lead's status. Runs as the signed-in user via the
 * user-context Supabase client. RLS on `public.leads` enforces:
 *   - SELECT: org members of the lead's org
 *   - UPDATE: org members with role agent / manager / owner
 *
 * If the user isn't authorized for the org, the UPDATE returns no row affected
 * (Postgres RLS soft-denies SELECT-then-UPDATE) — we treat that as `forbidden`.
 */

const StatusSchema = z.enum(LEAD_STATUSES);

interface ActionResult {
  ok: boolean;
  errorCode?: string;
}

export async function updateLeadStatus(
  leadId: string,
  status: string,
): Promise<ActionResult> {
  if (!z.string().uuid().safeParse(leadId).success) {
    return { ok: false, errorCode: 'invalid_id' };
  }
  const parsedStatus = StatusSchema.safeParse(status);
  if (!parsedStatus.success) {
    return { ok: false, errorCode: 'invalid_status' };
  }

  const supabase = await createServerSupabaseClient();
  const { data: userResult, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userResult.user) {
    return { ok: false, errorCode: 'unauthenticated' };
  }

  const { error: updateErr, data } = await supabase
    .from('leads')
    .update({ status: parsedStatus.data })
    .eq('id', leadId)
    .select('id');

  if (updateErr) {
    if (updateErr.code === '42501') {
      return { ok: false, errorCode: 'forbidden' };
    }
    return { ok: false, errorCode: updateErr.message };
  }
  if (!data || data.length === 0) {
    // RLS filtered the row out — user can't see / update this lead.
    return { ok: false, errorCode: 'forbidden' };
  }

  revalidatePath('/[locale]/dashboard/leads', 'page');
  return { ok: true };
}
