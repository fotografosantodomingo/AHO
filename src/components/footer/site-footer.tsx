import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { LocaleToggle } from '@/components/locale-toggle';
import { NewsletterForm } from './newsletter-form';
import { createServerSupabaseClient } from '@/lib/supabase/server';

const SUPPORT_EMAIL = 'info@advertisehomes.online';
const FACEBOOK_URL = 'https://facebook.com/advertisehomesonline';
const INSTAGRAM_URL = 'https://instagram.com/advertisehomesonline';
const LINKEDIN_URL = 'https://linkedin.com/company/advertisehomesonline';

interface Props {
  locale: Locale;
}

/**
 * Site-wide footer (DP-2c). Replaces the previous one-line bottom strip.
 *
 * Structure:
 *   - Forest band (bg-surface-band) with cream text — the inspired-by
 *     "espresso-dark bookend" the design spec calls for.
 *   - 4 columns on md+: About / For buyers / For agents / Stay in touch
 *     (newsletter + socials).
 *   - On mobile each column collapses into a `<details>` accordion.
 *     Pure HTML — no JS for the toggle.
 *   - Bottom strip: copyright + legal links + locale mirror.
 *
 * Active components:
 *   - <NewsletterForm> — POSTs to /api/newsletter; gracefully no-ops if
 *     Brevo env isn't wired.
 *   - <LocaleToggle> — same client component the header uses; a "mirror"
 *     placement at the foot of the page so users who read all the way
 *     down don't have to scroll back up to switch language.
 *   - Quick contact = mailto: link to SUPPORT_EMAIL. A dedicated /contact
 *     page is a future-batch item; the link works today.
 */
export async function SiteFooter({ locale }: Props) {
  const t = await getTranslations({ locale, namespace: 'footer' });

  // Resolve auth so the anon-only "Sign in / Register" CTA strip can
  // hide itself for signed-in users. Server-component side; the footer
  // already runs once per request via the layout.
  let isAuthed = false;
  try {
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase.auth.getUser();
    isAuthed = !!data.user;
  } catch {
    // Footer must not break the layout if Supabase hiccups.
  }

  const buyHref = `/${locale}/${locale === 'es' ? 'buscar' : 'search'}`;
  const countriesHref = `/${locale}/${locale === 'es' ? 'paises' : 'countries'}`;
  const savedSearchesHref = `/${locale}/${locale === 'es' ? 'busquedas-guardadas' : 'saved-searches'}`;
  const pricingHref = `/${locale}/${locale === 'es' ? 'precios' : 'pricing'}`;
  const signupHref = `/${locale}/${locale === 'es' ? 'registrarse' : 'signup'}`;
  const signinHref = `/${locale}/${locale === 'es' ? 'iniciar-sesion' : 'signin'}`;
  const privacyHref = `/${locale}/privacy`;
  const termsHref = `/${locale}/${locale === 'es' ? 'terminos' : 'terms'}`;

  // Reusable shape for column links — same JSX rendered both inside the
  // mobile accordion and inside the desktop column. Pulling into a const
  // avoids duplicating the JSX twice per section.
  const savedPropertiesHref = `/${locale}/${locale === 'es' ? 'inmuebles-guardados' : 'saved-properties'}`;
  const buyersLinks = (
    <ul className="space-y-2 text-sm">
      <li><a href={buyHref} className="footer-link">{t('linkBrowseListings')}</a></li>
      <li><a href={countriesHref} className="footer-link">{t('linkBrowseByCountry')}</a></li>
      <li><a href={savedPropertiesHref} className="footer-link">{t('linkSavedProperties')}</a></li>
      <li><a href={savedSearchesHref} className="footer-link">{t('linkSavedSearches')}</a></li>
    </ul>
  );

  const agentsLinks = (
    <ul className="space-y-2 text-sm">
      <li><a href={pricingHref} className="footer-link">{t('linkPricing')}</a></li>
      <li><a href={signupHref} className="footer-link">{t('linkSignUp')}</a></li>
      <li><a href={signinHref} className="footer-link">{t('linkSignIn')}</a></li>
    </ul>
  );

  const aboutBlock = (
    <div className="space-y-3 text-sm">
      <p className="text-ink-inverse-muted">{t('aboutBody')}</p>
      <p>
        <a href={`mailto:${SUPPORT_EMAIL}`} className="footer-link">
          {t('quickContact')}
        </a>
      </p>
    </div>
  );

  const stayInTouchBlock = (
    <div className="space-y-4 text-sm">
      <p className="text-ink-inverse-muted">{t('newsletter.body')}</p>
      <NewsletterForm />
      <div className="flex items-center gap-3 pt-2">
        <a
          href={FACEBOOK_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Facebook"
          className="footer-link"
        >
          Facebook
        </a>
        <span aria-hidden="true" className="text-ink-inverse-muted/40">·</span>
        <a
          href={INSTAGRAM_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Instagram"
          className="footer-link"
        >
          Instagram
        </a>
        <span aria-hidden="true" className="text-ink-inverse-muted/40">·</span>
        <a
          href={LINKEDIN_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="LinkedIn"
          className="footer-link"
        >
          LinkedIn
        </a>
      </div>
    </div>
  );

  const sections: Array<{ title: string; content: React.ReactNode }> = [
    { title: t('sectionAbout'), content: aboutBlock },
    { title: t('sectionForBuyers'), content: buyersLinks },
    { title: t('sectionForAgents'), content: agentsLinks },
    { title: t('sectionStayInTouch'), content: stayInTouchBlock },
  ];

  return (
    <footer className="mt-24 bg-surface-dark text-ink-inverse">
      <div className="mx-auto max-w-6xl px-6 pt-12 pb-6 md:pt-16">
        {/* Anon-only auth strip — pill CTAs for the high-intent moments
            when a buyer scrolled all the way to the footer without
            signing up yet. Hidden once authed (the visitor obviously
            doesn't need them anymore). */}
        {!isAuthed && (
          <div className="mb-10 flex flex-col items-start gap-4 rounded-card border border-white/10 bg-white/5 p-5 sm:flex-row sm:items-center sm:justify-between md:mb-14">
            <div>
              <p className="font-brand text-base font-semibold text-ink-inverse md:text-lg">
                {t('authStripHeading')}
              </p>
              <p className="mt-1 text-sm text-ink-inverse-muted">
                {t('authStripBody')}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <a href={signupHref} className="btn-primary-inverse">
                {t('authStripRegister')}
              </a>
              <a
                href={signinHref}
                className="inline-flex h-10 items-center justify-center rounded-full border border-white/20 px-6 text-sm font-medium text-ink-inverse transition hover:border-white/40 active:scale-95"
              >
                {t('authStripSignIn')}
              </a>
            </div>
          </div>
        )}

        {/* Mobile accordions — visible <md only. Each column is a <details>;
            no JS needed for the toggle. */}
        <div className="md:hidden">
          {sections.map((s, i) => (
            <details
              key={s.title}
              className="footer-accordion border-b border-white/10 py-3"
              open={i === 0}
            >
              <summary className="flex cursor-pointer items-center justify-between font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-ink-inverse">
                <span>{s.title}</span>
                <span aria-hidden="true" className="footer-accordion-chevron text-base text-ink-inverse-muted" />
              </summary>
              <div className="pt-4 pb-2">{s.content}</div>
            </details>
          ))}
        </div>

        {/* Desktop 4-column grid — visible md+ only. */}
        <div className="hidden gap-10 md:grid md:grid-cols-4">
          {sections.map((s) => (
            <div key={s.title}>
              <h3 className="mb-4 font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-ink-inverse">
                {s.title}
              </h3>
              {s.content}
            </div>
          ))}
        </div>

        {/* Bottom strip — copyright + legal + locale mirror. */}
        <div className="mt-10 flex flex-col gap-4 border-t border-white/10 pt-6 text-xs text-ink-inverse-muted md:mt-14 md:flex-row md:items-center md:justify-between">
          <p>© {new Date().getFullYear()} AHO. {t('rights')}</p>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Legal">
            <a href={privacyHref} className="footer-link">{t('privacy')}</a>
            <a href={termsHref} className="footer-link">{t('terms')}</a>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="footer-link">
              {SUPPORT_EMAIL}
            </a>
          </nav>
          <div className="md:order-3">
            <LocaleToggle variant="footer" />
          </div>
        </div>
      </div>
    </footer>
  );
}
