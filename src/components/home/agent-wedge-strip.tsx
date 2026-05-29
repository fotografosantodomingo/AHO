import Link from 'next/link';
import { type Locale } from '@/i18n/config';
import { localePath } from '@/i18n/routing';

interface Props {
  locale: Locale;
}

// PO directive 2026-05-28: Free Audit emits ONE caption per connected
// social platform (3: FB/IG/LinkedIn) in the agent's chosen language.
// Old copy said "9 ad captions + 3 graphics" — that was the 3-platforms-
// × 3-languages fanout retired in commit 716cfa9. Don't reintroduce.
const COPY: Record<
  Locale,
  { eyebrow: string; headline: string; sub: string; button: string }
> = {
  en: {
    eyebrow: 'For real estate agents',
    headline: 'Paste your listing URL. Get a full ad campaign in 60 seconds.',
    sub: '3 ready-to-publish captions — one for Facebook, Instagram, and LinkedIn — in the language you choose, all linking back to your AHO listing. No signup to see the preview.',
    button: 'Try free audit',
  },
  es: {
    eyebrow: 'Para agentes inmobiliarios',
    headline: 'Pega la URL de tu anuncio. Recibe una campaña completa en 60 segundos.',
    sub: '3 textos listos para publicar — uno para Facebook, Instagram y LinkedIn — en el idioma que elijas, todos enlazando a tu anuncio en AHO. Sin registro para ver la vista previa.',
    button: 'Probar gratis',
  },
  pl: {
    eyebrow: 'Dla agentów nieruchomości',
    headline: 'Wklej URL swojej oferty. Otrzymaj pełną kampanię reklamową w 60 sekund.',
    sub: '3 gotowe do publikacji teksty — po jednym na Facebooka, Instagrama i LinkedIn — w wybranym przez Ciebie języku, każdy z linkiem do Twojej oferty w AHO. Bez rejestracji do podglądu.',
    button: 'Wypróbuj bezpłatnie',
  },
  pt: {
    eyebrow: 'Para agentes imobiliários',
    headline: 'Cole o URL do seu anúncio. Obtenha uma campanha completa em 60 segundos.',
    sub: '3 textos prontos a publicar — um para Facebook, Instagram e LinkedIn — no idioma que escolher, todos com o link para o seu anúncio no AHO. Sem registo para ver a pré-visualização.',
    button: 'Experimentar grátis',
  },
  de: {
    eyebrow: 'Für Immobilienmakler',
    headline: 'Inserat-URL einfügen. Komplette Anzeigenkampagne in 60 Sekunden.',
    sub: '3 veröffentlichungsbereite Texte — je einer für Facebook, Instagram und LinkedIn — in der von Ihnen gewählten Sprache, alle mit Link zu Ihrem AHO-Inserat. Kein Login für die Vorschau.',
    button: 'Kostenlos testen',
  },
  fr: {
    eyebrow: 'Pour les agents immobiliers',
    headline: 'Collez l’URL de votre annonce. Recevez une campagne publicitaire complète en 60 secondes.',
    sub: '3 textes prêts à publier — un pour Facebook, Instagram et LinkedIn — dans la langue que vous choisissez, tous avec le lien vers votre annonce AHO. Sans inscription pour voir l’aperçu.',
    button: 'Essayer gratuitement',
  },
  it: {
    eyebrow: 'Per agenti immobiliari',
    headline: 'Incolla l’URL del tuo annuncio. Ottieni una campagna pubblicitaria completa in 60 secondi.',
    sub: '3 testi pronti da pubblicare — uno per Facebook, Instagram e LinkedIn — nella lingua che scegli, tutti con il link al tuo annuncio AHO. Nessuna registrazione per vedere l’anteprima.',
    button: 'Prova gratis',
  },
};

/**
 * Agent-wedge strip on the homepage. Positioned BETWEEN the buyer-side
 * content (hero search + featured listings + recently viewed) and the
 * Pro Automation ($99/mo) pitch, so the agent who scrolled past the
 * buyer surface hits the LOW-commitment Free Audit funnel before the
 * paid tier pitch. Ascending-commitment funnel: browse → audit (free) →
 * subscribe (paid).
 *
 * Visually consistent with the per-locale Free Audit CTA at the end of
 * every blog article — same emerald accent so visitors recognize the
 * Free Audit branding across surfaces.
 */
export function AgentWedgeStrip({ locale }: Props) {
  const copy = COPY[locale] ?? COPY.en;
  const forAgentsHref = `${localePath(locale, '/for-agents')}#free-audit`;

  return (
    <section className="mx-auto max-w-6xl px-6 py-12">
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 md:p-10 dark:border-emerald-800 dark:bg-emerald-950/30">
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-3xl">
            <p className="font-brand text-[13px] font-semibold uppercase tracking-[0.13em] text-emerald-700 dark:text-emerald-300">
              {copy.eyebrow}
            </p>
            <h2 className="mt-3 font-brand text-2xl font-semibold tracking-tight text-slate-900 md:text-[32px] md:leading-[1.15] dark:text-slate-100">
              {copy.headline}
            </h2>
            <p className="mt-3 text-base leading-relaxed text-slate-700 md:text-lg dark:text-slate-300">
              {copy.sub}
            </p>
          </div>
          <Link
            href={forAgentsHref}
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-emerald-600 px-6 py-3 text-base font-semibold text-white hover:bg-emerald-700 md:px-7 md:py-3.5"
          >
            {copy.button} →
          </Link>
        </div>
      </div>
    </section>
  );
}
