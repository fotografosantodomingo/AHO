import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { findSegment } from '@/lib/email/segments';

export const runtime = 'edge';

const BodySchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().min(1).max(200),
  subject: z.string().min(1).max(200),
  segment_key: z.string().min(1).max(64),
  html_body: z.string().min(1).max(200_000),
  text_body: z.string().max(200_000).optional(),
});

/**
 * POST /api/admin/email/campaigns
 *
 * Create-or-update an email_campaigns row. If body.id is set, update;
 * otherwise insert. Admin-gated; uses the user-context Supabase client
 * so RLS enforces is_platform_admin() on writes.
 */
export async function POST(req: NextRequest) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'invalid_body', issues: e }, { status: 400 });
  }

  if (!findSegment(body.segment_key)) {
    return NextResponse.json(
      { error: 'invalid_segment_key', segmentKey: body.segment_key },
      { status: 400 },
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data: userRes } = await supabase.auth.getUser();
  const user = userRes.user;
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (body.id) {
    const { data, error } = await supabase
      .from('email_campaigns')
      .update({
        name: body.name,
        subject: body.subject,
        segment_key: body.segment_key,
        html_body: body.html_body,
        text_body: body.text_body ?? null,
      })
      .eq('id', body.id)
      .select('id')
      .single();
    if (error || !data) {
      console.error('[POST /api/admin/email/campaigns] update_failed', error);
      return NextResponse.json(
        { error: 'update_failed' },
        { status: error?.code === 'PGRST116' ? 404 : 500 },
      );
    }
    return NextResponse.json({ id: data.id });
  }

  const { data, error } = await supabase
    .from('email_campaigns')
    .insert({
      name: body.name,
      subject: body.subject,
      segment_key: body.segment_key,
      html_body: body.html_body,
      text_body: body.text_body ?? null,
      created_by: user.id,
    })
    .select('id')
    .single();
  if (error || !data) {
    console.error('[POST /api/admin/email/campaigns] insert_failed', error);
    return NextResponse.json(
      { error: 'insert_failed' },
      { status: 500 },
    );
  }
  return NextResponse.json({ id: data.id });
}
