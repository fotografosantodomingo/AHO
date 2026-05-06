'use server';

import { revalidatePath } from 'next/cache';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

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

/**
 * Promote a user to admin / demote an existing admin.
 *
 * `is_admin` is trigger-protected against user-context updates (see
 * migration 0002 — the `protect_admin_role` trigger refuses to change
 * `is_admin` / `admin_role` from a non-service-role session). So these
 * actions go through the SERVICE-ROLE client.
 *
 * Self-protection: an admin can't demote themselves. Without this,
 * the only platform admin could lock the entire org out of admin
 * powers in a single click — recoverable only by a manual SQL update
 * to the production database. The "you can't demote yourself" rule
 * is the cheapest possible guardrail.
 *
 * Promote requires a current admin (by virtue of requireAdmin()).
 * There's no way to bootstrap the FIRST admin from this surface;
 * that's a manual SQL update on first deploy (per HANDOFF.md §5).
 */
export async function setUserAdmin(
  userId: string,
  makeAdmin: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.reason };

  const userSupabase = await createServerSupabaseClient();
  const { data: userResult } = await userSupabase.auth.getUser();
  if (!userResult.user) return { ok: false, error: 'unauthenticated' };

  // Self-protection: prevent the calling admin from demoting themselves.
  if (!makeAdmin && userResult.user.id === userId) {
    return { ok: false, error: 'cannot_demote_self' };
  }

  // The `protect_admin_role` trigger in migration 0002 only permits
  // is_admin/admin_role changes from the service role. The admin
  // client bypasses RLS + the trigger.
  const supabase = createAdminClient();

  // Snapshot prior state for the audit log (best-effort; the update
  // proceeds even if this fetch fails — at worst the audit row records
  // null priorIsAdmin / priorAdminRole).
  const { data: prior } = await supabase
    .from('profiles')
    .select('is_admin, admin_role, email')
    .eq('id', userId)
    .maybeSingle();

  const { error } = await supabase
    .from('profiles')
    .update({
      is_admin: makeAdmin,
      admin_role: makeAdmin ? 'admin' : null,
    })
    .eq('id', userId);
  if (error) {
    console.error('[setUserAdmin]', error);
    return { ok: false, error: error.message };
  }

  // Audit log: admin promotion / demotion is a high-trust action that
  // must leave a paper trail for compliance + post-incident forensics.
  // PO-noted gap 2026-05-01 (customer-flow audit). Best-effort: failures
  // log but don't unwind the role change — the role change is the user-
  // visible outcome, the audit row is for governance review.
  try {
    const auditErr = await supabase.from('audit_log').insert({
      kind: makeAdmin ? 'admin.user.promoted' : 'admin.user.demoted',
      actor_id: userResult.user.id,
      target_id: userId,
      payload: {
        target_email: prior?.email ?? null,
        prior_is_admin: prior?.is_admin ?? null,
        prior_admin_role: prior?.admin_role ?? null,
        next_is_admin: makeAdmin,
        next_admin_role: makeAdmin ? 'admin' : null,
      },
    });
    if (auditErr.error) {
      console.warn('[setUserAdmin] audit_log insert failed', auditErr.error);
    }
  } catch (e) {
    console.warn('[setUserAdmin] audit_log threw', e);
  }

  revalidatePath('/[locale]/admin/users', 'page');
  return { ok: true };
}
