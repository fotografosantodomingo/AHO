'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { LeadRoutingRuleInputSchema } from '@/lib/leads/routing-schemas';

/**
 * Server Actions for the lead-routing rules CRUD UI.
 *
 * All actions run as the signed-in user via the user-context Supabase
 * client. RLS on `lead_routing_rules` enforces:
 *   - SELECT: any org member of the rule's org
 *   - INSERT / UPDATE / DELETE: owner + manager only
 *
 * The orgId is passed in by the page (which already resolved the
 * caller's owning org via the dashboard layout's membership check),
 * but RLS is the actual enforcer — a malicious caller passing some
 * other org's ID gets a 0-row UPDATE / RLS-violation INSERT, which
 * we surface as `forbidden`.
 */

interface ActionResult<T = void> {
  ok: boolean;
  errorCode?: string;
  data?: T;
}

const UuidSchema = z.string().uuid();

const RULE_PATHS = [
  '/[locale]/dashboard/leads/routing',
  '/[locale]/panel/contactos/routing',
] as const;

function revalidateRoutingPages() {
  for (const p of RULE_PATHS) revalidatePath(p, 'page');
}

export async function createRoutingRule(
  orgId: string,
  input: unknown,
): Promise<ActionResult<{ id: string }>> {
  if (!UuidSchema.safeParse(orgId).success) {
    return { ok: false, errorCode: 'invalid_org_id' };
  }
  const parsed = LeadRoutingRuleInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errorCode: parsed.error.issues[0]?.message ?? 'invalid_input',
    };
  }
  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) return { ok: false, errorCode: 'unauthenticated' };

  const { data, error } = await supabase
    .from('lead_routing_rules')
    .insert({
      org_id: orgId,
      name: parsed.data.name,
      priority: parsed.data.priority,
      conditions: parsed.data.conditions,
      action: parsed.data.action,
      is_active: parsed.data.is_active,
    })
    .select('id')
    .single();

  if (error) {
    if (error.code === '42501') return { ok: false, errorCode: 'forbidden' };
    return { ok: false, errorCode: error.message };
  }
  revalidateRoutingPages();
  return { ok: true, data: { id: data.id as string } };
}

export async function updateRoutingRule(
  ruleId: string,
  input: unknown,
): Promise<ActionResult> {
  if (!UuidSchema.safeParse(ruleId).success) {
    return { ok: false, errorCode: 'invalid_id' };
  }
  const parsed = LeadRoutingRuleInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errorCode: parsed.error.issues[0]?.message ?? 'invalid_input',
    };
  }
  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) return { ok: false, errorCode: 'unauthenticated' };

  const { data, error } = await supabase
    .from('lead_routing_rules')
    .update({
      name: parsed.data.name,
      priority: parsed.data.priority,
      conditions: parsed.data.conditions,
      action: parsed.data.action,
      is_active: parsed.data.is_active,
    })
    .eq('id', ruleId)
    .select('id');
  if (error) {
    if (error.code === '42501') return { ok: false, errorCode: 'forbidden' };
    return { ok: false, errorCode: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, errorCode: 'forbidden' };
  }
  revalidateRoutingPages();
  return { ok: true };
}

export async function setRoutingRuleActive(
  ruleId: string,
  isActive: boolean,
): Promise<ActionResult> {
  if (!UuidSchema.safeParse(ruleId).success) {
    return { ok: false, errorCode: 'invalid_id' };
  }
  if (typeof isActive !== 'boolean') {
    return { ok: false, errorCode: 'invalid_input' };
  }
  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) return { ok: false, errorCode: 'unauthenticated' };

  const { data, error } = await supabase
    .from('lead_routing_rules')
    .update({ is_active: isActive })
    .eq('id', ruleId)
    .select('id');
  if (error) {
    if (error.code === '42501') return { ok: false, errorCode: 'forbidden' };
    return { ok: false, errorCode: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, errorCode: 'forbidden' };
  }
  revalidateRoutingPages();
  return { ok: true };
}

export async function deleteRoutingRule(
  ruleId: string,
): Promise<ActionResult> {
  if (!UuidSchema.safeParse(ruleId).success) {
    return { ok: false, errorCode: 'invalid_id' };
  }
  const supabase = await createServerSupabaseClient();
  const { data: userResult } = await supabase.auth.getUser();
  if (!userResult.user) return { ok: false, errorCode: 'unauthenticated' };

  // RLS-deletes silently affect 0 rows — to detect "forbidden" we
  // .select() the deleted rows and check the count.
  const { data, error } = await supabase
    .from('lead_routing_rules')
    .delete()
    .eq('id', ruleId)
    .select('id');
  if (error) {
    if (error.code === '42501') return { ok: false, errorCode: 'forbidden' };
    return { ok: false, errorCode: error.message };
  }
  if (!data || data.length === 0) {
    return { ok: false, errorCode: 'forbidden' };
  }
  revalidateRoutingPages();
  return { ok: true };
}
