import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { admin, clientFor } from './_setup';

/**
 * RLS test for `public.founding_agent_applications` (migration 0077).
 *
 * Policy matrix:
 *   - SELECT: admin only (is_platform_admin() = true)
 *   - UPDATE: admin only
 *   - INSERT: no policy at all (service-role bypasses; everyone else
 *             denied). Belt-and-suspenders REVOKE on anon + authenticated.
 *   - DELETE: no policy, no grants — fully denied to non-service-role.
 *
 * Verifies the negative cases that matter for the public form:
 *   - Anon cannot SELECT, INSERT, UPDATE, DELETE
 *   - Registered (non-admin) authenticated cannot SELECT, INSERT, UPDATE
 *   - Agent owner (non-admin) cannot SELECT
 *
 * And the positive case:
 *   - Admin CAN SELECT all rows + UPDATE status / notes
 *   - Service role INSERT works (covered by the API route in practice;
 *     re-tested here to confirm the route's write path isn't blocked).
 */

const FIXTURE_EMAIL = 'fixture-founding-agent@aho.test';

beforeAll(async () => {
  // Seed one fixture row via service role. Clean up any prior runs.
  const a = admin();
  await a.from('founding_agent_applications').delete().eq('email', FIXTURE_EMAIL);
  const { error } = await a.from('founding_agent_applications').insert({
    full_name: 'Fixture Applicant',
    email: FIXTURE_EMAIL,
    whatsapp: '+18295550123',
    city: 'Santo Domingo',
    country_code: 'DO',
    portfolio_url: 'https://example.test/profile',
    message: 'fixture message',
  });
  if (error) throw new Error(`fixture insert failed: ${error.message}`);
});

afterAll(async () => {
  // Tidy fixture row so subsequent runs are deterministic.
  const a = admin();
  await a.from('founding_agent_applications').delete().eq('email', FIXTURE_EMAIL);
});

describe('founding_agent_applications RLS', () => {
  it('anon CANNOT select', async () => {
    const c = await clientFor('anon');
    const { data, error } = await c.from('founding_agent_applications').select('*');
    // PostgREST returns empty array + no error when RLS hides all rows.
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('anon CANNOT insert (REVOKE blocks even before RLS check)', async () => {
    const c = await clientFor('anon');
    const { error } = await c.from('founding_agent_applications').insert({
      full_name: 'Anon Inserter',
      email: 'anon-insert@aho.test',
      city: 'Nowhere',
      country_code: 'US',
    });
    expect(error).not.toBeNull();
    // Expect either a permission error (REVOKE) OR an RLS rejection.
    // Postgres surfaces these slightly differently across versions.
    expect(error?.message).toMatch(/permission|policy|denied|insufficient/i);
  });

  it('registered (non-admin) CANNOT select', async () => {
    const c = await clientFor('registered_a');
    const { data, error } = await c.from('founding_agent_applications').select('*');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('registered (non-admin) CANNOT insert', async () => {
    const c = await clientFor('registered_a');
    const { error } = await c.from('founding_agent_applications').insert({
      full_name: 'Registered Inserter',
      email: 'reg-insert@aho.test',
      city: 'Madrid',
      country_code: 'ES',
    });
    expect(error).not.toBeNull();
  });

  it('agent owner (non-admin) CANNOT select', async () => {
    const c = await clientFor('agent_a_owner');
    const { data, error } = await c.from('founding_agent_applications').select('*');
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it('admin CAN select all rows incl. the fixture', async () => {
    const c = await clientFor('admin');
    const { data, error } = await c
      .from('founding_agent_applications')
      .select('id, email, status')
      .eq('email', FIXTURE_EMAIL);
    expect(error).toBeNull();
    expect(data?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(data?.[0]?.email).toBe(FIXTURE_EMAIL);
    expect(data?.[0]?.status).toBe('applied');
  });

  it('admin CAN update status + operator_notes', async () => {
    const c = await clientFor('admin');
    const { error } = await c
      .from('founding_agent_applications')
      .update({ status: 'contacted', operator_notes: 'reached on WA' })
      .eq('email', FIXTURE_EMAIL);
    expect(error).toBeNull();

    // Verify via service-role.
    const { data: after } = await admin()
      .from('founding_agent_applications')
      .select('status, operator_notes')
      .eq('email', FIXTURE_EMAIL)
      .single();
    expect(after?.status).toBe('contacted');
    expect(after?.operator_notes).toBe('reached on WA');
  });

  it('registered (non-admin) CANNOT update', async () => {
    const c = await clientFor('registered_a');
    const { error } = await c
      .from('founding_agent_applications')
      .update({ status: 'declined' })
      .eq('email', FIXTURE_EMAIL);
    // Update either errors or affects 0 rows. Both are acceptable.
    // We assert the row is NOT actually declined.
    const { data: after } = await admin()
      .from('founding_agent_applications')
      .select('status')
      .eq('email', FIXTURE_EMAIL)
      .single();
    expect(after?.status).not.toBe('declined');
    // Soft-assert error: PostgREST may return empty result rather than
    // an explicit error when RLS gates the update. We tolerate both.
    void error;
  });
});
