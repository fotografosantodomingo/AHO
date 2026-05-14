import 'server-only';

/**
 * Email-marketing segment registry.
 *
 * Each segment maps to a Postgres function in migration 0056. The
 * /api/email/send route calls the function via the service-role
 * client, then filters against email_unsubscribes (also done inside
 * the function for defence in depth) before posting to Brevo.
 *
 * Adding a new segment:
 *   1. Write `segment_email_<key>()` in a new migration. Same return
 *      shape: (email citext, user_id uuid, full_name text). Filter
 *      `email_marketing_opt_in = true` for cold/general lists; skip
 *      the filter only when consent is implicit (e.g. test_self).
 *   2. Grant execute to service_role; revoke from anon + authenticated.
 *   3. Add a SEGMENT entry below.
 *   4. The composer picks it up automatically (it renders SEGMENTS).
 */

export interface SegmentDefinition {
  key: string;
  label: string;
  description: string;
  /** Postgres function name (no schema, no args). */
  rpcName: string;
  /** Pass the admin's profile id as the only argument? Used by test_self. */
  needsAdminId?: boolean;
}

export const SEGMENTS: readonly SegmentDefinition[] = [
  {
    key: 'all_subscribers',
    label: 'All subscribers (broad)',
    description:
      'Every profile with email_marketing_opt_in = true. Use sparingly — broadest blast.',
    rpcName: 'segment_email_all_subscribers',
  },
  {
    key: 'free_users_no_listing',
    label: 'Free users (upsell to Agent $29)',
    description:
      'Profiles that don’t belong to any org with listings. Target the $29 Agent plan.',
    rpcName: 'segment_email_free_users_no_listing',
  },
  {
    key: 'agents_no_pro',
    label: 'Agents not on Pro Automation (upsell to $99)',
    description:
      'Agents on Agent/Plus tier or no active plan. Target the $99 Pro Automation feature set.',
    rpcName: 'segment_email_agents_no_pro',
  },
  {
    key: 'agents_inactive_30d',
    label: 'Agents inactive 30+ days (re-engage)',
    description:
      'Org members whose latest listing edit is older than 30 days. Nudge them back in.',
    rpcName: 'segment_email_agents_inactive_30d',
  },
  {
    key: 'buyers_with_saved_search',
    label: 'Buyers with saved searches (listing match)',
    description:
      'Profiles with at least one saved search row. Cross-promote listings that match.',
    rpcName: 'segment_email_buyers_with_saved_search',
  },
  {
    key: 'recent_leads_14d',
    label: 'Recent leads (last 14 days)',
    description:
      'Anyone who submitted a lead in the last 14 days. Implicit consent — no opt-in filter.',
    rpcName: 'segment_email_recent_leads_14d',
  },
  {
    key: 'test_self',
    label: 'Test send — to me only',
    description: 'Sends a single preview to the currently signed-in admin.',
    rpcName: 'segment_email_test_self',
    needsAdminId: true,
  },
] as const;

export type SegmentKey = (typeof SEGMENTS)[number]['key'];

export function findSegment(key: string): SegmentDefinition | null {
  if (key.startsWith('audience:')) {
    return AUDIENCE_SEGMENT;
  }
  return SEGMENTS.find((s) => s.key === key) ?? null;
}

/**
 * Synthetic segment definition for any `audience:<uuid>` key. The
 * audience id is parsed out by the resolver below and passed to
 * segment_email_audience(uuid). Not enumerated in SEGMENTS — it
 * doesn't make sense as a static dropdown choice; the composer
 * fetches the list of audiences from the DB and renders one option
 * per row.
 */
const AUDIENCE_SEGMENT: SegmentDefinition = {
  key: 'audience',
  label: 'Custom audience',
  description: 'Resolved from an uploaded contact list.',
  rpcName: 'segment_email_audience',
};

export function parseAudienceKey(key: string): string | null {
  if (!key.startsWith('audience:')) return null;
  return key.slice('audience:'.length);
}

export interface SegmentRecipient {
  email: string;
  user_id: string | null;
  full_name: string | null;
}

/**
 * Resolve a segment key to a recipient list via the corresponding RPC.
 * Requires a service-role Supabase client.
 */
export async function resolveSegment({
  supabase,
  segmentKey,
  adminId,
}: {
  supabase: {
    rpc: (
      fn: string,
      args?: Record<string, unknown>,
    ) => Promise<{ data: SegmentRecipient[] | null; error: { message: string } | null }>;
  };
  segmentKey: string;
  adminId: string;
}): Promise<SegmentRecipient[]> {
  const seg = findSegment(segmentKey);
  if (!seg) {
    throw new Error(`unknown segment_key: ${segmentKey}`);
  }
  // Three argument shapes:
  //   - audience:<uuid>  → { p_audience_id: <uuid> }
  //   - test_self        → { p_admin_id: <adminId> }
  //   - everything else  → no args
  let args: Record<string, unknown> | undefined;
  const audienceId = parseAudienceKey(segmentKey);
  if (audienceId) {
    args = { p_audience_id: audienceId };
  } else if (seg.needsAdminId) {
    args = { p_admin_id: adminId };
  }
  const { data, error } = await supabase.rpc(seg.rpcName, args);
  if (error) {
    throw new Error(`segment resolve failed: ${error.message}`);
  }
  return data ?? [];
}
