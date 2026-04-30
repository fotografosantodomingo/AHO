'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * Admin moderation actions for the `/admin` surface.
 *
 * Auth model: every action calls `requireAdmin()` first, which checks the
 * session's `is_admin` flag. The DB-level RLS policies on each table
 * (properties_admin_update, etc.) provide the second layer of defense —
 * even if a non-admin somehow bypassed the JS check, RLS would reject
 * the write.
 *
 * Per CLAUDE.md hard rule #4: "The frontend never decides what a user
 * can do. It asks the database." The action layer is convenience — RLS
 * is the source of truth.
 */

interface AdminCheck {
  ok: boolean;
  reason?: 'unauthenticated' | 'forbidden';
}

async function requireAdmin(): Promise<AdminCheck> {
  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) return { ok: false, reason: 'unauthenticated' };
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_admin')
    .eq('id', userResult.user.id)
    .maybeSingle();
  if (!profile?.is_admin) return { ok: false, reason: 'forbidden' };
  return { ok: true };
}

/**
 * Set `status='archived'` on a listing. Used to suspend bad/spam/flagged
 * listings without hard-deleting (preserves audit trail).
 *
 * Idempotent: archiving an already-archived listing is a no-op.
 */
export async function archiveListing(propertyId: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.reason };

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from('properties')
    .update({ status: 'archived' })
    .eq('id', propertyId);
  if (error) {
    console.error('[archiveListing]', error);
    return { ok: false, error: error.message };
  }

  // Bust the admin listings page so the table reflects the new status.
  revalidatePath('/[locale]/admin', 'page');
  return { ok: true };
}

/**
 * Restore an archived listing back to draft. The owner can then republish
 * via the dashboard's Publish button (re-running the listing-cap check).
 */
export async function unarchiveListing(propertyId: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.reason };

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from('properties')
    .update({ status: 'draft' })
    .eq('id', propertyId);
  if (error) {
    console.error('[unarchiveListing]', error);
    return { ok: false, error: error.message };
  }

  revalidatePath('/[locale]/admin', 'page');
  return { ok: true };
}
