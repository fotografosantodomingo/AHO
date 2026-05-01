/**
 * Idempotent seed of `public.plans` from Stripe price IDs.
 *
 * Workflow:
 *   1. `pnpm stripe:setup` — creates the Stripe Product + Prices, prints JSON.
 *   2. PO reviews the IDs.
 *   3. PO copies the IDs into `.env.local` as the env vars below.
 *   4. `pnpm db:seed` — this script — upserts the matching `plans` rows.
 *
 * Re-run safely whenever a Stripe price ID changes; existing plan rows are
 * upserted by their stable internal `id` (e.g. `aho_agent_monthly`).
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AGENT_PRODUCT_ID = process.env.STRIPE_AGENT_PRODUCT_ID;
const MONTHLY_PRICE = process.env.STRIPE_AGENT_MONTHLY_PRICE_ID;
const ANNUAL_PRICE = process.env.STRIPE_AGENT_ANNUAL_PRICE_ID;
const FOUNDER_PRICE = process.env.STRIPE_AGENT_FOUNDER_PRICE_ID;
const PLUS_PRODUCT_ID = process.env.STRIPE_PLUS_PRODUCT_ID;
const PLUS_MONTHLY_PRICE = process.env.STRIPE_PLUS_MONTHLY_PRICE_ID;
const PLUS_ANNUAL_PRICE = process.env.STRIPE_PLUS_ANNUAL_PRICE_ID;
const PRO_PRODUCT_ID = process.env.STRIPE_PRO_AUTOMATION_PRODUCT_ID;
const PRO_MONTHLY_PRICE = process.env.STRIPE_PRO_AUTOMATION_MONTHLY_PRICE_ID;
const PRO_ANNUAL_PRICE = process.env.STRIPE_PRO_AUTOMATION_ANNUAL_PRICE_ID;

const missing: string[] = [];
if (!SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL');
if (!SERVICE_ROLE) missing.push('SUPABASE_SERVICE_ROLE_KEY');
if (!AGENT_PRODUCT_ID) missing.push('STRIPE_AGENT_PRODUCT_ID');
if (!MONTHLY_PRICE) missing.push('STRIPE_AGENT_MONTHLY_PRICE_ID');
if (!ANNUAL_PRICE) missing.push('STRIPE_AGENT_ANNUAL_PRICE_ID');
if (!FOUNDER_PRICE) missing.push('STRIPE_AGENT_FOUNDER_PRICE_ID');
if (!PLUS_PRODUCT_ID) missing.push('STRIPE_PLUS_PRODUCT_ID');
if (!PLUS_MONTHLY_PRICE) missing.push('STRIPE_PLUS_MONTHLY_PRICE_ID');
if (!PLUS_ANNUAL_PRICE) missing.push('STRIPE_PLUS_ANNUAL_PRICE_ID');
if (!PRO_PRODUCT_ID) missing.push('STRIPE_PRO_AUTOMATION_PRODUCT_ID');
if (!PRO_MONTHLY_PRICE) missing.push('STRIPE_PRO_AUTOMATION_MONTHLY_PRICE_ID');
if (!PRO_ANNUAL_PRICE) missing.push('STRIPE_PRO_AUTOMATION_ANNUAL_PRICE_ID');

if (missing.length > 0) {
  console.error(
    'Missing required env vars: ' +
      missing.join(', ') +
      '. Run `pnpm stripe:setup` first, then add the resulting IDs to .env.local.',
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL!, SERVICE_ROLE!, {
  auth: { autoRefreshToken: false, persistSession: false },
});

interface PlanRow {
  id: string;
  tier: 'agent';
  billing_period: 'monthly' | 'annual';
  stripe_product_id: string;
  stripe_price_id: string;
  display_name_en: string;
  display_name_es: string;
  description_en: string | null;
  description_es: string | null;
  amount_cents: number;
  currency: 'USD';
  trial_days: number;
  listing_cap: number | null;
  seats_included: number;
  is_active: boolean;
  is_visible: boolean;
  sort_order: number;
}

const PLANS: PlanRow[] = [
  // Tier 1: Agent ($29 / $290) — entry-level
  {
    id: 'aho_agent_monthly',
    tier: 'agent',
    billing_period: 'monthly',
    stripe_product_id: AGENT_PRODUCT_ID!,
    stripe_price_id: MONTHLY_PRICE!,
    display_name_en: 'AHO Agent (Monthly)',
    display_name_es: 'AHO Agente (Mensual)',
    description_en:
      'Up to 5 active listings. Manual social share. WhatsApp lead capture. Performance analytics. Agent profile and inbox.',
    description_es:
      'Hasta 5 anuncios activos. Publicación manual en redes sociales. Captura de leads por WhatsApp. Estadísticas. Perfil del agente y bandeja de entrada.',
    amount_cents: 2900,
    currency: 'USD',
    trial_days: 7,
    listing_cap: 5,
    seats_included: 1,
    is_active: true,
    is_visible: true,
    sort_order: 1,
  },
  {
    id: 'aho_agent_annual',
    tier: 'agent',
    billing_period: 'annual',
    stripe_product_id: AGENT_PRODUCT_ID!,
    stripe_price_id: ANNUAL_PRICE!,
    display_name_en: 'AHO Agent (Annual)',
    display_name_es: 'AHO Agente (Anual)',
    description_en: 'Same features as monthly, billed annually. Save ~17%.',
    description_es: 'Mismas funciones que el plan mensual, facturado anualmente. Ahorra ~17%.',
    amount_cents: 29000,
    currency: 'USD',
    trial_days: 0,
    listing_cap: 5,
    seats_included: 1,
    is_active: true,
    is_visible: true,
    sort_order: 2,
  },
  {
    id: 'aho_agent_founder_monthly',
    tier: 'agent',
    billing_period: 'monthly',
    stripe_product_id: AGENT_PRODUCT_ID!,
    stripe_price_id: FOUNDER_PRICE!,
    display_name_en: 'AHO Agent — Founder Rate',
    display_name_es: 'AHO Agente — Tarifa Fundador',
    description_en:
      'Same features as monthly, $19/mo locked for life. First 50 agents only — application-gated, not publicly listed.',
    description_es:
      'Mismas funciones que el plan mensual, $19/mes para siempre. Solo los primeros 50 agentes — gestionado por aplicación, no se publica.',
    amount_cents: 1900,
    currency: 'USD',
    trial_days: 7,
    listing_cap: 5,
    seats_included: 1,
    is_active: true,
    is_visible: false,
    sort_order: 99,
  },

  // Tier 2: Plus ($49 / $490) — mid-tier
  {
    id: 'aho_plus_monthly',
    tier: 'agent',
    billing_period: 'monthly',
    stripe_product_id: PLUS_PRODUCT_ID!,
    stripe_price_id: PLUS_MONTHLY_PRICE!,
    display_name_en: 'AHO Plus (Monthly)',
    display_name_es: 'AHO Plus (Mensual)',
    description_en:
      'Up to 15 active listings. Priority placement on city landings. Verified Real Estate Agent badge. Multi-city listings. Includes everything in Agent.',
    description_es:
      'Hasta 15 anuncios activos. Posición prioritaria en páginas de ciudades. Insignia de Agente Inmobiliario Verificado. Anuncios en varias ciudades. Incluye todo lo de Agente.',
    amount_cents: 4900,
    currency: 'USD',
    trial_days: 7,
    listing_cap: 15,
    seats_included: 1,
    is_active: true,
    is_visible: true,
    sort_order: 3,
  },
  {
    id: 'aho_plus_annual',
    tier: 'agent',
    billing_period: 'annual',
    stripe_product_id: PLUS_PRODUCT_ID!,
    stripe_price_id: PLUS_ANNUAL_PRICE!,
    display_name_en: 'AHO Plus (Annual)',
    display_name_es: 'AHO Plus (Anual)',
    description_en: 'Same features as monthly, billed annually. Save ~17%.',
    description_es: 'Mismas funciones que el plan mensual, facturado anualmente. Ahorra ~17%.',
    amount_cents: 49000,
    currency: 'USD',
    trial_days: 0,
    listing_cap: 15,
    seats_included: 1,
    is_active: true,
    is_visible: true,
    sort_order: 4,
  },

  // Tier 3: Pro Automation ($99 / $990) — top-tier with social automation
  {
    id: 'aho_pro_automation_monthly',
    tier: 'agent',
    billing_period: 'monthly',
    stripe_product_id: PRO_PRODUCT_ID!,
    stripe_price_id: PRO_MONTHLY_PRICE!,
    display_name_en: 'AHO Pro Automation (Monthly)',
    display_name_es: 'AHO Pro Automation (Mensual)',
    description_en:
      'Up to 30 active listings. ONE-CLICK SOCIAL AUTOMATION to Facebook + Instagram + LinkedIn with AI-generated captions. Post history + retry. Traffic tracking back to AHO. Includes everything in Plus.',
    description_es:
      'Hasta 30 anuncios activos. AUTOMATIZACIÓN SOCIAL DE UN CLIC en Facebook + Instagram + LinkedIn con subtítulos generados por IA. Historial de publicaciones + reintento. Seguimiento de tráfico a AHO. Incluye todo lo de Plus.',
    amount_cents: 9900,
    currency: 'USD',
    trial_days: 7,
    listing_cap: 30,
    seats_included: 1,
    is_active: true,
    is_visible: true,
    sort_order: 5,
  },
  {
    id: 'aho_pro_automation_annual',
    tier: 'agent',
    billing_period: 'annual',
    stripe_product_id: PRO_PRODUCT_ID!,
    stripe_price_id: PRO_ANNUAL_PRICE!,
    display_name_en: 'AHO Pro Automation (Annual)',
    display_name_es: 'AHO Pro Automation (Anual)',
    description_en: 'Same features as monthly, billed annually. Save ~17%.',
    description_es: 'Mismas funciones que el plan mensual, facturado anualmente. Ahorra ~17%.',
    amount_cents: 99000,
    currency: 'USD',
    trial_days: 0,
    listing_cap: 30,
    seats_included: 1,
    is_active: true,
    is_visible: true,
    sort_order: 6,
  },
];

async function main() {
  for (const row of PLANS) {
    const { error } = await sb.from('plans').upsert(row, { onConflict: 'id' });
    if (error) {
      console.error(`Failed to seed plan ${row.id}: ${error.message}`);
      process.exit(1);
    }
    console.log(
      `Seeded ${row.id} → product ${row.stripe_product_id}, price ${row.stripe_price_id}`,
    );
  }
  console.log('\nDone. Verify in Supabase Studio: select id, stripe_price_id, amount_cents, is_visible from plans;');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
