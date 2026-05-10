/**
 * Zod schemas for the lead-routing rule CRUD UI. Shared between the
 * Server Actions in `routing-actions.ts` and the admin/dashboard form
 * components so the form's optimistic local state stays type-safe.
 *
 * Rule shape mirrors the JSONB columns in 0040_lead_routing_rules.sql.
 * Conditions are all optional (empty `{}` = match everything). Action
 * is a discriminated union on `type`.
 */

import { z } from 'zod';

/** ISO-3166-1 alpha-2; uppercase enforced. v1 doesn't validate
 *  membership in any country list — agencies in newly-onboarded markets
 *  shouldn't have to wait on a code-push to add a country rule. */
const CountryCode = z
  .string()
  .trim()
  .toUpperCase()
  .length(2, { message: 'invalid_country_code' });

/** Property type — free-form short string. We don't pin it to the
 *  PROPERTY_TYPES list because that union grows over time and a
 *  routing rule for a type that doesn't yet exist is harmless (it
 *  just never matches). */
const PropertyType = z.string().trim().min(1).max(40);

/** Locale — keep loose to match the lead's `language` column, which
 *  is currently 'en'|'es' but will broaden as content locales open up.
 *  Two-letter language codes only. */
const Language = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z]{2}$/, { message: 'invalid_language' });

export const LeadRoutingConditionsSchema = z
  .object({
    city: z.string().trim().min(1).max(120).optional(),
    country_code: CountryCode.optional(),
    language: Language.optional(),
    property_type: PropertyType.optional(),
  })
  .strict();

export const LeadRoutingActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('assign'),
    assign_to_user_id: z.string().uuid({ message: 'invalid_user_id' }),
  }),
  z.object({
    type: z.literal('round_robin'),
    round_robin_user_ids: z
      .array(z.string().uuid({ message: 'invalid_user_id' }))
      .min(1, { message: 'round_robin_needs_users' })
      .max(50, { message: 'round_robin_too_many_users' }),
  }),
]);

export const LeadRoutingRuleInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  priority: z
    .number()
    .int()
    .min(-1000, { message: 'priority_too_low' })
    .max(1000, { message: 'priority_too_high' }),
  conditions: LeadRoutingConditionsSchema,
  action: LeadRoutingActionSchema,
  is_active: z.boolean(),
});

export type LeadRoutingRuleInput = z.infer<typeof LeadRoutingRuleInputSchema>;
