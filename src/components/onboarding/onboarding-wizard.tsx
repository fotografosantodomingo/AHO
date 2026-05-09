'use client';

import { useState, useCallback, useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { CountrySelect } from '@/components/forms/country-select';
import type { Locale } from '@/i18n/config';

/**
 * Multi-step first-run onboarding wizard for newly-signed-up agents.
 *
 * Lives at /[locale]/onboarding/welcome (when there's no Stripe
 * `?session_id` in the URL — the post-Checkout success path is handled
 * by the page-level Server Component before this renders).
 *
 * Steps:
 *   1. Welcome — set expectations, show real trust signals.
 *   2. Profile basics — full_name, country/city, languages, bio.
 *   3. Connect — WhatsApp + social link URLs (deep-link to /dashboard/social
 *      for the Meta OAuth handshake handled there).
 *   4. First listing — CTA to /dashboard/properties/new + Pro Automation
 *      upgrade nudge for free-tier users.
 *
 * Soft funnel only: every step has Skip; the wizard never gates dashboard
 * access. Each step that mutates data PUTs to /api/me/profile so progress
 * persists if the user closes the tab. The wizard pre-fills from
 * `initial` (server-rendered from the user's current profile row).
 */

export interface OnboardingWizardInitial {
  fullName: string | null;
  city: string | null;
  countryCode: string | null;
  bio: string | null;
  languagesSpoken: string[];
  whatsappPhone: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  linkedinUrl: string | null;
}

interface Props {
  initial: OnboardingWizardInitial;
  /** Plan tier from `planTierLabel(currentPlanId)`. 'none' = free user. */
  planTier: 'none' | 'agent' | 'plus' | 'pro_automation';
  /** True if at least one country page has agents — drives a real trust line. */
  hasLiveAgents: boolean;
}

const TOTAL_STEPS = 4;

const LANGUAGE_SUGGESTIONS = [
  'English',
  'Español',
  'Português',
  'Français',
  'Deutsch',
  'Italiano',
];

const inputClass =
  'mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark';
const labelClass = 'block text-sm font-medium';
const hintClass = 'mt-1 text-xs text-helper';

function nullify(s: string): string | null {
  const t = s.trim();
  return t.length === 0 ? null : t;
}

export function OnboardingWizard({ initial, planTier, hasLiveAgents }: Props) {
  const t = useTranslations('onboardingWizard');
  const locale = useLocale();
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step-2 form state
  const [fullName, setFullName] = useState(initial.fullName ?? '');
  const [city, setCity] = useState(initial.city ?? '');
  const [countryCode, setCountryCode] = useState(initial.countryCode ?? '');
  const [bio, setBio] = useState(initial.bio ?? '');
  const [languages, setLanguages] = useState<string[]>(
    initial.languagesSpoken ?? [],
  );

  // Step-3 form state
  const [whatsappPhone, setWhatsappPhone] = useState(
    initial.whatsappPhone ?? '',
  );
  const [facebookUrl, setFacebookUrl] = useState(initial.facebookUrl ?? '');
  const [instagramUrl, setInstagramUrl] = useState(initial.instagramUrl ?? '');
  const [linkedinUrl, setLinkedinUrl] = useState(initial.linkedinUrl ?? '');

  const dashboardPath = useMemo(
    () => `/${locale}/${locale === 'es' ? 'panel' : 'dashboard'}`,
    [locale],
  );
  const newListingPath = useMemo(
    () =>
      `/${locale}/${
        locale === 'es' ? 'panel/propiedades/nuevo' : 'dashboard/properties/new'
      }`,
    [locale],
  );
  const socialPath = useMemo(
    () =>
      `/${locale}/${locale === 'es' ? 'panel/social' : 'dashboard/social'}`,
    [locale],
  );
  const pricingPath = useMemo(
    () => `/${locale}/${locale === 'es' ? 'precios' : 'pricing'}`,
    [locale],
  );

  function addLanguage(value: string) {
    const trimmed = value.trim();
    if (!trimmed || languages.includes(trimmed) || languages.length >= 20) {
      return;
    }
    setLanguages([...languages, trimmed]);
  }
  function removeLanguage(l: string) {
    setLanguages(languages.filter((x) => x !== l));
  }

  const saveProfile = useCallback(
    async (
      patch: Record<string, string | null | string[]>,
    ): Promise<boolean> => {
      setError(null);
      setPending(true);
      try {
        const res = await fetch('/api/me/profile', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          errorCode?: string;
        };
        if (!res.ok || !json.ok) {
          setError(json.errorCode ?? `http_${res.status}`);
          return false;
        }
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'network_error');
        return false;
      } finally {
        setPending(false);
      }
    },
    [],
  );

  async function handleStep2Save() {
    const ok = await saveProfile({
      full_name: nullify(fullName),
      city: nullify(city),
      country_code: nullify(countryCode),
      bio: nullify(bio),
      languages_spoken: languages,
    });
    if (ok) setStep(3);
  }

  async function handleStep3Save() {
    const ok = await saveProfile({
      whatsapp_phone: nullify(whatsappPhone),
      facebook_url: nullify(facebookUrl),
      instagram_url: nullify(instagramUrl),
      linkedin_url: nullify(linkedinUrl),
    });
    if (ok) setStep(4);
  }

  function next() {
    if (step < TOTAL_STEPS) setStep(step + 1);
  }
  function back() {
    if (step > 1) setStep(step - 1);
  }
  function finishToDashboard() {
    router.push(dashboardPath);
  }

  return (
    <div className="mx-auto w-full max-w-xl">
      <ProgressDots current={step} total={TOTAL_STEPS} t={t} />

      <div className="mt-6 rounded-2xl border border-border bg-surface p-6 shadow-whisper md:p-8 dark:bg-surface-deep">
        <p className="font-brand text-[12px] font-semibold uppercase tracking-[0.13em] text-helper">
          {t('stepLabel', { current: step, total: TOTAL_STEPS })}
        </p>

        {step === 1 && <StepWelcome t={t} hasLiveAgents={hasLiveAgents} />}

        {step === 2 && (
          <StepProfileBasics
            t={t}
            locale={locale as Locale}
            fullName={fullName}
            setFullName={setFullName}
            city={city}
            setCity={setCity}
            countryCode={countryCode}
            setCountryCode={setCountryCode}
            bio={bio}
            setBio={setBio}
            languages={languages}
            addLanguage={addLanguage}
            removeLanguage={removeLanguage}
          />
        )}

        {step === 3 && (
          <StepConnect
            t={t}
            socialPath={socialPath}
            whatsappPhone={whatsappPhone}
            setWhatsappPhone={setWhatsappPhone}
            facebookUrl={facebookUrl}
            setFacebookUrl={setFacebookUrl}
            instagramUrl={instagramUrl}
            setInstagramUrl={setInstagramUrl}
            linkedinUrl={linkedinUrl}
            setLinkedinUrl={setLinkedinUrl}
          />
        )}

        {step === 4 && (
          <StepFirstListing
            t={t}
            planTier={planTier}
            newListingPath={newListingPath}
            pricingPath={pricingPath}
          />
        )}

        {error && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
          >
            {error === 'invalid_input'
              ? t('errors.invalidInput')
              : error === 'unauthenticated'
                ? t('errors.unauthenticated')
                : t('errors.generic')}
          </div>
        )}

        <div className="mt-6 flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {step > 1 && (
              <button
                type="button"
                onClick={back}
                className="btn-ghost"
                disabled={pending}
              >
                {t('back')}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {step !== TOTAL_STEPS && (
              <button
                type="button"
                onClick={next}
                className="text-sm font-medium text-helper underline-offset-2 hover:text-action hover:underline dark:hover:text-action-dark"
                disabled={pending}
              >
                {t('skip')}
              </button>
            )}
            {step === 1 && (
              <button
                type="button"
                onClick={() => setStep(2)}
                className="btn-primary"
              >
                {t('getStarted')}
              </button>
            )}
            {step === 2 && (
              <button
                type="button"
                onClick={handleStep2Save}
                disabled={pending}
                className="btn-primary disabled:opacity-50"
              >
                {pending ? t('saving') : t('saveAndContinue')}
              </button>
            )}
            {step === 3 && (
              <button
                type="button"
                onClick={handleStep3Save}
                disabled={pending}
                className="btn-primary disabled:opacity-50"
              >
                {pending ? t('saving') : t('saveAndContinue')}
              </button>
            )}
            {step === 4 && (
              <button
                type="button"
                onClick={finishToDashboard}
                className="btn-primary"
              >
                {t('finishToDashboard')}
              </button>
            )}
          </div>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-helper">
        {t('softFunnelNote')}
      </p>
    </div>
  );
}

// ─── Steps ──────────────────────────────────────────────────────────

type TFn = ReturnType<typeof useTranslations<'onboardingWizard'>>;

function StepWelcome({
  t,
  hasLiveAgents,
}: {
  t: TFn;
  hasLiveAgents: boolean;
}) {
  return (
    <div className="space-y-4">
      <h1 className="font-brand text-2xl font-semibold tracking-tight md:text-[28px] md:leading-[1.18]">
        {t('welcomeHeading')}
      </h1>
      <p className="text-sm text-ink dark:text-ink-inverse">
        {t('welcomeBody')}
      </p>
      <ul className="mt-4 space-y-2 text-sm">
        <Bullet>{t('welcomeBullet1')}</Bullet>
        <Bullet>{t('welcomeBullet2')}</Bullet>
        <Bullet>{t('welcomeBullet3')}</Bullet>
      </ul>
      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-canvas px-3 py-2 text-xs text-helper">
        <span aria-hidden="true">{lockIcon()}</span>
        <span>{t('trustSsl')}</span>
        <span aria-hidden="true">·</span>
        <span>{t('trustGdpr')}</span>
        {hasLiveAgents && (
          <>
            <span aria-hidden="true">·</span>
            <span>{t('trustHasAgents')}</span>
          </>
        )}
      </div>
    </div>
  );
}

function StepProfileBasics({
  t,
  locale,
  fullName,
  setFullName,
  city,
  setCity,
  countryCode,
  setCountryCode,
  bio,
  setBio,
  languages,
  addLanguage,
  removeLanguage,
}: {
  t: TFn;
  locale: Locale;
  fullName: string;
  setFullName: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  countryCode: string;
  setCountryCode: (v: string) => void;
  bio: string;
  setBio: (v: string) => void;
  languages: string[];
  addLanguage: (v: string) => void;
  removeLanguage: (v: string) => void;
}) {
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h2 className="font-brand text-xl font-semibold tracking-tight md:text-2xl">
          {t('profileHeading')}
        </h2>
        <p className="text-sm text-helper">{t('profileSubheading')}</p>
      </header>

      <div>
        <label htmlFor="ow-name" className={labelClass}>
          {t('fullName')}
        </label>
        <input
          id="ow-name"
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          className={inputClass}
          maxLength={120}
          autoComplete="name"
        />
        <p className={hintClass}>{t('fullNameHint')}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ow-city" className={labelClass}>
            {t('city')}
          </label>
          <input
            id="ow-city"
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className={inputClass}
            maxLength={120}
            autoComplete="address-level2"
          />
        </div>
        <div>
          <label htmlFor="ow-country" className={labelClass}>
            {t('country')}
          </label>
          <CountrySelect
            id="ow-country"
            value={countryCode}
            onChange={setCountryCode}
            locale={locale}
            className={inputClass}
            placeholder={t('countryPlaceholder')}
          />
        </div>
      </div>
      <p className={hintClass}>{t('locationHint')}</p>

      <div>
        <span className={labelClass}>{t('languages')}</span>
        <p className={hintClass}>{t('languagesHint')}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {languages.map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => removeLanguage(l)}
              className="inline-flex items-center gap-1 rounded-md bg-action/15 px-2.5 py-1 text-xs font-medium text-action dark:bg-action-dark/20 dark:text-action-dark"
            >
              <span>{l}</span>
              <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {LANGUAGE_SUGGESTIONS.filter((l) => !languages.includes(l)).map(
            (l) => (
              <button
                key={l}
                type="button"
                onClick={() => addLanguage(l)}
                className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-helper transition hover:border-border-strong/60 hover:text-ink dark:bg-surface-deep dark:hover:text-ink-inverse"
              >
                + {l}
              </button>
            ),
          )}
        </div>
      </div>

      <div>
        <label htmlFor="ow-bio" className={labelClass}>
          {t('bio')}
        </label>
        <textarea
          id="ow-bio"
          rows={4}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          className={inputClass}
          maxLength={2000}
          placeholder={t('bioPlaceholder')}
        />
        <p className={hintClass}>{t('bioHint')}</p>
      </div>
    </div>
  );
}

function StepConnect({
  t,
  socialPath,
  whatsappPhone,
  setWhatsappPhone,
  facebookUrl,
  setFacebookUrl,
  instagramUrl,
  setInstagramUrl,
  linkedinUrl,
  setLinkedinUrl,
}: {
  t: TFn;
  socialPath: string;
  whatsappPhone: string;
  setWhatsappPhone: (v: string) => void;
  facebookUrl: string;
  setFacebookUrl: (v: string) => void;
  instagramUrl: string;
  setInstagramUrl: (v: string) => void;
  linkedinUrl: string;
  setLinkedinUrl: (v: string) => void;
}) {
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h2 className="font-brand text-xl font-semibold tracking-tight md:text-2xl">
          {t('connectHeading')}
        </h2>
        <p className="text-sm text-helper">{t('connectSubheading')}</p>
      </header>

      <div>
        <label htmlFor="ow-whatsapp" className={labelClass}>
          {t('whatsappPhone')}
        </label>
        <input
          id="ow-whatsapp"
          type="tel"
          value={whatsappPhone}
          onChange={(e) => setWhatsappPhone(e.target.value)}
          className={inputClass}
          placeholder="+1 809 555 1234"
          autoComplete="tel"
          maxLength={40}
        />
        <p className={hintClass}>{t('whatsappHint')}</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="ow-facebook" className={labelClass}>
            Facebook
          </label>
          <input
            id="ow-facebook"
            type="url"
            value={facebookUrl}
            onChange={(e) => setFacebookUrl(e.target.value)}
            className={inputClass}
            placeholder="https://facebook.com/…"
            maxLength={500}
          />
        </div>
        <div>
          <label htmlFor="ow-instagram" className={labelClass}>
            Instagram
          </label>
          <input
            id="ow-instagram"
            type="url"
            value={instagramUrl}
            onChange={(e) => setInstagramUrl(e.target.value)}
            className={inputClass}
            placeholder="https://instagram.com/…"
            maxLength={500}
          />
        </div>
        <div>
          <label htmlFor="ow-linkedin" className={labelClass}>
            LinkedIn
          </label>
          <input
            id="ow-linkedin"
            type="url"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            className={inputClass}
            placeholder="https://linkedin.com/in/…"
            maxLength={500}
          />
        </div>
      </div>
      <p className={hintClass}>{t('socialLinksHint')}</p>

      <div className="rounded-lg border border-border bg-canvas p-4">
        <p className="text-sm font-medium">{t('autoPostHeading')}</p>
        <p className="mt-1 text-sm text-helper">{t('autoPostBody')}</p>
        <a
          href={socialPath}
          className="mt-3 inline-flex items-center text-sm font-medium text-action underline-offset-2 hover:underline dark:text-action-dark"
        >
          {t('autoPostCta')} <span aria-hidden="true" className="ml-1">→</span>
        </a>
      </div>
    </div>
  );
}

function StepFirstListing({
  t,
  planTier,
  newListingPath,
  pricingPath,
}: {
  t: TFn;
  planTier: 'none' | 'agent' | 'plus' | 'pro_automation';
  newListingPath: string;
  pricingPath: string;
}) {
  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h2 className="font-brand text-xl font-semibold tracking-tight md:text-2xl">
          {t('listingHeading')}
        </h2>
        <p className="text-sm text-helper">{t('listingSubheading')}</p>
      </header>

      <ul className="space-y-2 text-sm">
        <Bullet>{t('listingLane1')}</Bullet>
        <Bullet>{t('listingLane2')}</Bullet>
        <Bullet>{t('listingLane3')}</Bullet>
      </ul>

      <a href={newListingPath} className="btn-primary inline-flex w-full sm:w-auto">
        {t('addFirstListing')}
      </a>

      {planTier === 'none' && (
        <div className="rounded-lg border border-border bg-canvas p-4">
          <p className="text-sm font-medium">{t('upgradeNudgeHeading')}</p>
          <p className="mt-1 text-sm text-helper">{t('upgradeNudgeBody')}</p>
          <a
            href={pricingPath}
            className="mt-3 inline-flex items-center text-sm font-medium text-action underline-offset-2 hover:underline dark:text-action-dark"
          >
            {t('upgradeNudgeCta')} <span aria-hidden="true" className="ml-1">→</span>
          </a>
        </div>
      )}

      {planTier === 'agent' && (
        <div className="rounded-lg border border-border bg-canvas p-4">
          <p className="text-sm font-medium">{t('proAutomationHeading')}</p>
          <p className="mt-1 text-sm text-helper">{t('proAutomationBody')}</p>
          <a
            href={pricingPath}
            className="mt-3 inline-flex items-center text-sm font-medium text-action underline-offset-2 hover:underline dark:text-action-dark"
          >
            {t('proAutomationCta')} <span aria-hidden="true" className="ml-1">→</span>
          </a>
        </div>
      )}
    </div>
  );
}

// ─── Bits ───────────────────────────────────────────────────────────

function ProgressDots({
  current,
  total,
  t,
}: {
  current: number;
  total: number;
  t: TFn;
}) {
  return (
    <div
      role="progressbar"
      aria-valuenow={current}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-label={t('progressAria', { current, total })}
      className="flex items-center justify-center gap-2"
    >
      {Array.from({ length: total }).map((_, i) => {
        const n = i + 1;
        const state =
          n < current ? 'done' : n === current ? 'current' : 'todo';
        return (
          <span
            key={n}
            aria-hidden="true"
            className={
              state === 'done'
                ? 'h-2 w-8 rounded-full bg-action transition-all dark:bg-action-dark'
                : state === 'current'
                  ? 'h-2 w-12 rounded-full bg-action transition-all dark:bg-action-dark'
                  : 'h-2 w-8 rounded-full bg-border transition-all'
            }
          />
        );
      })}
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className="mt-[0.4rem] inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-action dark:bg-action-dark"
      />
      <span>{children}</span>
    </li>
  );
}

function lockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}
