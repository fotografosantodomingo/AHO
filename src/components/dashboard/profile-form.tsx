'use client';

import { useState, type FormEvent } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { AvatarUploader } from './avatar-uploader';

export interface ProfileFormInitial {
  full_name: string | null;
  phone: string | null;
  whatsapp_phone: string | null;
  avatar_url: string | null;
  bio: string | null;
  website_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  linkedin_url: string | null;
  specialties: string[];
  languages_spoken: string[];
  city: string | null;
  country_code: string | null;
}

interface Props {
  initial: ProfileFormInitial;
}

const inputClass =
  'mt-1 block w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark';
const labelClass = 'block text-sm font-medium';

const SPECIALTY_SUGGESTIONS = [
  'first_time_buyers',
  'luxury',
  'relocation',
  'investment',
  'short_term_rentals',
  'commercial',
  'land',
  'new_construction',
];

const LANGUAGE_SUGGESTIONS = [
  'English',
  'Español',
  'Português',
  'Français',
  'Deutsch',
  'Italiano',
  '中文',
];

/**
 * Editable agent profile. POSTs to PUT /api/me/profile. Specialties +
 * languages are tag inputs (chip on click to remove; suggestion chips
 * to add). Empty-string-to-null normalization happens before submit so
 * RLS sees null instead of '' for cleared optional fields.
 */
export function ProfileForm({ initial }: Props) {
  const t = useTranslations('profileForm');
  const locale = useLocale();
  const router = useRouter();

  const [fullName, setFullName] = useState(initial.full_name ?? '');
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [whatsappPhone, setWhatsappPhone] = useState(initial.whatsapp_phone ?? '');
  const [avatarUrl, setAvatarUrl] = useState(initial.avatar_url ?? '');
  const [bio, setBio] = useState(initial.bio ?? '');
  const [websiteUrl, setWebsiteUrl] = useState(initial.website_url ?? '');
  const [facebookUrl, setFacebookUrl] = useState(initial.facebook_url ?? '');
  const [instagramUrl, setInstagramUrl] = useState(initial.instagram_url ?? '');
  const [linkedinUrl, setLinkedinUrl] = useState(initial.linkedin_url ?? '');
  const [specialties, setSpecialties] = useState<string[]>(initial.specialties ?? []);
  const [languages, setLanguages] = useState<string[]>(initial.languages_spoken ?? []);
  const [city, setCity] = useState(initial.city ?? '');
  const [countryCode, setCountryCode] = useState(initial.country_code ?? '');

  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function addSpecialty(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (specialties.includes(trimmed)) return;
    if (specialties.length >= 20) return;
    setSpecialties([...specialties, trimmed]);
  }
  function removeSpecialty(s: string) {
    setSpecialties(specialties.filter((x) => x !== s));
  }
  function addLanguage(value: string) {
    const trimmed = value.trim();
    if (!trimmed || languages.includes(trimmed) || languages.length >= 20) return;
    setLanguages([...languages, trimmed]);
  }
  function removeLanguage(l: string) {
    setLanguages(languages.filter((x) => x !== l));
  }

  function nullify(s: string): string | null {
    const t = s.trim();
    return t.length === 0 ? null : t;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setPending(true);
    try {
      const body = {
        full_name: nullify(fullName),
        phone: nullify(phone),
        whatsapp_phone: nullify(whatsappPhone),
        avatar_url: nullify(avatarUrl),
        bio: nullify(bio),
        website_url: nullify(websiteUrl),
        facebook_url: nullify(facebookUrl),
        instagram_url: nullify(instagramUrl),
        linkedin_url: nullify(linkedinUrl),
        specialties,
        languages_spoken: languages,
        city: nullify(city),
        country_code: nullify(countryCode),
      };
      const res = await fetch('/api/me/profile', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        errorCode?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.errorCode ?? `http_${res.status}`);
        return;
      }
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'network_error');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-8" noValidate>
      <Section heading={t('sectionIdentity')}>
        <Field>
          <label htmlFor="pf-name" className={labelClass}>
            {t('fullName')}
          </label>
          <input
            id="pf-name"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={inputClass}
            maxLength={120}
          />
        </Field>
        <Field>
          <span className={labelClass}>{t('avatarUrl')}</span>
          <AvatarUploader
            current={avatarUrl}
            onChange={setAvatarUrl}
            labels={{
              upload: t('avatarUpload'),
              replace: t('avatarReplace'),
              remove: t('avatarRemove'),
              uploading: t('avatarUploading'),
              tooLarge: t('avatarTooLarge'),
              badType: t('avatarBadType'),
              failed: t('avatarUploadFailed'),
            }}
          />
          <p className="mt-1 text-xs text-helper">{t('avatarHelp')}</p>
        </Field>
        <Field>
          <label htmlFor="pf-bio" className={labelClass}>
            {t('bio')}
          </label>
          <textarea
            id="pf-bio"
            rows={5}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            className={inputClass}
            maxLength={2000}
            placeholder={t('bioPlaceholder')}
          />
          <p className="mt-1 text-xs text-helper">
            {bio.length} / 2000
          </p>
        </Field>
      </Section>

      <Section heading={t('sectionContact')}>
        <Field className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="pf-phone" className={labelClass}>
              {t('phone')}
            </label>
            <input
              id="pf-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={inputClass}
              placeholder="+1 809 555 1234"
            />
          </div>
          <div>
            <label htmlFor="pf-whatsapp" className={labelClass}>
              {t('whatsappPhone')}
            </label>
            <input
              id="pf-whatsapp"
              type="tel"
              value={whatsappPhone}
              onChange={(e) => setWhatsappPhone(e.target.value)}
              className={inputClass}
              placeholder="+1 809 555 1234"
            />
            <p className="mt-1 text-xs text-helper">{t('whatsappHelp')}</p>
          </div>
        </Field>
        <Field className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="pf-city" className={labelClass}>
              {t('city')}
            </label>
            <input
              id="pf-city"
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className={inputClass}
              maxLength={120}
            />
          </div>
          <div>
            <label htmlFor="pf-country" className={labelClass}>
              {t('countryCode')}
            </label>
            <input
              id="pf-country"
              type="text"
              value={countryCode}
              onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
              maxLength={2}
              className={`${inputClass} uppercase`}
              placeholder="DO"
            />
          </div>
        </Field>
      </Section>

      <Section heading={t('sectionExpertise')}>
        <Field>
          <label className={labelClass}>{t('specialties')}</label>
          <p className="mt-1 text-xs text-helper">{t('specialtiesHelp')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {specialties.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => removeSpecialty(s)}
                className="inline-flex items-center gap-1 rounded-md bg-action/15 px-2.5 py-1 text-xs font-medium text-action dark:bg-action-dark/20 dark:text-action-dark"
              >
                <span>{t.has(`specialtyOptions.${s}`) ? t(`specialtyOptions.${s}` as 'specialtyOptions.luxury') : s}</span>
                <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SPECIALTY_SUGGESTIONS.filter((s) => !specialties.includes(s)).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => addSpecialty(s)}
                className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-helper transition hover:border-border-strong/60 hover:text-ink dark:bg-surface-deep dark:hover:text-ink-inverse"
              >
                + {t.has(`specialtyOptions.${s}`) ? t(`specialtyOptions.${s}` as 'specialtyOptions.luxury') : s}
              </button>
            ))}
          </div>
          <CustomTagInput onAdd={addSpecialty} placeholder={t('addCustomSpecialty')} />
        </Field>

        <Field>
          <label className={labelClass}>{t('languages')}</label>
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
            {LANGUAGE_SUGGESTIONS.filter((l) => !languages.includes(l)).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => addLanguage(l)}
                className="inline-flex items-center rounded-md border border-border bg-surface px-2.5 py-1 text-xs text-helper transition hover:border-border-strong/60 hover:text-ink dark:bg-surface-deep dark:hover:text-ink-inverse"
              >
                + {l}
              </button>
            ))}
          </div>
          <CustomTagInput onAdd={addLanguage} placeholder={t('addCustomLanguage')} />
        </Field>
      </Section>

      <Section heading={t('sectionLinks')}>
        <Field>
          <label htmlFor="pf-website" className={labelClass}>
            {t('websiteUrl')}
          </label>
          <input
            id="pf-website"
            type="url"
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
            className={inputClass}
            placeholder="https://yoursite.com"
          />
        </Field>
        <Field className="grid grid-cols-3 gap-3">
          <div>
            <label htmlFor="pf-facebook" className={labelClass}>
              Facebook
            </label>
            <input
              id="pf-facebook"
              type="url"
              value={facebookUrl}
              onChange={(e) => setFacebookUrl(e.target.value)}
              className={inputClass}
              placeholder="https://facebook.com/…"
            />
          </div>
          <div>
            <label htmlFor="pf-instagram" className={labelClass}>
              Instagram
            </label>
            <input
              id="pf-instagram"
              type="url"
              value={instagramUrl}
              onChange={(e) => setInstagramUrl(e.target.value)}
              className={inputClass}
              placeholder="https://instagram.com/…"
            />
          </div>
          <div>
            <label htmlFor="pf-linkedin" className={labelClass}>
              LinkedIn
            </label>
            <input
              id="pf-linkedin"
              type="url"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              className={inputClass}
              placeholder="https://linkedin.com/in/…"
            />
          </div>
        </Field>
      </Section>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
        >
          {error === 'invalid_input'
            ? locale === 'es'
              ? 'Algún campo es inválido. Revisa las URLs (deben empezar por https://) y los teléfonos.'
              : 'Some field is invalid. Check the URLs (must start with https://) and phone numbers.'
            : error === 'unauthenticated'
            ? locale === 'es'
              ? 'Tu sesión expiró.'
              : 'Your session expired.'
            : error}
        </div>
      )}

      {saved && (
        <div
          role="status"
          className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
        >
          {t('saved')}
        </div>
      )}

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <button
          type="submit"
          disabled={pending}
          className="btn-primary disabled:opacity-50"
        >
          {pending ? '…' : t('saveChanges')}
        </button>
      </div>
    </form>
  );
}

function Section({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4">
      <legend className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-helper">
        {heading}
      </legend>
      {children}
    </fieldset>
  );
}

function Field({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={className}>{children}</div>;
}

function CustomTagInput({
  onAdd,
  placeholder,
}: {
  onAdd: (value: string) => void;
  placeholder: string;
}) {
  const [v, setV] = useState('');
  return (
    <div className="mt-2 flex gap-2">
      <input
        type="text"
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onAdd(v);
            setV('');
          }
        }}
        maxLength={60}
        className="block flex-1 rounded-lg border border-border-strong bg-surface px-3 py-1.5 text-sm shadow-whisper outline-hidden focus:ring-3 focus:ring-action dark:bg-surface-deep dark:focus:ring-action-dark"
      />
      <button
        type="button"
        onClick={() => {
          onAdd(v);
          setV('');
        }}
        className="inline-flex h-9 items-center rounded-lg border border-border-strong px-3 text-sm transition hover:bg-black/5 dark:hover:bg-white/5"
      >
        +
      </button>
    </div>
  );
}
