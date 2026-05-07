'use client';

import { useMemo } from 'react';
import { getAllCountries } from '@/lib/i18n/countries';
import type { Locale } from '@/i18n/config';

interface Props {
  id?: string;
  /** Current ISO 3166-1 alpha-2 code (uppercase). Empty string = unset. */
  value: string;
  onChange: (code: string) => void;
  /** Current UI locale — used to localize each country's display name. */
  locale: Locale;
  /** Native select className — forwarded as-is. */
  className?: string;
  required?: boolean;
  /** Placeholder shown as the disabled first option. Translated by caller. */
  placeholder?: string;
  /** When true, the select is rendered disabled (e.g. while saving). */
  disabled?: boolean;
}

/**
 * Country dropdown. Replaces the legacy 2-letter ISO text inputs across
 * the profile + listing forms. Renders all 249 ISO 3166-1 alpha-2
 * countries with display names localized to the user's UI language.
 *
 * Why a native `<select>` (and not a custom typeahead): a 249-row plain
 * select is fast, accessible by default, and works on every browser /
 * screen reader / keyboard pattern without bespoke JS. Mobile browsers
 * render their native picker. We keep the typeahead-style combobox for
 * the homepage city/country search where the dataset is dynamic — for
 * forms with a fixed list, native is the right answer.
 */
export function CountrySelect({
  id,
  value,
  onChange,
  locale,
  className,
  required,
  placeholder,
  disabled,
}: Props) {
  const countries = useMemo(() => getAllCountries(locale), [locale]);

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      disabled={disabled}
      className={className}
    >
      <option value="" disabled={required}>
        {placeholder ?? '—'}
      </option>
      {countries.map((c) => (
        <option key={c.code} value={c.code}>
          {c.name}
        </option>
      ))}
    </select>
  );
}
