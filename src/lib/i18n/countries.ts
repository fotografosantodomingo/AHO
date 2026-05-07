import type { Locale } from '@/i18n/config';

/**
 * Single source of truth for ISO-3166-1 alpha-2 → localized country name.
 * Replaces the four+ inline `resolveCountryName` / `Intl.DisplayNames` copies
 * that grew across `properties-in/`, `agents/`, `listing-card`, etc. The
 * underlying `Intl.DisplayNames` instance is created once per locale and
 * memoized so we don't pay the construction cost per render.
 *
 * Returns the uppercased ISO code unchanged if the runtime can't resolve
 * the region (older Edge runtimes, malformed input, etc.) — never throws.
 *
 * Locale-fallback policy: locale → ISO only. There is intentionally NO
 * cross-locale fallback chain (e.g. es → en → ISO). V8 supports both en
 * and es region-name resolution natively, so the chain would never fire
 * in practice; adding it would just be untested code paths. If a future
 * locale is added that lacks region support, fall back to ISO directly.
 */
const cache = new Map<Locale, Intl.DisplayNames | null>();

/** Maps AHO Locale to a BCP-47 tag for Intl.DisplayNames. ES uses
 *  the Dominican Republic variant matching our launch market; the
 *  other 5 marketing locales pick the most common regional variant. */
function intlTagFor(locale: Locale): string {
  switch (locale) {
    case 'es':
      return 'es-DO';
    case 'pl':
      return 'pl-PL';
    case 'pt':
      return 'pt-PT';
    case 'de':
      return 'de-DE';
    case 'fr':
      return 'fr-FR';
    case 'it':
      return 'it-IT';
    default:
      return 'en-US';
  }
}

function getDisplay(locale: Locale): Intl.DisplayNames | null {
  if (cache.has(locale)) return cache.get(locale)!;
  let display: Intl.DisplayNames | null;
  try {
    display = new Intl.DisplayNames([intlTagFor(locale)], { type: 'region' });
  } catch {
    display = null;
  }
  cache.set(locale, display);
  return display;
}

export function getCountryName(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return '';
  const code = iso.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return code;
  const display = getDisplay(locale);
  return display?.of(code) ?? code;
}

/**
 * Full ISO 3166-1 alpha-2 list (249 codes). Used by the country
 * dropdown components on the profile + listing forms — every form
 * that asks "which country?" should accept any country in the world,
 * not just countries that already have AHO listings (which is what
 * `getCountriesIndex` returns for the /countries page).
 */
export const ALL_COUNTRY_CODES = [
  'AD','AE','AF','AG','AI','AL','AM','AO','AQ','AR','AS','AT','AU','AW','AX','AZ',
  'BA','BB','BD','BE','BF','BG','BH','BI','BJ','BL','BM','BN','BO','BQ','BR','BS',
  'BT','BV','BW','BY','BZ','CA','CC','CD','CF','CG','CH','CI','CK','CL','CM','CN',
  'CO','CR','CU','CV','CW','CX','CY','CZ','DE','DJ','DK','DM','DO','DZ','EC','EE',
  'EG','EH','ER','ES','ET','FI','FJ','FK','FM','FO','FR','GA','GB','GD','GE','GF',
  'GG','GH','GI','GL','GM','GN','GP','GQ','GR','GS','GT','GU','GW','GY','HK','HM',
  'HN','HR','HT','HU','ID','IE','IL','IM','IN','IO','IQ','IR','IS','IT','JE','JM',
  'JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB','LC',
  'LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MF','MG','MH','MK',
  'ML','MM','MN','MO','MP','MQ','MR','MS','MT','MU','MV','MW','MX','MY','MZ','NA',
  'NC','NE','NF','NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PF','PG',
  'PH','PK','PL','PM','PN','PR','PS','PT','PW','PY','QA','RE','RO','RS','RU','RW',
  'SA','SB','SC','SD','SE','SG','SH','SI','SJ','SK','SL','SM','SN','SO','SR','SS',
  'ST','SV','SX','SY','SZ','TC','TD','TF','TG','TH','TJ','TK','TL','TM','TN','TO',
  'TR','TT','TV','TW','TZ','UA','UG','UM','US','UY','UZ','VA','VC','VE','VG','VI',
  'VN','VU','WF','WS','YE','YT','ZA','ZM','ZW',
] as const;

export type CountryCode = (typeof ALL_COUNTRY_CODES)[number];

/**
 * Returns every ISO country with a localized display name for the
 * active locale, sorted alphabetically by display name. Used by the
 * `<CountrySelect>` component. Memoized per-locale so we don't rebuild
 * the array on every keystroke in a typeahead.
 */
const allCountriesCache = new Map<Locale, ReadonlyArray<{ code: string; name: string }>>();

export function getAllCountries(
  locale: Locale,
): ReadonlyArray<{ code: string; name: string }> {
  const cached = allCountriesCache.get(locale);
  if (cached) return cached;
  const list = ALL_COUNTRY_CODES.map((code) => ({
    code,
    name: getCountryName(code, locale),
  }));
  list.sort((a, b) => a.name.localeCompare(b.name, intlTagFor(locale)));
  const frozen = list as ReadonlyArray<{ code: string; name: string }>;
  allCountriesCache.set(locale, frozen);
  return frozen;
}
