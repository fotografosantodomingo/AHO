import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/email/brevo';
import { renderAdminPropertyPublishedEmail } from '@/lib/email/templates/admin-property-published';
import { formatPrice } from '@/lib/listings/format';
import { publicEnv } from '@/lib/env';

export const runtime = 'edge';

/**
 * POST /api/listings/:id/publish
 *
 * Flip a draft listing's status to active. Replaces the previous
 * Server Action path (`publishListing` in `src/lib/listings/actions.ts`).
 *
 * Auth: signed-in org member (RLS allows agent / manager / owner UPDATE
 * via `properties_org_member_update`). The listing-cap trigger from
 * 0005 raises `listing_cap_exceeded` if publishing this listing would
 * push the org over its cap; we surface that as a 403 with a stable
 * error code.
 *
 * Body: none.
 *
 * Response shape:
 *   - 200 { ok: true, id }
 *   - 400 { ok: false, errorCode: 'invalid_id' }
 *   - 401 { ok: false, errorCode: 'unauthenticated' }
 *   - 403 { ok: false, errorCode: 'listing_cap_exceeded' | 'forbidden' }
 *   - 500 { ok: false, errorCode }
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json(
      { ok: false, errorCode: 'invalid_id' },
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

  const { error: updateErr } = await supabase
    .from('properties')
    .update({
      status: 'active',
      published_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (updateErr) {
    // Listing-cap trigger raises an exception with the literal text
    // 'listing_cap_exceeded' (per migration 0005). Surface it as a
    // stable code regardless of whether postgres-js wraps the error.
    if (
      updateErr.message?.includes('listing_cap_exceeded') ||
      updateErr.code === 'P0001'
    ) {
      return NextResponse.json(
        { ok: false, errorCode: 'listing_cap_exceeded' },
        { status: 403 },
      );
    }
    if (updateErr.code === '42501') {
      return NextResponse.json(
        { ok: false, errorCode: 'forbidden' },
        { status: 403 },
      );
    }
    console.error('[POST /api/listings/:id/publish] update failed', updateErr);
    return NextResponse.json(
      { ok: false, errorCode: updateErr.message ?? 'db_error' },
      { status: 500 },
    );
  }

  // Admin notification — fire-and-await (cheap; Brevo is a single fetch).
  // Failure logs but does not unwind the publish.
  const adminEmail = process.env.ADMIN_EMAIL;
  if (adminEmail) {
    try {
      const { data: row } = await supabase
        .from('properties')
        .select(
          `
            short_id, slug_en, slug_es, title_en, title_es,
            city, country_code, price_cents, currency,
            profiles!properties_created_by_fkey(full_name, email)
          `,
        )
        .eq('id', id)
        .maybeSingle();
      if (row) {
        const pub = publicEnv();
        const slug = (row.slug_en as string | null) ?? (row.slug_es as string | null);
        const publicUrl = slug
          ? `${pub.NEXT_PUBLIC_SITE_URL}/en/properties/${slug}-${row.short_id}`
          : pub.NEXT_PUBLIC_SITE_URL;
        const title =
          (row.title_en as string | null) ??
          (row.title_es as string | null) ??
          '(no title)';
        const agentJoin = row.profiles as
          | { full_name?: string | null; email?: string | null }
          | { full_name?: string | null; email?: string | null }[]
          | null;
        const agent = Array.isArray(agentJoin) ? agentJoin[0] : agentJoin;
        const email = renderAdminPropertyPublishedEmail({
          title,
          city: row.city as string,
          countryCode: row.country_code as string,
          priceLabel: formatPrice(
            Number(row.price_cents),
            row.currency as string,
            'en',
          ),
          agentName: agent?.full_name ?? '—',
          agentEmail: agent?.email ?? '—',
          publicUrl,
          adminListingsUrl: `${pub.NEXT_PUBLIC_SITE_URL}/en/admin`,
        });
        const sendResult = await sendEmail({
          to: adminEmail,
          subject: email.subject,
          html: email.html,
        });
        if (!sendResult.sent) {
          console.warn('[publish] admin notification not sent', sendResult.error);
        }
      }
    } catch (e) {
      console.error('[publish] admin notification threw', e);
    }
  }

  revalidatePath('/[locale]/dashboard/properties', 'page');
  return NextResponse.json({ ok: true, id });
}
