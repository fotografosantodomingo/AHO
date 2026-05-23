'use client';

import { useState, type FormEvent } from 'react';

/**
 * Founding 50 application form. Client component (form state + submit).
 *
 * Posts to /api/founding-agent which validates, dedups, inserts, and
 * fires two emails (welcome + admin alert). Returns one of:
 *   { ok: true, applicationId, duplicate?: true }
 *   { error: 'invalid_request' | 'rate_limited' | 'internal_error' }
 *
 * Honeypot field `website` is rendered off-screen via inline CSS so
 * screen readers can still describe it (good a11y citizenship) while
 * sighted humans never see it. Bots fill it; the API rejects.
 */
export function FoundingAgentForm({
  locale,
  copy,
  defaultCountryCode,
}: {
  locale: 'en' | 'es' | 'pl' | 'pt' | 'de' | 'fr' | 'it';
  copy: FoundingAgentFormCopy;
  /** Pre-fill the country dropdown based on the visitor's locale.
   *  Defaults to DO since the DR market is the launch priority. */
  defaultCountryCode?: string;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    | { kind: 'idle' }
    | { kind: 'success'; duplicate: boolean }
    | { kind: 'error'; code: string }
  >({ kind: 'idle' });
  const [form, setForm] = useState({
    full_name: '',
    email: '',
    whatsapp: '',
    city: '',
    country_code: defaultCountryCode ?? 'DO',
    portfolio_url: '',
    message: '',
    website: '', // honeypot — must stay empty
  });

  function update<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setResult({ kind: 'idle' });
    setSubmitting(true);

    try {
      const res = await fetch('/api/founding-agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...form,
          locale,
        }),
      });
      const json = (await res.json()) as
        | { ok: true; applicationId: string; duplicate?: boolean }
        | { error: string };

      if ('ok' in json && json.ok) {
        setResult({
          kind: 'success',
          duplicate: json.duplicate === true,
        });
      } else if ('error' in json) {
        setResult({ kind: 'error', code: json.error });
      } else {
        setResult({ kind: 'error', code: 'internal_error' });
      }
    } catch (err) {
      setResult({
        kind: 'error',
        code: err instanceof Error ? err.message : 'network_error',
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (result.kind === 'success') {
    return (
      <div
        role="status"
        className="rounded-2xl border border-emerald-300 bg-emerald-50 p-8 text-center dark:border-emerald-700 dark:bg-emerald-950/30"
      >
        <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-200">
          {result.duplicate ? copy.successAlready : copy.successHeading}
        </p>
        <p className="mt-3 text-slate-700 dark:text-slate-300">
          {result.duplicate ? copy.successAlreadyBody : copy.successBody}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <FieldRow>
        <Field label={copy.labelFullName} required>
          <input
            type="text"
            required
            value={form.full_name}
            onChange={(e) => update('full_name', e.target.value)}
            disabled={submitting}
            autoComplete="name"
            className={inputClass}
          />
        </Field>
        <Field label={copy.labelEmail} required>
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
            disabled={submitting}
            autoComplete="email"
            inputMode="email"
            className={inputClass}
          />
        </Field>
      </FieldRow>

      <FieldRow>
        <Field label={copy.labelWhatsApp} hint={copy.hintWhatsApp}>
          <input
            type="tel"
            value={form.whatsapp}
            onChange={(e) => update('whatsapp', e.target.value)}
            disabled={submitting}
            autoComplete="tel"
            inputMode="tel"
            placeholder="+1 829 555 0123"
            className={inputClass}
          />
        </Field>
        <Field label={copy.labelCity} required>
          <input
            type="text"
            required
            value={form.city}
            onChange={(e) => update('city', e.target.value)}
            disabled={submitting}
            autoComplete="address-level2"
            placeholder={copy.placeholderCity}
            className={inputClass}
          />
        </Field>
      </FieldRow>

      <Field label={copy.labelCountry} required>
        <select
          required
          value={form.country_code}
          onChange={(e) => update('country_code', e.target.value)}
          disabled={submitting}
          className={inputClass}
        >
          {/* Priority list — markets we're recruiting in. Rest of
              world available but not surfaced at top of the list. */}
          <option value="DO">{copy.country_DO}</option>
          <option value="ES">{copy.country_ES}</option>
          <option value="MX">{copy.country_MX}</option>
          <option value="CO">{copy.country_CO}</option>
          <option value="AR">{copy.country_AR}</option>
          <option value="US">{copy.country_US}</option>
          <option value="PL">{copy.country_PL}</option>
          <option value="PT">{copy.country_PT}</option>
          <option value="DE">{copy.country_DE}</option>
          <option value="FR">{copy.country_FR}</option>
          <option value="IT">{copy.country_IT}</option>
          <option value="OTHER" disabled>
            ─────────────────
          </option>
          {OTHER_ISO_2_CODES.map((cc) => (
            <option key={cc} value={cc}>
              {cc}
            </option>
          ))}
        </select>
      </Field>

      <Field label={copy.labelPortfolio} hint={copy.hintPortfolio}>
        <input
          type="url"
          value={form.portfolio_url}
          onChange={(e) => update('portfolio_url', e.target.value)}
          disabled={submitting}
          placeholder="https://"
          className={inputClass}
        />
      </Field>

      <Field label={copy.labelMessage} hint={copy.hintMessage}>
        <textarea
          rows={4}
          value={form.message}
          onChange={(e) => update('message', e.target.value)}
          disabled={submitting}
          maxLength={2000}
          className={inputClass + ' resize-y'}
        />
      </Field>

      {/* Honeypot — kept in DOM, hidden from real users via CSS. Bots
          fill it; the server rejects. aria-hidden + tabIndex=-1 so
          assistive tech also skips it. */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '-10000px',
          top: 'auto',
          width: '1px',
          height: '1px',
          overflow: 'hidden',
        }}
      >
        <label>
          Website (leave blank)
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={form.website}
            onChange={(e) => update('website', e.target.value)}
          />
        </label>
      </div>

      {result.kind === 'error' && (
        <p
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
        >
          {result.code === 'rate_limited'
            ? copy.errorRateLimited
            : result.code === 'invalid_request'
              ? copy.errorInvalid
              : copy.errorGeneric}
          {result.code !== 'rate_limited' && (
            <span className="ml-1 opacity-80">— {result.code}</span>
          )}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-emerald-600 px-8 text-base font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60 sm:w-auto"
      >
        {submitting ? copy.submitLoading : copy.submitButton} {!submitting && '→'}
      </button>

      <p className="text-xs text-slate-500 dark:text-slate-400">{copy.trustNote}</p>
    </form>
  );
}

const inputClass =
  'h-12 w-full rounded-lg border border-slate-300 bg-white px-4 text-base text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100';

function FieldRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">{children}</div>;
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-900 dark:text-slate-200">
        {label}
        {required && <span className="ml-1 text-emerald-600">*</span>}
      </span>
      {children}
      {hint && (
        <span className="mt-1.5 block text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </span>
      )}
    </label>
  );
}

// Tail of the ISO-2 list, minus the priority codes already at the top.
// Kept compact — full ALL_COUNTRY_CODES would balloon the bundle.
const OTHER_ISO_2_CODES = [
  'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS',
  'BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN',
  'CR','CU','CV','CW','CX','CY','CZ','DJ','DK','DM','DZ','EC','EE','EG','EH','ER',
  'ET','FI','FJ','FK','FM','FO','GA','GB','GD','GE','GF','GG','GH','GI','GL','GM',
  'GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM','HN','HR','HT','HU','ID',
  'IE','IL','IM','IN','IO','IQ','IR','IS','JE','JM','JO','JP','KE','KG','KH','KI',
  'KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC','LI','LK','LR','LS','LT','LU',
  'LV','LY','MA','MC','MD','ME','MF','MG','MH','MK','ML','MM','MN','MO','MP','MQ',
  'MR','MS','MT','MU','MV','MW','MY','MZ','NA','NC','NE','NF','NG','NI','NL','NO',
  'NP','NR','NU','NZ','OM','PA','PE','PF','PG','PH','PK','PM','PN','PR','PS','PW',
  'PY','QA','RE','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG','SH','SI','SJ',
  'SK','SL','SM','SN','SO','SR','SS','ST','SV','SX','SY','SZ','TC','TD','TF','TG',
  'TH','TJ','TK','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','UM','UY',
  'UZ','VA','VC','VE','VG','VI','VN','VU','WF','WS','YE','YT','ZA','ZM','ZW',
] as const;

export interface FoundingAgentFormCopy {
  labelFullName: string;
  labelEmail: string;
  labelWhatsApp: string;
  hintWhatsApp: string;
  labelCity: string;
  placeholderCity: string;
  labelCountry: string;
  labelPortfolio: string;
  hintPortfolio: string;
  labelMessage: string;
  hintMessage: string;
  submitButton: string;
  submitLoading: string;
  trustNote: string;
  successHeading: string;
  successBody: string;
  successAlready: string;
  successAlreadyBody: string;
  errorRateLimited: string;
  errorInvalid: string;
  errorGeneric: string;
  country_DO: string;
  country_ES: string;
  country_MX: string;
  country_CO: string;
  country_AR: string;
  country_US: string;
  country_PL: string;
  country_PT: string;
  country_DE: string;
  country_FR: string;
  country_IT: string;
}
