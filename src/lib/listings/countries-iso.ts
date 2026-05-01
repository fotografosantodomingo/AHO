/**
 * ISO-3166-1 alpha-2 country codes used by the listing form's country
 * dropdown. List is the standard 249 ISO codes; we resolve display names
 * at render time via `Intl.DisplayNames` so we don't ship a hand-curated
 * EN/ES name table.
 *
 * Why a static array instead of pulling from `Intl.supportedValuesOf('region')`:
 * the runtime helper exists in modern engines but its return shape isn't
 * fully consistent across Edge runtime versions, and the canonical ISO
 * list doesn't change often. Static keeps things deterministic.
 */
export const COUNTRY_CODES = [
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

/**
 * Build a [code, localizedName] pair list for the active locale. Sorted by
 * localized name so users see "Argentina, Brasil, …" alphabetically in
 * Spanish and "Argentina, Australia, …" in English.
 */
export function buildCountryOptions(
  locale: 'en' | 'es',
): Array<{ code: string; name: string }> {
  const intlLocale = locale === 'es' ? 'es-DO' : 'en-US';
  let display: Intl.DisplayNames | null = null;
  try {
    display = new Intl.DisplayNames([intlLocale], { type: 'region' });
  } catch {
    display = null;
  }
  return COUNTRY_CODES.map((code) => ({
    code,
    name: display?.of(code) ?? code,
  })).sort((a, b) => a.name.localeCompare(b.name, intlLocale));
}
