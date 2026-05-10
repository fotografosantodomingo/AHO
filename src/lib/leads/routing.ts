/**
 * Lead-routing rules engine — pure function.
 *
 * Walks an array of `LeadRoutingRule` rows in priority order and
 * returns the assignee + (optional) matched rule id for a given lead.
 * No DB, no IO, no side effects — designed to be unit-testable from a
 * single fixture array. The /api/leads route loads rules + cursor
 * state, calls this function, and persists the new cursor.
 *
 * Algorithm:
 *   1. Filter to active rules.
 *   2. Sort by priority desc, then created_at asc (stable tiebreaker
 *      so adding a rule never reorders an existing higher-priority
 *      one). The DB index already returns rows in this order; the
 *      sort here is defensive in case the caller passes an
 *      unordered list.
 *   3. For each rule, check conditions. First match wins.
 *   4. Apply the matched rule's action:
 *        - "assign" → return that user id
 *        - "round_robin" → take `users[cursor % len]`, then advance
 *          the cursor
 *   5. No match → return the fallback (the property's primary agent)
 *      and a null rule id.
 *
 * Why a pure function: per CLAUDE.md hard rule #4, the frontend never
 * decides what a user can do. RLS still enforces who can read /
 * update the lead row after we attribute it. This engine only decides
 * `assigned_to`, which is just an attribution label — the row is
 * org-scoped already and visible to every org member regardless.
 */

import type { LeadRoutingAction, LeadRoutingConditions } from '@/db/schema';

/**
 * Subset of a `lead_routing_rules` row that the engine cares about.
 * Accepts the parsed/typed shape rather than the raw DB row so the
 * engine doesn't need a Supabase client to be tested.
 */
export interface RoutingRule {
  id: string;
  priority: number;
  /** ISO timestamp string. Used as the secondary sort for stable
   *  tiebreaking when two rules share a priority. */
  createdAt: string;
  isActive: boolean;
  conditions: LeadRoutingConditions;
  action: LeadRoutingAction;
}

/**
 * Subset of a lead's facts the engine matches on. The route extracts
 * these from the property + the inbound POST body before calling the
 * engine.
 */
export interface RoutingLeadFacts {
  city: string | null;
  countryCode: string | null;
  language: string | null;
  propertyType: string | null;
}

export interface RoutingDecision {
  /** The user id to attribute the lead to. */
  assignTo: string;
  /** The rule id that fired. `null` when no rule matched and we fell
   *  back to the property's primary agent. */
  ruleId: string | null;
  /** When the matched rule was a round-robin, this is the cursor's
   *  new value (already advanced + wrapped). The caller persists it
   *  back to `lead_routing_state`. `null` for non-round-robin
   *  decisions. */
  newRoundRobinIndex: number | null;
}

/**
 * Apply routing rules to a lead.
 *
 * @param rules           All active+inactive rules for the lead's org.
 *                        The engine filters out inactive ones internally.
 * @param lead            Facts the engine matches on.
 * @param fallbackUserId  The property's primary agent — used when no rule
 *                        matches. Required: there's always SOMEONE to
 *                        attribute to (the legacy behavior).
 * @param currentRoundRobinIndex  The org's cursor for round-robin
 *                        rotation (from `lead_routing_state`). Defaults
 *                        to 0 for orgs that haven't routed any leads
 *                        through round-robin yet.
 */
export function applyRoutingRules(
  rules: ReadonlyArray<RoutingRule>,
  lead: RoutingLeadFacts,
  fallbackUserId: string,
  currentRoundRobinIndex: number = 0,
): RoutingDecision {
  const candidates = rules
    .filter((r) => r.isActive)
    .slice()
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      // Same priority: stable tiebreak on created_at ASC so the rule
      // an admin wrote first wins. (DESC would mean every newly added
      // rule at the same priority displaces the older one — surprising.)
      return a.createdAt.localeCompare(b.createdAt);
    });

  for (const rule of candidates) {
    if (!matches(rule.conditions, lead)) continue;
    return resolveAction(rule, currentRoundRobinIndex, fallbackUserId);
  }

  return {
    assignTo: fallbackUserId,
    ruleId: null,
    newRoundRobinIndex: null,
  };
}

function matches(
  conditions: LeadRoutingConditions,
  lead: RoutingLeadFacts,
): boolean {
  // Empty `{}` matches everything (org-wide default rule).
  if (conditions.city != null && conditions.city !== lead.city) return false;
  if (
    conditions.country_code != null &&
    conditions.country_code !== lead.countryCode
  ) {
    return false;
  }
  if (conditions.language != null && conditions.language !== lead.language) {
    return false;
  }
  if (
    conditions.property_type != null &&
    conditions.property_type !== lead.propertyType
  ) {
    return false;
  }
  return true;
}

function resolveAction(
  rule: RoutingRule,
  currentRoundRobinIndex: number,
  fallbackUserId: string,
): RoutingDecision {
  if (rule.action.type === 'assign') {
    return {
      assignTo: rule.action.assign_to_user_id,
      ruleId: rule.id,
      newRoundRobinIndex: null,
    };
  }
  // round_robin
  const users = rule.action.round_robin_user_ids;
  if (users.length === 0) {
    // Misconfigured rule (empty user list). Don't crash — fall back
    // to the legacy attribution and signal no rule fired so the
    // caller can warn / log.
    return {
      assignTo: fallbackUserId,
      ruleId: null,
      newRoundRobinIndex: null,
    };
  }
  // Defensive: if the cursor is somehow out of range (negative,
  // beyond array length, NaN), wrap it. Prevents a stale cursor from
  // a previous larger rule list from blowing past the end.
  const safeIdx =
    Number.isFinite(currentRoundRobinIndex) && currentRoundRobinIndex >= 0
      ? Math.floor(currentRoundRobinIndex) % users.length
      : 0;
  const assignTo = users[safeIdx]!;
  const newIndex = (safeIdx + 1) % users.length;
  return {
    assignTo,
    ruleId: rule.id,
    newRoundRobinIndex: newIndex,
  };
}
