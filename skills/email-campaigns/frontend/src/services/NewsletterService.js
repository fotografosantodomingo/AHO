import { supabase } from '@/lib/customSupabaseClient';
import { EMAIL_WORKER_BASE_URL } from '@/config/emailWorker';

export const subscribeToNewsletter = async ({ firstName, email, source, tags = [] }) => {
  try {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      throw new Error('Please enter a valid email address.');
    }

    // Plain INSERT (not upsert). The DB has a trigger that mirrors new rows
    // into email_contacts (so marketing campaigns can reach them) using
    // SECURITY DEFINER — the SPA doesn't have to touch email_contacts.
    // Duplicate (23505) means the email is already subscribed: treat as success
    // (we still fire the welcome email so re-subscribing isn't a silent dead-end).
    const { error } = await supabase
      .from('newsletter_subscribers')
      .insert({
        email,
        first_name: firstName || null,
        source,
        tags: JSON.stringify(tags),
      });

    if (error && error.code !== '23505') {
      console.error('newsletter_subscribers insert error:', error);
      throw new Error('Could not subscribe. Please try again.');
    }

    // Fire the welcome email via the worker. Best-effort: if it fails, the
    // subscription still succeeded so we don't block the user-visible toast.
    try {
      await fetch(`${EMAIL_WORKER_BASE_URL}/newsletter/welcome`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, first_name: firstName || null }),
      });
    } catch (welcomeErr) {
      console.warn('newsletter welcome email failed (non-fatal):', welcomeErr);
    }

    // If user is signed in, also flag the preference for them.
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      await supabase.from('user_preferences').upsert(
        {
          user_id: session.user.id,
          newsletter_signup: true,
          preferences_json: { tags, source },
        },
        { onConflict: 'user_id' },
      );
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
